# Orchestration & Data Schema

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
| **STOP** | Hard conflict or error. | `null` | Heartbeat failed, Vercel down |
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
  "symbols": ["auth.ts", "auth.ts::validateToken"],
  "agent_head": "abc1234..." 
}
```

**Response:**
```json
{
  "status": "OK" | "STALE" | "CONFLICT" | "OFFLINE",
  "repo_head": "abc1234...",
  "locks": {
    "auth.ts": {
      "user": "github_user_1",
      "status": "WRITING",
      "lock_type": "DIRECT" | "NEIGHBOR", // New Field
      "timestamp": 1234567890
    }
  },
  "warnings": [
    "OFFLINE_MODE: Vercel is unreachable. Reading allowed, Writing disabled.",
    "STALE_BRANCH: Your branch is behind origin/main."
  ],
  "orchestration": {
    "type": "orchestration_command",
    "action": "SWITCH_TASK", // Changed from WAIT
    "command": null,
    "reason": "Symbol 'auth.ts' is locked by user 'octocat' (DIRECT)"
  }
}
```

### `post_status`

**Request:**
```json
{
  "repo_url": "https://github.com/dedalus/core.git",
  "branch": "main",
  "symbols": ["auth.ts::validateToken", "auth.ts::login"], 
  "status": "READING" | "WRITING" | "OPEN",
  "message": "Refactoring auth logic",
  "agent_head": "abc1234...",
  "new_repo_head": "def4567..." // Only for OPEN
}
```

**Response:**
```json
{
  "success": true,
  "orphaned_dependencies": ["utils.ts"], 
  "orchestration": {
    "type": "orchestration_command",
    "action": "PROCEED",
    "command": null
  }
}
```

---

## 3. Data Structures (Vercel Backend)

### Lock Entry
```json
{
  "key": "repo_url:branch:symbol", // Composite Key
  "symbol": "string",
  "user_id": "string", 
  "status": "READING" | "WRITING",
  "agent_head": "string",
  "timestamp": 1610000000,
  "expiry": 1610000120 // timestamp + 120s (Passive Timeout)
}
```
