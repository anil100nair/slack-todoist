import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { createHmac, timingSafeEqual } from 'crypto';

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

function verifySlackSignature(
  signingSecret: string,
  signature: string,
  timestamp: string,
  body: string
): boolean {
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5;
  if (parseInt(timestamp, 10) < fiveMinutesAgo) {
    return false;
  }

  const sigBasestring = `v0:${timestamp}:${body}`;
  const mySignature = 'v0=' + createHmac('sha256', signingSecret)
    .update(sigBasestring)
    .digest('hex');

  return timingSafeEqual(
    Buffer.from(mySignature, 'utf8'),
    Buffer.from(signature, 'utf8')
  );
}

async function fetchTodayTasks(apiToken: string): Promise<TodoistTask[]> {
  const response = await fetch('https://api.todoist.com/rest/v2/tasks?filter=today', {
    headers: {
      'Authorization': `Bearer ${apiToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Todoist API error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<TodoistTask[]>;
}

function getPriorityEmoji(priority: number): string {
  // Todoist priority: 4 = highest (p1), 1 = lowest (p4)
  switch (priority) {
    case 4: return '🔴';
    case 3: return '🟠';
    case 2: return '🔵';
    default: return '⚪';
  }
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

  const taskLines = tasks.map((task) => {
    const priority = getPriorityEmoji(task.priority);
    const dueTime = task.due?.datetime
      ? ` _(${new Date(task.due.datetime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })})_`
      : '';
    return `${priority} ${task.content}${dueTime}`;
  });

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
          text: `_Fetched from Todoist at ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}_`,
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

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const todoistToken = process.env.TODOIST_API_TOKEN;
  const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;

  if (!todoistToken || !slackSigningSecret) {
    console.error('Missing required environment variables');
    return {
      statusCode: 500,
      body: JSON.stringify({ text: 'Server configuration error' }),
    };
  }

  // Verify Slack signature
  const signature = event.headers['x-slack-signature'] ?? '';
  const timestamp = event.headers['x-slack-request-timestamp'] ?? '';
  const body = event.body ?? '';

  if (!verifySlackSignature(slackSigningSecret, signature, timestamp, body)) {
    console.error('Invalid Slack signature');
    return {
      statusCode: 401,
      body: JSON.stringify({ text: 'Invalid request signature' }),
    };
  }

  try {
    const tasks = await fetchTodayTasks(todoistToken);
    const response = formatTasksForSlack(tasks);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error fetching tasks:', error);
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        response_type: 'ephemeral',
        text: 'Sorry, there was an error fetching your tasks. Please try again later.',
      }),
    };
  }
};
