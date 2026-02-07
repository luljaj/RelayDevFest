# Complete Implementation Guide - Vercel Coordination Backend

> **Complete AI One-Shot Implementation Guide**
> 
> This document contains everything needed to implement the multi-agent coordination backend. Read this file, follow the code examples, and deploy. No other files needed.
>
> **Architecture:** HTTP-only system. Frontend polls for updates, all state in Redis. No WebSocket complexity.

---

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Technology Stack](#technology-stack)
3. [Setup & Installation](#setup--installation)
4. [Core Infrastructure](#core-infrastructure)
5. [Lock Management](#lock-management)
6. [API Endpoints](#api-endpoints)
7. [Graph Generation](#graph-generation)
8. [Import Parsing](#import-parsing)
9. [Path Resolution](#path-resolution)
10. [Frontend Integration](#frontend-integration)
11. [Deployment](#deployment)
12. [Testing](#testing)
13. [Troubleshooting](#troubleshooting)

---

## System Architecture

### Component Overview

```
Agent (Claude/GPT/etc)
  ↓
MCP Server (separate - calls Vercel)
  ↓
Vercel Backend (THIS IMPLEMENTATION)
  ├─ API Routes (check_status, post_status, graph)
  ├─ Lock Management (Redis Lua scripts)
  ├─ Graph Generation (incremental updates)
  └─ Cron Jobs (cleanup stale locks)
  ↓
Vercel KV (Redis) - All state storage
```

### Data Flow

**Agent wants to edit file:**
1. Agent → MCP Server → `POST /api/check_status` → Check if file is locked
2. If available → `POST /api/post_status` with `status: WRITING` → Acquire lock
3. Agent edits file, commits, pushes
4. Agent → `POST /api/post_status` with `status: OPEN` → Release lock

**Frontend displays graph:**
1. Frontend → `GET /api/graph` → Get dependency graph + lock status
2. Poll every 5 seconds for updates
3. Display colored nodes (green=available, red=locked)

---

## Technology Stack

### Dependencies

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

## Setup & Installation

### 1. Initialize Project

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
  parser.ts
  resolver.ts
  graph-service.ts
vercel.json
.env.local
```

### 4. Environment Variables

Create `.env.local`:

```bash
# Vercel KV (auto-populated when you add KV storage)
KV_REST_API_URL="https://your-kv.kv.vercel-storage.com"
KV_REST_API_TOKEN="your_token_here"

# GitHub API
GITHUB_TOKEN="ghp_your_github_token"

# Cron Job Security
CRON_SECRET="random_secret_123"
```

---

## Core Infrastructure

### File: `lib/kv.ts`

```typescript
import { kv } from '@vercel/kv';

export { kv };
```

### File: `lib/github.ts`

```typescript
import { Octokit } from 'octokit';

export const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN
});

/**
 * Extract owner and repo from GitHub URL
 */
export function parseRepoUrl(repoUrl: string): { owner: string; repo: string } {
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (!match) throw new Error('Invalid GitHub URL');
  return { owner: match[1], repo: match[2] };
}

/**
 * Get current HEAD SHA for a branch
 */
export async function getRepoHead(
  owner: string,
  repo: string,
  branch: string
): Promise<string> {
  const { data } = await octokit.rest.git.getRef({
    owner,
    repo,
    ref: `heads/${branch}`
  });
  return data.object.sha;
}
```

---

## Lock Management

### File: `lib/locks.ts`

Complete atomic lock management with Redis Lua scripts.

```typescript
import { kv } from './kv';

export interface LockRequest {
  repoUrl: string;
  branch: string;
  filePaths: string[];
  userId: string;
  userName: string;
  status: 'READING' | 'WRITING';
  message: string;
  agentHead: string;
}

export interface LockEntry {
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
 * Returns: { success: true, locks: [...] } or { success: false, reason: string }
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

---

## API Endpoints

### File: `app/api/check_status/route.ts`

Check lock status before editing files.

```typescript
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

### File: `app/api/post_status/route.ts`

Acquire/release file locks.

```typescript
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

    // Extract user info from auth header
    const userId = request.headers.get('x-github-user') || 'anonymous';
    const userName = request.headers.get('x-github-username') || 'Anonymous';

    // Get current repo HEAD
    const { owner, repo } = parseRepoUrl(repo_url);
    const repoHead = await getRepoHead(owner, repo, branch);

    // Handle OPEN status (release locks)
    if (status === 'OPEN') {
      // Validate that repo advanced
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
        orphaned_dependencies: [],
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

    // Handle READING status (informational only)
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

### File: `app/api/cleanup_stale_locks/route.ts`

Cron job to expire locks after 5 minutes.

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@/lib/kv';

export async function GET(request: NextRequest) {
  try {
    // Verify cron secret
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

---

## Graph Generation

### GitHub API Integration

The graph generator uses three GitHub API endpoints:

1. **Get Branch HEAD:** `GET /repos/{owner}/{repo}/git/refs/heads/{branch}`
   - Returns current commit SHA
   - Used to detect if repo changed

2. **Get File Tree:** `GET /repos/{owner}/{repo}/git/trees/{sha}?recursive=1`
   - Returns all files with their SHAs
   - Single request for entire repo structure

3. **Get File Content:** `GET /repos/{owner}/{repo}/contents/{path}?ref={sha}`
   - Returns base64-encoded file content
   - Only called for NEW or CHANGED files

### Incremental Update Algorithm

**Two-layer change detection:**

**Layer 1 - Repo-Level:**
- Compare stored HEAD SHA with GitHub HEAD SHA
- If identical → Exit (no changes)
- Cost: 1 GitHub API call + 1 Redis read

**Layer 2 - File-Level:**
- Fetch all file SHAs from GitHub
- Compare with stored file SHAs in Redis
- Categorize: NEW, CHANGED, DELETED, UNCHANGED
- Only process NEW and CHANGED files

**Performance:**
- First run: Parse 100% of files (~30-60s for 500 files)
- Incremental: Parse only changed files (~2-5s for typical commit)

---

## Import Parsing

### File: `lib/parser.ts`

Regex-based import parsing for TypeScript, JavaScript, and Python.

```typescript
export type FileLanguage = 'ts' | 'js' | 'py';

export interface ParsedImport {
  raw: string;
  module: string;
  lineNumber: number;
}

/**
 * Parse imports from file content using regex
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

      // CommonJS
      cjsRegex.lastIndex = 0;
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
 * Get file language from extension
 */
export function getFileLanguage(filePath: string): FileLanguage | null {
  if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) return 'ts';
  if (filePath.endsWith('.js') || filePath.endsWith('.jsx')) return 'js';
  if (filePath.endsWith('.py')) return 'py';
  return null;
}

/**
 * Check if import is relative (not external package)
 */
export function isRelativeImport(importPath: string): boolean {
  return importPath.startsWith('.') || importPath.startsWith('/');
}
```

---

## Path Resolution

### File: `lib/resolver.ts`

Resolve relative imports to absolute file paths.

```typescript
import { isRelativeImport } from './parser';

/**
 * Resolve import path to absolute file path
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

  return null;
}

/**
 * Resolve relative path using Node.js algorithm
 */
function resolvePath(currentDir: string, relativePath: string): string {
  const parts = currentDir ? currentDir.split('/') : [];
  const importParts = relativePath.split('/');

  for (const part of importParts) {
    if (part === '..') {
      if (parts.length > 0) {
        parts.pop();
      }
    } else if (part === '.') {
      continue;
    } else if (part) {
      parts.push(part);
    }
  }

  return parts.join('/');
}

/**
 * Generate candidate paths with extensions
 */
function generateCandidates(basePath: string): string[] {
  const candidates: string[] = [];

  // Direct file matches
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py'];
  for (const ext of extensions) {
    candidates.push(basePath + ext);
  }

  // Index file matches
  const indexFiles = ['index.ts', 'index.tsx', 'index.js', 'index.jsx'];
  for (const index of indexFiles) {
    candidates.push(`${basePath}/${index}`);
  }

  return candidates;
}

/**
 * Resolver with caching for performance
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
```

---

## Graph Service

### File: `lib/graph-service.ts`

Complete graph generation with incremental updates.

```typescript
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
   * Get cached graph
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

    // Check if update needed (Layer 1: repo-level)
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

    // Get stored SHAs for incremental update (Layer 2: file-level)
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

    // Transaction: update all together
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
      const { needsUpdate } = await this.needsUpdate();
      if (!needsUpdate) {
        return cached;
      }
    }

    return await this.generate();
  }
}
```

### File: `app/api/graph/route.ts`

API endpoint for fetching graph.

```typescript
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

## Frontend Integration

### API Contract

Frontend polls `GET /api/graph` every 5 seconds.

**Response:**
```typescript
interface DependencyGraph {
  nodes: Array<{
    id: string;              // "src/auth.ts"
    type: 'file';
    size?: number;
    language?: string;
  }>;
  
  edges: Array<{
    source: string;
    target: string;
    type: 'import';
  }>;
  
  locks: Record<string, {
    user_id: string;
    user_name: string;
    status: 'READING' | 'WRITING';
    message: string;
    timestamp: number;
    expiry: number;
  }>;
  
  version: string;
  metadata: {
    generated_at: number;
    files_processed: number;
    edges_found: number;
  };
}
```

### Polling Hook

```typescript
function useGraph(repoUrl: string, branch: string) {
  const [graph, setGraph] = useState<DependencyGraph | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchGraph = async () => {
      const res = await fetch(
        `/api/graph?repo_url=${encodeURIComponent(repoUrl)}&branch=${branch}`
      );
      const data = await res.json();
      setGraph(data);
      setLoading(false);
    };

    fetchGraph();
    const interval = setInterval(fetchGraph, 5000);
    
    return () => clearInterval(interval);
  }, [repoUrl, branch]);

  return { graph, loading };
}
```

### Recommended Stack

- **Framework:** Next.js 14, React + Vite, or SvelteKit
- **Graph Viz:** React Flow, Cytoscape.js, or D3.js
- **UI Components:** shadcn/ui, Radix UI, or Mantine

### Node Styling

```typescript
function getNodeStyle(node: GraphNode, locks: Record<string, Lock>) {
  const lock = locks[node.id];
  
  if (!lock) {
    return { backgroundColor: '#10b981' }; // Green - available
  }
  
  if (lock.status === 'WRITING') {
    return { backgroundColor: '#ef4444' }; // Red - locked
  }
  
  return { backgroundColor: '#f59e0b' }; // Yellow - reading
}
```

### Key Features

1. **Search/Filter** - By filename, status, user, directory
2. **Interactive Graph** - Click nodes, zoom/pan, focus dependencies
3. **Activity Feed** - Real-time stream of lock changes
4. **Lock Details** - Full message, time remaining, commit SHA
5. **Multi-Repo** - Switch between repositories

---

## Deployment

### Step 1: Deploy to Vercel

```bash
vercel
```

### Step 2: Add Vercel KV Storage

1. Vercel Dashboard → Your Project → Storage
2. Create Database → Select "KV"
3. Variables auto-populated: `KV_REST_API_URL`, `KV_REST_API_TOKEN`

### Step 3: Configure Environment Variables

In Vercel Dashboard → Settings → Environment Variables:

```
GITHUB_TOKEN=ghp_your_token_here
CRON_SECRET=random_secret_string
```

**Get GitHub Token:**
1. https://github.com/settings/tokens
2. Generate new token (classic)
3. Scope: `repo` or `public_repo`

### Step 4: Configure Cron Job

Create `vercel.json`:

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

### Step 5: Verify Deployment

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

# Test graph
curl "https://your-app.vercel.app/api/graph?repo_url=https://github.com/user/repo&branch=main"
```

---

## Testing

### Unit Tests

```typescript
// __tests__/locks.test.ts
import { acquireLocks } from '@/lib/locks';

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
  // User 1 acquires
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

  // User 2 tries
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
```

### Manual Testing Checklist

- [ ] Lock acquisition works
- [ ] Multi-file atomic locking works
- [ ] Lock conflicts are rejected
- [ ] Stale repo detection works
- [ ] Lock expiration works after 5 minutes
- [ ] Graph generation works
- [ ] Incremental updates work
- [ ] Locks overlay on graph correctly
- [ ] Cron job cleans expired locks

---

## Troubleshooting

### Redis Connection Errors

```bash
# Verify KV variables
vercel env ls

# Test locally
node -e "const kv = require('@vercel/kv').kv; kv.ping().then(console.log)"
```

### GitHub API Rate Limiting

```bash
# Check rate limit
curl -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/rate_limit
```

### Lua Script Errors

- Check Redis version (Vercel KV uses Redis 6+)
- Ensure JSON encoding/decoding is correct
- Test Lua script in Redis CLI first

### Cron Job Not Running

- Verify `CRON_SECRET` is set
- Check Vercel → Cron Jobs in dashboard
- Ensure schedule is valid (`* * * * *` = every minute)

### Import Resolution Failures

- Check file extensions match
- Verify relative paths are correct
- Test regex patterns against actual code

---

## Performance Optimization

### Redis Pipelining

```typescript
async function bulkGetLocks(keys: string[]) {
  const pipeline = kv.pipeline();
  keys.forEach(key => pipeline.hgetall(key));
  return await pipeline.exec();
}
```

### GitHub API Caching

```typescript
const cache = new Map();

export async function getCachedTree(owner, repo, sha) {
  const key = `${owner}/${repo}/${sha}`;
  const cached = cache.get(key);
  
  if (cached && Date.now() - cached.timestamp < 60000) {
    return cached.data;
  }

  const { data } = await octokit.rest.git.getTree({
    owner, repo, tree_sha: sha, recursive: 'true'
  });

  cache.set(key, { data, timestamp: Date.now() });
  return data;
}
```

### Next.js Edge Runtime

```typescript
// app/api/graph/route.ts
export const runtime = 'edge'; // Lower latency for read-only
```

---

## Summary

This guide provides complete, copy-paste-ready code for:

✅ **Redis lock management** with atomic transactions
✅ **API endpoints** for status checking and lock operations
✅ **Graph generation** with incremental updates
✅ **Import parsing** for TypeScript, JavaScript, Python
✅ **Path resolution** with caching
✅ **Frontend integration** with polling strategy
✅ **Deployment** to Vercel with cron jobs
✅ **Testing** examples and troubleshooting

**Time Estimate:** 2-3 hours for complete implementation and deployment.

**Next Steps:**
1. Follow setup instructions
2. Copy code files
3. Deploy to Vercel
4. Test endpoints
5. Build frontend (optional)

---

## References

- **Vercel KV Docs:** https://vercel.com/docs/storage/vercel-kv
- **Octokit Docs:** https://github.com/octokit/octokit.js
- **Next.js App Router:** https://nextjs.org/docs/app
- **GitHub API:** https://docs.github.com/en/rest
