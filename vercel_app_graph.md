# Graph Implementation - Technical Specifications

## Overview

This document provides detailed technical specifications for the file dependency graph generation and management system. The graph visualizes file-level dependencies and overlays real-time lock status for multi-agent coordination.

---

## **1. GitHub API Integration**

### Specific Endpoints Used

#### Get Branch Reference (Repo HEAD)
- **Endpoint:** `GET /repos/{owner}/{repo}/git/refs/heads/{branch}`
- **Returns:** `{ "object": { "sha": "abc123..." } }`
- **Purpose:** Get the current commit SHA to detect if repo changed
- **Rate limit cost:** 1 request per graph check

#### Get Git Tree (Recursive File List)
- **Endpoint:** `GET /repos/{owner}/{repo}/git/trees/{tree_sha}?recursive=1`
- **Returns:** Array of `{ path, mode, type, sha, size }` for every file
- **Purpose:** Get complete file list with their Git SHAs
- **Rate limit cost:** 1 request per graph update
- **Key advantage:** Single request gets entire repo structure with SHAs

#### Get File Contents
- **Endpoint:** `GET /repos/{owner}/{repo}/contents/{path}?ref={sha}`
- **Returns:** `{ content: "<base64>", sha, size, ... }`
- **Purpose:** Fetch raw file content for parsing imports
- **Rate limit cost:** 1 request per file that needs parsing
- **Optimization:** Only called for NEW or CHANGED files in incremental mode

### Authentication Method
- Use GitHub Personal Access Token (PAT) or GitHub App
- Header: `Authorization: Bearer {token}` or `Authorization: token {token}`
- Required scope: `repo:read` (or `public_repo` for public repos only)

### Rate Limiting Strategy
- GitHub allows 5,000 requests/hour (authenticated)
- **First graph generation:** ~1 + 1 + N requests (ref + tree + N files)
- **Incremental updates:** ~1 + 1 + M requests (ref + tree + M changed files, where M << N)
- **Optimization:** Cache file contents in memory during parsing to avoid re-fetching

---

## **2. Dependency Parsing Methodology**

### Why Regex Instead of AST?
- **Speed:** Regex is 10-100x faster than full AST parsing
- **Simplicity:** No need for language-specific parsers (Babel, TypeScript Compiler API, Python ast module)
- **File-level granularity:** We only need import statements, not full syntax analysis
- **Trade-off:** Miss edge cases like dynamic imports with variables, but acceptable for coordination

### Specific Regex Patterns

#### TypeScript/JavaScript

**1. ES6 Import:**
- Pattern: `^import\s+.*\s+from\s+['"]([^'"]+)['"]`
- Matches: `import { foo } from './bar'`
- Captures: `./bar`

**2. ES6 Re-export:**
- Pattern: `^export\s+.*\s+from\s+['"]([^'"]+)['"]`
- Matches: `export * from '../utils'`
- Captures: `../utils`

**3. CommonJS/Dynamic Import:**
- Pattern: `(import|require)\(['"]([^'"]+)['"]\)`
- Matches: `require('./db')` or `import('./lazy')`
- Captures: `./db` or `./lazy`

#### Python

**1. Direct Import:**
- Pattern: `^import\s+([\w\.]+)`
- Matches: `import os.path`
- Captures: `os.path`

**2. From Import:**
- Pattern: `^from\s+([\w\.]+)\s+import`
- Matches: `from .utils import helper`
- Captures: `.utils`

### Regex Flags
- Use `g` (global) flag to find all matches in file
- Use `m` (multiline) flag so `^` matches start of each line
- **Important:** Reset regex `.lastIndex` between files to avoid state bugs

---

## **3. Import Path Resolution Algorithm**

### Challenge
Convert relative import strings like `./auth` into absolute file paths like `src/auth.ts`

### Resolution Steps

#### 1. Filter Out External Libraries
- If import doesn't start with `.` or `..` → skip it (it's npm/pip package)
- Examples to ignore: `react`, `express`, `numpy`, `@types/node`

