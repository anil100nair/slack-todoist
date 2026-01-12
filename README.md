# Slack-Todoist Integration

A serverless Slack slash command that fetches your today's tasks from Todoist. Type `/today` in Slack and instantly see your tasks for the day.

![Architecture](https://img.shields.io/badge/AWS-Lambda-orange) ![Runtime](https://img.shields.io/badge/Node.js-20.x-green) ![IaC](https://img.shields.io/badge/IaC-AWS%20SAM-blue)

## Features

- `/today` slash command to fetch Todoist tasks
- Filters tasks by project (currently set to "Work")
- Displays task priority with visual indicators (🔥P1, ⚡P2, 📌P3)
- Shows task duration if set
- Shows scheduled time for time-specific tasks
- Slack signature verification for security
- User authorization to restrict access

## Architecture

```
Slack /today → API Gateway (HTTP API) → AWS Lambda → Todoist REST API
                                              ↓
                                    Formatted response back to Slack
```

## Prerequisites

- [Node.js](https://nodejs.org/) 20.x or higher
- [AWS CLI](https://aws.amazon.com/cli/) configured with credentials
- [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)
- [esbuild](https://esbuild.github.io/) installed globally (`npm install -g esbuild`)
- A Slack workspace where you can create apps
- A Todoist account

## Setup

### 1. Clone and Install

```bash
git clone <repository-url>
cd slack-todoist-integration
npm install
```

### 2. Get Your Todoist API Token

1. Go to [Todoist Settings](https://todoist.com/app/settings/integrations/developer)
2. Scroll to "API token"
3. Copy your token

### 3. Create a Slack App

1. Go to [Slack API Apps](https://api.slack.com/apps)
2. Click **Create New App** → **From scratch**
3. Name your app (e.g., "Todoist Today") and select your workspace
4. Go to **Basic Information** → **App Credentials**
5. Copy the **Signing Secret**

### 4. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and add your credentials:

```
TODOIST_API_TOKEN=your_todoist_api_token
SLACK_SIGNING_SECRET=your_slack_signing_secret
```

### 5. Configure User Access

Edit `src/handlers/today.ts` and add your Slack member ID to the `ALLOWED_USER_IDS` array:

```typescript
const ALLOWED_USER_IDS = ['YOUR_SLACK_MEMBER_ID'];
```

To find your Slack member ID:
1. Click your profile picture in Slack
2. Click **Profile**
3. Click the **⋮** menu → **Copy member ID**

### 6. Configure Project Filter (Optional)

By default, tasks are filtered to the "Work" project. To change this, edit `src/handlers/today.ts`:

```typescript
const filter = encodeURIComponent('today & #YourProjectName');
```

Or to show all today's tasks:

```typescript
const filter = encodeURIComponent('today');
```

### 7. Deploy

```bash
npm run build
npm run deploy
```

The deployment will output your API Gateway endpoint URL:

```
TodayApiEndpoint: https://xxxxxxxxxx.execute-api.ap-south-1.amazonaws.com/slack/today
```

### 8. Configure Slack Slash Command

1. Go back to your [Slack App](https://api.slack.com/apps)
2. Click **Slash Commands** → **Create New Command**
3. Fill in:
   - **Command:** `/today`
   - **Request URL:** `<your API Gateway endpoint from step 7>`
   - **Short Description:** Get today's Todoist tasks
4. Click **Save**
5. Go to **Install App** → **Install to Workspace**

### 9. Test It

Type `/today` in any Slack channel!

## Usage

```
/today
```

Example output:

```
📋 Today's Tasks (3)

• Review PR for auth feature [🔥P1] ⏱️1h30m _(3:00 PM)_
• Update documentation [⚡P2] ⏱️45m
• Team standup ⏱️15m _(10:00 AM)_

Fetched from Todoist
```

## Development

### Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Build with SAM |
| `npm run deploy` | Build and deploy to AWS |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run lint` | Run ESLint |
| `npm run local` | Test Lambda locally with SAM |

### Project Structure

```
├── src/
│   └── handlers/
│       └── today.ts       # Lambda handler
├── events/
│   └── today.json         # Test event for local testing
├── template.yaml          # SAM template
├── samconfig.toml         # SAM deployment config
├── package.json
├── tsconfig.json
└── .env                   # Local secrets (not committed)
```

## Configuration

### AWS Region

The default region is set to `ap-south-1` (Mumbai) in `samconfig.toml`. To change it:

```toml
[default.global.parameters]
region = "us-east-1"  # Change to your preferred region
```

### AWS Profile

The default AWS profile is `beneathatree-cli`. To change it, edit `samconfig.toml`:

```toml
[default.global.parameters]
profile = "your-aws-profile"
```

## Current Limitations

- **Single-user authorization**: User access is controlled via a hardcoded array of Slack member IDs. OAuth-based multi-user support is planned for a future release.
- **Single Todoist account**: Currently uses a single Todoist API token. Multi-user support will require OAuth integration with Todoist.

## Security

- All requests are verified using Slack's signing secret
- Secrets are stored in environment variables, not in code
- `.env` file is gitignored to prevent accidental commits
- User authorization restricts who can use the command

## License

MIT

## Author

Anil - [anil@beneathatree.com](mailto:anil@beneathatree.com)
