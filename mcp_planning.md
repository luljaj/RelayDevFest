# Dedalus Labs MCP Planning: Stateless Coordination Layer

## 1. Overview & Core Philosophy

**Goal**: Create a **stateless** MCP server that acts as the coordination logic layer for agentic collaboration. It serves as the bridge between agents (Cursor/VSCode) and the persistent state stored in the Vercel webapp.

**Key Constraints**:
- **Statelessness**: The MCP server MUST NOT store any state in memory or on disk. All state (locks, activity log, repo head) resides in the Vercel backend.
- **Authentication**: Uses Dedalus infrastructure. Credentials (`COORD_API_KEY`) are encrypted client-side, decrypted just-in-time by Dedalus, and used to authenticate the user for every request.
- **Orchestration**: The MCP server receives requests from agents, queries Vercel for state, applies logic (e.g., conflict detection), and returns **orchestration commands** (e.g., "git pull required") to the agent.

---

## 2. Architecture & Data Flow

### The "Sandwich" Model
```
[ Agent Layer ]  (Cursor/VSCode)
      FIELD AGENTS
      ↓  (MCP Tool Call + Encrypted Creds)
      ↓
[ Dedalus Layer ] (Infrastructure)
      AUTHENTICATION & ROUTING
      ↓  (Decrypted Context)
      ↓
[ MCP Server ]   (Python/FastAPI)
      COORDINATION LOGIC (Stateless)
      ↓  (GET/POST State)      ↑ (Orchestration Commands)
      ↓                        |
[ Vercel Layer ] (Next.js/KV/PG)
      STATE & SIGNALING
      ↓  (Persist to DB)
      ↓  (Broadcast via WebSocket)
[ Broadcast ]    (WebSocket)
      ↓
[ Clients ]      (Browser UI / Other Agents)
```

### Critical Flows
1.  **Agent -> MCP**: Agent calls `check_status` or `post_status`.
2.  **MCP -> Vercel**: MCP authenticates user, then queries Vercel API for current `lock_table` and `repo_head`.
3.  **Vercel -> MCP**: Vercel returns state.
4.  **MCP -> Agent**: MCP analyzes state and returns:
    *   **Status**: OK / REJECTED
    *   **Data**: Locks, Activity
    *   **Orchestration Commands**: `git pull --rebase`, `wait`, `resolve_conflict`

---

## 3. Authentication & Security (Dedalus Protocol)

**Mechanism**:
- **Client-Side**: `COORD_API_KEY` is loaded from `.env` and encrypted locally specifically for the Coordination Server.
- **In-Transit**: Encrypted blob sent to Dedalus.
- **Just-In-Time Decryption**: Dedalus decrypts the key in a secure enclave immediately before invoking the MCP tool.
- **Context Injection**: The plaintext key is injected into the tool's execution context: `ctx.request_context.credentials["COORD_API_KEY"]`.
- **User Resolution**: The MCP server hashes this key to look up the user identity (User ID, Email, Name) via the Vercel backend's user directory.

**Implementation Note**:
Every tool implementation must start with:
```python
ctx = get_context()
api_key = ctx.request_context.credentials.get("COORD_API_KEY")
user = authenticate_user(api_key) # Hashes key, queries Vercel/Cache
```

---

## 4. MCP Tool Definitions (API Protocol)

The MCP server exposes the following tools to agents. These are the **only** entry points.

### Tool 1: `check_status`
**Purpose**: The "Look Before You Leap" primitive. Agents MUST call this before starting work.
**Orchestration Role**: Delivers "pull required" commands if the agent is stale.

*   **Input**:
    *   `symbols` (List[str]): The files/symbols the agent intends to work on.
    *   `agent_head` (str): The current git HEAD SHA of the agent's local repo.

*   **Logic**:
    1.  Fetch `repo_head` (latest known shared state) from Vercel.
    2.  Fetch `lock_table` from Vercel.
    3.  Compare `agent_head` vs `repo_head`.
    4.  Check if `symbols` are locked by others.

