# Vercel Backend Architecture - Implementation Guide

> **Architecture Note:** This is an HTTP-only system. No WebSocket needed. Frontend polls for updates, MCP server makes HTTP requests to Vercel API, and all state is stored in Redis. Simple and reliable.

## Technology Stack

### Core Dependencies
```json
{
  "dependencies": {
    "@vercel/kv": "^1.0.1",
    "next": "^14.1.0",
    "octokit": "^3.1.2"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "typescript": "^5.3.3"
  }
}
```

### Runtime Environment
- **Framework:** Next.js 14+ (App Router)
- **Hosting:** Vercel (Serverless Functions)
- **Database:** Vercel KV (Redis-compatible)
- **Node Version:** 18.x or 20.x

---

## Core Design Principles

### 1. **HTTP-Only Architecture**
- **Purpose:** Simple, reliable communication between agents, MCP server, and frontend
- **Architecture:** 
  - Agents → MCP Server → HTTP POST → Vercel API Routes
  - Frontend → HTTP GET → Vercel API Routes (polling every 5 seconds)
  - All state stored in Vercel KV (Redis)
- **No WebSocket needed:** Polling is sufficient for this use case

### 2. **Data Storage**
- **Backend:** Vercel KV (Redis) ONLY
- **Schema:** Complete structure defined in `schema.md`
- **Historical Data Retention:** As long as Vercel can hold it (no explicit TTL)

### 3. **Repository State**
- **repo_head:** NOT stored in Redis
- **Source:** Fetched from GitHub API on-demand
- **Method:** `GET /repos/{owner}/{repo}/git/refs/heads/{branch}`
- **Purpose:** Real-time freshness checking

