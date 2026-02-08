# Relay (DevFest 2026)

Relay is a Next.js + Vercel KV coordination backend with a dependency-graph UI and an MCP server for agent workflows.

## What’s implemented

- Graph API with lock overlay (`GET /api/graph`)
- Coordination APIs:
  - `POST /api/check_status`
  - `POST /api/post_status`
- Neighbor-aware conflict signaling and orchestration commands
- Lock cleanup cron endpoint (`GET /api/cleanup_stale_locks`)
- Frontend graph viewer with force-style node motion
- GitHub OAuth for UI repo selection (`next-auth`)
- MCP server in `/mcp` with `check_status` and `post_status` tools

## Tech stack

- Next.js 14, React 18, TypeScript
- Vercel KV (Upstash Redis)
- GitHub API via Octokit
- NextAuth (GitHub provider)
- MCP server (`dedalus-mcp`, Python)

## Project layout

- `app/` Next.js app + API routes
- `lib/` graph/lock/github services
- `mcp/` Python MCP server
- `tests/` Vitest tests for app routes/libs

## Local setup

### 1. Install app dependencies

```bash
npm install
```

### 2. Configure environment

Create `.env` (or `.env.local`) in project root:

```bash
KV_REST_API_URL=...
KV_REST_API_TOKEN=...
CRON_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
NEXTAUTH_SECRET=...
NEXTAUTH_URL=http://localhost:3000

# Optional, used when no user token is available for some graph calls
GITHUB_TOKEN=...
```

### 3. Run app

```bash
npm run dev
```

Open `http://localhost:3000`.

## Useful scripts

- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run typecheck`
- `npm run test`

## API quick checks

```bash
curl -X POST http://localhost:3000/api/check_status -H "Content-Type: application/json" -d '{}'
curl -X POST http://localhost:3000/api/post_status -H "Content-Type: application/json" -d '{}'
curl "http://localhost:3000/api/graph"
curl -i http://localhost:3000/api/cleanup_stale_locks
```

## Connect and deploy to Vercel

### 1. Connect local repo to your Vercel project

```bash
npm i -g vercel
vercel login
vercel link
```

`vercel link` connects this folder to a Vercel project.

### 2. Add Vercel KV to the project

- In Vercel Dashboard: `Storage` -> `Create Database` -> `KV` (Upstash)
- Attach it to the same project/environment(s)
- Vercel will provide/inject:
  - `KV_REST_API_URL`
  - `KV_REST_API_TOKEN`

### 3. Set required Vercel environment variables

In `Project Settings -> Environment Variables`, set:

- `CRON_SECRET`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL` = your production URL, e.g. `https://your-app.vercel.app`
- `GITHUB_TOKEN` (optional fallback)

### 4. Configure GitHub OAuth app callback

In your GitHub OAuth App settings:

- Homepage URL: `https://your-app.vercel.app`
- Authorization callback URL: `https://your-app.vercel.app/api/auth/callback/github`

### 5. Deploy

```bash
vercel --prod
```

The cron in `vercel.json` is configured to call `/api/cleanup_stale_locks` daily at `03:00` UTC.

## MCP server (Python)

### Run locally

```bash
uv run --project mcp python mcp/main.py
```

Server endpoint: `http://0.0.0.0:8000/mcp`

### Point MCP to your deployed Vercel app

Set before starting MCP:

```bash
export VERCEL_API_URL="https://your-app.vercel.app"
```

MCP tools forward calls to:

- `POST /api/check_status`
- `POST /api/post_status`

## Testing

```bash
npm run typecheck
npm test
uv run --project mcp --with pytest pytest mcp/tests/test_models.py
```
