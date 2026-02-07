# Quick Implementation Guide - AI One-Shot Reference

This is a condensed checklist for implementing the entire Vercel backend in one shot. Follow these steps sequentially.

---

## Setup (5 minutes)

### 1. Initialize Next.js Project
```bash
npx create-next-app@latest vercel-backend --typescript --app --no-tailwind
cd vercel-backend
```

### 2. Install Dependencies
```bash
npm install @vercel/kv octokit
npm install -D @types/node typescript
```

### 3. Create Directory Structure
```
app/
  api/
    check_status/
      route.ts
    post_status/
      route.ts
    graph/
      route.ts
    cleanup_stale_locks/
      route.ts
lib/
  kv.ts
  github.ts
  locks.ts
  graph.ts
  parser.ts
  resolver.ts
  graph-service.ts
vercel.json
.env.local
```

---

## Core Files Implementation

### File 1: `lib/kv.ts` (3 lines)
```typescript
import { kv } from '@vercel/kv';
export { kv };
```

### File 2: `lib/github.ts` (~40 lines)
- Import Octokit
- Export configured client
- Add `parseRepoUrl()` helper
- Add `getRepoHead()` helper
**Copy from:** `vercel_app.md` lines 150-180

### File 3: `lib/locks.ts` (~200 lines)
- Define `LockEntry` interface
- Implement `acquireLocks()` with Lua script
- Implement `releaseLocks()` with Lua script
- Implement `getLocks()` and `checkLocks()`
**Copy from:** `vercel_app.md` lines 200-400

### File 4: `lib/parser.ts` (~100 lines)
- Define `ParsedImport` interface
- Implement `parseImports()` for TS/JS/Python
- Implement `getFileLanguage()`
- Implement `isRelativeImport()`
**Copy from:** `vercel_app_graph.md` Section 2

### File 5: `lib/resolver.ts` (~80 lines)
- Implement `resolveImportPath()`
- Implement `resolvePath()` helper
- Implement `generateCandidates()` helper
- Implement `ImportResolver` class with cache
**Copy from:** `vercel_app_graph.md` Section 3

### File 6: `lib/graph.ts` (~150 lines)
- Define `GraphNode`, `GraphEdge`, `DependencyGraph` interfaces
- Implement `generateGraph()`
- Implement `getGraph()`
**Copy from:** `vercel_app.md` lines 600-750

### File 7: `lib/graph-service.ts` (~200 lines)
- Implement `GraphService` class
- Methods: `getCached()`, `needsUpdate()`, `generate()`, `get()`
**Copy from:** `vercel_app_graph.md` Section 14

---

## API Routes Implementation

### Route 1: `app/api/check_status/route.ts` (~60 lines)
```typescript
export async function POST(request: NextRequest) {
  // 1. Parse body: repo_url, branch, file_paths, agent_head
  // 2. Get repo HEAD from GitHub
  // 3. Check if agent is stale
  // 4. Get locks for files
  // 5. Build orchestration command
  // 6. Return response
}
```
**Copy from:** `vercel_app.md` lines 420-480

### Route 2: `app/api/post_status/route.ts` (~100 lines)
```typescript
export async function POST(request: NextRequest) {
  // 1. Parse body: repo_url, branch, file_paths, status, message, agent_head
  // 2. Get repo HEAD from GitHub
  // 3. If status=OPEN: release locks
  // 4. If status=WRITING: validate freshness, acquire locks
  // 5. Return success or rejection
}
```
**Copy from:** `vercel_app.md` lines 490-590

### Route 3: `app/api/graph/route.ts` (~40 lines)
```typescript
export async function GET(request: NextRequest) {
  // 1. Parse query params: repo_url, branch, regenerate
  // 2. Create GraphService
  // 3. Get graph (with auto-regeneration)
  // 4. Return JSON
}
```
**Copy from:** `vercel_app_graph.md` Section 14

### Route 4: `app/api/cleanup_stale_locks/route.ts` (~60 lines)
```typescript
export async function GET(request: NextRequest) {
  // 1. Verify cron secret
  // 2. Get all lock keys
  // 3. Check expiry timestamps
  // 4. Delete expired locks
  // 5. Return cleanup stats
}
```
**Copy from:** `vercel_app.md` lines 750-810

---

## Configuration Files

### `vercel.json`
```json
{
  "framework": "nextjs",
  "crons": [
    {
      "path": "/api/cleanup_stale_locks",
      "schedule": "* * * * *"
    }
  ]
}
```

### `.env.local`
```bash
KV_REST_API_URL="https://your-kv.kv.vercel-storage.com"
KV_REST_API_TOKEN="your_token"
GITHUB_TOKEN="ghp_your_github_token"
CRON_SECRET="random_secret_123"
```

---

## Implementation Checklist

### Phase 1: Core Infrastructure (15 min)
- [ ] Create Next.js project
- [ ] Install dependencies
- [ ] Create directory structure
- [ ] Set up `lib/kv.ts`
- [ ] Set up `lib/github.ts`

### Phase 2: Lock Management (30 min)
- [ ] Implement `lib/locks.ts` with Lua scripts
- [ ] Add TypeScript interfaces
- [ ] Test lock acquisition logic

### Phase 3: Graph Parsing (45 min)
- [ ] Implement `lib/parser.ts` for import parsing
- [ ] Implement `lib/resolver.ts` for path resolution
- [ ] Add test cases for edge cases

### Phase 4: Graph Generation (45 min)
- [ ] Implement `lib/graph.ts` basic functions
- [ ] Implement `lib/graph-service.ts` class
- [ ] Add incremental update logic

