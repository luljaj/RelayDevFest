# Dedalus Labs MCP Planning: Stateless Coordination Layer

## 1. Overview & Core Philosophy

**Goal**: Create a **stateless** MCP server that acts as the coordination logic layer for agentic collaboration. It serves as the bridge between agents (Cursor/VSCode) and the persistent state stored in the Vercel webapp.

**Key Constraints**:
- **Statelessness**: The MCP server MUST NOT store any state in memory or on disk. All state (locks, activity log, repo head) resides in the Vercel backend.
- **Authentication**: **GitHub via Dedalus**. Agents pass their GitHub Token as an encrypted Dedalus credential. The MCP server decrypts it via `get_context()` and validates identity with GitHub.
- **Orchestration**: Returns strict **orchestration commands** (defined in `schema.md`) to guide agents.
- **Concurrency**: Locks are **advisory intent signals**. They prevent agents from *starting* work on the same file, but cannot physically block a git push if another user bypasses the system.
- **Atomicity**: Vercel API handles atomic locking via transactions/scripts to prevent race conditions during lock acquisition.

---

## 2. Architecture & Data Flow

### The "Sandwich" Model
```
[ Agent Layer ]  (Cursor/VSCode)
      FIELD AGENTS
      ↓  (MCP Tool Call + Encrypted GitHub Token)
      ↓
[ Dedalus Layer ] (Infrastructure)
      AUTHENTICATION & ROUTING
      ↓  (Decrypted Context)
      ↓
[ MCP Server ]   (Python/FastAPI)
      COORDINATION LOGIC (Stateless)
      ↓  (GET/POST State via HTTPS)      ↑ (Orchestration Commands)
      ↓                                  |
[ Vercel Layer ] (Next.js/KV/PG)
      STATE & SIGNALING
      ↓  (Persist to DB)
      ↓  (Broadcast via WebSocket)
[ Broadcast ]    (WebSocket)
      ↓
[ Clients ]      (Browser UI / Other Agents)
```

### Critical Flow: Atomic Locking & Race Conditions
1.  **Agent -> MCP**: `post_status(symbols=[...], status="WRITING")`
2.  **MCP -> Vercel**: `POST /api/lock` (Atomic Transaction)
    *   Vercel checks if ANY symbol is locked by another user *on this branch*.
    *   If locked: Returns 409 Conflict.
    *   If free: Sets locks and returns 200 OK.
3.  **Real-World Git Consistency**:
    *   The lock guarantees **User A** intends to write.
    *   If **User B** pushes to the same file (bypassing MCP), User A's subsequent push will fail at the git layer (non-fast-forward).
    *   MCP minimizes wasted effort but cannot strictly enforce git consistency without server-side hooks.

---

## 3. MCP Server Description (Agent Rules)

**System Prompt Instruction**:
"You are a collaborative agent working in a shared, real-time codebase. You **MUST** strictly adhere to the following Coordination Protocol via the attached MCP tools:"

1.  **Look Before You Leap**:
    *   Before *planning* any edits, call `check_status(symbols=[...])`.
    *   This provides the current state of the dependency graph and any active locks.

2.  **Respect the Graph Status**:
    *   **LOCKED_DIRECT**: Someone is editing this file. **DO NOT EDIT.**
    *   **LOCKED_NEIGHBOR**: A dependency is being edited. **YOU MAY READ, BUT DO NOT EDIT.**
    *   **OPEN**: Free to claim.

3.  **Orchestration Commands are Law**:
    *   If `check_status` returns `ORCHESTRATION_COMMAND: SWITCH_TASK`, you **MUST NOT WAIT**.
    *   Move immediately to an independent task or file that is not locked.
    *   Do not poll aggressively. The graph is warning you of a conflict.

4.  **Listen to Signals**:
    *   Interpretation of `lock_type`:
        *   "DIRECT": High conflict probability. Stop.
        *   "NEIGHBOR": Medium conflict probability (API changes). Read-only mode ok.

---

## 4. Authentication (Dedalus + GitHub)

**Mechanism**:
- **Client-Side**: Agents configure their `.env` with a `GITHUB_TOKEN`.
- **Dedalus Transport**: The agent wraps this token in a Dedalus `SecretValue` and passes it to the MCP server.
- **MCP Server**:
    1.  Calls `ctx = get_context()` (Dedalus SDK).
    2.  Extracts the decrypted `GITHUB_TOKEN` from `ctx.request_context.credentials`.
    3.  Validates the token against GitHub API (e.g., `GET /user`) to resolve the **GitHub Username**.
