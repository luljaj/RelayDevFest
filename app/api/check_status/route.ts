import { NextRequest, NextResponse } from 'next/server';
import { getRepoHead, parseRepoUrl } from '@/lib/github';
import { checkLocks } from '@/lib/locks';
import { getMissingFields, isNonEmptyString, normalizeFilePaths, toBodyRecord } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = toBodyRecord(await request.json());
    const missing = getMissingFields(body, ['repo_url', 'branch', 'file_paths', 'agent_head']);

    if (missing.length > 0) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const repoUrl = body.repo_url;
    const branch = body.branch;
    const filePaths = normalizeFilePaths(body.file_paths);
    const agentHead = body.agent_head;

    if (
      !isNonEmptyString(repoUrl) ||
      !isNonEmptyString(branch) ||
      !isNonEmptyString(agentHead) ||
      !filePaths ||
      filePaths.length === 0
    ) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const { owner, repo } = parseRepoUrl(repoUrl);
    const repoHead = await getRepoHead(owner, repo, branch);

    const isStale = agentHead !== repoHead;
    const locks = await checkLocks(repoUrl, branch, filePaths);

    let status = 'OK';
    if (isStale) status = 'STALE';
    if (Object.keys(locks).length > 0) status = 'CONFLICT';

    let orchestration: { action: string; command: string | null; reason: string } = {
      action: 'PROCEED',
      command: null,
      reason: '',
    };

    if (isStale) {
      orchestration = {
        action: 'PULL',
        command: 'git pull --rebase',
        reason: `Your local repo is behind. Current HEAD: ${repoHead}`,
      };
    } else if (Object.keys(locks).length > 0) {
      const firstLock = Object.values(locks)[0];
      orchestration = {
        action: 'SWITCH_TASK',
        command: null,
        reason: `File '${firstLock.file_path}' is locked by ${firstLock.user_name} (DIRECT)`,
      };
    }

    return NextResponse.json({
      status,
      repo_head: repoHead,
      locks,
      warnings: isStale ? [`STALE_BRANCH: Your branch is behind origin/${branch}`] : [],
      orchestration,
    });
  } catch (error) {
    const details = error instanceof Error ? error.message : 'Unknown error';
    console.error('check_status error:', error);
    return NextResponse.json({ error: 'Internal server error', details }, { status: 500 });
  }
}
