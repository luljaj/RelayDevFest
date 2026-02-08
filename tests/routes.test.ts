import { describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/github', () => ({
  parseRepoUrl: vi.fn(() => ({ owner: 'test', repo: 'repo' })),
  getRepoHead: vi.fn(async () => 'remote-head'),
  isGitHubQuotaError: vi.fn(() => false),
  getGitHubQuotaErrorMessage: vi.fn(() => 'GitHub API quota exhausted.'),
}));

vi.mock('@/lib/locks', () => ({
  checkLocks: vi.fn(async () => ({})),
  acquireLocks: vi.fn(async () => ({ success: true, locks: [] })),
  releaseLocks: vi.fn(async () => ({ success: true })),
  cleanupExpiredLocks: vi.fn(async () => 3),
}));

import { GET as graphGet } from '@/app/api/graph/route';
import { POST as checkStatusPost } from '@/app/api/check_status/route';
import { GET as cleanupGet } from '@/app/api/cleanup_stale_locks/route';
import { POST as postStatusPost } from '@/app/api/post_status/route';
import { getRepoHead } from '@/lib/github';
import { acquireLocks, checkLocks } from '@/lib/locks';

const mockedGetRepoHead = vi.mocked(getRepoHead);
const mockedCheckLocks = vi.mocked(checkLocks);
const mockedAcquireLocks = vi.mocked(acquireLocks);

describe('route smoke checks', () => {
  test('check_status returns 400 on missing fields', async () => {
    const request = { json: async () => ({}) } as any;
    const response = await checkStatusPost(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Missing required fields' });
  });

  test('check_status returns PULL orchestration on stale head', async () => {
    mockedGetRepoHead.mockResolvedValueOnce('remote-head');
    mockedCheckLocks.mockResolvedValueOnce({});

    const request = {
      json: async () => ({
        repo_url: 'https://github.com/a/b',
        branch: 'main',
        file_paths: ['src/a.ts'],
        agent_head: 'local-head',
      }),
    } as any;

    const response = await checkStatusPost(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.status).toBe('STALE');
    expect(payload.orchestration.action).toBe('PULL');
  });

  test('post_status returns 400 on missing fields', async () => {
    const request = { json: async () => ({}) } as any;
    const response = await postStatusPost(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Missing required fields' });
  });

  test('post_status returns PULL orchestration on stale WRITING request', async () => {
    mockedGetRepoHead.mockResolvedValueOnce('remote-head');

    const request = {
      json: async () => ({
        repo_url: 'https://github.com/a/b',
        branch: 'main',
        file_paths: ['src/a.ts'],
        status: 'WRITING',
        message: 'work',
        agent_head: 'local-head',
      }),
      headers: new Headers(),
    } as any;

    const response = await postStatusPost(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(false);
    expect(payload.orchestration.action).toBe('PULL');
  });

  test('post_status returns conflict orchestration when lock acquisition fails', async () => {
    mockedGetRepoHead.mockResolvedValueOnce('same-head');
    mockedAcquireLocks.mockResolvedValueOnce({
      success: false,
      reason: 'FILE_CONFLICT',
      conflictingFile: 'src/a.ts',
      conflictingUser: 'user2',
    });

    const request = {
      json: async () => ({
        repo_url: 'https://github.com/a/b',
        branch: 'main',
        file_paths: ['src/a.ts'],
        status: 'WRITING',
        message: 'work',
        agent_head: 'same-head',
      }),
      headers: new Headers(),
    } as any;

    const response = await postStatusPost(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(false);
    expect(payload.orchestration.action).toBe('SWITCH_TASK');
    expect(payload.orchestration.reason).toContain('FILE_CONFLICT');
  });

  test('cleanup route returns 401 when auth is missing', async () => {
    const request = { headers: new Headers() } as any;
    const response = await cleanupGet(request);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  test('graph route returns 400 when repo_url is missing', async () => {
    const request = { url: 'http://localhost:3000/api/graph' } as any;
    const response = await graphGet(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'repo_url is required' });
  });
});
