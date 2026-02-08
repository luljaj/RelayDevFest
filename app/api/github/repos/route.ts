import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Octokit } from 'octokit';
import { authOptions } from '@/lib/auth';
import { kv } from '@/lib/kv';
import { isGitHubQuotaError, getGitHubQuotaErrorMessage } from '@/lib/github';

type RepoSummary = {
  id: number;
  full_name: string;
  html_url: string;
  default_branch: string;
  private: boolean;
};

export const dynamic = 'force-dynamic';

const REPOS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

type CachedRepos = {
  repos: RepoSummary[];
  cached_at: number;
};

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const accessToken = session?.accessToken;
    const userId = session?.user?.login || session?.user?.id;

    if (!accessToken || !userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Try cache first
    const cacheKey = `github:repos:${userId}`;
    const cachedRaw = await kv.get(cacheKey);

    if (cachedRaw) {
      try {
        const cached = typeof cachedRaw === 'string' ? JSON.parse(cachedRaw) : cachedRaw;
        if (cached?.repos && cached?.cached_at && Date.now() - cached.cached_at < REPOS_CACHE_TTL_MS) {
          return NextResponse.json(
            { repos: cached.repos },
            {
              headers: {
                'Cache-Control': 'private, max-age=300',
                'X-Cache': 'HIT',
              },
            },
          );
        }
      } catch {
        // Invalid cache, continue to fetch
      }
    }

    // Fetch from GitHub API (only first 10 repos instead of ALL)
    const octokit = new Octokit({ auth: accessToken });
    const { data: repos } = await octokit.rest.repos.listForAuthenticatedUser({
      sort: 'updated',
      direction: 'desc',
      affiliation: 'owner,collaborator,organization_member',
      per_page: 10, // Changed from 100 and removed pagination
    });

    const mapped: RepoSummary[] = repos.map((repo) => ({
      id: repo.id,
      full_name: repo.full_name,
      html_url: repo.html_url,
      default_branch: repo.default_branch,
      private: repo.private,
    }));

    // Cache the result
    const cacheValue: CachedRepos = {
      repos: mapped,
      cached_at: Date.now(),
    };
    await kv.set(cacheKey, JSON.stringify(cacheValue), { ex: Math.floor(REPOS_CACHE_TTL_MS / 1000) });

    return NextResponse.json(
      { repos: mapped },
      {
        headers: {
          'Cache-Control': 'private, max-age=300',
          'X-Cache': 'MISS',
        },
      },
    );
  } catch (error) {
    // Handle GitHub rate limit errors specifically
    if (isGitHubQuotaError(error)) {
      const message = getGitHubQuotaErrorMessage(error);
      return NextResponse.json(
        {
          error: 'GitHub API rate limit exceeded',
          details: message,
          repos: []
        },
        { status: 429 }
      );
    }

    const details = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Failed to load repositories', details }, { status: 500 });
  }
}
