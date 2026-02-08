import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { GraphService } from '@/lib/graph-service';
import { authOptions } from '@/lib/auth';
import { getRecentActivityEvents } from '@/lib/activity';
import {
  getGitHubQuotaErrorMessage,
  getGitHubQuotaResetMs,
  isGitHubQuotaError,
  normalizeRepoUrl,
} from '@/lib/github';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    let accessToken: string | undefined;
    try {
      const session = await getServerSession(authOptions);
      accessToken = session?.accessToken;
    } catch {
      accessToken = undefined;
    }

    const { searchParams } = new URL(request.url);
    const repoUrl = searchParams.get('repo_url');
    const branch = searchParams.get('branch')?.trim() || 'main';
    const regenerate = searchParams.get('regenerate') === 'true';

    if (!repoUrl) {
      return NextResponse.json({ error: 'repo_url is required' }, { status: 400 });
    }

    const normalizedRepoUrl = normalizeRepoUrl(repoUrl);
    const service = new GraphService(normalizedRepoUrl, branch, accessToken);
    const graph = await service.get(regenerate);
    const activityEvents = await getRecentActivityEvents(normalizedRepoUrl, branch);

    return NextResponse.json(
      {
        ...graph,
        activity_events: activityEvents,
      },
      {
      headers: {
        'Cache-Control': 'public, max-age=10, s-maxage=30, stale-while-revalidate=60',
      },
      },
    );
  } catch (error) {
    if (isGitHubQuotaError(error)) {
      const retryAtMs = getGitHubQuotaResetMs(error);
      return NextResponse.json(
        {
          error: 'GitHub API rate limit exceeded',
          details: getGitHubQuotaErrorMessage(error),
          retry_after_ms: retryAtMs ?? undefined,
        },
        { status: 429 },
      );
    }

    const details = error instanceof Error ? error.message : 'Unknown error';
    console.error('[API] Graph error:', error);
    return NextResponse.json({ error: 'Failed to fetch graph', details }, { status: 500 });
  }
}