#### 2. Resolve Relative Path
- Get current file's directory: `src/api/users.ts` → `src/api/`
- Apply path.resolve logic: `src/api/` + `../utils` → `src/utils`
- **Use Node.js path resolution algorithm** (even for Python files, since paths work the same)

#### 3. Extension Probing (File Existence Check)
Base path: `src/utils`

Try in order:
1. `src/utils.ts`
2. `src/utils.tsx`
3. `src/utils.js`
4. `src/utils.jsx`
5. `src/utils.py`
6. `src/utils/index.ts`
7. `src/utils/index.tsx`
8. `src/utils/index.js`
9. `src/utils/index.jsx`

- **Check against GitHub tree:** Use the Set of all file paths from GitHub tree
- **First match wins**

#### 4. Special Cases
- Python relative imports: `from .module import x` → `.` means same directory
- Python parent imports: `from ..utils import x` → `..` means parent directory
- TypeScript path aliases: **NOT SUPPORTED** (would require reading tsconfig.json)
- Webpack aliases: **NOT SUPPORTED** (would require reading webpack config)

### Why This Approach?
- Works without file system access (we only have GitHub tree)
- No need to download/execute tsconfig.json or webpack.config.js
- Fast: O(1) Set lookup for each candidate path

---

## **4. Redis (Vercel KV) Data Structures**

### Specific Keys and Data Types

#### 1. `coord:graph` (String - JSON)
- Stores entire graph: `{ nodes: [...], edges: [...] }`
- Size: ~10-100KB for medium repo (1000 files)
- Updated atomically on each graph sync

#### 2. `coord:graph_meta` (String)
- Stores last processed repo HEAD SHA
- Purpose: Quick check if graph is stale
- Example value: `"7f8a9b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a"`

#### 3. `coord:file_shas` (Hash)
- Maps filepath → Git SHA
- Example: `{ "src/auth.ts": "abc123...", "src/db.ts": "def456..." }`
- Purpose: Detect which specific files changed
- **Critical for incremental updates**

#### 4. `coord:locks` (Hash)
- Maps filepath → lock JSON
- Lock JSON: `{ user_id, status, timestamp, expiry, message }`
- Purpose: Current file locks (overlaid on graph)

### Redis Operations Used

- `GET coord:graph` - Fetch graph (single read)
- `SET coord:graph <json>` - Store updated graph (atomic write)
- `HGETALL coord:file_shas` - Get all file SHAs (single read)
- `HMSET coord:file_shas ...` - Bulk update file SHAs
- `HDEL coord:file_shas path1 path2 ...` - Remove deleted files
- `HGETALL coord:locks` - Get all current locks

### Transaction Strategy
- Use Redis MULTI/EXEC for atomic updates
- Ensures graph + metadata + file_shas update together
- Prevents race conditions if multiple graph updates triggered simultaneously

---

## **5. Incremental Update Algorithm (Diff & Sync)**

### Two-Layer Change Detection

#### Layer 1 - Repo-Level Check
- Compare stored `coord:graph_meta` SHA vs GitHub HEAD SHA
- If identical → **Exit immediately** (most common case)
- Cost: 1 GitHub API call + 1 Redis read
- **Optimization:** 99% of checks exit here when no commits

#### Layer 2 - File-Level Diff
- Fetch GitHub tree (all files with SHAs)
- Fetch `coord:file_shas` from Redis
- Build three sets:
  - **NEW:** In GitHub, not in Redis
  - **CHANGED:** In both, but different SHAs
  - **DELETED:** In Redis, not in GitHub
  - **UNCHANGED:** SHAs match → **skip entirely**

### Processing Strategy

#### For NEW Files
- Fetch content from GitHub
- Parse dependencies
- Add node to graph
- Add edges from this file to its dependencies
- Store SHA in `coord:file_shas`

#### For CHANGED Files
- Fetch new content from GitHub
- Parse dependencies
- **Remove all old edges** where source = this file
- **Add new edges** based on new dependencies
- Update SHA in `coord:file_shas`
- **Node stays the same** (only edges change)

