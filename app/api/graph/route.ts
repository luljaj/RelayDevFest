import { NextRequest, NextResponse } from 'next/server';
import { GraphService } from '@/lib/graph-service';
import { getGitHubQuotaErrorMessage, isGitHubQuotaError } from '@/lib/github';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const repoUrl = searchParams.get('repo_url');
    const branch = searchParams.get('branch') || 'main';
    const regenerate = searchParams.get('regenerate') === 'true';

    if (!repoUrl) {
      return NextResponse.json({ error: 'repo_url is required' }, { status: 400 });
    }

    const service = new GraphService(repoUrl, branch);
    const graph = await service.get(regenerate);

    return NextResponse.json(graph, {
      headers: {
        'Cache-Control': 'public, max-age=5, s-maxage=5',
      },
    });
  } catch (error) {
    if (isGitHubQuotaError(error)) {
      return NextResponse.json(
        {
          error: 'GitHub API rate limit exceeded',
          details: getGitHubQuotaErrorMessage(error),
        },
        { status: 429 },
      );
    }

    const details = error instanceof Error ? error.message : 'Unknown error';
    console.error('[API] Graph error:', error);
    return NextResponse.json({ error: 'Failed to fetch graph', details }, { status: 500 });
  }
}
