# Orchestration & Data Schema

## Complete API Surface

### MCP Tool Endpoints (Agent ↔ Backend)
These are the **only** endpoints agents interact with:
1. **`POST /api/check_status`** - Check file lock status before editing
2. **`POST /api/post_status`** - Acquire/update/release file locks

### Frontend Endpoints (Browser ↔ Backend)
3. **`GET /api/graph`** - Fetch dependency graph for visualization

### What's NOT in the API
- ❌ No `/api/post_activity` - Communication happens via `message` field in `post_status`
- ❌ No `/api/generate_graph` - Graph generation is an internal background process
- ❌ No `/api/cleanup_stale_locks` - Cleanup is an internal cron job
- ❌ No `/api/chat` - Agent messages are embedded in status updates

### Agent Communication Model
**Key Design Principle:** All agent-to-agent communication happens through the `message` field in `post_status` requests.

When agents acquire or update locks, they MUST include a clear one-sentence explanation:
- ✅ Good: "Refactoring authentication to use JWT tokens instead of sessions"
- ✅ Good: "Adding connection pooling to database for better performance"
- ❌ Bad: "Working on auth.ts"
- ❌ Bad: "" (empty message)

The frontend displays these messages in real-time as an activity feed. No separate chat/activity API needed.

---

## 1. Orchestration Commands
These commands are returned by MCP tools (`check_status`, `post_status`) to guide the agent's next actions. Agents **MUST** parse and execute these commands.

### Schema
```json
{
  "type": "orchestration_command",
  "action": "PULL" | "PUSH" | "WAIT" | "STOP" | "PROCEED",
  "command": "string" | null,
  "reason": "string",
  "metadata": {
    "remote_head": "string",  // for PULL/PUSH
    "lock_owner": "string",   // for WAIT
    "conflicts": ["string"]   // for WAIT/STOP
  }
}
```

### Command Types

| Action | Description | `command` value | Condition |
| :--- | :--- | :--- | :--- |
| **PULL** | Local repo is behind remote. | `git pull --rebase` | `agent_head != repo_head` |
| **PUSH** | Lock release requires sync. | `git push` | `post_status(OPEN)` but `head` unchanged |
| **WAIT** | Symbol is locked by another user. | `sleep 5` | `locks[symbol] != null` |
| **SWITCH_TASK** | Node or neighbor locked. | `null` | `lock_type == "DIRECT" \| "NEIGHBOR"` |
| **STOP** | Hard conflict or error. | `null` | Lock timeout, Vercel down |
| **PROCEED**| Safe to continue. | `null` | No conflicts, fresh repo |

---

## 2. Tool Input/Output Schemas

### Common Fields
All requests MUST include:
*   `repo_url`: "https://github.com/user/repo.git"
*   `branch`: "main" (or current branch)

### `check_status`

**Request:**
```json
{
  "repo_url": "https://github.com/dedalus/core.git",
  "branch": "main",
  "file_paths": ["src/auth.ts", "src/db.ts"],
  "agent_head": "abc1234..." 
}
```

**Notes:**
- `file_paths` are file-level only (e.g., "src/auth.ts"), not function/symbol level.
- **Neighbor awareness**: Response includes locks on files you requested AND their dependencies.

**Response:**
```json
{
  "status": "OK" | "STALE" | "CONFLICT" | "OFFLINE",
  "repo_head": "abc1234...",
  "locks": {
    "src/auth.ts": {
      "user": "github_user_1",
      "user_name": "GitHub User",
      "status": "WRITING",
      "lock_type": "DIRECT",
      "message": "Refactoring authentication to use JWT tokens",
      "timestamp": 1234567890
    },
    "src/db.ts": {
      "user": "github_user_2",
      "user_name": "Another Agent",
      "status": "WRITING",
      "lock_type": "NEIGHBOR",
      "message": "Adding connection pooling to database",
      "timestamp": 1234567890
    }
  },
  "warnings": [
    "OFFLINE_MODE: Vercel is unreachable. Reading allowed, Writing disabled.",
    "STALE_BRANCH: Your branch is behind origin/main."
  ],
  "orchestration": {
    "type": "orchestration_command",
    "action": "SWITCH_TASK",
    "command": null,
    "reason": "File 'src/auth.ts' is locked by user 'github_user_1' (DIRECT)"
  }
}
```

