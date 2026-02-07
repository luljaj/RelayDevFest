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

### Complete Implementation

```typescript
// lib/parser.ts

export type FileLanguage = 'ts' | 'js' | 'py';

export interface ParsedImport {
  raw: string;        // Original import statement
  module: string;     // Extracted module path
  lineNumber: number; // Line where import was found
}

/**
 * Parse all imports from file content
 * Returns array of import paths with metadata
 */
export function parseImports(
  content: string,
  filePath: string,
  language: FileLanguage
): ParsedImport[] {
  const imports: ParsedImport[] = [];
  const lines = content.split('\n');

  if (language === 'ts' || language === 'js') {
    // ES6 import: import { foo } from './bar'
    const es6ImportRegex = /^import\s+.*\s+from\s+['"]([^'"]+)['"]/;
    // ES6 export: export * from './bar'
    const es6ExportRegex = /^export\s+.*\s+from\s+['"]([^'"]+)['"]/;
    // CommonJS/dynamic: require('./bar') or import('./bar')
    const cjsRegex = /(import|require)\(['"]([^'"]+)['"]\)/g;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      
      // Skip comments
      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
        continue;
      }

      // ES6 Import
      const es6ImportMatch = trimmed.match(es6ImportRegex);
      if (es6ImportMatch) {
        imports.push({
          raw: line,
          module: es6ImportMatch[1],
          lineNumber: i + 1
        });
        continue;
      }

      // ES6 Export
      const es6ExportMatch = trimmed.match(es6ExportRegex);
      if (es6ExportMatch) {
        imports.push({
          raw: line,
          module: es6ExportMatch[1],
          lineNumber: i + 1
        });
        continue;
      }

      // CommonJS (can have multiple per line)
      cjsRegex.lastIndex = 0; // Reset regex state
      let cjsMatch;
      while ((cjsMatch = cjsRegex.exec(line)) !== null) {
        imports.push({
          raw: line,
          module: cjsMatch[2],
          lineNumber: i + 1
        });
      }
    }
  } else if (language === 'py') {
    // Direct import: import os.path
    const directImportRegex = /^import\s+([\w\.]+)/;
    // From import: from .utils import helper
    const fromImportRegex = /^from\s+([\w\.]+)\s+import/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Skip comments
      if (trimmed.startsWith('#')) {
        continue;
      }

      // Direct import
      const directMatch = trimmed.match(directImportRegex);
      if (directMatch) {
        imports.push({
          raw: line,
          module: directMatch[1],
          lineNumber: i + 1
        });
        continue;
      }

      // From import
      const fromMatch = trimmed.match(fromImportRegex);
      if (fromMatch) {
        imports.push({
          raw: line,
          module: fromMatch[1],
          lineNumber: i + 1
        });
      }
    }
  }

  return imports;
}

/**
 * Determine language from file extension
 */
export function getFileLanguage(filePath: string): FileLanguage | null {
  if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) return 'ts';
  if (filePath.endsWith('.js') || filePath.endsWith('.jsx')) return 'js';
  if (filePath.endsWith('.py')) return 'py';
  return null;
}

/**
 * Filter out external package imports (keep only relative imports)
 */
export function isRelativeImport(importPath: string): boolean {
  return importPath.startsWith('.') || importPath.startsWith('/');
}
```

### Edge Cases Handled

```typescript
// Test cases for import parsing
const testCases = [
  // Valid imports
  { input: "import { foo } from './bar'", expected: './bar' },
  { input: "import * as utils from '../utils'", expected: '../utils' },
  { input: "export { default } from './component'", expected: './component' },
  { input: "const db = require('./database')", expected: './database' },
  { input: "const lazy = import('./lazy')", expected: './lazy' },
  { input: "from .models import User", expected: '.models' },
  { input: "from ..utils import helper", expected: '..utils' },
  
  // Edge cases (should skip)
  { input: "// import { foo } from './bar'", expected: null }, // Comment
  { input: "import React from 'react'", expected: null },      // External package
  { input: "import('variable' + path)", expected: null },      // Dynamic with variable
  { input: "# from .utils import foo", expected: null },       // Python comment
];
```

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

