import { isRelativeImport } from './parser';

export function resolveImportPath(
  importPath: string,
  currentFilePath: string,
  allFilePaths: Set<string>,
): string | null {
  if (!isRelativeImport(importPath)) {
    return null;
  }

  const lastSlash = currentFilePath.lastIndexOf('/');
  const currentDir = lastSlash > 0 ? currentFilePath.substring(0, lastSlash) : '';
  const resolved = resolvePath(currentDir, importPath);

  for (const candidate of generateCandidates(resolved)) {
    if (allFilePaths.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolvePath(currentDir: string, relativePath: string): string {
  const parts = currentDir ? currentDir.split('/') : [];

  for (const part of relativePath.split('/')) {
    if (part === '..') {
      if (parts.length > 0) {
        parts.pop();
      }
      continue;
    }

    if (part === '.' || part === '') {
      continue;
    }

    parts.push(part);
  }

  return parts.join('/');
}

function generateCandidates(basePath: string): string[] {
  const candidates: string[] = [];

  for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.py']) {
    candidates.push(`${basePath}${ext}`);
  }

  for (const indexFile of ['index.ts', 'index.tsx', 'index.js', 'index.jsx']) {
    candidates.push(`${basePath}/${indexFile}`);
  }

  return candidates;
}

export class ImportResolver {
  private cache = new Map<string, string | null>();

  constructor(private allFilePaths: Set<string>) {}

  resolve(importPath: string, currentFilePath: string): string | null {
    const cacheKey = `${currentFilePath}:${importPath}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey) ?? null;
    }

    const resolved = resolveImportPath(importPath, currentFilePath, this.allFilePaths);
    this.cache.set(cacheKey, resolved);
    return resolved;
  }

  clear(): void {
    this.cache.clear();
  }
}