**Lock Types:**
- **DIRECT**: The file you requested is locked by someone else.
- **NEIGHBOR**: A dependency/dependent of your file is locked. Proceed with caution or switch tasks to avoid conflicts.

### `post_status`

**Request:**
```json
{
  "repo_url": "https://github.com/dedalus/core.git",
  "branch": "main",
  "file_paths": ["src/auth.ts", "src/utils.ts"], 
  "status": "READING" | "WRITING" | "OPEN",
  "message": "Refactoring auth logic to use JWT tokens instead of sessions",
  "agent_head": "abc1234...",
  "new_repo_head": "def4567..." // Only for OPEN
}
```

**Notes:**
- `file_paths` are file-level only. Multi-file locking is atomic (all-or-nothing).
- **`message` field is REQUIRED** and serves as the agent's communication channel. Include a clear one-sentence explanation of what you're doing and why. These messages are displayed in real-time to other agents and in the frontend UI.
- When `status` is `OPEN`, you must provide `new_repo_head` (the commit SHA after your changes).

**Response:**
```json
{
  "success": true,
  "orphaned_dependencies": ["src/utils.ts"], 
  "orchestration": {
    "type": "orchestration_command",
    "action": "PROCEED",
    "command": null
  }
}
```

**Note:** `orphaned_dependencies` lists file paths that depend on the files you just released.

---

### `GET /api/graph` (Frontend Only)

**Purpose:** Fetch current dependency graph for visualization in the frontend.

**Query Parameters:**
```
?repo_url=https://github.com/user/repo.git&branch=main
```

**Response:**
```json
{
  "nodes": [
    {"id": "src/auth.ts", "type": "file"},
    {"id": "src/db.ts", "type": "file"},
    {"id": "src/utils.ts", "type": "file"}
  ],
  "edges": [
    {"source": "src/auth.ts", "target": "src/db.ts", "type": "import"},
    {"source": "src/auth.ts", "target": "src/utils.ts", "type": "import"}
  ],
  "locks": {
    "src/auth.ts": {
      "user": "github_user_1",
      "status": "WRITING",
      "message": "Refactoring authentication"
    }
  },
  "version": "abc123def"
}
```

**Notes:**
- This endpoint is for frontend visualization only
- Agents do NOT call this endpoint
- Graph is generated automatically in the background
- Lock status is overlaid on the graph for real-time awareness

---

## 3. Data Structures (Vercel Backend)

### Lock Entry
```json
{
  "key": "repo_url:branch:file_path", // Composite Key
  "file_path": "string",
  "user_id": "string",
  "user_name": "string",
  "status": "READING" | "WRITING",
  "agent_head": "string",
  "message": "string",
  "timestamp": 1610000000,
  "expiry": 1610000300 // timestamp + 300s (Passive Timeout - 5 minutes)
}
```

**Notes:**
- **Granularity**: File-level only. `file_path` represents the file being worked on (e.g., "src/auth.ts")
- **No Heartbeat**: Lock expiration is passive. If timestamp + 300s < now, lock is expired
- **user_name**: Display name for UI purposes
- **message**: Agent's one-sentence explanation of their intent (displayed in UI and to other agents)

---

## 4. Internal Backend Processes

### Graph Generation
**Trigger:** Automatic background process, refreshed periodically or on-demand
**Process:**
1. Fetch repository tree from GitHub at HEAD
2. Parse imports from JS/TS/Python files (regex-based, no AST)
3. Build file→file dependency edges
4. Store in `coord:graph` (Vercel KV)
5. Broadcast `graph_update` WebSocket event to frontend

**Not an API endpoint** - happens behind the scenes. Frontend fetches via `GET /api/graph`.

### Lock Cleanup
**Trigger:** Vercel cron job (runs every 1 minute)
**Process:**
1. Read all locks from `coord:locks`
2. Check each lock's timestamp
3. If `now - timestamp > 300 seconds`:
   - Delete lock from `coord:locks`
   - Broadcast `lock_expired` WebSocket event
   - Log to `coord:status_log`

**Not an API endpoint** - runs automatically in the background. Agents don't need to call anything; stale locks just disappear after 5 minutes of inactivity.