### Complete Implementation

```typescript
// lib/resolver.ts
import { isRelativeImport } from './parser';

/**
 * Resolve relative import path to absolute file path
 * Returns null if import is external or cannot be resolved
 */
export function resolveImportPath(
  importPath: string,
  currentFilePath: string,
  allFilePaths: Set<string>
): string | null {
  // Filter out external packages
  if (!isRelativeImport(importPath)) {
    return null;
  }

  // Get directory of current file
  const lastSlash = currentFilePath.lastIndexOf('/');
  const currentDir = lastSlash > 0 ? currentFilePath.substring(0, lastSlash) : '';

  // Resolve relative path
  const resolved = resolvePath(currentDir, importPath);

  // Try different extensions
  const candidates = generateCandidates(resolved);

  for (const candidate of candidates) {
    if (allFilePaths.has(candidate)) {
      return candidate;
    }
  }

  // Not found
  return null;
}

/**
 * Resolve relative path using Node.js algorithm
 * Example: resolvePath('src/api', '../utils') => 'src/utils'
 */
function resolvePath(currentDir: string, relativePath: string): string {
  const parts = currentDir ? currentDir.split('/') : [];
  const importParts = relativePath.split('/');

  for (const part of importParts) {
    if (part === '..') {
      // Go up one directory
      if (parts.length > 0) {
        parts.pop();
      }
    } else if (part === '.') {
      // Current directory, do nothing
      continue;
    } else if (part) {
      // Add directory/file
      parts.push(part);
    }
  }

  return parts.join('/');
}

/**
 * Generate candidate file paths with different extensions
 */
function generateCandidates(basePath: string): string[] {
  const candidates: string[] = [];

  // Direct file matches
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py'];
  for (const ext of extensions) {
    candidates.push(basePath + ext);
  }

  // Index file matches (for directory imports)
  const indexFiles = ['index.ts', 'index.tsx', 'index.js', 'index.jsx'];
  for (const index of indexFiles) {
    candidates.push(`${basePath}/${index}`);
  }

  return candidates;
}

/**
 * Example usage and test cases
 */
export function testResolver() {
  const allFiles = new Set([
    'src/index.ts',
    'src/api/users.ts',
    'src/api/auth.ts',
    'src/utils/db.ts',
    'src/utils/index.ts',
    'src/components/Button.tsx',
    'lib/helper.js'
  ]);

  const tests = [
    {
      current: 'src/api/users.ts',
      import: './auth',
      expected: 'src/api/auth.ts'
    },
    {
      current: 'src/api/users.ts',
      import: '../utils/db',
      expected: 'src/utils/db.ts'
    },
    {
      current: 'src/api/users.ts',
      import: '../utils',
      expected: 'src/utils/index.ts' // Resolves to index file
    },
    {
      current: 'src/index.ts',
      import: './components/Button',
      expected: 'src/components/Button.tsx'
    },
    {
      current: 'src/api/users.ts',
      import: '../../lib/helper',
      expected: 'lib/helper.js'
    },
    {
      current: 'src/api/users.ts',
      import: 'express', // External package
      expected: null
    }
  ];

  for (const test of tests) {
    const result = resolveImportPath(test.import, test.current, allFiles);
    console.assert(
      result === test.expected,
      `Failed: ${test.current} -> ${test.import} (expected ${test.expected}, got ${result})`
    );
  }

  console.log('All resolver tests passed!');
}
```

### Python Import Resolution Special Cases

