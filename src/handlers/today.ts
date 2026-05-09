import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { createHmac, timingSafeEqual } from 'crypto';

// Constants
const ALLOWED_USER_IDS = ['U6AHGJPPZ'];
const TODOIST_API_BASE = 'https://api.todoist.com/api/v1';
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
    date: string;   // YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS (floating) or YYYY-MM-DDTHH:MM:SSZ (UTC)
    timezone: string | null;
    string: string;
    is_recurring?: boolean;
    lang?: string;
  };
  duration?: TaskDuration;
  project_id: string;
  labels: string[];
  is_completed: boolean;
}

interface CompletedTaskItem {
  due?: {
    date: string;
    datetime?: string;
  };
  duration?: TaskDuration;
  priority: number;
}

interface CompletedTask {
  id: string;
  task_id: string;
  content: string;
  project_id: string;
  completed_at: string;
  item_object?: CompletedTaskItem;
}

interface CompletedTasksResponse {
  items: CompletedTask[];
}


interface SlackBlock {
  type: 'header' | 'section' | 'context' | 'divider';
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

interface SlackUserInfo {
  ok: boolean;
  user?: {
    tz: string;
  };
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
  const filter = encodeURIComponent('today');
  const url = `${TODOIST_API_BASE}/tasks?filter=${filter}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });

  if (!response.ok) {
    throw new Error(`Todoist API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as { results: TodoistTask[] };
  return data.results;
}

function getTodayDateRange(): { since: string; until: string } {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
  return {
    since: startOfDay.toISOString(),
    until: endOfDay.toISOString(),
  };
}

async function fetchCompletedTodayTasks(apiToken: string): Promise<CompletedTask[]> {
  const { since, until } = getTodayDateRange();
  const url = `${TODOIST_API_BASE}/tasks/completed?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });

  if (!response.ok) {
    throw new Error(`Todoist API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as CompletedTasksResponse;
  return data.items;
}

const PRIORITY_LABELS: Record<number, string> = {
  4: 'P1',
  3: 'P2',
  2: 'P3',
};

function getPriorityLabel(priority: number): string {
  return PRIORITY_LABELS[priority] ?? '';
}

async function fetchUserTimezone(botToken: string, userId: string): Promise<string> {
  const url = `https://slack.com/api/users.info?user=${userId}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${botToken}` },
  });

  if (!response.ok) {
    console.error(`Slack API error: ${response.status}`);
    return 'UTC';
  }

  const data = (await response.json()) as SlackUserInfo;
  if (!data.ok || !data.user?.tz) {
    console.error('Failed to get user timezone from Slack');
    return 'UTC';
  }

  return data.user.tz;
}