- **Identity**: All locks and activities are attributed to this verified GitHub Username.

**Implementation Note**:
```python
ctx = get_context()
token = ctx.request_context.credentials.get("GITHUB_TOKEN")
user_profile = verify_github_token(token) # logic in utils
user_id = user_profile.login
```

---

## 4. MCP Tool Definitions

Refer to `schema.md` for exact JSON schemas.

### Tool 1: `check_status`
**Entry Point**: Agents **MUST** call this first.

*   **Input**: `symbols` (List), `agent_head` (String), `repo_url`, `branch`.
*   **Logic**:
    1.  Query Vercel (`POST /api/check_status`). Vercel checks the **Dependency Graph**.
    2.  **Locking Rules**:
        *   **DIRECT LOCK** (Node itself locked): **Cannot READ or WRITE**.
        *   **NEIGHBOR LOCK** (Dependency locked): **Read-Only**. Writing prohibited to prevent conflicts.
    3.  **Orchestration**:
        *   If `LOCKED_DIRECT` or `LOCKED_NEIGHBOR`: Return `ORCHESTRATION_COMMAND: SWITCH_TASK`.
        *   *Instruction*: "Node or dependency is locked. Do not wait. Switch to a task that does not depend on these symbols."
    4.  **Offline Mode**: if Vercel down, return `OFFLINE` warning.

*   **Output**: Schema defined in `schema.md`.

### Tool 2: `post_status`
**Purpose**: Claim/Release locks. Supports **Multi-Symbol Locking** (Atomic).

*   **Input**: `symbols` (List), `status`, `agent_head`, `branch`, `repo_url`.
*   **Logic**:
    1.  **Validation**: Enforce `agent_head == repo_head` for WRITING.
    2.  **Atomic Call**: Send list of symbols to Vercel `/api/lock`.
    3.  **Orchestration**:
        *   If Vercel returns 409 (Conflict): Return `WAIT` command.
        *   If Vercel returns 200: Return `PROCEED`.
        *   If Vercel down: Return `STOP` (Cannot safely write without locks).

### Tool 3: `post_activity`
**Purpose**: Team updates (Slack-style).
*   **Input**: `message`, `scope`, `intent`.

### Tool 4: `post_activity`
**Purpose**: Team updates (Slack-style).
*   **Input**: `message`, `scope`, `intent`.

### Passive Timeout (No Heartbeat)
**Timeout**: **120 seconds** (2 minutes).
*   **Mechanism**: There is no active heartbeat.
*   **Expiration**: If a lock's timestamp is older than 120 seconds, it is automatically considered **FREE**.
*   **Agent Responsibility**: Agents must complete their work chunks within 2 minutes or re-issue a `post_status` to extend the lock. This keeps the system snappy and prevents zombie locks from crashed agents.

---

## 5. Vercel Integration (Backend API)

The MCP server interacts with Vercel via **HTTPS Requests**.

*   **`POST /api/lock`**:
    *   Body: `{ symbols: ["A", "B"], user: "gh_user", status: "WRITING" }`
    *   **Behavior**: Atomic check-and-set. All or nothing.
*   **`GET /api/state`**: Returns global state.
*   **`POST /api/heartbeat`**: Refreshes expiry (set to Now + 100s).

---

## 6. Implementation Checklist

1.  **Schema Enforcement**: Use Pydantic models matching `schema.md`.
2.  **GitHub Auth**: Middleware to validate tokens.
3.  **Atomic Vercel Client**: Ensure `post_status` allows sending multiple symbols in one request.
4.  **Error Handling**:
    *   Vercel Down -> `check_status` = WARN (Offline).
    *   Vercel Down -> `post_status(WRITING)` = STOP (Unsafe).
5.  **Heartbeat Loop**: Ensure agents call every ~30-50s (well within 100s limit).

## 7. Prompts for AI Generation

*   "Generate Pydantic models based on `schema.md`."
*   "Implement `post_status` to hit Vercel's atomic `/api/lock` endpoint."
*   "Use GitHub token validation for `get_user()`."
*   "Implement the `OFFLINE` fallback in `check_status`."
