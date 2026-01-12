# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Slack-Todoist Integration - A serverless AWS Lambda function that provides a `/today` Slack slash command to fetch and display Todoist tasks for the current day.

## Build and Development Commands

```bash
# Install dependencies
npm install

# Build with SAM (compiles TypeScript via esbuild)
npm run build

# Deploy (first time - interactive guided deployment)
npm run deploy

# Deploy (subsequent deployments)
npm run deploy:prod

# Test locally with SAM
npm run local

# Type check
npm run typecheck

# Lint
npm run lint
```

## Architecture

```
Slack /today → API Gateway (HTTP API) → Lambda (today.ts) → Todoist REST API
```

**Key components:**
- `template.yaml` - SAM template defining Lambda function, API Gateway, and parameters
- `src/handlers/today.ts` - Lambda handler that verifies Slack signatures, fetches Todoist tasks, and formats the response

**External APIs:**
- Todoist REST API v2 (`GET /tasks?filter=today`)
- Slack Block Kit for response formatting

**Environment variables (set via SAM parameters):**
- `TODOIST_API_TOKEN` - Personal Todoist API token
- `SLACK_SIGNING_SECRET` - Slack app signing secret for request verification

## Setup Requirements

1. AWS CLI configured with credentials
2. SAM CLI installed
3. Slack App created with slash command pointing to deployed API Gateway URL
4. Todoist API token from Settings > Integrations > Developer