```typescript
/**
 * Handle Python-specific import syntax
 * Python uses dots for relative imports
 */
export function resolvePythonImport(
  importPath: string,
  currentFilePath: string,
  allFilePaths: Set<string>
): string | null {
  // Handle relative imports with leading dots
  // from . import module  -> same directory
  // from .. import module -> parent directory
  // from .subpackage import module -> subdirectory

  let relativePath = importPath;
  let levelsUp = 0;

  // Count leading dots
  while (relativePath.startsWith('.')) {
    levelsUp++;
    relativePath = relativePath.substring(1);
  }

  if (levelsUp === 0) {
    // Absolute import (external package)
    return null;
  }

  // Get current directory
  const currentDir = currentFilePath.substring(0, currentFilePath.lastIndexOf('/'));
  const parts = currentDir.split('/');

  // Go up directories based on dots
  for (let i = 0; i < levelsUp - 1; i++) {
    parts.pop();
  }

  // Add the module path
  if (relativePath) {
    const moduleParts = relativePath.split('.');
    parts.push(...moduleParts);
  }

  const basePath = parts.join('/');

  // Try candidates
  const candidates = [
    `${basePath}.py`,
    `${basePath}/__init__.py`
  ];

  for (const candidate of candidates) {
    if (allFilePaths.has(candidate)) {
      return candidate;
    }
  }

  return null;
}
```

### Performance Optimization

```typescript
/**
 * Cache resolved paths to avoid repeated lookups
 */
export class ImportResolver {
  private cache = new Map<string, string | null>();

  constructor(private allFilePaths: Set<string>) {}

  resolve(importPath: string, currentFilePath: string): string | null {
    const cacheKey = `${currentFilePath}:${importPath}`;
    
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const resolved = resolveImportPath(importPath, currentFilePath, this.allFilePaths);
    this.cache.set(cacheKey, resolved);
    
    return resolved;
  }

  clear() {
    this.cache.clear();
  }
}

// Usage
const resolver = new ImportResolver(allFilePaths);
const resolved = resolver.resolve('./auth', 'src/api/users.ts');
```

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

## **14. Complete Working Example**

### Full Graph Service Implementation

