import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { createHmac, timingSafeEqual } from 'crypto';

// Constants
const ALLOWED_USER_IDS = ['U6AHGJPPZ'];
const TODOIST_API_BASE = 'https://api.todoist.com/rest/v2';
const SIGNATURE_MAX_AGE_SECONDS = 300;

// Types
interface TaskDuration {
  amount: number;
  unit: 'minute' | 'day';
}

interface TodoistTask {
  id: string;
  content: string;
  description: string;
  priority: number;
  due?: {
    date: string;
    datetime?: string;
    string: string;
  };
  duration?: TaskDuration;
  project_id: string;
  labels: string[];
  is_completed: boolean;
}

interface SlackBlock {
  type: string;
  text?: {
    type: string;
    text: string;
    emoji?: boolean;
  };
  elements?: Array<{
    type: string;
    text: string;
  }>;
}

interface SlackResponse {
  response_type: 'ephemeral' | 'in_channel';
  blocks?: SlackBlock[];
  text: string;
}

function parseSlackBody(body: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(body));
}

function verifySlackSignature(
  signingSecret: string,
  signature: string,
  timestamp: string,
  body: string
): boolean {
  const timestampSeconds = parseInt(timestamp, 10);
  const cutoffTime = Math.floor(Date.now() / 1000) - SIGNATURE_MAX_AGE_SECONDS;

  if (timestampSeconds < cutoffTime) {
    return false;
  }

  const baseString = `v0:${timestamp}:${body}`;
  const expectedSignature = 'v0=' + createHmac('sha256', signingSecret)
    .update(baseString)
    .digest('hex');

  return timingSafeEqual(
    Buffer.from(expectedSignature, 'utf8'),
    Buffer.from(signature, 'utf8')
  );
}

async function fetchTodayTasks(apiToken: string): Promise<TodoistTask[]> {
  const filter = encodeURIComponent('today & #Work');
  const url = `${TODOIST_API_BASE}/tasks?filter=${filter}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });

  if (!response.ok) {
    throw new Error(`Todoist API error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<TodoistTask[]>;
}

const PRIORITY_LABELS: Record<number, string> = {
  4: '🔥P1',
  3: '⚡P2',
  2: '📌P3',
};

function getPriorityLabel(priority: number): string {
  return PRIORITY_LABELS[priority] ?? '';
}

function formatDuration(duration?: TaskDuration): string {
  if (!duration) {
    return '';
  }

  if (duration.unit === 'day') {
    return ` ⏱️${duration.amount}d`;
  }

  const hours = Math.floor(duration.amount / 60);
  const minutes = duration.amount % 60;

  if (hours === 0) {
    return ` ⏱️${minutes}m`;
  }
  if (minutes === 0) {
    return ` ⏱️${hours}h`;
  }
  return ` ⏱️${hours}h${minutes}m`;
}

function formatDueTime(datetime: string): string {
  const time = new Date(datetime).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
  return ` _(${time})_`;
}

function formatTaskLine(task: TodoistTask): string {
  const priority = getPriorityLabel(task.priority);
  const priorityStr = priority ? ` [${priority}]` : '';
  const dueTime = task.due?.datetime ? formatDueTime(task.due.datetime) : '';
  const duration = formatDuration(task.duration);

  return `• ${task.content}${priorityStr}${duration}${dueTime}`;
}

function formatTasksForSlack(tasks: TodoistTask[]): SlackResponse {
  if (tasks.length === 0) {
    return {
      response_type: 'ephemeral',
      text: 'No tasks for today! 🎉',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*No tasks for today!* 🎉\nEnjoy your free time or add some tasks in Todoist.',
          },
        },
      ],
    };
  }

  const taskLines = tasks.map(formatTaskLine);
  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `📋 Today's Tasks (${tasks.length})`,
        emoji: true,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: taskLines.join('\n'),
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: '_Fetched from Todoist_',
        },
      ],
    },
  ];

  return {
    response_type: 'ephemeral',
    text: `Today's Tasks (${tasks.length}): ${taskLines.join(', ')}`,
    blocks,
  };
}

function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function slackErrorResponse(text: string): APIGatewayProxyResultV2 {
  return jsonResponse(200, { response_type: 'ephemeral', text });
}

function getRequestBody(event: APIGatewayProxyEventV2): string {
  const body = event.body ?? '';
  if (event.isBase64Encoded && body) {
    return Buffer.from(body, 'base64').toString('utf-8');
  }
  return body;
}

export async function handler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  const todoistToken = process.env.TODOIST_API_TOKEN;
  const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;

  if (!todoistToken || !slackSigningSecret) {
    console.error('Missing required environment variables');
    return jsonResponse(500, { text: 'Server configuration error' });
  }

  const signature = event.headers['x-slack-signature'] ?? '';
  const timestamp = event.headers['x-slack-request-timestamp'] ?? '';
  const body = getRequestBody(event);

  if (!verifySlackSignature(slackSigningSecret, signature, timestamp, body)) {
    console.error('Invalid Slack signature');
    return jsonResponse(401, { text: 'Invalid request signature' });
  }

  const slackParams = parseSlackBody(body);
  const userId = slackParams.user_id;

  if (!ALLOWED_USER_IDS.includes(userId)) {
    return slackErrorResponse(
      '🔒 This is a test app by Anil. Please reach out to anil@beneathatree.com if you need access.'
    );
  }

  try {
    const tasks = await fetchTodayTasks(todoistToken);
    return jsonResponse(200, formatTasksForSlack(tasks));
  } catch (error) {
    console.error('Error fetching tasks:', error);
    return slackErrorResponse(
      'Sorry, there was an error fetching your tasks. Please try again later.'
    );
  }
}
