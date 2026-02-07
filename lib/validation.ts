export type CoordinationStatus = 'READING' | 'WRITING' | 'OPEN';

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function normalizeFilePaths(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const candidate of value) {
    if (!isNonEmptyString(candidate)) {
      continue;
    }

    const filePath = candidate.trim();
    if (!seen.has(filePath)) {
      seen.add(filePath);
      normalized.push(filePath);
    }
  }

  return normalized;
}

export function getMissingFields(body: Record<string, unknown>, fields: string[]): string[] {
  const missing: string[] = [];

  for (const field of fields) {
    const value = body[field];

    if (typeof value === 'undefined' || value === null) {
      missing.push(field);
      continue;
    }

    if (typeof value === 'string' && value.trim().length === 0) {
      missing.push(field);
      continue;
    }

    if (Array.isArray(value) && value.length === 0) {
      missing.push(field);
    }
  }

  return missing;
}

export function parseCoordinationStatus(value: unknown): CoordinationStatus | null {
  if (value === 'READING' || value === 'WRITING' || value === 'OPEN') {
    return value;
  }

  return null;
}

export function toBodyRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}