*   **Output (Response)**:
    *   `status`: "OK" | "STALE" | "CONFLICT"
    *   `repo_head`: "abc1234..."
    *   `locks`: Dict of existing locks on requested symbols.
    *   **Orchestration Command**:
        *   If `agent_head != repo_head`: `{"action": "pull", "command": "git pull --rebase"}`
        *   If `locks` exist: `{"action": "wait", "reason": "Symbol locked by <user>"}`
        *   Otherwise: `null` (Proceed)

### Tool 2: `post_status`
**Purpose**: Claim or Release a lock.
**Orchestration Role**: Enforces freshness. Rejects claims if agent is stale.

*   **Input**:
    *   `symbol` (str): The symbol to lock/unlock.
    *   `status` (str): "READING" | "WRITING" | "OPEN"
    *   `message` (str): Description of intent (e.g., "Refactoring auth").
    *   `agent_head` (str): Required for WRITING. Current local HEAD.
    *   `new_repo_head` (str): Required for OPEN (if changed). New HEAD after push.

*   **Logic**:
    1.  **Validation**:
        *   If `status` == "WRITING": Enforce `agent_head == repo_head`. If not, REJECT with "pull required".
        *   If `status` == "OPEN": If `new_repo_head` provided, update `repo_head` in Vercel.
    2.  **Update**: Call Vercel API to update `lock_table`.
    3.  **Broadcast**: Trigger Vercel to broadcast `status_update` via WebSocket.

*   **Output (Response)**:
    *   `success`: bool
    *   **Orchestration Command**:
        *   If Rejected (Stale): `{"action": "pull", "command": "git pull --rebase"}`
        *   If Rejected (Head Not Advanced on Release): `{"action": "push", "command": "git push"}`

### Tool 3: `post_activity`
**Purpose**: High-level "Slack-style" updates for the team.
**Use Case**: "Starting major refactor of Auth", "Fixing bug #123".

*   **Input**:
    *   `message` (str): The update text.
    *   `scope` (List[str]): Related files/symbols.
    *   `intent` (str): "READING" | "WRITING" | "DEBUGGING"

*   **Logic**:
    1.  Call Vercel API to append to `activity_feed`.
    2.  Trigger Vercel to broadcast `activity_posted` via WebSocket.

### Tool 4: `heartbeat`
**Purpose**: Keep locks alive.
**Constraint**: Locks expire after 60s without a heartbeat.

*   **Input**:
    *   `symbols` (List[str]): List of active locks to refresh.

*   **Logic**:
    1.  Call Vercel API to update `last_heartbeat` for these locks.

---

## 5. Vercel Integration (Backend API)

The MCP server interacts with the Vercel backend via these REST endpoints:

*   **`GET /api/state`**: Returns `{ lock_table, repo_head, activity_feed }`.
*   **`POST /api/lock`**: Updates a lock. Body: `{ symbol, user, status, message }`.
    *   Side Effect: Broadcasts `status_update`.
*   **`POST /api/repo_head`**: Updates the shared repo HEAD. Body: `{ sha }`.
*   **`POST /api/activity`**: Adds an activity log.
*   **`POST /api/heartbeat`**: Updates timestamps for locks.

---

## 6. Implementation Plan Checkpoints

1.  **Skeleton**: basic FastAPI/MCP setup with `check_status` and `post_status` stubs.
2.  **Auth Integration**: Implement `get_context()` decryption and mock user lookup.
3.  **Vercel Client**: Implement the HTTP client to talk to the Vercel API (mocked initially if Vercel not ready).
4.  **Orchestration Logic**: Implement the "Stale Repo" detection and command generation.
5.  **Refinement**: Add `heartbeat` and `post_activity`.

## 7. Prompts for AI Generation

When generating the actual server code, emphasize:
*   "You are building a **stateless** MCP server."
*   "Use the `dedalus_mcp_utils` library for `get_context` (mock if needed)."
*   "Strictly enforce the `agent_head == repo_head` check for WRITING locks."
*   "Return distinct `orchestration_command` objects in responses to guide the agent."