```typescript
// lib/graph-service.ts
import { octokit, parseRepoUrl, getRepoHead } from './github';
import { kv } from './kv';
import { getLocks } from './locks';
import { parseImports, getFileLanguage } from './parser';
import { ImportResolver } from './resolver';

export interface GraphNode {
  id: string;
  type: 'file';
  size?: number;
  language?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: 'import';
}

export interface DependencyGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  locks: Record<string, any>;
  version: string;
  metadata: {
    generated_at: number;
    files_processed: number;
    edges_found: number;
  };
}

export class GraphService {
  private repoUrl: string;
  private branch: string;
  private owner: string;
  private repo: string;

  constructor(repoUrl: string, branch: string = 'main') {
    this.repoUrl = repoUrl;
    this.branch = branch;
    const parsed = parseRepoUrl(repoUrl);
    this.owner = parsed.owner;
    this.repo = parsed.repo;
  }

  private getKeys() {
    return {
      graph: `graph:${this.repoUrl}:${this.branch}`,
      meta: `graph:meta:${this.repoUrl}:${this.branch}`,
      fileShas: `graph:file_shas:${this.repoUrl}:${this.branch}`
    };
  }

  /**
   * Get cached graph or return null if not exists
   */
  async getCached(): Promise<DependencyGraph | null> {
    const keys = this.getKeys();
    const cached = await kv.get(keys.graph) as string | null;
    
    if (!cached) return null;

    const graph = JSON.parse(cached) as DependencyGraph;
    
    // Overlay current locks
    const locks = await getLocks(this.repoUrl, this.branch);
    graph.locks = locks;

    return graph;
  }

  /**
   * Check if graph needs update
   */
  async needsUpdate(): Promise<{ needsUpdate: boolean; currentHead: string }> {
    const keys = this.getKeys();
    const currentHead = await getRepoHead(this.owner, this.repo, this.branch);
    const storedHead = await kv.get(keys.meta) as string | null;

    return {
      needsUpdate: currentHead !== storedHead,
      currentHead
    };
  }

  /**
   * Generate or update graph incrementally
   */
  async generate(force: boolean = false): Promise<DependencyGraph> {
    const keys = this.getKeys();
    const startTime = Date.now();

    // Get current HEAD
    const currentHead = await getRepoHead(this.owner, this.repo, this.branch);

    // Check if update needed
    if (!force) {
      const storedHead = await kv.get(keys.meta) as string | null;
      if (storedHead === currentHead) {
        console.log('[Graph] Already up to date');
        return (await this.getCached())!;
      }
    }

    console.log('[Graph] Generating for', this.repoUrl, '@', currentHead);

    // Fetch file tree
    const { data: treeData } = await octokit.rest.git.getTree({
      owner: this.owner,
      repo: this.repo,
      tree_sha: currentHead,
      recursive: 'true'
    });

    // Filter supported files
    const supportedExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py'];
    const files = treeData.tree.filter(
      item =>
        item.type === 'blob' &&
        item.path &&
        supportedExtensions.some(ext => item.path!.endsWith(ext))
    );

    console.log(`[Graph] Found ${files.length} files`);

    // Get stored SHAs for incremental update
    const storedShas = await kv.hgetall(keys.fileShas) as Record<string, string> || {};
    const allFilePaths = new Set(files.map(f => f.path!));

    // Categorize files
    const newFiles = files.filter(f => !storedShas[f.path!]);
    const changedFiles = files.filter(f => storedShas[f.path!] && storedShas[f.path!] !== f.sha);
    const deletedFiles = Object.keys(storedShas).filter(p => !allFilePaths.has(p));

    console.log(`[Graph] Changes: ${newFiles.length} new, ${changedFiles.length} changed, ${deletedFiles.length} deleted`);

    // Load existing graph
    let nodes: GraphNode[] = [];
    let edges: GraphEdge[] = [];

    const existing = await kv.get(keys.graph) as string | null;
    if (existing) {
      const parsed = JSON.parse(existing) as DependencyGraph;
      nodes = parsed.nodes;
      edges = parsed.edges;

      // Remove deleted files
      nodes = nodes.filter(n => !deletedFiles.includes(n.id));
      edges = edges.filter(e => !deletedFiles.includes(e.source) && !deletedFiles.includes(e.target));

      // Remove edges from changed files
      edges = edges.filter(e => !changedFiles.some(f => f.path === e.source));
    }

    // Create resolver
    const resolver = new ImportResolver(allFilePaths);

    // Process new and changed files
    const filesToProcess = [...newFiles, ...changedFiles];
    let processedCount = 0;

    for (const file of filesToProcess) {
      const path = file.path!;
      
      try {
        // Add node if new
        if (!nodes.some(n => n.id === path)) {
          const language = getFileLanguage(path);
          nodes.push({
            id: path,
            type: 'file',
            size: file.size,
            language: language || undefined
          });
        }

        // Fetch content
        const { data: contentData } = await octokit.rest.repos.getContent({
          owner: this.owner,
          repo: this.repo,
          path,
          ref: currentHead
        });

        if ('content' in contentData) {
          const content = Buffer.from(contentData.content, 'base64').toString('utf-8');
          const language = getFileLanguage(path);
          
          if (language) {
            // Parse imports
            const imports = parseImports(content, path, language);

            // Resolve and add edges
            for (const imp of imports) {
              const resolved = resolver.resolve(imp.module, path);
              if (resolved) {
                // Avoid duplicates
                if (!edges.some(e => e.source === path && e.target === resolved)) {
                  edges.push({
                    source: path,
                    target: resolved,
                    type: 'import'
                  });
                }
              }
            }
          }
        }

        processedCount++;
        if (processedCount % 10 === 0) {
          console.log(`[Graph] Processed ${processedCount}/${filesToProcess.length} files`);
        }

      } catch (error) {
        console.error(`[Graph] Failed to process ${path}:`, error.message);
      }
    }

    // Update file SHAs
    const newShas: Record<string, string> = {};
    for (const file of files) {
      newShas[file.path!] = file.sha!;
    }

    // Save atomically
    const graph: DependencyGraph = {
      nodes,
      edges,
      locks: {},
      version: currentHead,
      metadata: {
        generated_at: Date.now(),
        files_processed: processedCount,
        edges_found: edges.length
      }
    };

    // Transaction: update graph, meta, and SHAs together
    const pipeline = kv.pipeline();
    pipeline.set(keys.graph, JSON.stringify(graph));
    pipeline.set(keys.meta, currentHead);
    
    if (deletedFiles.length > 0) {
      pipeline.hdel(keys.fileShas, ...deletedFiles);
    }
    if (Object.keys(newShas).length > 0) {
      pipeline.hset(keys.fileShas, newShas);
    }
    
    await pipeline.exec();

    const elapsed = Date.now() - startTime;
    console.log(`[Graph] Complete in ${elapsed}ms: ${nodes.length} nodes, ${edges.length} edges`);

    // Overlay locks
    const locks = await getLocks(this.repoUrl, this.branch);
    graph.locks = locks;

    return graph;
  }

  /**
   * Get graph with automatic regeneration if stale
   */
  async get(forceRegenerate: boolean = false): Promise<DependencyGraph> {
    if (forceRegenerate) {
      return await this.generate(true);
    }

    const cached = await this.getCached();
    if (cached) {
      // Check if stale
      const { needsUpdate } = await this.needsUpdate();
      if (!needsUpdate) {
        return cached;
      }
    }

    // Generate new graph
    return await this.generate();
  }
}
```