function formatDuration(duration?: TaskDuration): string {
  if (!duration) {
    return '';
  }

  if (duration.unit === 'day') {
    return `${duration.amount}d`;
  }

  const hours = Math.floor(duration.amount / 60);
  const minutes = duration.amount % 60;

  if (hours === 0) {
    return `${minutes}m`;
  }
  if (minutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h${minutes}m`;
}

function formatTime(datetime: string, timezone: string): string {
  // Todoist returns datetime in two formats:
  // - With Z suffix (UTC): needs timezone conversion
  // - Without Z suffix (floating): already in user's Todoist timezone, extract time directly
  if (datetime.endsWith('Z')) {
    return new Date(datetime).toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: timezone,
    });
  }

  // Floating time - extract HH:MM directly from the ISO string
  const timeMatch = datetime.match(/T(\d{2}):(\d{2})/);
  if (timeMatch) {
    return `${timeMatch[1]}:${timeMatch[2]}`;
  }

  // Fallback: parse and format without conversion
  return new Date(datetime).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function getTodayDateString(): string {
  return new Date().toISOString().substring(0, 10);
}

function getTaskDatetime(task: TodoistTask): string | undefined {
  const date = task.due?.date;
  return date?.includes('T') ? date : undefined;
}

function getTaskSortKey(task: TodoistTask): number {
  const datetime = getTaskDatetime(task);
  if (datetime) {
    return new Date(datetime).getTime();
  }
  return Number.MAX_SAFE_INTEGER;
}

function sortTasksBySchedule(tasks: TodoistTask[]): TodoistTask[] {
  return [...tasks].sort((a, b) => getTaskSortKey(a) - getTaskSortKey(b));
}

function categorizeTasks(tasks: TodoistTask[]): { today: TodoistTask[]; overdue: TodoistTask[] } {
  const todayStr = getTodayDateString();
  const today: TodoistTask[] = [];
  const overdue: TodoistTask[] = [];

  for (const task of tasks) {
    if (!task.due) continue;
    const taskDate = task.due.date.substring(0, 10);
    if (taskDate === todayStr) {
      today.push(task);
    } else if (taskDate < todayStr) {
      overdue.push(task);
    }
    // future-dated tasks (e.g. next occurrence of overdue recurring tasks): exclude
  }

  return { today, overdue };
}

function formatOverdueLabel(dateStr: string): string {
  const todayStr = getTodayDateString();
  const daysAgo = Math.round(
    (new Date(todayStr).getTime() - new Date(dateStr).getTime()) / (24 * 60 * 60 * 1000)
  );
  if (daysAgo === 1) return 'yesterday';
  if (daysAgo < 7) return `${daysAgo}d ago`;
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function stripLabels(content: string): string {
  return content.replace(/@\w+/g, '').replace(/\s+/g, ' ').trim();
}

function formatTaskMeta(duration: TaskDuration | undefined, priority: number): string {
  const meta: string[] = [];
  const d = formatDuration(duration);
  const p = getPriorityLabel(priority);
  if (d) meta.push(d);
  if (p) meta.push(p);
  return meta.length > 0 ? ` — _${meta.join(' · ')}_` : '';
}

function formatTodayTask(task: TodoistTask, index: number, timezone: string): string {
  const datetime = getTaskDatetime(task);
  const time = datetime ? `\`${formatTime(datetime, timezone)}\` ` : '';
  const content = stripLabels(task.content);
  return `${index + 1}. ${time}${content}${formatTaskMeta(task.duration, task.priority)}`;
}

function formatOverdueTask(task: TodoistTask, index: number): string {
  const label = formatOverdueLabel(task.due!.date.substring(0, 10));
  const content = stripLabels(task.content);
  return `${index + 1}. _${label}_ ${content}${formatTaskMeta(task.duration, task.priority)}`;
}

function formatCompletedTask(task: CompletedTask, index: number, timezone: string): string {
  const completedTime = formatTime(task.completed_at, timezone);
  const content = stripLabels(task.content);
  return `${index + 1}. ~${content}~ — _done ${completedTime}_`;
}

interface TasksData {
  today: TodoistTask[];
  overdue: TodoistTask[];
  completed: CompletedTask[];
  timezone: string;
}

function formatTasksForSlack(data: TasksData): SlackResponse {
  const { today, overdue, completed, timezone } = data;

  if (today.length === 0 && overdue.length === 0 && completed.length === 0) {
    return {
      response_type: 'ephemeral',
      text: 'No tasks for today!',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*No tasks for today!*\nEnjoy your free time or add some tasks in Todoist.',
          },
        },
      ],
    };
  }

  const headerParts: string[] = [];
  if (today.length > 0) headerParts.push(`${today.length} today`);
  if (overdue.length > 0) headerParts.push(`${overdue.length} overdue`);
  if (completed.length > 0) headerParts.push(`${completed.length} done`);

  const blocks: SlackBlock[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `📋 *Today's Tasks* (${headerParts.join(' · ')})`,
      },
    },
  ];

  if (today.length > 0) {
    const sorted = sortTasksBySchedule(today);
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: sorted.map((t, i) => formatTodayTask(t, i, timezone)).join('\n'),
      },
    });
  }

  if (overdue.length > 0) {
    if (today.length > 0) blocks.push({ type: 'divider' });
    const sortedOverdue = [...overdue].sort((a, b) => b.due!.date.localeCompare(a.due!.date));
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `⚠️ *Overdue*\n${sortedOverdue.map((t, i) => formatOverdueTask(t, i)).join('\n')}`,
      },
    });
  }

  if (completed.length > 0) {
    if (today.length > 0 || overdue.length > 0) blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: completed.map((t, i) => formatCompletedTask(t, i, timezone)).join('\n'),
      },
    });
  }

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: '_Fetched from Todoist_' }],
  });

  return {
    response_type: 'ephemeral',
    text: `Today's Tasks (${headerParts.join(', ')}): ${today.map((t) => t.content).join(', ')}`,
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
  const slackBotToken = process.env.SLACK_BOT_TOKEN;

  if (!todoistToken || !slackSigningSecret || !slackBotToken) {
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
    const [timezone, allActive, completed] = await Promise.all([
      fetchUserTimezone(slackBotToken, userId),
      fetchTodayTasks(todoistToken),
      fetchCompletedTodayTasks(todoistToken),
    ]);
    const { today, overdue } = categorizeTasks(allActive);
    return jsonResponse(200, formatTasksForSlack({ today, overdue, completed, timezone }));
  } catch (error) {
    console.error('Error fetching tasks:', error);
    return slackErrorResponse(
      'Sorry, there was an error fetching your tasks. Please try again later.'
    );
  }
}
