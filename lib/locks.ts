import { kv } from './kv';
import { normalizeRepoUrl } from './github';

const LOCK_TTL_MS = 300_000;

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

type AcquireResult = {
  success: boolean;
  locks?: LockEntry[];
  reason?: string;
  conflictingFile?: string;
  conflictingUser?: string;
};

function getLockKey(repoUrl: string, branch: string): string {
  const normalizedRepoUrl = normalizeRepoUrl(repoUrl);
  const normalizedBranch = branch.trim() || 'main';
  return `locks:${normalizedRepoUrl}:${normalizedBranch}`;
}

type RedisLockEntryValue = string | Partial<LockEntry> | null | undefined;

function normalizeJsonValue<T>(value: string | T | null | undefined): T | null {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  if (value && typeof value === 'object') {
    return value;
  }

  return null;
}

function parseLockEntry(value: RedisLockEntryValue): LockEntry | null {
  try {
    const parsed = normalizeJsonValue<Partial<LockEntry>>(value);
    if (!parsed) {
      return null;
    }

    if (
      typeof parsed.file_path === 'string' &&
      typeof parsed.user_id === 'string' &&
      typeof parsed.user_name === 'string' &&
      (parsed.status === 'READING' || parsed.status === 'WRITING') &&
      typeof parsed.agent_head === 'string' &&
      typeof parsed.message === 'string' &&
      typeof parsed.timestamp === 'number' &&
      typeof parsed.expiry === 'number'
    ) {
      return parsed as LockEntry;
    }

    return null;
  } catch {
    return null;
  }
}

export async function acquireLocks(request: LockRequest): Promise<AcquireResult> {
  const lockKey = getLockKey(request.repoUrl, request.branch);
  const timestamp = Date.now();
  const expiry = timestamp + LOCK_TTL_MS;

  const luaScript = `
    local lock_key = KEYS[1]
    local file_paths = cjson.decode(ARGV[1])
    local user_id = ARGV[2]
    local status = ARGV[3]
    local timestamp = tonumber(ARGV[4])
    local expiry = tonumber(ARGV[5])

    for i, file_path in ipairs(file_paths) do
      local existing = redis.call('HGET', lock_key, file_path)
      if existing then
        local lock = cjson.decode(existing)
        if lock.expiry > timestamp then
          if lock.user_id ~= user_id then
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
    const rawResult = await (kv as any).eval(luaScript, [lockKey], [
      JSON.stringify(request.filePaths),
      request.userId,
      request.status,
      timestamp.toString(),
      expiry.toString(),
      request.userName,
      request.agentHead,
      request.message,
    ]);

    const parsed = normalizeJsonValue<{
      success: boolean;
      locks?: LockEntry[];
      reason?: string;
      conflicting_file?: string;
      conflicting_user?: string;
    }>(rawResult);

    if (!parsed) {
      return {
        success: false,
        reason: 'INVALID_LOCK_RESPONSE',
      };
    }

    return {
      success: parsed.success,
      locks: parsed.locks,
      reason: parsed.reason,
      conflictingFile: parsed.conflicting_file,
      conflictingUser: parsed.conflicting_user,
    };
  } catch (error) {
    console.error('Lock acquisition failed:', error);
    return {
      success: false,
      reason: 'INTERNAL_ERROR',
    };
  }
}

export async function releaseLocks(
  repoUrl: string,
  branch: string,
  filePaths: string[],
  userId: string,
): Promise<{ success: boolean }> {
  const lockKey = getLockKey(repoUrl, branch);

  const luaScript = `
    local lock_key = KEYS[1]
    local file_paths = cjson.decode(ARGV[1])
    local user_id = ARGV[2]

    for i, file_path in ipairs(file_paths) do
      local existing = redis.call('HGET', lock_key, file_path)
      if existing then
        local lock = cjson.decode(existing)
        if lock.user_id == user_id then
          redis.call('HDEL', lock_key, file_path)
        end
      end
    end

    return 1
  `;

  try {
    await (kv as any).eval(luaScript, [lockKey], [JSON.stringify(filePaths), userId]);
    return { success: true };
  } catch (error) {
    console.error('Lock release failed:', error);
    return { success: false };
  }
}

export async function getLocks(repoUrl: string, branch: string): Promise<Record<string, LockEntry>> {
  const lockKey = getLockKey(repoUrl, branch);
  const entries = (await kv.hgetall(lockKey)) as Record<string, RedisLockEntryValue> | null;

  if (!entries) {
    return {};
  }

  const now = Date.now();
  const parsed: Record<string, LockEntry> = {};

  for (const [filePath, rawLock] of Object.entries(entries)) {
    const lock = parseLockEntry(rawLock);
    if (lock && lock.expiry > now) {
      parsed[filePath] = lock;
    }
  }

  return parsed;
}

export async function checkLocks(
  repoUrl: string,
  branch: string,
  filePaths: string[],
): Promise<Record<string, LockEntry>> {
  const allLocks = await getLocks(repoUrl, branch);
  const relevant: Record<string, LockEntry> = {};

  for (const filePath of filePaths) {
    if (allLocks[filePath]) {
      relevant[filePath] = allLocks[filePath];
    }
  }

  return relevant;
}

export async function cleanupExpiredLocks(): Promise<number> {
  const now = Date.now();
  let cleanedCount = 0;
  const keys = (await (kv as any).keys('locks:*')) as string[];

  for (const key of keys) {
    const entries = (await kv.hgetall(key)) as Record<string, RedisLockEntryValue> | null;
    if (!entries) {
      continue;
    }

    for (const [filePath, rawLock] of Object.entries(entries)) {
      const lock = parseLockEntry(rawLock);
      if (!lock || lock.expiry < now) {
        await kv.hdel(key, filePath);
        cleanedCount += 1;
      }
    }
  }

  return cleanedCount;
}
