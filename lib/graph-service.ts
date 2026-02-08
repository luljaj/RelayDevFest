import { Buffer } from 'node:buffer';
import {
  createOctokitClient,
  getGitHubQuotaErrorMessage,
  getGitHubQuotaResetMs,
  getRepoHeadCached,
  isGitHubQuotaError,
  normalizeRepoUrl,
  parseRepoUrl,
} from './github';
import { kv } from './kv';
import { getLocks } from './locks';
import { getFileLanguage, parseImports } from './parser';
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
  locks: Record<string, unknown>;
  version: string;
  metadata: {
    generated_at: number;
    files_processed: number;
    edges_found: number;
  };
}

interface RepoFile {
  path: string;
  sha: string;
  size?: number;
}

const HEAD_CHECK_MIN_INTERVAL_MS = 20_000;
const RATE_LIMIT_FALLBACK_COOLDOWN_MS = 60_000;

export class GraphService {
  private static inFlight = new Map<string, Promise<DependencyGraph>>();
  private repoUrl: string;
  private branch: string;
  private owner: string;
  private repo: string;
  private octokitClient: ReturnType<typeof createOctokitClient>;

  constructor(repoUrl: string, branch = 'main', authToken?: string) {
    this.repoUrl = normalizeRepoUrl(repoUrl);
    this.branch = branch.trim() || 'main';
    this.octokitClient = createOctokitClient(authToken);

    const parsed = parseRepoUrl(this.repoUrl);
    this.owner = parsed.owner;
    this.repo = parsed.repo;
  }

  private getKeys() {
    return {
      graph: `graph:${this.repoUrl}:${this.branch}`,
      meta: `graph:meta:${this.repoUrl}:${this.branch}`,
      fileShas: `graph:file_shas:${this.repoUrl}:${this.branch}`,
      fileContents: `graph:file_contents:${this.repoUrl}:${this.branch}`,
      headCheckedAt: `graph:head_checked_at:${this.repoUrl}:${this.branch}`,
      rateLimitedUntil: `graph:rate_limited_until:${this.repoUrl}:${this.branch}`,
    };
  }

  private getInFlightKey(): string {
    return `${this.repoUrl}:${this.branch}`;
  }