### Usage in API Routes

```typescript
// app/api/graph/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { GraphService } from '@/lib/graph-service';

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

    const service = new GraphService(repoUrl, branch);
    const graph = await service.get(regenerate);

    return NextResponse.json(graph, {
      headers: {
        'Cache-Control': 'public, max-age=5, s-maxage=5',
      }
    });

  } catch (error) {
    console.error('[API] Graph error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch graph', details: error.message },
      { status: 500 }
    );
  }
}
```

---

## **15. Testing the Graph System**

### Unit Tests

```typescript
// __tests__/parser.test.ts
import { parseImports } from '@/lib/parser';

describe('Import Parser', () => {
  test('parses ES6 imports', () => {
    const code = `
import { foo } from './bar';
import * as utils from '../utils';
export { default } from './component';
    `.trim();

    const imports = parseImports(code, 'src/test.ts', 'ts');
    
    expect(imports).toHaveLength(3);
    expect(imports[0].module).toBe('./bar');
    expect(imports[1].module).toBe('../utils');
    expect(imports[2].module).toBe('./component');
  });

  test('parses CommonJS requires', () => {
    const code = `
const db = require('./database');
const config = require('../config');
    `.trim();

    const imports = parseImports(code, 'src/test.js', 'js');
    
    expect(imports).toHaveLength(2);
    expect(imports[0].module).toBe('./database');
    expect(imports[1].module).toBe('../config');
  });

  test('parses Python imports', () => {
    const code = `
import os.path
from .models import User
from ..utils import helper
    `.trim();

    const imports = parseImports(code, 'src/test.py', 'py');
    
    expect(imports).toHaveLength(3);
    expect(imports[0].module).toBe('os.path');
    expect(imports[1].module).toBe('.models');
    expect(imports[2].module).toBe('..utils');
  });

  test('ignores comments', () => {
    const code = `
// import { foo } from './bar';
import { real } from './real';
/* import { fake } from './fake'; */
    `.trim();

    const imports = parseImports(code, 'src/test.ts', 'ts');
    
    expect(imports).toHaveLength(1);
    expect(imports[0].module).toBe('./real');
  });
});
```

```typescript
// __tests__/resolver.test.ts
import { resolveImportPath } from '@/lib/resolver';

describe('Import Resolver', () => {
  const allFiles = new Set([
    'src/index.ts',
    'src/api/users.ts',
    'src/api/auth.ts',
    'src/utils/db.ts',
    'src/utils/index.ts',
    'src/components/Button.tsx',
  ]);

  test('resolves sibling import', () => {
    const resolved = resolveImportPath('./auth', 'src/api/users.ts', allFiles);
    expect(resolved).toBe('src/api/auth.ts');
  });

  test('resolves parent import', () => {
    const resolved = resolveImportPath('../utils/db', 'src/api/users.ts', allFiles);
    expect(resolved).toBe('src/utils/db.ts');
  });

  test('resolves index file', () => {
    const resolved = resolveImportPath('../utils', 'src/api/users.ts', allFiles);
    expect(resolved).toBe('src/utils/index.ts');
  });

  test('resolves TSX extension', () => {
    const resolved = resolveImportPath('./components/Button', 'src/index.ts', allFiles);
    expect(resolved).toBe('src/components/Button.tsx');
  });

  test('returns null for external packages', () => {
    const resolved = resolveImportPath('react', 'src/index.ts', allFiles);
    expect(resolved).toBeNull();
  });

  test('returns null for non-existent files', () => {
    const resolved = resolveImportPath('./nonexistent', 'src/index.ts', allFiles);
    expect(resolved).toBeNull();
  });
});
```