### 4. **Lock Expiration**
- **Timeout:** 300 seconds (5 minutes) of no status update (NOT heartbeat-based)
- **Cleanup:** Vercel cron job runs every 1 minute
- **Behavior:** When lock expires, status → OPEN
- **Agent Workflow:** Agent commits their own work when complete (lock expiration doesn't force anything)
- **NO Heartbeat Mechanism:** Not implemented (passive timeout only)

### 5. **Graph Generation**
- **Supported Languages:** JavaScript/TypeScript, Python only
- **Granularity:** FILE-level dependencies only (NOT function-level, NOT line-level)
- **Analysis Method:** Import/require statement parsing (NO AST parsing)
- **Lock Granularity:** File-level only. Locks apply to entire files, not functions or lines
- **Update Strategy:** Incremental "Diff & Sync"
  - **Layer 1 (Repo Check):** Compare `repo_head` SHA. If unchanged, exit.
  - **Layer 2 (File Check):** Compare GitHub Tree SHAs against Redis Hash (`coord:file_shas`).
  - **Logic:**
    - **NEW:** Path in GitHub, not in Redis → Parse & Add Node.
    - **CHANGED:** Path in both, SHAs differ → Parse & Update Edges.
    - **DELETED:** Path in Redis, not in GitHub → Remove Node & Edges.
    - **UNCHANGED:** SHAs match → Skip.
- **Dependency Parsing (Regex-based):**
  - **TS/JS:**
    - `^import\s+.*\s+from\s+['"]([^'"]+)['"]`
    - `^export\s+.*\s+from\s+['"]([^'"]+)['"]`
    - `(import|require)\(['"]([^'"]+)['"]\)`
  - **Python:**
    - `^import\s+([\w\.]+)`
    - `^from\s+([\w\.]+)\s+import`
  - **Resolution:**
    - Ignore non-relative imports (libraries).
    - Resolve relative paths (`./`, `../`).
    - Probe extensions (`.ts`, `.tsx`, `.js`, `/index.ts`, etc.) against file list.
- **Data Source:** GitHub repository at HEAD
- **Visualization:** Overlays lock status on file graph (shows which files agents are working on)

### 6. **Conflict Detection**
- **Granularity:** FILE-LEVEL only
- **Logic:** Only one agent can write to a file at a time (file-level locking)
- **Complete Rules:** See `mcp_planning.md` and `schema.md` for full lock logic

### 7. **Lock Management**
- **Updates:** ONLY current lock holder can update their own lock
- **Multi-file locking:** Atomic all-or-nothing with Redis transactions
- **Race Conditions:** Handled by Redis Lua scripts (see implementation below)

### 8. **MCP Response Freshness**
- **Caching:** NONE - every MCP request fetches fresh state from Vercel
- **GitHub API:** Called on every status check/update
- **KV Reads:** Direct reads, no caching layer

---

## REST API Endpoints

### **State Management**

#### `POST /api/check_status`
**Purpose:** Fetch current world state for agent decision-making

**Request:**
```json
{
  "user_id": "luka",
  "file_paths": ["src/auth.ts", "src/db.ts"]
}
```

**Note:** File-level granularity only. `file_paths` are full file paths, not functions/symbols.

**Response:**
```json
{
  "repo_head": "abc123def",  // Fetched from GitHub API
  "locks": {
    "src/auth.ts": {
      "user_id": "jane",
      "status": "WRITING",
      "lines": [10, 11, 12],
      "timestamp": 1707321600000
    }
  },
  "recent_activity": [...],
  "graph_version": "xyz789"
}
```

**Process:**
1. Fetch repo_head from GitHub API
2. Read locks from `coord:locks` (KV)
3. Read activity from `coord:activity` (KV)
4. Return combined state

---

#### `POST /api/post_status`
**Purpose:** Acquire/update/release lock on files

**Request:**
```json
{
  "user_id": "luka",
  "file_paths": ["src/auth.ts"],
  "status": "WRITING",  // or "OPEN", "READING"
  "message": "Refactoring authentication",
  "agent_head": "abc123def",  // Required for WRITING
  "new_repo_head": "xyz789"  // Required for OPEN (after push)
}
```

**Note:** File-level locking only. Multi-file locking is atomic (all-or-nothing).

**Response (Success):**
```json
{
  "status": "SUCCESS",
  "lock_acquired": true
}
```

**Response (Rejection - Stale):**
```json
{
  "status": "REJECTED",
  "reason": "STALE_REPO",
  "message": "Your local repo is behind. Pull and retry.",
  "server_repo_head": "abc123def",
  "your_agent_head": "old789"
}
```

**Response (Rejection - File Conflict):**
```json
{
  "status": "REJECTED",
  "reason": "FILE_CONFLICT",
  "message": "File is being modified by another user.",
  "conflicting_user": "jane@example.com",
  "conflicting_file": "src/auth.ts"
}
```

**Process:**
1. Fetch repo_head from GitHub API
2. If WRITING: Validate agent_head == repo_head
3. Check file-level conflicts in `coord:locks`
4. If OPEN: Verify new_repo_head advanced (optional)
5. Update `coord:locks` in KV
6. Log to `coord:status_log`

**Lock Update Rule:**
- ONLY the current lock holder (matching user_id) can update their own lock
- Other users get REJECTED if they try to modify a locked file
- Lock expires after 300 seconds (5 minutes) with no heartbeat mechanism

---

### **Graph Management**

#### `POST /api/generate_graph`
**Purpose:** Generate/update file dependency graph from GitHub

**Request:**
```json
{
  "repo_url": "https://github.com/user/repo",
  "branch": "main"
}
```

**Process:**
1. Authenticate with GitHub API (token from env)
2. Fetch repository tree at HEAD
3. Filter for JS/TS/Python files
4. Parse import statements (simple regex, no AST)
5. Build file→file edges
6. If incremental: Compare with existing graph, only update changed files
7. Overlay lock status from `coord:locks`
8. Store in `coord:graph` (KV)

**Graph Structure:**
```json
{
  "nodes": [
    {"id": "src/auth.ts", "type": "file"},
    {"id": "src/db.ts", "type": "file"}
  ],
  "edges": [
    {"source": "src/auth.ts", "target": "src/db.ts", "type": "import"}
  ],
  "locks": {
    "src/auth.ts": {"user": "luka", "status": "WRITING"}
  }
}
```

---

#### `GET /api/graph`
**Purpose:** Fetch current dependency graph

**Response:**
```json
{
  "nodes": [...],
  "edges": [...],
  "locks": {...},
  "version": "xyz789"
}
```

---

### **Background Jobs**

#### `GET /api/cleanup_stale_locks`
**Purpose:** Expire locks with no status update for 300+ seconds (5 minutes)

**Trigger:** Vercel cron job, runs every 1 minute

**Process:**
1. Read all locks from `coord:locks`
2. Check each lock's timestamp
3. If `now - timestamp > 300 seconds`:
   - Set status to OPEN
   - Delete from `coord:locks`
   - Log to `coord:status_log`

**Note:** Agent commits own work when complete. Lock expiration just releases coordination, doesn't force git operations.
**No Heartbeat:** Lock expiration is passive, based only on timestamp of last status update.

---

## Data Schema (Vercel KV - Redis)

**See `schema.md` for complete structure**

### Key Patterns:

- `coord:locks` → Hash (symbol → lock JSON)
- `coord:activity` → List (recent activity messages)
- `coord:graph` → String (JSON graph structure)
- `coord:graph_meta` → String (SHA of repo_head from last graph update)
- `coord:file_shas` → Hash (file_path → git_sha)
- `coord:status_log` → List (historical events)
- `coord:chat` → List (chat messages)

### Lock Entry Structure:
```json
{
  "file_path": "src/auth.ts",
  "user_id": "luka",
  "user_name": "Luka",
  "status": "WRITING",
  "agent_head": "abc123def",
  "timestamp": 1707321600000,
  "expiry": 1707321900000,
  "message": "Refactoring auth"
}
```

**Note:** File-level granularity only. Expiry is timestamp + 300 seconds (5 minutes).

---

## GitHub Integration

### Authentication:
- **Method:** Personal Access Token or GitHub App
- **Permissions:** `repo:read` (contents, refs)
- **Configuration:** `GITHUB_TOKEN` env var in Vercel

### API Calls:

**Get repo HEAD:**
```
GET /repos/{owner}/{repo}/git/refs/heads/{branch}
Response: { "object": { "sha": "abc123..." } }
```

**Get file tree:**
```
GET /repos/{owner}/{repo}/git/trees/{sha}?recursive=1
Response: { "tree": [{ "path": "src/auth.ts", ... }] }
```

**Get file content:**
```
GET /repos/{owner}/{repo}/contents/{path}?ref={sha}
Response: { "content": "<base64>", ... }
```

### Rate Limiting:
- GitHub API: 5000 requests/hour (authenticated)
- Graph generation is incremental to minimize API calls
- Cache file contents between graph updates

---

## Environment Variables

```bash
# Vercel KV
KV_REST_API_URL=https://...
KV_REST_API_TOKEN=...

# GitHub
GITHUB_TOKEN=ghp_...  # Personal Access Token

# Cron Job Security
CRON_SECRET=...  # Random string for securing cron endpoints
```

---

## Deployment (vercel.json)

```json
{
  "framework": "nextjs",
  "buildCommand": "npm run build",
  "crons": [
    {
      "path": "/api/cleanup_stale_locks",
      "schedule": "*/1 * * * *"
    }
  ]
}
```

**Note:** Environment variables (KV_REST_API_URL, KV_REST_API_TOKEN, GITHUB_TOKEN, CRON_SECRET) are set in Vercel Dashboard, not in vercel.json.

---

## Key Design Decisions

1. **No Heartbeat:** Lock expiration based solely on timestamp of last status update (300s timeout)
2. **File-Level Locking:** One agent per file at a time (not line-level, not function-level)
3. **Fresh State:** No caching - every request queries GitHub API + KV
4. **File Dependencies:** Simple import parsing, no complex AST analysis
5. **Incremental Graph:** Only reanalyze changed files to save GitHub API quota
6. **HTTP-Only:** Simple polling architecture, no WebSocket complexity
7. **Redis Only:** Vercel KV for all state (no Postgres)
8. **GitHub as Source of Truth:** repo_head always fetched from GitHub, never cached
9. **300 Second Timeout:** Locks expire after 5 minutes (300s) with no heartbeat mechanism

---

## Implementation Code Examples

### Setup Vercel KV Client

```typescript
// lib/kv.ts
import { kv } from '@vercel/kv';

export { kv };

// Environment variables required in Vercel:
// KV_REST_API_URL
// KV_REST_API_TOKEN
// (Automatically set when you add Vercel KV to your project)
```

### Setup GitHub Client

```typescript
// lib/github.ts
import { Octokit } from 'octokit';

export const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN
});

// Extract repo info from URL
export function parseRepoUrl(repoUrl: string) {
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (!match) throw new Error('Invalid GitHub URL');
  return { owner: match[1], repo: match[2] };
}

// Get current HEAD SHA
export async function getRepoHead(owner: string, repo: string, branch: string): Promise<string> {
  const { data } = await octokit.rest.git.getRef({
    owner,
    repo,
    ref: `heads/${branch}`
  });
  return data.object.sha;
}
```

### Multi-File Lock Acquisition (Atomic)

```typescript
// lib/locks.ts
import { kv } from './kv';

interface LockRequest {
  repoUrl: string;
  branch: string;
  filePaths: string[];
  userId: string;
  userName: string;
  status: 'READING' | 'WRITING';
  message: string;
  agentHead: string;
}

interface LockEntry {
  file_path: string;
  user_id: string;
  user_name: string;
  status: 'READING' | 'WRITING';
  agent_head: string;
  message: string;
  timestamp: number;
  expiry: number;
}

/**
 * Atomic multi-file lock acquisition using Lua script
 * Returns: { success: true, locks: [...] } or { success: false, reason: string, conflictingFile: string }
 */
export async function acquireLocks(request: LockRequest): Promise<{
  success: boolean;
  locks?: LockEntry[];
  reason?: string;
  conflictingFile?: string;
  conflictingUser?: string;
}> {
  const lockKey = `locks:${request.repoUrl}:${request.branch}`;
  const timestamp = Date.now();
  const expiry = timestamp + 300_000; // 5 minutes

  // Lua script for atomic multi-file locking
  const luaScript = `
    local lock_key = KEYS[1]
    local file_paths = cjson.decode(ARGV[1])
    local user_id = ARGV[2]
    local status = ARGV[3]
    local timestamp = tonumber(ARGV[4])
    local expiry = tonumber(ARGV[5])
    
    -- Check all files first (no partial locking)
    for i, file_path in ipairs(file_paths) do
      local existing = redis.call('HGET', lock_key, file_path)
      if existing then
        local lock = cjson.decode(existing)
        -- Check if lock is expired
        if lock.expiry > timestamp then
          -- Lock still valid
          if lock.user_id ~= user_id then
            -- Locked by someone else
            return cjson.encode({
              success = false,
              reason = "FILE_CONFLICT",
              conflicting_file = file_path,
              conflicting_user = lock.user_id
            })
          end
        end
      end
    end
    
    -- All files available, acquire all locks
    local locks = {}
    for i, file_path in ipairs(file_paths) do
      local lock = {
        file_path = file_path,
        user_id = ARGV[2],
        user_name = ARGV[6],
        status = status,
        agent_head = ARGV[7],
        message = ARGV[8],
        timestamp = timestamp,
        expiry = expiry
      }
      redis.call('HSET', lock_key, file_path, cjson.encode(lock))
      table.insert(locks, lock)
    end
    
    return cjson.encode({ success = true, locks = locks })
  `;

  try {
    // Execute Lua script via Vercel KV
    const result = await kv.eval(
      luaScript,
      [lockKey],
      [
        JSON.stringify(request.filePaths),
        request.userId,
        request.status,
        timestamp.toString(),
        expiry.toString(),
        request.userName,
        request.agentHead,
        request.message
      ]
    ) as string;

    return JSON.parse(result);
  } catch (error) {
    console.error('Lock acquisition failed:', error);
    return {
      success: false,
      reason: 'INTERNAL_ERROR'
    };
  }
}

/**
 * Release locks for specific files
 */
export async function releaseLocks(
  repoUrl: string,
  branch: string,
  filePaths: string[],
  userId: string
): Promise<{ success: boolean }> {
  const lockKey = `locks:${repoUrl}:${branch}`;
  
  const luaScript = `
    local lock_key = KEYS[1]
    local file_paths = cjson.decode(ARGV[1])
    local user_id = ARGV[2]
    
    for i, file_path in ipairs(file_paths) do
      local existing = redis.call('HGET', lock_key, file_path)
      if existing then
        local lock = cjson.decode(existing)
        -- Only the lock owner can release
        if lock.user_id == user_id then
          redis.call('HDEL', lock_key, file_path)
        end
      end
    end
    
    return 1
  `;

  try {
    await kv.eval(
      luaScript,
      [lockKey],
      [JSON.stringify(filePaths), userId]
    );
    return { success: true };
  } catch (error) {
    console.error('Lock release failed:', error);
    return { success: false };
  }
}

/**
 * Get all current locks for a repository
 */
export async function getLocks(
  repoUrl: string,
  branch: string
): Promise<Record<string, LockEntry>> {
  const lockKey = `locks:${repoUrl}:${branch}`;
  const locks = await kv.hgetall(lockKey) as Record<string, string>;
  
  if (!locks) return {};
  
  const parsed: Record<string, LockEntry> = {};
  const now = Date.now();
  
  for (const [filePath, lockJson] of Object.entries(locks)) {
    const lock = JSON.parse(lockJson) as LockEntry;
    // Filter out expired locks
    if (lock.expiry > now) {
      parsed[filePath] = lock;
    }
  }
  
  return parsed;
}

/**
 * Check if specific files are locked
 */
export async function checkLocks(
  repoUrl: string,
  branch: string,
  filePaths: string[]
): Promise<Record<string, LockEntry>> {
  const allLocks = await getLocks(repoUrl, branch);
  const relevantLocks: Record<string, LockEntry> = {};
  
  for (const filePath of filePaths) {
    if (allLocks[filePath]) {
      relevantLocks[filePath] = allLocks[filePath];
    }
  }
  
  return relevantLocks;
}
```

### API Route: POST /api/check_status

```typescript
// app/api/check_status/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getRepoHead, parseRepoUrl } from '@/lib/github';
import { checkLocks } from '@/lib/locks';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { repo_url, branch, file_paths, agent_head } = body;

    if (!repo_url || !branch || !file_paths || !agent_head) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Get current repo HEAD from GitHub
    const { owner, repo } = parseRepoUrl(repo_url);
    const repoHead = await getRepoHead(owner, repo, branch);

    // Check if agent is stale
    const isStale = agent_head !== repoHead;

    // Get locks for requested files
    const locks = await checkLocks(repo_url, branch, file_paths);

    // Determine status
    let status = 'OK';
    if (isStale) status = 'STALE';
    if (Object.keys(locks).length > 0) status = 'CONFLICT';

    // Build orchestration command
    let orchestration = { action: 'PROCEED', command: null, reason: '' };
    
    if (isStale) {
      orchestration = {
        action: 'PULL',
        command: 'git pull --rebase',
        reason: `Your local repo is behind. Current HEAD: ${repoHead}`
      };
    } else if (Object.keys(locks).length > 0) {
      const firstLock = Object.values(locks)[0];
      orchestration = {
        action: 'SWITCH_TASK',
        command: null,
        reason: `File '${firstLock.file_path}' is locked by ${firstLock.user_name} (DIRECT)`
      };
    }

    return NextResponse.json({
      status,
      repo_head: repoHead,
      locks,
      warnings: isStale ? ['STALE_BRANCH: Your branch is behind origin/' + branch] : [],
      orchestration
    });

  } catch (error) {
    console.error('check_status error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
```

### API Route: POST /api/post_status

```typescript
// app/api/post_status/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getRepoHead, parseRepoUrl } from '@/lib/github';
import { acquireLocks, releaseLocks } from '@/lib/locks';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      repo_url,
      branch,
      file_paths,
      status,
      message,
      agent_head,
      new_repo_head
    } = body;

    // Validate required fields
    if (!repo_url || !branch || !file_paths || !status || !message) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Extract user info from auth header (in production, validate JWT/token)
    const userId = request.headers.get('x-github-user') || 'anonymous';
    const userName = request.headers.get('x-github-username') || 'Anonymous';

    // Get current repo HEAD
    const { owner, repo } = parseRepoUrl(repo_url);
    const repoHead = await getRepoHead(owner, repo, branch);

    // Handle OPEN status (release locks)
    if (status === 'OPEN') {
      // Validate that repo advanced (optional check)
      if (new_repo_head && new_repo_head === agent_head) {
        return NextResponse.json(
          {
            success: false,
            orchestration: {
              action: 'PUSH',
              command: 'git push',
              reason: 'You need to push your changes to advance the repo'
            }
          },
          { status: 400 }
        );
      }

      await releaseLocks(repo_url, branch, file_paths, userId);

      return NextResponse.json({
        success: true,
        orphaned_dependencies: [], // TODO: Calculate from graph
        orchestration: {
          action: 'PROCEED',
          command: null,
          reason: 'Locks released successfully'
        }
      });
    }

    // Handle WRITING status (acquire locks)
    if (status === 'WRITING') {
      // Validate agent is on latest commit
      if (agent_head !== repoHead) {
        return NextResponse.json({
          success: false,
          orchestration: {
            action: 'PULL',
            command: 'git pull --rebase',
            reason: 'Your local repo is behind remote',
            metadata: {
              remote_head: repoHead,
              your_head: agent_head
            }
          }
        });
      }

      // Try to acquire locks atomically
      const lockResult = await acquireLocks({
        repoUrl: repo_url,
        branch,
        filePaths: file_paths,
        userId,
        userName,
        status,
        message,
        agentHead: agent_head
      });

      if (!lockResult.success) {
        return NextResponse.json({
          success: false,
          orchestration: {
            action: 'SWITCH_TASK',
            command: null,
            reason: `${lockResult.reason}: ${lockResult.conflictingFile} locked by ${lockResult.conflictingUser}`
          }
        });
      }

      return NextResponse.json({
        success: true,
        locks: lockResult.locks,
        orchestration: {
          action: 'PROCEED',
          command: null,
          reason: 'Locks acquired successfully'
        }
      });
    }

    // Handle READING status (informational only, no actual lock)
    return NextResponse.json({
      success: true,
      orchestration: {
        action: 'PROCEED',
        command: null,
        reason: 'Reading status recorded'
      }
    });

  } catch (error) {
    console.error('post_status error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
```

### Cleanup Cron Job

```typescript
// app/api/cleanup_stale_locks/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@/lib/kv';

export async function GET(request: NextRequest) {
  try {
    // Verify cron secret (Vercel cron jobs send this header)
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const now = Date.now();
    let cleanedCount = 0;

    // Get all lock keys (scan pattern locks:*)
    const keys = await kv.keys('locks:*');

    for (const key of keys) {
      const locks = await kv.hgetall(key) as Record<string, string>;
      
      if (!locks) continue;

      for (const [filePath, lockJson] of Object.entries(locks)) {
        const lock = JSON.parse(lockJson);
        
        // Check if expired
        if (lock.expiry < now) {
          await kv.hdel(key, filePath);
          cleanedCount++;
          
          console.log(`Cleaned expired lock: ${filePath} (user: ${lock.user_id})`);
        }
      }
    }

    return NextResponse.json({
      success: true,
      cleaned: cleanedCount,
      timestamp: now
    });

  } catch (error) {
    console.error('Cleanup job error:', error);
    return NextResponse.json(
      { error: 'Cleanup failed', details: error.message },
      { status: 500 }
    );
  }
}
```

### Vercel Configuration

```json
// vercel.json
{
  "framework": "nextjs",
  "crons": [
    {
      "path": "/api/cleanup_stale_locks",
      "schedule": "* * * * *"
    }
  ],
  "env": {
    "GITHUB_TOKEN": "@github-token",
    "CRON_SECRET": "@cron-secret"
  }
}
```

### Environment Variables Setup

```bash
# .env.local (for local development)
KV_REST_API_URL="https://your-kv-instance.kv.vercel-storage.com"
KV_REST_API_TOKEN="your_kv_token"
GITHUB_TOKEN="ghp_yourgithubtoken"
CRON_SECRET="random_secret_string"

# In Vercel Dashboard:
# 1. Add Vercel KV storage (auto-populates KV_* vars)
# 2. Add Environment Variables:
#    - GITHUB_TOKEN (GitHub Personal Access Token with repo:read scope)
#    - CRON_SECRET (random string for securing cron endpoint)
```

### Graph Generation Implementation

```typescript
// lib/graph.ts
import { octokit, parseRepoUrl } from './github';
import { kv } from './kv';
import { getLocks } from './locks';

interface GraphNode {
  id: string;
  type: 'file';
}

interface GraphEdge {
  source: string;
  target: string;
  type: 'import';
}

interface DependencyGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  locks: Record<string, any>;
  version: string;
}

/**
 * Parse import statements from file content
 */
function parseImports(content: string, filePath: string, language: 'ts' | 'js' | 'py'): string[] {
  const imports: string[] = [];
  const lines = content.split('\n');

  if (language === 'ts' || language === 'js') {
    // ES6 import: import { foo } from './bar'
    const es6ImportRegex = /^import\s+.*\s+from\s+['"]([^'"]+)['"]/;
    // ES6 export: export * from './bar'
    const es6ExportRegex = /^export\s+.*\s+from\s+['"]([^'"]+)['"]/;
    // CommonJS/dynamic: require('./bar') or import('./bar')
    const cjsRegex = /(import|require)\(['"]([^'"]+)['"]\)/;

    for (const line of lines) {
      const trimmed = line.trim();
      
      const es6ImportMatch = trimmed.match(es6ImportRegex);
      if (es6ImportMatch) {
        imports.push(es6ImportMatch[1]);
        continue;
      }

      const es6ExportMatch = trimmed.match(es6ExportRegex);
      if (es6ExportMatch) {
        imports.push(es6ExportMatch[1]);
        continue;
      }

      const cjsMatch = line.match(cjsRegex);
      if (cjsMatch) {
        imports.push(cjsMatch[2]);
      }
    }
  } else if (language === 'py') {
    // Direct import: import os.path
    const directImportRegex = /^import\s+([\w\.]+)/;
    // From import: from .utils import helper
    const fromImportRegex = /^from\s+([\w\.]+)\s+import/;

    for (const line of lines) {
      const trimmed = line.trim();

      const directMatch = trimmed.match(directImportRegex);
      if (directMatch) {
        imports.push(directMatch[1]);
        continue;
      }

      const fromMatch = trimmed.match(fromImportRegex);
      if (fromMatch) {
        imports.push(fromMatch[1]);
      }
    }
  }

  return imports;
}

/**
 * Resolve relative import path to absolute file path
 */
function resolveImportPath(
  importPath: string,
  currentFilePath: string,
  allFilePaths: Set<string>
): string | null {
  // Ignore external packages (non-relative imports)
  if (!importPath.startsWith('.')) {
    return null;
  }

  // Get directory of current file
  const currentDir = currentFilePath.substring(0, currentFilePath.lastIndexOf('/'));
  
  // Resolve relative path
  const parts = currentDir.split('/');
  const importParts = importPath.split('/');

  for (const part of importParts) {
    if (part === '..') {
      parts.pop();
    } else if (part !== '.') {
      parts.push(part);
    }
  }

  const basePath = parts.join('/');

  // Try different extensions
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];
  
  for (const ext of extensions) {
    const candidate = basePath + ext;
    if (allFilePaths.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Generate or update dependency graph
 */
export async function generateGraph(
  repoUrl: string,
  branch: string
): Promise<DependencyGraph> {
  const { owner, repo } = parseRepoUrl(repoUrl);
  const graphKey = `graph:${repoUrl}:${branch}`;
  const graphMetaKey = `graph:meta:${repoUrl}:${branch}`;
  const fileShasKey = `graph:file_shas:${repoUrl}:${branch}`;

  // Get current HEAD SHA
  const { data: refData } = await octokit.rest.git.getRef({
    owner,
    repo,
    ref: `heads/${branch}`
  });
  const currentHead = refData.object.sha;

  // Check if graph needs update (Layer 1: repo-level check)
  const storedHead = await kv.get(graphMetaKey) as string | null;
  if (storedHead === currentHead) {
    console.log('Graph is up to date, returning cached version');
    const cached = await kv.get(graphKey) as string | null;
    if (cached) {
      const graph = JSON.parse(cached) as DependencyGraph;
      // Overlay current locks
      const locks = await getLocks(repoUrl, branch);
      graph.locks = locks;
      return graph;
    }
  }

  // Get file tree from GitHub
  const { data: treeData } = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: currentHead,
    recursive: 'true'
  });

  // Filter for supported files
  const supportedExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py'];
  const files = treeData.tree.filter(
    item =>
      item.type === 'blob' &&
      item.path &&
      supportedExtensions.some(ext => item.path!.endsWith(ext))
  );

  console.log(`Found ${files.length} supported files`);

  // Get stored file SHAs for incremental update (Layer 2: file-level check)
  const storedShas = await kv.hgetall(fileShasKey) as Record<string, string> || {};
  const allFilePaths = new Set(files.map(f => f.path!));

  // Categorize files: NEW, CHANGED, DELETED, UNCHANGED
  const newFiles: typeof files = [];
  const changedFiles: typeof files = [];
  const unchangedFiles: typeof files = [];
  const deletedFiles: string[] = [];

  for (const file of files) {
    const path = file.path!;
    const currentSha = file.sha!;
    const storedSha = storedShas[path];

    if (!storedSha) {
      newFiles.push(file);
    } else if (storedSha !== currentSha) {
      changedFiles.push(file);
    } else {
      unchangedFiles.push(file);
    }
  }

  // Find deleted files
  for (const path of Object.keys(storedShas)) {
    if (!allFilePaths.has(path)) {
      deletedFiles.push(path);
    }
  }

  console.log(`Incremental update: ${newFiles.length} new, ${changedFiles.length} changed, ${deletedFiles.length} deleted, ${unchangedFiles.length} unchanged`);

  // Load existing graph if doing incremental update
  let nodes: GraphNode[] = [];
  let edges: GraphEdge[] = [];

  if (storedHead) {
    const cached = await kv.get(graphKey) as string | null;
    if (cached) {
      const existing = JSON.parse(cached) as DependencyGraph;
      nodes = existing.nodes;
      edges = existing.edges;

      // Remove deleted files
      for (const deletedPath of deletedFiles) {
        nodes = nodes.filter(n => n.id !== deletedPath);
        edges = edges.filter(e => e.source !== deletedPath && e.target !== deletedPath);
      }

      // Remove edges from changed files (will be re-added)
      for (const file of changedFiles) {
        edges = edges.filter(e => e.source !== file.path);
      }
    }
  }

  // Process new and changed files
  const filesToProcess = [...newFiles, ...changedFiles];
  
  for (const file of filesToProcess) {
    const path = file.path!;
    
    // Add node if new
    if (!nodes.some(n => n.id === path)) {
      nodes.push({ id: path, type: 'file' });
    }

    // Fetch file content
    try {
      const { data: contentData } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path,
        ref: currentHead
      });

      if ('content' in contentData) {
        const content = Buffer.from(contentData.content, 'base64').toString('utf-8');
        const language = path.endsWith('.py') ? 'py' : 'ts';
        
        // Parse imports
        const imports = parseImports(content, path, language);

        // Resolve and add edges
        for (const importPath of imports) {
          const resolvedPath = resolveImportPath(importPath, path, allFilePaths);
          if (resolvedPath) {
            // Avoid duplicate edges
            if (!edges.some(e => e.source === path && e.target === resolvedPath)) {
              edges.push({
                source: path,
                target: resolvedPath,
                type: 'import'
              });
            }
          }
        }
      }
    } catch (error) {
      console.error(`Failed to process file ${path}:`, error);
    }
  }

  // Update file SHAs in Redis
  const newShas: Record<string, string> = {};
  for (const file of files) {
    newShas[file.path!] = file.sha!;
  }
  
  // Delete old SHAs for deleted files
  if (deletedFiles.length > 0) {
    await kv.hdel(fileShasKey, ...deletedFiles);
  }
  
  // Update SHAs
  if (Object.keys(newShas).length > 0) {
    await kv.hset(fileShasKey, newShas);
  }

  // Overlay current locks
  const locks = await getLocks(repoUrl, branch);

  const graph: DependencyGraph = {
    nodes,
    edges,
    locks,
    version: currentHead
  };

  // Store graph and metadata atomically
  await kv.set(graphKey, JSON.stringify({ nodes, edges, version: currentHead }));
  await kv.set(graphMetaKey, currentHead);

  console.log(`Graph updated: ${nodes.length} nodes, ${edges.length} edges`);

  return graph;
}

/**
 * Get current graph (from cache)
 */
export async function getGraph(repoUrl: string, branch: string): Promise<DependencyGraph | null> {
  const graphKey = `graph:${repoUrl}:${branch}`;
  const cached = await kv.get(graphKey) as string | null;
  
  if (!cached) return null;

  const graph = JSON.parse(cached) as DependencyGraph;
  
  // Overlay current locks
  const locks = await getLocks(repoUrl, branch);
  graph.locks = locks;

  return graph;
}
```

### API Route: GET /api/graph

```typescript
// app/api/graph/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getGraph, generateGraph } from '@/lib/graph';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const repoUrl = searchParams.get('repo_url');
    const branch = searchParams.get('branch') || 'main';
    const regenerate = searchParams.get('regenerate') === 'true';

    if (!repoUrl) {
      return NextResponse.json(
        { error: 'repo_url is required' },
        { status: 400 }
      );
    }

    let graph;

    if (regenerate) {
      // Force regeneration
      graph = await generateGraph(repoUrl, branch);
    } else {
      // Try to get cached graph
      graph = await getGraph(repoUrl, branch);
      
      // If no graph exists, generate it
      if (!graph) {
        graph = await generateGraph(repoUrl, branch);
      }
    }

    return NextResponse.json(graph);

  } catch (error) {
    console.error('Graph fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch graph', details: error.message },
      { status: 500 }
    );
  }
}
```

### Background Graph Update (Optional Cron)

```typescript
// app/api/update_graph/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { generateGraph } from '@/lib/graph';

export async function GET(request: NextRequest) {
  try {
    // Verify cron secret
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // List of repos to update (could be stored in Redis)
    const repos = [
      { url: 'https://github.com/user/repo1', branch: 'main' },
      { url: 'https://github.com/user/repo2', branch: 'main' }
    ];

    const results = [];

    for (const repo of repos) {
      try {
        const graph = await generateGraph(repo.url, repo.branch);
        results.push({
          repo: repo.url,
          success: true,
          nodes: graph.nodes.length,
          edges: graph.edges.length
        });
      } catch (error) {
        results.push({
          repo: repo.url,
          success: false,
          error: error.message
        });
      }
    }

    return NextResponse.json({
      success: true,
      updated: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results
    });

  } catch (error) {
    console.error('Graph update error:', error);
    return NextResponse.json(
      { error: 'Update failed', details: error.message },
      { status: 500 }
    );
  }
}
```

Add to vercel.json:
```json
{
  "crons": [
    {
      "path": "/api/cleanup_stale_locks",
      "schedule": "* * * * *"
    },
    {
      "path": "/api/update_graph",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

---

## Frontend Implementation Guide

### Overview

The frontend is a **real-time dashboard** for visualizing multi-agent coordination. It shows:
- **Dependency graph** - File relationships in the codebase
- **Live lock status** - Which agents are working on which files
- **Activity feed** - Recent actions and status changes
- **Conflict warnings** - When agents might interfere with each other

### API Contract

The frontend only needs **one endpoint**: `GET /api/graph`

**Response Structure:**
```typescript
interface DependencyGraph {
  nodes: Array<{
    id: string;              // File path: "src/auth.ts"
    type: 'file';
    size?: number;           // File size in bytes
    language?: string;       // "ts" | "js" | "py"
  }>;
  
  edges: Array<{
    source: string;          // File that imports
    target: string;          // File being imported
    type: 'import';
  }>;
  
  locks: Record<string, {
    user_id: string;         // "github_user_123"
    user_name: string;       // "Jane Doe"
    status: 'READING' | 'WRITING';
    message: string;         // "Refactoring auth logic"
    timestamp: number;       // Unix timestamp
    expiry: number;          // When lock expires
  }>;
  
  version: string;           // Git commit SHA
  metadata: {
    generated_at: number;
    files_processed: number;
    edges_found: number;
  };
}
```

### Data Fetching Strategy

**Polling (5-second intervals):**
```typescript
// React hook example
function useGraph(repoUrl: string, branch: string) {
  const [graph, setGraph] = useState<DependencyGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchGraph = async () => {
      try {
        const res = await fetch(
          `/api/graph?repo_url=${encodeURIComponent(repoUrl)}&branch=${branch}`
        );
        if (!res.ok) throw new Error('Failed to fetch graph');
        const data = await res.json();
        setGraph(data);
        setError(null);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchGraph(); // Initial fetch
    const interval = setInterval(fetchGraph, 5000); // Poll every 5s
    
    return () => clearInterval(interval);
  }, [repoUrl, branch]);

  return { graph, loading, error };
}
```

**Why polling is sufficient:**
- ✅ Simple to implement
- ✅ No additional infrastructure
- ✅ 5-second delay is acceptable for coordination
- ✅ Works reliably without persistent connections

---

## Frontend Architecture Recommendations

### Suggested Tech Stack

**Framework Options:**
- **Next.js 14** - Server components + API routes in same repo
- **React + Vite** - Separate frontend repo, deploy to Vercel
- **SvelteKit** - Alternative if team prefers Svelte

**Graph Visualization:**
- **React Flow** - Modern, React-friendly, handles large graphs well
- **Cytoscape.js** - Battle-tested, handles 5000+ nodes
- **D3.js** - Maximum customization, steeper learning curve

**UI Components:**
- **shadcn/ui** - Accessible, customizable, Tailwind-based
- **Radix UI** - Headless primitives for custom designs
- **Mantine** - Full-featured component library

### Recommended Page Layout

```
┌─────────────────────────────────────────────────────┐
│ Header: Repo Selector | Branch | Refresh Button     │
├──────────────────────┬──────────────────────────────┤
│                      │                              │
│   File Tree          │   Dependency Graph           │
│   (Sidebar)          │   (Main Canvas)              │
│                      │                              │
│   src/               │   [Visual graph with nodes]  │
│   ├─ auth.ts  🔴     │   [Nodes colored by status]  │
│   ├─ db.ts    🟢     │   [Edges show dependencies]  │
│   └─ utils.ts 🟡     │                              │
│                      │                              │
├──────────────────────┴──────────────────────────────┤
│ Activity Feed (Bottom Panel)                        │
│ • Jane: "Refactoring auth logic" (2 sec ago)        │
│ • Bob: Released lock on db.ts (15 sec ago)          │
└─────────────────────────────────────────────────────┘
```

### Component Structure

```
src/
├── components/
│   ├── DependencyGraph.tsx      # Main graph visualization
│   ├── FileNode.tsx              # Single file node in graph
│   ├── FileSidebar.tsx           # Navigable file tree
│   ├── ActivityFeed.tsx          # Live activity stream
│   ├── LockIndicator.tsx         # Lock status badge
│   └── UserAvatar.tsx            # User indicator
├── hooks/
│   ├── useGraph.ts               # Graph data fetching
│   ├── useLocks.ts               # Extract locks from graph
│   └── useActivityFeed.ts        # Process recent changes
├── lib/
│   ├── graph-layout.ts           # Layout algorithms for graph
│   └── graph-filters.ts          # Filter nodes by directory/status
└── pages/
    └── dashboard.tsx             # Main dashboard page
```

### Graph Visualization Details

**Node Styling (based on lock status):**
```typescript
function getNodeStyle(node: GraphNode, locks: Record<string, Lock>) {
  const lock = locks[node.id];
  
  if (!lock) {
    return { 
      backgroundColor: '#10b981',  // Green - available
      borderColor: '#059669'
    };
  }
  
  if (lock.status === 'WRITING') {
    return { 
      backgroundColor: '#ef4444',  // Red - being modified
      borderColor: '#dc2626',
      borderWidth: 3
    };
  }
  
  if (lock.status === 'READING') {
    return { 
      backgroundColor: '#f59e0b',  // Yellow - being read
      borderColor: '#d97706'
    };
  }
}
```

**Node Labels:**
- **Primary:** Filename (`auth.ts`)
- **Secondary:** User if locked (`Jane Doe`)
- **Tooltip:** Full message on hover

**Edge Styling:**
- Normal edges: Gray, thin
- Edges to/from locked files: Highlighted, thicker
- Circular dependencies: Dashed line (optional detection)

### Key Features to Implement

**1. Search/Filter**
- Search files by name
- Filter by status (locked/available)
- Filter by directory (`src/api/*`)
- Filter by user

**2. Interactive Graph**
- Click node → Show dependencies
- Click node → Show who's working on it
- Click node → Navigate to GitHub file
- Zoom/pan for large graphs
- Minimap for navigation

**3. Activity Feed**
- Real-time stream of lock changes
- Click activity → Focus file in graph
- Filter by user
- Time-based grouping

**4. Lock Details Panel**
- Shows full lock message
- Shows time remaining before expiry
- Shows agent_head commit SHA
- Link to GitHub commit

**5. Multi-Repo Support**
- Dropdown to switch repos
- Remember last viewed repo (localStorage)
- Compare branches side-by-side (advanced)

### Data Processing Helpers

**Extract Recent Activity:**
```typescript
function getRecentActivity(
  currentGraph: DependencyGraph,
  previousGraph: DependencyGraph | null
): Activity[] {
  if (!previousGraph) return [];
  
  const activities: Activity[] = [];
  
  // New locks
  for (const [filePath, lock] of Object.entries(currentGraph.locks)) {
    if (!previousGraph.locks[filePath]) {
      activities.push({
        type: 'lock_acquired',
        filePath,
        user: lock.user_name,
        message: lock.message,
        timestamp: lock.timestamp
      });
    }
  }
  
  // Released locks
  for (const [filePath, lock] of Object.entries(previousGraph.locks)) {
    if (!currentGraph.locks[filePath]) {
      activities.push({
        type: 'lock_released',
        filePath,
        user: lock.user_name,
        timestamp: Date.now()
      });
    }
  }
  
  return activities.sort((a, b) => b.timestamp - a.timestamp);
}
```

**Detect Conflicts:**
```typescript
function detectPotentialConflicts(graph: DependencyGraph): Conflict[] {
  const conflicts: Conflict[] = [];
  
  // Find files where dependencies are locked
  for (const edge of graph.edges) {
    const sourceLock = graph.locks[edge.source];
    const targetLock = graph.locks[edge.target];
    
    if (sourceLock && targetLock && sourceLock.user_id !== targetLock.user_id) {
      conflicts.push({
        type: 'dependency_conflict',
        files: [edge.source, edge.target],
        users: [sourceLock.user_name, targetLock.user_name],
        severity: 'warning'
      });
    }
  }
  
  return conflicts;
}
```

### Performance Considerations

**For Large Graphs (1000+ files):**
- **Virtualization:** Only render visible nodes
- **Level-of-detail:** Show less detail when zoomed out
- **Lazy loading:** Load subgraphs on-demand
- **Filtering:** Default to showing only important files
- **Clustering:** Group files by directory

**Optimization Tips:**
- Debounce search/filter inputs
- Use React.memo for node components
- Cache layout calculations
- Limit activity feed to last 50 items

### Accessibility

- **Keyboard navigation** - Tab through nodes, Enter to select
- **Screen reader support** - Announce lock status changes
- **Color contrast** - Ensure WCAG AA compliance
- **Focus indicators** - Clear visual focus for keyboard users

### Mobile Considerations

**Responsive Layout:**
- Stack sidebar below graph on mobile
- Simplify graph (fewer nodes visible)
- Activity feed as modal/drawer
- Touch gestures for zoom/pan

---

## Frontend Deployment

**Option 1: Same Vercel Project**
- Add frontend pages to existing Next.js app
- Single deployment, same domain
- API routes already available

**Option 2: Separate Frontend Repo**
- Deploy to Vercel as separate project
- Configure CORS on backend API routes
- Use environment variable for API URL

**Environment Variables (Frontend):**
```bash
NEXT_PUBLIC_API_URL=https://your-backend.vercel.app
NEXT_PUBLIC_DEFAULT_REPO=https://github.com/user/repo
```

---

## Example User Flows

**Flow 1: Viewing Current State**
1. User opens dashboard
2. Sees graph with colored nodes
3. Notices red node (locked file)
4. Hovers → sees "Jane: Refactoring auth logic"
5. Clicks node → sees full details + remaining time

**Flow 2: Finding Where Someone is Working**
1. User wants to avoid Jane's work
2. Clicks "Filter by User" → selects Jane
3. Graph highlights Jane's locked files + dependencies
4. User sees safe files to work on (unrelated subgraphs)

**Flow 3: Tracking Activity**
1. User monitors activity feed
2. Sees "Bob released lock on db.ts"
3. Clicks activity → graph focuses on db.ts
4. Notices db.ts is now green (available)
5. User can now work on that file

---

## Deployment Guide

### Step 1: Create Vercel Project

```bash
npm create next-app@latest vercel-backend
cd vercel-backend

npm install @vercel/kv octokit ws
npm install -D @types/ws
```

### Step 2: Add Vercel KV Storage

1. Go to Vercel Dashboard → Your Project → Storage
2. Click "Create Database" → Select "KV"
3. Follow prompts to provision Redis instance
4. Environment variables `KV_REST_API_URL` and `KV_REST_API_TOKEN` are auto-populated

### Step 3: Configure Environment Variables

In Vercel Dashboard → Settings → Environment Variables:

```
GITHUB_TOKEN=ghp_your_token_here
CRON_SECRET=random_secret_string_123
```

Get GitHub token:
```bash
# Go to https://github.com/settings/tokens
# Create new token with 'repo' scope (or 'public_repo' for public repos only)
```

### Step 4: Deploy

```bash
vercel
```

### Step 5: Test Endpoints

```bash
# Test check_status
curl -X POST https://your-app.vercel.app/api/check_status \
  -H "Content-Type: application/json" \
  -d '{
    "repo_url": "https://github.com/user/repo",
    "branch": "main",
    "file_paths": ["src/index.ts"],
    "agent_head": "abc123"
  }'

# Test post_status
curl -X POST https://your-app.vercel.app/api/post_status \
  -H "Content-Type: application/json" \
  -H "x-github-user: testuser" \
  -H "x-github-username: Test User" \
  -d '{
    "repo_url": "https://github.com/user/repo",
    "branch": "main",
    "file_paths": ["src/index.ts"],
    "status": "WRITING",
    "message": "Adding new feature",
    "agent_head": "abc123"
  }'

# Test graph
curl "https://your-app.vercel.app/api/graph?repo_url=https://github.com/user/repo&branch=main"
```

### Step 6: Verify Cron Job

1. Vercel Dashboard → Your Project → Cron Jobs
2. Verify `cleanup_stale_locks` appears and runs every 1 minute
3. Check logs to confirm execution

---

## Testing Strategy

### Unit Tests

```typescript
// __tests__/locks.test.ts
import { acquireLocks, releaseLocks } from '@/lib/locks';

describe('Lock Management', () => {
  test('should acquire lock on available file', async () => {
    const result = await acquireLocks({
      repoUrl: 'https://github.com/test/repo',
      branch: 'main',
      filePaths: ['src/test.ts'],
      userId: 'user1',
      userName: 'User 1',
      status: 'WRITING',
      message: 'Testing',
      agentHead: 'abc123'
    });

    expect(result.success).toBe(true);
  });

  test('should reject lock on already locked file', async () => {
    // User 1 acquires lock
    await acquireLocks({
      repoUrl: 'https://github.com/test/repo',
      branch: 'main',
      filePaths: ['src/test.ts'],
      userId: 'user1',
      userName: 'User 1',
      status: 'WRITING',
      message: 'Testing',
      agentHead: 'abc123'
    });

    // User 2 tries to acquire same file
    const result = await acquireLocks({
      repoUrl: 'https://github.com/test/repo',
      branch: 'main',
      filePaths: ['src/test.ts'],
      userId: 'user2',
      userName: 'User 2',
      status: 'WRITING',
      message: 'Testing',
      agentHead: 'abc123'
    });

    expect(result.success).toBe(false);
    expect(result.reason).toBe('FILE_CONFLICT');
  });

  test('should handle multi-file atomic locking', async () => {
    const result = await acquireLocks({
      repoUrl: 'https://github.com/test/repo',
      branch: 'main',
      filePaths: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
      userId: 'user1',
      userName: 'User 1',
      status: 'WRITING',
      message: 'Testing',
      agentHead: 'abc123'
    });

    expect(result.success).toBe(true);
    expect(result.locks?.length).toBe(3);
  });
});
```

### Integration Tests

```typescript
// __tests__/api/check_status.test.ts
import { POST } from '@/app/api/check_status/route';

describe('POST /api/check_status', () => {
  test('should return OK status for available files', async () => {
    const request = new Request('http://localhost/api/check_status', {
      method: 'POST',
      body: JSON.stringify({
        repo_url: 'https://github.com/test/repo',
        branch: 'main',
        file_paths: ['src/test.ts'],
        agent_head: 'current_head_sha'
      })
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe('OK');
  });
});
```

### Manual Testing Checklist

- [ ] Lock acquisition on single file works
- [ ] Lock acquisition on multiple files is atomic
- [ ] Lock conflicts are detected and rejected
- [ ] Stale repo detection works (agent_head != repo_head)
- [ ] Lock expiration works after 5 minutes
- [ ] Graph generation works for JS/TS files
- [ ] Graph generation works for Python files
- [ ] Incremental graph updates only process changed files
- [ ] Locks are overlaid on graph correctly
- [ ] Cron job runs and cleans expired locks

---

## Troubleshooting

### Common Issues

**1. Redis connection errors**
```bash
# Verify KV environment variables
vercel env ls

# Test connection locally
node -e "const kv = require('@vercel/kv').kv; kv.ping().then(console.log)"
```

**2. GitHub API rate limiting**
```bash
# Check rate limit status
curl -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/rate_limit
```

**3. Lua script errors**
```
Error: ERR Error running script...
```
- Check Redis version (Vercel KV uses Redis 6+)
- Ensure JSON encoding/decoding is correct
- Test Lua script in Redis CLI first

**4. Lock cleanup not running**
- Verify `CRON_SECRET` is set
- Check Vercel cron job logs
- Ensure cron schedule is valid (`* * * * *` = every minute)

**5. Import resolution failures**
- Check file extensions match (`.ts` vs `.tsx`)
- Verify relative paths are correct
- Test regex patterns against actual code

---

## Performance Optimization

### Redis Performance

```typescript
// Use pipelining for bulk operations
import { kv } from '@vercel/kv';

async function bulkGetLocks(keys: string[]) {
  const pipeline = kv.pipeline();
  keys.forEach(key => pipeline.hgetall(key));
  return await pipeline.exec();
}
```

### GitHub API Optimization

```typescript
// Cache file tree for 1 minute to avoid repeated calls
const cache = new Map<string, { data: any; timestamp: number }>();

export async function getCachedTree(owner: string, repo: string, sha: string) {
  const key = `${owner}/${repo}/${sha}`;
  const cached = cache.get(key);
  
  if (cached && Date.now() - cached.timestamp < 60000) {
    return cached.data;
  }

  const { data } = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: sha,
    recursive: 'true'
  });

  cache.set(key, { data, timestamp: Date.now() });
  return data;
}
```

### Next.js Edge Runtime (Optional)

For lower latency, use Edge Runtime for read-only endpoints:

```typescript
// app/api/graph/route.ts
export const runtime = 'edge';
```

Note: Edge Runtime doesn't support all Node.js APIs. Use only for simple read operations.

---

## References

- **Lock Logic:** See `mcp_planning.md` for complete rules
- **Data Schema:** See `schema.md` for KV structure
- **MCP Integration:** See `project_info.md` for MCP server architecture
- **Vercel KV Docs:** https://vercel.com/docs/storage/vercel-kv
- **Octokit Docs:** https://github.com/octokit/octokit.js
- **Next.js App Router:** https://nextjs.org/docs/app
