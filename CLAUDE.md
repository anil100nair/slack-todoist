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

# Deploy (sources secrets from .env file)
npm run deploy

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
- `samconfig.toml` - SAM deployment config (region: ap-south-1, profile: beneathatree-cli)
- `src/handlers/today.ts` - Lambda handler that verifies Slack signatures, fetches Todoist tasks, and formats the response
- `.env` - Local secrets file (not committed, see `.env.example`)

**External APIs:**
- Todoist REST API v2 (`GET /tasks?filter=today & #Work`)
- Slack Block Kit for response formatting

**Environment variables (set via .env file and passed to SAM):**
- `TODOIST_API_TOKEN` - Personal Todoist API token
- `SLACK_SIGNING_SECRET` - Slack app signing secret for request verification

## Setup Requirements

1. AWS CLI configured with `beneathatree-cli` profile
2. SAM CLI installed (and esbuild globally: `npm install -g esbuild`)
3. Copy `.env.example` to `.env` and fill in secrets
4. Slack App created with `/today` slash command pointing to deployed API Gateway URL
5. Todoist API token from Settings > Integrations > Developer