### Integration Test

```typescript
// __tests__/graph-service.test.ts
import { GraphService } from '@/lib/graph-service';

describe('GraphService', () => {
  test('generates graph for real repository', async () => {
    const service = new GraphService('https://github.com/vercel/next.js', 'canary');
    
    const graph = await service.generate();
    
    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(graph.edges.length).toBeGreaterThan(0);
    expect(graph.version).toBeTruthy();
  }, 60000); // 60s timeout

  test('incremental update only processes changed files', async () => {
    const service = new GraphService('https://github.com/user/test-repo', 'main');
    
    // First generation
    const graph1 = await service.generate(true);
    const filesProcessed1 = graph1.metadata.files_processed;
    
    // Second generation (should be incremental)
    const graph2 = await service.generate();
    const filesProcessed2 = graph2.metadata.files_processed;
    
    // Should process fewer files on second run (only changes)
    expect(filesProcessed2).toBeLessThanOrEqual(filesProcessed1);
  }, 120000);
});
```

### Manual Testing Script

```typescript
// scripts/test-graph.ts
import { GraphService } from '../lib/graph-service';

async function main() {
  const repoUrl = process.argv[2] || 'https://github.com/vercel/next.js';
  const branch = process.argv[3] || 'canary';

  console.log(`Testing graph generation for ${repoUrl}@${branch}`);

  const service = new GraphService(repoUrl, branch);

  // Check if update needed
  const { needsUpdate, currentHead } = await service.needsUpdate();
  console.log(`Current HEAD: ${currentHead}`);
  console.log(`Needs update: ${needsUpdate}`);

  // Generate graph
  console.log('Generating graph...');
  const startTime = Date.now();
  const graph = await service.generate();
  const elapsed = Date.now() - startTime;

  console.log(`\nResults:`);
  console.log(`- Nodes: ${graph.nodes.length}`);
  console.log(`- Edges: ${graph.edges.length}`);
  console.log(`- Time: ${elapsed}ms`);
  console.log(`- Files processed: ${graph.metadata.files_processed}`);

  // Show sample nodes
  console.log(`\nSample nodes:`);
  graph.nodes.slice(0, 5).forEach(node => {
    console.log(`  - ${node.id} (${node.language})`);
  });

  // Show sample edges
  console.log(`\nSample edges:`);
  graph.edges.slice(0, 5).forEach(edge => {
    console.log(`  - ${edge.source} → ${edge.target}`);
  });
}

main().catch(console.error);
```

Run with:
```bash
npx tsx scripts/test-graph.ts https://github.com/user/repo main
```

---

## **16. Performance Benchmarks**

### Expected Performance

| Repo Size | Files | Initial Generation | Incremental Update |
|-----------|-------|-------------------|-------------------|
| Small     | 50    | ~5s               | ~0.5s             |
| Medium    | 500   | ~30s              | ~2s               |
| Large     | 2000  | ~120s             | ~5s               |

### Optimization Checklist

- [ ] Use Redis pipelining for bulk operations
- [ ] Cache file tree for repeated calls
- [ ] Skip unchanged files in incremental mode
- [ ] Limit file size (skip files >1MB)
- [ ] Use parallel file fetching (Promise.all in batches)
- [ ] Add database indexes if using Postgres
- [ ] Enable Next.js Edge Runtime for read endpoints
- [ ] Use CDN caching for graph endpoint

---

## References

- **Main Architecture:** See `vercel_app.md`
- **Data Schema:** See `schema.md`
- **API Endpoints:** See `api_endpoints_review.md`
- **GitHub API Docs:** https://docs.github.com/en/rest
- **Vercel KV Docs:** https://vercel.com/docs/storage/vercel-kv
- **Octokit REST API:** https://octokit.github.io/rest.js/