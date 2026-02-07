import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/kv', () => {
  return {
    kv: {
      eval: vi.fn(),
      hgetall: vi.fn(),
      hdel: vi.fn(),
      keys: vi.fn(),
      pipeline: vi.fn(() => ({
        set: vi.fn(),
        hset: vi.fn(),
        hdel: vi.fn(),
        exec: vi.fn(),
      })),
    },
  };
});

import { kv } from '@/lib/kv';
import { acquireLocks, checkLocks, getLocks, releaseLocks } from '@/lib/locks';

const mockedKv = kv as unknown as {
  eval: ReturnType<typeof vi.fn>;
  hgetall: ReturnType<typeof vi.fn>;
  hdel: ReturnType<typeof vi.fn>;
  keys: ReturnType<typeof vi.fn>;
};

describe('locks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('acquires lock on available file', async () => {
    mockedKv.eval.mockResolvedValue(
      JSON.stringify({
        success: true,
        locks: [
          {
            file_path: 'src/test.ts',
            user_id: 'user1',
            user_name: 'User 1',
            status: 'WRITING',
            agent_head: 'abc123',
            message: 'Editing file',
            timestamp: Date.now(),
            expiry: Date.now() + 300_000,
          },
        ],
      }),
    );

    const result = await acquireLocks({
      repoUrl: 'https://github.com/test/repo',
      branch: 'main',
      filePaths: ['src/test.ts'],
      userId: 'user1',
      userName: 'User 1',
      status: 'WRITING',
      message: 'Editing file',
      agentHead: 'abc123',
    });

    expect(result.success).toBe(true);
    expect(result.locks?.[0]?.file_path).toBe('src/test.ts');
  });

  test('rejects lock when file conflict is returned', async () => {
    mockedKv.eval.mockResolvedValue(
      JSON.stringify({
        success: false,
        reason: 'FILE_CONFLICT',
        conflicting_file: 'src/test.ts',
        conflicting_user: 'user1',
      }),
    );

    const result = await acquireLocks({
      repoUrl: 'https://github.com/test/repo',
      branch: 'main',
      filePaths: ['src/test.ts'],
      userId: 'user2',
      userName: 'User 2',
      status: 'WRITING',
      message: 'Trying lock',
      agentHead: 'abc123',
    });

    expect(result.success).toBe(false);
    expect(result.reason).toBe('FILE_CONFLICT');
    expect(result.conflictingFile).toBe('src/test.ts');
    expect(result.conflictingUser).toBe('user1');
  });

  test('releases locks with eval call', async () => {
    mockedKv.eval.mockResolvedValue(1);

    const result = await releaseLocks('https://github.com/test/repo', 'main', ['src/test.ts'], 'user1');

    expect(result.success).toBe(true);
    expect(mockedKv.eval).toHaveBeenCalledTimes(1);
  });

  test('filters expired locks when reading lock map', async () => {
    const now = Date.now();
    mockedKv.hgetall.mockResolvedValue({
      'src/live.ts': JSON.stringify({
        file_path: 'src/live.ts',
        user_id: 'user1',
        user_name: 'User 1',
        status: 'WRITING',
        agent_head: 'a',
        message: 'Live lock',
        timestamp: now,
        expiry: now + 5000,
      }),
      'src/old.ts': JSON.stringify({
        file_path: 'src/old.ts',
        user_id: 'user2',
        user_name: 'User 2',
        status: 'READING',
        agent_head: 'b',
        message: 'Old lock',
        timestamp: now - 5000,
        expiry: now - 1,
      }),
    });

    const allLocks = await getLocks('https://github.com/test/repo', 'main');
    expect(Object.keys(allLocks)).toEqual(['src/live.ts']);

    const subset = await checkLocks('https://github.com/test/repo', 'main', ['src/live.ts', 'src/missing.ts']);
    expect(Object.keys(subset)).toEqual(['src/live.ts']);
  });
});