#### For DELETED Files
- Remove node from graph
- Remove all edges where source = this file
- Remove all edges where target = this file (it's no longer a valid dependency)
- Delete from `coord:file_shas`

#### For UNCHANGED Files
- **Do nothing** - no GitHub API calls, no parsing

### Performance Impact
- First run: Parse 100% of files
- Typical commit: Parse ~2-5% of files (only what changed)
- **10-50x faster** than full regeneration

---

## **6. Lock Overlay Mechanism**

### Why Separate Storage?
- Graph structure changes slowly (on commits)
- Lock state changes frequently (every few seconds)
- **Don't want to regenerate graph** just because someone took a lock

### How Overlay Works
1. Graph stored in `coord:graph` (relatively static)
2. Locks stored in `coord:locks` (highly dynamic)
3. When frontend requests graph:
   - Fetch both independently
   - Merge at query time: add `locks` field to graph JSON
   - Return combined structure

### Lock Data Format
```json
{
  "locks": {
    "src/auth.ts": {
      "user": "Luka",
      "status": "WRITING",
      "timestamp": 1707321600000
    },
    "src/db.ts": {
      "user": "Jane", 
      "status": "READING",
      "timestamp": 1707321650000
    }
  }
}
```

### Visual Representation
- Frontend can highlight locked nodes in the graph
- Color coding: WRITING (red), READING (yellow), OPEN (green)
- Show user avatar on locked nodes

---

## **7. Graph Update Trigger Points**

### When does graph regeneration happen?

#### 1. Manual Trigger
- Admin calls `POST /api/generate_graph`
- Used for initial setup or force refresh

#### 2. On Lock Acquisition (Optional)
- When agent calls `POST /api/post_status` with status=WRITING
- Check if graph is stale (compare repo HEAD)
- If stale → trigger incremental update
- **Ensures agents see current graph before working**

#### 3. Scheduled Background Job (Optional)
- Vercel cron job every 5 minutes: `GET /api/update_graph_if_stale`
- Checks repo HEAD, runs incremental update if needed
- **Keeps graph fresh even when no agents active**

#### 4. Webhook from GitHub (Advanced)
- GitHub webhook on push events
- POST to Vercel endpoint with commit SHA
- Immediately trigger incremental update
- **Lowest latency** but requires webhook setup

---

## **8. Edge Cases & Error Handling**

### Import Resolution Failures
- Import path references non-existent file → log warning, skip edge
- Circular imports → allowed in graph (frontend handles visualization)
- Import with dynamic expression: `require(variable)` → can't parse, skip

### GitHub API Failures
- Rate limit hit → retry with exponential backoff
- 404 on file → file was deleted mid-update, skip it
- Network timeout → fail gracefully, don't corrupt existing graph

### Redis Failures
- Connection lost → retry operation
- Transaction conflict → retry with backoff
- Key not found → treat as empty (first run)

### File Content Issues
- Binary file returned → skip parsing (shouldn't happen with file type filter)
- Malformed UTF-8 → skip file, log error
- File too large (>1MB) → skip or truncate to first N lines for imports

---

## **9. Performance Characteristics**

### Complexity Analysis

#### Initial Graph Generation
- **Time:** O(N × M) where N = files, M = avg imports per file
- **GitHub API calls:** 2 + N (ref + tree + N contents)
- **Typical:** 500 files × 5 imports = 2,500 edges parsed
- **Duration:** ~30-60 seconds for medium repo

#### Incremental Update
- **Time:** O(C × M) where C = changed files
- **GitHub API calls:** 2 + C
- **Typical:** 5 changed files × 5 imports = 25 edges
- **Duration:** ~2-5 seconds

#### Graph Query (GET /api/graph)
- **Time:** O(1) - single Redis read + lock overlay
- **Duration:** ~50-100ms

### Memory Usage
- Store graph in Redis: ~100-200KB per 1000 files
- In-memory processing: Stream file contents, don't load entire repo
- Frontend receives: Full graph structure (~100KB typical)

---

## **10. Frontend Visualization Implications**

### Graph Format Sent to Frontend

**Structure:**
```json
{
  "nodes": [
    { "id": "src/auth.ts", "type": "file" },
    { "id": "src/db.ts", "type": "file" }
  ],
  "edges": [
    { "source": "src/auth.ts", "target": "src/db.ts", "type": "import" }
  ],
  "locks": {
    "src/auth.ts": {
      "user": "Luka",
      "status": "WRITING",
      "timestamp": 1707321600000
    }
  },
  "version": "abc123def"
}
```

### Suggested Visualization Library
- **Option 1:** D3.js force-directed graph (flexible, customizable)
- **Option 2:** Cytoscape.js (optimized for large graphs)
- **Option 3:** React Flow (modern, React-native)

### Graph Metrics
- Node count: 100-2000 typical
- Edge count: 500-10,000 typical
- **Performance limit:** Most browsers handle <5000 nodes smoothly

### Filtering/Zoom
- Backend provides full graph
- Frontend filters by directory: show only `src/` subtree
- Search/highlight specific files
- Show dependency path between two files (BFS algorithm client-side)

---

## **11. Implementation Flow Summary**

### Initial Setup (First Graph Generation)
1. Fetch repo HEAD SHA from GitHub
2. Fetch complete file tree (recursive)
3. Filter for JS/TS/Python files
4. For each file:
   - Fetch content from GitHub
   - Parse imports with regex
   - Resolve relative paths to absolute
   - Build edges
5. Store graph in `coord:graph`
6. Store file SHAs in `coord:file_shas`
7. Store repo HEAD in `coord:graph_meta`
8. Broadcast `graph_update` WebSocket event

### Incremental Update (Subsequent Updates)
1. Fetch current repo HEAD SHA from GitHub
2. Compare with `coord:graph_meta`
3. If unchanged → exit
4. Fetch file tree and compare with `coord:file_shas`
5. Identify NEW, CHANGED, DELETED files
6. Process only changed files:
   - NEW: Add nodes + edges
   - CHANGED: Update edges only
   - DELETED: Remove nodes + edges
7. Update Redis atomically (transaction)
8. Broadcast `graph_update` WebSocket event

### Graph Query with Locks
1. Fetch `coord:graph` from Redis
2. Fetch `coord:locks` from Redis
3. Merge locks into graph structure
4. Return to frontend

---

## **12. Key Design Decisions**

1. **File-Level Only:** No function or line-level dependencies (simpler, faster)
2. **Regex Parsing:** No AST parsing (10-100x faster, acceptable accuracy)
3. **Incremental Updates:** Only reprocess changed files (saves 95%+ API calls)
4. **Lock Overlay:** Separate storage for graph vs locks (different update frequencies)
5. **GitHub Tree API:** Single API call gets all file SHAs (efficient change detection)
6. **No Path Aliases:** Skip tsconfig/webpack resolution (too complex, rare conflicts)
7. **Relative Imports Only:** Ignore external packages (not relevant for coordination)
8. **Extension Probing:** Try common extensions instead of reading config files

---

## **13. Future Enhancements (Optional)**

### Advanced Features (Not in MVP)
- Function-level dependencies (requires AST parsing)
- Cross-language dependencies (C++ → Python bindings)
- Dynamic import analysis (static analysis with heuristics)
- TypeScript path alias support (parse tsconfig.json)
- Dependency strength metrics (count of imports between files)
- Circular dependency detection and warnings
- Hot module replacement (HMR) integration for live updates
- Graph diff visualization (before/after comparison)

### Performance Optimizations
- Parallel file parsing (process multiple files simultaneously)
- GitHub GraphQL API (batch queries, fewer requests)
- Redis pipelining (batch multiple operations)
- WebSocket binary protocol (smaller payloads)
- Frontend graph virtualization (render only visible nodes)

---

## References

- **Main Architecture:** See `vercel_app.md`
- **Data Schema:** See `schema.md`
- **API Endpoints:** See `api_endpoints_review.md`
- **GitHub API Docs:** https://docs.github.com/en/rest
- **Vercel KV Docs:** https://vercel.com/docs/storage/vercel-kv
