import { NextRequest, NextResponse } from 'next/server';
import { getRecentActivityEvents } from '@/lib/activity';
import { normalizeRepoUrl } from '@/lib/github';
import { getLocks } from '@/lib/locks';

export const dynamic = 'force-dynamic';

const DEFAULT_ACTIVITY_LIMIT = 120;
const MAX_ACTIVITY_LIMIT = 500;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const repoUrl = searchParams.get('repo_url');
    const branch = searchParams.get('branch')?.trim() || 'main';
    const limit = normalizeLimit(searchParams.get('limit'));

    if (!repoUrl) {
      return NextResponse.json({ error: 'repo_url is required' }, { status: 400 });
    }

    const normalizedRepoUrl = normalizeRepoUrl(repoUrl);
    const activityEvents = await getRecentActivityEvents(normalizedRepoUrl, branch, limit);
    const locks = await getLocks(normalizedRepoUrl, branch);

    return NextResponse.json(
      { activity_events: activityEvents, locks },
      {
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      },
    );
  } catch (error) {
    const details = error instanceof Error ? error.message : 'Unknown error';
    console.error('[API] Activity error:', error);
    return NextResponse.json({ error: 'Failed to fetch activity', details }, { status: 500 });
  }
}

function normalizeLimit(raw: string | null): number {
  if (!raw) {
    return DEFAULT_ACTIVITY_LIMIT;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_ACTIVITY_LIMIT;
  }

  return Math.max(1, Math.min(MAX_ACTIVITY_LIMIT, parsed));
}