### Phase 5: API Routes (30 min)
- [ ] Implement `check_status` endpoint
- [ ] Implement `post_status` endpoint
- [ ] Implement `graph` endpoint
- [ ] Implement `cleanup_stale_locks` endpoint

### Phase 6: Configuration (10 min)
- [ ] Create `vercel.json` with cron config
- [ ] Set up `.env.local`
- [ ] Add TypeScript config if needed

### Phase 7: Testing (30 min)
- [ ] Test lock acquisition (single file)
- [ ] Test lock acquisition (multi-file atomic)
- [ ] Test lock conflicts
- [ ] Test graph generation on small repo
- [ ] Test incremental graph updates
- [ ] Test API endpoints with curl

### Phase 8: Deployment (15 min)
- [ ] Deploy to Vercel: `vercel`
- [ ] Add Vercel KV storage in dashboard
- [ ] Configure environment variables
- [ ] Verify cron job is running
- [ ] Test deployed endpoints

---

## Testing Commands

### Test Lock System
```bash
# Acquire lock
curl -X POST http://localhost:3000/api/post_status \
  -H "Content-Type: application/json" \
  -H "x-github-user: user1" \
  -H "x-github-username: User 1" \
  -d '{
    "repo_url": "https://github.com/user/repo",
    "branch": "main",
    "file_paths": ["src/test.ts"],
    "status": "WRITING",
    "message": "Testing locks",
    "agent_head": "abc123"
  }'

# Check status
curl -X POST http://localhost:3000/api/check_status \
  -H "Content-Type: application/json" \
  -d '{
    "repo_url": "https://github.com/user/repo",
    "branch": "main",
    "file_paths": ["src/test.ts"],
    "agent_head": "abc123"
  }'
```

### Test Graph System
```bash
# Generate graph
curl "http://localhost:3000/api/graph?repo_url=https://github.com/user/repo&branch=main&regenerate=true"

# Get cached graph
curl "http://localhost:3000/api/graph?repo_url=https://github.com/user/repo&branch=main"
```

---

## Common Issues & Quick Fixes

### Issue: "Cannot find module '@vercel/kv'"
```bash
npm install @vercel/kv
```

### Issue: "GitHub API rate limit exceeded"
- Get GitHub token: https://github.com/settings/tokens
- Add to `.env.local`: `GITHUB_TOKEN=ghp_...`

### Issue: "Redis connection error"
- Deploy to Vercel first
- Add KV storage in dashboard
- Copy connection vars to `.env.local`

### Issue: "Cron job not running"
- Check `vercel.json` cron configuration
- Verify `CRON_SECRET` is set
- Check Vercel dashboard → Cron Jobs

### Issue: "Import resolution fails"
- Check file extensions in regex
- Verify relative path logic
- Test with simple repo first

---

## Performance Optimization (Optional)

### If graph generation is slow:
```typescript
// Parallel file fetching (in batches)
const BATCH_SIZE = 10;
for (let i = 0; i < files.length; i += BATCH_SIZE) {
  const batch = files.slice(i, i + BATCH_SIZE);
  await Promise.all(batch.map(f => processFile(f)));
}
```

### If Redis is slow:
```typescript
// Use pipelining
const pipeline = kv.pipeline();
keys.forEach(key => pipeline.get(key));
const results = await pipeline.exec();
```

### If GitHub API rate limits hit:
```typescript
// Cache file tree for 60 seconds
const cache = new Map();
// Check cache before API call
```

---

## Verification Checklist

Before marking as complete, verify:

- [ ] `POST /api/check_status` returns locks correctly
- [ ] `POST /api/post_status` acquires locks atomically
- [ ] `POST /api/post_status` rejects conflicts
- [ ] `POST /api/post_status` validates stale repos
- [ ] `GET /api/graph` returns valid graph
- [ ] Graph includes nodes and edges
- [ ] Locks are overlaid on graph
- [ ] Cron job cleans expired locks (wait 5 min)
- [ ] All endpoints return proper error messages
- [ ] Environment variables are set correctly

---

## Time Estimates

| Task | Estimate |
|------|----------|
| Setup project | 5 min |
| Implement lib files | 60 min |
| Implement API routes | 30 min |
| Configuration | 10 min |
| Local testing | 20 min |
| Deploy to Vercel | 10 min |
| Production testing | 15 min |
| **Total** | **2.5 hours** |

---

## Success Criteria

✅ **System is working when:**
1. You can acquire a lock on a file
2. Another user gets rejected for the same file
3. Locks expire after 5 minutes
4. Graph shows file dependencies
5. Graph overlays lock status
6. Stale repos are detected
7. Multi-file locks are atomic
8. Cron job runs every minute

---

## Reference Documents

- **Complete code:** `vercel_app.md`
- **Graph implementation:** `vercel_app_graph.md`
- **Data schemas:** `schema.md`
- **API specs:** `api_endpoints_review.md`

---

## Quick Links

- Vercel KV Docs: https://vercel.com/docs/storage/vercel-kv
- Octokit Docs: https://github.com/octokit/octokit.js
- Next.js App Router: https://nextjs.org/docs/app
- GitHub API: https://docs.github.com/en/rest

---

## Final Notes

- **Don't overthink** - Copy the code examples as-is
- **Test incrementally** - Verify each component before moving on
- **Use console.log** - Add logging for debugging
- **Start simple** - Test with small repo first
- **Read errors carefully** - Error messages usually point to the issue

**Good luck! 🚀**
