import { Octokit } from 'octokit';
import { kv } from './kv';

export function createOctokitClient(authToken?: string): Octokit {
  const token = authToken?.trim() || process.env.GITHUB_TOKEN;
  if (token) {
    return new Octokit({ auth: token });
  }
  return new Octokit();
}

export const octokit = createOctokitClient();

const GITHUB_REPO_URL_REGEX = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i;

export function parseRepoUrl(repoUrl: string): { owner: string; repo: string } {
  const trimmed = repoUrl.trim();
  const match = trimmed.match(GITHUB_REPO_URL_REGEX);
  if (match) {
    return { owner: match[1], repo: match[2] };
  }

  throw new Error('Invalid GitHub URL');
}

export function normalizeRepoUrl(repoUrl: string): string {
  const { owner, repo } = parseRepoUrl(repoUrl);
  return `https://github.com/${owner.toLowerCase()}/${repo.toLowerCase()}`;
}

export async function getRepoHead(
  owner: string,
  repo: string,
  branch: string,
  client: Octokit = octokit,
): Promise<string> {
  const { data } = await client.rest.git.getRef({
    owner,
    repo,
    ref: `heads/${branch}`,
  });

  return data.object.sha;
}

const DEFAULT_REPO_HEAD_CACHE_MS = 20_000;

type RepoHeadCacheValue = {
  sha: string;
  fetched_at: number;
};

function getRepoHeadCacheKey(owner: string, repo: string, branch: string): string {
  return `github:head:${owner}:${repo}:${branch}`;
}

function parseRepoHeadCacheValue(input: unknown): RepoHeadCacheValue | null {
  if (typeof input === 'string') {
    try {
      return parseRepoHeadCacheValue(JSON.parse(input));
    } catch {
      return null;
    }
  }

  if (!input || typeof input !== 'object') {
    return null;
  }

  const candidate = input as Partial<RepoHeadCacheValue>;
  if (typeof candidate.sha !== 'string' || typeof candidate.fetched_at !== 'number') {
    return null;
  }

  return {
    sha: candidate.sha,
    fetched_at: candidate.fetched_at,
  };
}

export async function getRepoHeadCached(
  owner: string,
  repo: string,
  branch: string,
  maxAgeMs = DEFAULT_REPO_HEAD_CACHE_MS,
  client: Octokit = octokit,
): Promise<string> {
  if (maxAgeMs > 0) {
    const cachedRaw = await kv.get(getRepoHeadCacheKey(owner, repo, branch));
    const cached = parseRepoHeadCacheValue(cachedRaw);
    if (cached && Date.now() - cached.fetched_at <= maxAgeMs) {
      return cached.sha;
    }
  }

  const head = await getRepoHead(owner, repo, branch, client);
  const payload: RepoHeadCacheValue = { sha: head, fetched_at: Date.now() };
  await kv.set(getRepoHeadCacheKey(owner, repo, branch), JSON.stringify(payload));
  return head;
}

type GitHubErrorShape = {
  status?: number;
  message?: string;
  response?: {
    headers?: Record<string, string | number | undefined>;
  };
};

function parseGitHubError(error: unknown): GitHubErrorShape {
  if (!error || typeof error !== 'object') {
    return {};
  }

  return error as GitHubErrorShape;
}

function getHeaderValue(
  headers: Record<string, string | number | undefined> | undefined,
  name: string,
): string | null {
  if (!headers) {
    return null;
  }

  const direct = headers[name];
  if (typeof direct === 'string' || typeof direct === 'number') {
    return String(direct);
  }

  const lowered = name.toLowerCase();
  for (const [headerName, headerValue] of Object.entries(headers)) {
    if (headerName.toLowerCase() !== lowered) {
      continue;
    }
    if (typeof headerValue === 'string' || typeof headerValue === 'number') {
      return String(headerValue);
    }
  }

  return null;
}

export function isGitHubQuotaError(error: unknown): boolean {
  const parsed = parseGitHubError(error);
  const message = (parsed.message ?? '').toLowerCase();
  const remaining = getHeaderValue(parsed.response?.headers, 'x-ratelimit-remaining');
  const status = parsed.status;

  const isQuotaMessage =
    message.includes('request quota exhausted') ||
    message.includes('api rate limit exceeded') ||
    message.includes('secondary rate limit') ||
    message.includes('github api quota exhausted');
  const exhaustedByHeader = remaining === '0';

  return (status === 403 || status === 429) && (isQuotaMessage || exhaustedByHeader);
}

export function getGitHubQuotaResetMs(error: unknown): number | null {
  const parsed = parseGitHubError(error);
  const headers = parsed.response?.headers;

  const retryAfterRaw = getHeaderValue(headers, 'retry-after');
  if (retryAfterRaw) {
    const retryAfterSeconds = Number(retryAfterRaw);
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
      return Date.now() + Math.round(retryAfterSeconds * 1000);
    }

    const retryAfterDate = Date.parse(retryAfterRaw);
    if (!Number.isNaN(retryAfterDate) && retryAfterDate > Date.now()) {
      return retryAfterDate;
    }
  }

  const resetRaw = getHeaderValue(headers, 'x-ratelimit-reset');
  if (!resetRaw) {
    return null;
  }

  const resetEpochSeconds = Number(resetRaw);
  if (!Number.isFinite(resetEpochSeconds) || resetEpochSeconds <= 0) {
    return null;
  }

  const resetMs = Math.round(resetEpochSeconds * 1000);
  if (resetMs <= 0) {
    return null;
  }

  return resetMs;
}

export function getGitHubQuotaErrorMessage(error: unknown): string {
  const resetMs = getGitHubQuotaResetMs(error);
  if (resetMs && resetMs > Date.now()) {
    return `GitHub API quota exhausted. Try again after ${new Date(resetMs).toISOString()}.`;
  }

  return 'GitHub API quota exhausted. Add a valid GITHUB_TOKEN and retry shortly.';
}
