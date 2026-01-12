# Roadmap

Future directions for the Slack-Todoist integration.

## Phase 1: Multi-user OAuth + Storage

**Goal:** Allow each Slack user to connect their own Todoist account.

### Requirements
- Todoist OAuth flow (authorization code grant)
- Storage for user tokens (DynamoDB recommended)
- Token refresh handling
- User onboarding flow (`/todoist connect`)

### Storage Options
| Option | Pros | Cons |
|--------|------|------|
| DynamoDB | Serverless, pay-per-use, fits Lambda | Slightly more setup |
| S3 | Simple JSON storage | Not ideal for frequent reads |
| Slack built-in | No extra infra | Limited capacity |

### Database Schema (DynamoDB)
```
Table: todoist-users
- slack_user_id (PK)
- todoist_access_token
- todoist_refresh_token
- token_expires_at
- default_project_filter
- created_at
- updated_at
```

## Phase 2: Mark Complete from Slack

**Goal:** Add interactive buttons to mark tasks done without leaving Slack.

- Use Slack Block Kit interactive components
- Add "Complete" button next to each task
- Handle button click via new Lambda endpoint
- Call Todoist API to close task

## Phase 3: Quick Add Tasks

**Goal:** Create tasks directly from Slack.

```
/todoist add Buy groceries #Personal
/todoist add Call mom tomorrow at 5pm @urgent
```

- Parse natural language for due dates
- Support project and label syntax
- Use Todoist's quick add API (handles natural language)

## Phase 4: User Preferences

**Goal:** Let users customize their experience.

```
/todoist config
```

- Default project filter
- Default view (today/week)
- Notification preferences
- Timezone setting

Store preferences in DynamoDB user record.

## Phase 5: Daily Digest & Notifications

**Goal:** Proactive task reminders.

### Daily Digest
- EventBridge scheduled rule (e.g., 8 AM user's timezone)
- Lambda fetches tasks and posts to user's DM
- Slack incoming webhook or chat.postMessage API

### Due Soon Alerts
- Poll for upcoming tasks (or use Todoist webhooks if available)
- DM user 15 minutes before time-specific tasks

## Additional Feature Ideas

### Different Views
- `/tomorrow` - Tomorrow's tasks
- `/week` - This week's tasks
- `/overdue` - Overdue tasks

### Label Filtering
```
/today @urgent
/today @waiting
```

### Project Switcher
```
/today #Personal
/today #Work
```

## Technical Considerations

### OAuth Flow
1. User runs `/todoist connect`
2. Bot responds with Todoist OAuth URL
3. User authorizes, Todoist redirects to our callback
4. Callback Lambda exchanges code for token
5. Store token in DynamoDB
6. Confirm connection in Slack

### New AWS Resources Needed
- DynamoDB table
- Additional Lambda for OAuth callback
- API Gateway route for OAuth callback
- IAM permissions for DynamoDB access

### Slack App Updates
- Add OAuth redirect URL to Slack app
- Request additional scopes if needed (chat:write for DMs)
