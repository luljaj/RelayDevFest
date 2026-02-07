# DevFest Vercel Coordination Backend

Guide-first implementation of the coordination backend from `IMPLEMENTATION_GUIDE.md`, with a minimal starter UI that polls `/api/graph`.

## Requirements

- Node.js 18+ (20 recommended)
- npm
- Vercel KV credentials
- GitHub token with `repo` or `public_repo` scope

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create environment file:

```bash
cp .env.example .env.local
```

3. Run locally:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

- `npm run dev` - start local server
- `npm run build` - production build
- `npm run start` - run built app
- `npm run typecheck` - TypeScript checks
- `npm run test` - run unit/smoke tests
- `npm run test:watch` - test watcher

## API Endpoints

- `POST /api/check_status`
- `POST /api/post_status`
- `GET /api/graph`
- `GET /api/cleanup_stale_locks` (cron/internal)

## Smoke Test Commands

```bash
# check_status (missing fields validation)
curl -X POST http://localhost:3000/api/check_status \
  -H "Content-Type: application/json" \
  -d '{}'

# post_status (missing fields validation)
curl -X POST http://localhost:3000/api/post_status \
  -H "Content-Type: application/json" \
  -d '{}'

# graph (missing repo_url validation)
curl "http://localhost:3000/api/graph"

# cleanup cron auth check
curl -i http://localhost:3000/api/cleanup_stale_locks
```

## Vercel Deployment

1. Deploy project:

```bash
vercel
```

2. In Vercel dashboard, add KV storage (injects `KV_*` vars).
3. Add `GITHUB_TOKEN` and `CRON_SECRET` environment variables.
4. Confirm `vercel.json` cron is active for `/api/cleanup_stale_locks`.
   - Hobby plan note: Cron runs are limited to daily schedules, so this project uses a once-per-day cleanup job.