  private async readNumberKey(key: string): Promise<number | null> {
    const value = await kv.get(key);
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private async getRateLimitedUntil(): Promise<number | null> {
    const keys = this.getKeys();
    return this.readNumberKey(keys.rateLimitedUntil);
  }

  private async setRateLimitedUntil(untilMs: number): Promise<void> {
    const keys = this.getKeys();
    await kv.set(keys.rateLimitedUntil, untilMs);
  }

  private async getCachedFileContent(sha: string): Promise<string | null> {
    const keys = this.getKeys();
    try {
      const cached = await kv.hget(keys.fileContents, sha);
      return typeof cached === 'string' ? cached : null;
    } catch {
      return null;
    }
  }

  private async setCachedFileContent(sha: string, content: string): Promise<void> {
    const keys = this.getKeys();
    try {
      await kv.hset(keys.fileContents, { [sha]: content });
    } catch (error) {
      // Log but don't fail if cache write fails
      console.warn(`[Graph] Failed to cache content for SHA ${sha}:`, error);
    }
  }

  private async setHeadCheckedAt(timestamp: number): Promise<void> {
    const keys = this.getKeys();
    await kv.set(keys.headCheckedAt, timestamp);
  }

  private async shouldSkipHeadCheck(now: number): Promise<boolean> {
    const keys = this.getKeys();
    const lastHeadCheckedAt = await this.readNumberKey(keys.headCheckedAt);
    if (!lastHeadCheckedAt) {
      return false;
    }

    return now - lastHeadCheckedAt < HEAD_CHECK_MIN_INTERVAL_MS;
  }

  private async applyRateLimitCooldown(error: unknown): Promise<number> {
    const resetAt =
      getGitHubQuotaResetMs(error) ?? Date.now() + RATE_LIMIT_FALLBACK_COOLDOWN_MS;
    const untilMs = Math.max(resetAt, Date.now() + 5_000);
    await this.setRateLimitedUntil(untilMs);
    return untilMs;
  }

  private async withSingleFlight(operation: () => Promise<DependencyGraph>): Promise<DependencyGraph> {
    const key = this.getInFlightKey();
    const existing = GraphService.inFlight.get(key);
    if (existing) {
      return existing;
    }

    const promise = operation().finally(() => {
      GraphService.inFlight.delete(key);
    });

    GraphService.inFlight.set(key, promise);
    return promise;
  }

  async getCached(): Promise<DependencyGraph | null> {
    const keys = this.getKeys();
    const cached = (await kv.get(keys.graph)) as string | null;

    if (!cached) {
      return null;
    }

    try {
      const graph = JSON.parse(cached) as DependencyGraph;
      graph.locks = await getLocks(this.repoUrl, this.branch);
      return graph;
    } catch {
      return null;
    }
  }

  async needsUpdate(): Promise<{ needsUpdate: boolean; currentHead: string }> {
    const keys = this.getKeys();
    const currentHead = await getRepoHeadCached(
      this.owner,
      this.repo,
      this.branch,
      undefined,
      this.octokitClient,
    );
    const storedHead = (await kv.get(keys.meta)) as string | null;

    return {
      needsUpdate: currentHead !== storedHead,
      currentHead,
    };
  }

  async generate(force = false): Promise<DependencyGraph> {
    const keys = this.getKeys();
    const startTime = Date.now();

    const currentHead = await getRepoHeadCached(
      this.owner,
      this.repo,
      this.branch,
      force ? 0 : HEAD_CHECK_MIN_INTERVAL_MS,
      this.octokitClient,
    );

    if (!force) {
      const storedHead = (await kv.get(keys.meta)) as string | null;
      if (storedHead === currentHead) {
        const cached = await this.getCached();
        if (cached) {
          return cached;
        }
      }
    }

    const { data: treeData } = await this.octokitClient.rest.git.getTree({
      owner: this.owner,
      repo: this.repo,
      tree_sha: currentHead,
      recursive: 'true',
    });

    const supportedExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py'];
    const files = (treeData.tree ?? [])
      .filter((item) => item.type === 'blob' && typeof item.path === 'string')
      .filter((item) => supportedExtensions.some((ext) => item.path!.endsWith(ext)))
      .map((item) => ({
        path: item.path as string,
        sha: item.sha as string,
        size: item.size ?? undefined,
      })) as RepoFile[];

    const storedShas = ((await kv.hgetall(keys.fileShas)) as Record<string, string> | null) ?? {};
    const allFilePaths = new Set(files.map((file) => file.path));

    const newFiles = files.filter((file) => !storedShas[file.path]);
    const changedFiles = files.filter((file) => storedShas[file.path] && storedShas[file.path] !== file.sha);
    const deletedFiles = Object.keys(storedShas).filter((filePath) => !allFilePaths.has(filePath));

    let nodes: GraphNode[] = [];
    let edges: GraphEdge[] = [];
    let hasExistingGraph = false;

    const existing = (await kv.get(keys.graph)) as string | null;
    if (existing) {
      try {
        const parsed = JSON.parse(existing) as DependencyGraph;
        nodes = parsed.nodes;
        edges = parsed.edges;
        hasExistingGraph = true;
      } catch {
        nodes = [];
        edges = [];
      }

      if (deletedFiles.length > 0) {
        nodes = nodes.filter((node) => !deletedFiles.includes(node.id));
        edges = edges.filter((edge) => !deletedFiles.includes(edge.source) && !deletedFiles.includes(edge.target));

        // Clean up cached content for deleted files
        const deletedShas = deletedFiles.map(filePath => storedShas[filePath]).filter(Boolean);
        if (deletedShas.length > 0) {
          try {
            await kv.hdel(keys.fileContents, ...deletedShas);
          } catch (error) {
            console.warn('[Graph] Failed to clean up cached content for deleted files:', error);
          }
        }
      }

      if (changedFiles.length > 0) {
        const changedSet = new Set(changedFiles.map((file) => file.path));
        edges = edges.filter((edge) => !changedSet.has(edge.source));
      }
    }

    // If graph payload is missing/corrupt but file SHAs still exist, incremental mode can end up empty forever.
    // In that case, force a full rebuild from the current tree.
    const incrementalFiles = [...newFiles, ...changedFiles];
    const needsFullRebuild =
      !hasExistingGraph ||
      // New files can make previously unresolved imports (from unchanged files) resolvable.
      // Rebuild to avoid missing new inbound edges.
      newFiles.length > 0 ||
      (files.length > 0 && nodes.length === 0 && incrementalFiles.length === 0);

    if (needsFullRebuild) {
      console.log('[Graph] Full rebuild triggered');
      nodes = [];
      edges = [];
    }

    const resolver = new ImportResolver(allFilePaths);
    const filesToProcess = needsFullRebuild ? files : incrementalFiles;
    let processedCount = 0;
    let cacheHits = 0;
    let cacheMisses = 0;
    const edgeSet = new Set(edges.map((edge) => `${edge.source}=>${edge.target}`));

    for (const file of filesToProcess) {
      const filePath = file.path;

      const existingNode = nodes.find((node) => node.id === filePath);
      if (!existingNode) {
        nodes.push({
          id: filePath,
          type: 'file',
          size: file.size,
          language: getFileLanguage(filePath) ?? undefined,
        });
      } else {
        existingNode.size = file.size;
        existingNode.language = getFileLanguage(filePath) ?? undefined;
      }

      try {
        let content: string | null = null;

        // Try to get content from cache first (by SHA)
        const cachedContent = await this.getCachedFileContent(file.sha);
        if (cachedContent !== null) {
          content = cachedContent;
          cacheHits += 1;
        } else {
          // Cache miss - fetch from GitHub
          const { data: contentData } = await this.octokitClient.rest.repos.getContent({
            owner: this.owner,
            repo: this.repo,
            path: filePath,
            ref: currentHead,
          });

          if (!('content' in contentData) || typeof contentData.content !== 'string') {
            continue;
          }

          content = Buffer.from(contentData.content, 'base64').toString('utf-8');

          // Cache the content for future use
          await this.setCachedFileContent(file.sha, content);
          cacheMisses += 1;
        }

        const language = getFileLanguage(filePath);
        if (!language) {
          continue;
        }

        const imports = parseImports(content, filePath, language);
        for (const parsedImport of imports) {
          const resolved = resolver.resolve(parsedImport.module, filePath);
          if (!resolved) {
            continue;
          }

          const edgeKey = `${filePath}=>${resolved}`;
          if (!edgeSet.has(edgeKey)) {
            edges.push({ source: filePath, target: resolved, type: 'import' });
            edgeSet.add(edgeKey);
          }
        }

        processedCount += 1;
      } catch (error) {
        if (isGitHubQuotaError(error)) {
          throw error;
        }
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[Graph] Failed to process ${filePath}:`, message);
      }
    }

    const newShas: Record<string, string> = {};
    for (const file of files) {
      newShas[file.path] = file.sha;
    }

    nodes.sort((a, b) => a.id.localeCompare(b.id));
    edges.sort((a, b) => {
      const sourceCompare = a.source.localeCompare(b.source);
      if (sourceCompare !== 0) {
        return sourceCompare;
      }
      return a.target.localeCompare(b.target);
    });

    const graph: DependencyGraph = {
      nodes,
      edges,
      locks: {},
      version: currentHead,
      metadata: {
        generated_at: Date.now(),
        files_processed: processedCount,
        edges_found: edges.length,
      },
    };

    const pipeline = (kv as any).pipeline();
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
    const cacheEfficiency = processedCount > 0 ? Math.round((cacheHits / processedCount) * 100) : 0;
    console.log(
      `[Graph] Complete in ${elapsed}ms: ${nodes.length} nodes, ${edges.length} edges | ` +
      `Cache: ${cacheHits} hits, ${cacheMisses} misses (${cacheEfficiency}% hit rate) | ` +
      `GitHub API calls saved: ${cacheHits}`
    );

    graph.locks = await getLocks(this.repoUrl, this.branch);
    return graph;
  }

  async get(forceRegenerate = false): Promise<DependencyGraph> {
    return this.withSingleFlight(async () => {
      const now = Date.now();
      const cached = await this.getCached();
      const rateLimitedUntil = await this.getRateLimitedUntil();

      if (rateLimitedUntil && rateLimitedUntil > now) {
        if (cached) {
          return cached;
        }

        const retryIso = new Date(rateLimitedUntil).toISOString();
        const quotaError = new Error(`GitHub API quota exhausted. Try again after ${retryIso}.`);
        (quotaError as { status?: number }).status = 429;
        throw quotaError;
      }

      try {
        if (forceRegenerate) {
          return await this.generate(true);
        }

        if (cached) {
          const skipHeadCheck = await this.shouldSkipHeadCheck(now);
          if (skipHeadCheck) {
            return cached;
          }

          await this.setHeadCheckedAt(now);
          const { needsUpdate } = await this.needsUpdate();
          if (!needsUpdate) {
            return cached;
          }
        }

        return await this.generate();
      } catch (error) {
        if (isGitHubQuotaError(error)) {
          const untilMs = await this.applyRateLimitCooldown(error);
          const fallback = cached ?? (await this.getCached());
          if (fallback) {
            console.warn(
              `[Graph] GitHub quota exhausted for ${this.repoUrl}@${this.branch}; serving cached graph until ${new Date(untilMs).toISOString()}`,
            );
            return fallback;
          }

          console.warn(
            `[Graph] GitHub quota exhausted for ${this.repoUrl}@${this.branch}; no cached graph available. ${getGitHubQuotaErrorMessage(error)}`,
          );
        }

        throw error;
      }
    });
  }
}
