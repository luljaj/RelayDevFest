import { describe, expect, test } from 'vitest';
import { ImportResolver, resolveImportPath } from '@/lib/resolver';

describe('resolveImportPath', () => {
  const files = new Set([
    'src/utils.ts',
    'src/core/index.ts',
    'src/features/auth/service.ts',
    'src/features/shared/helper.py',
  ]);

  test('resolves simple relative import with extension probing', () => {
    const resolved = resolveImportPath('./utils', 'src/main.ts', files);
    expect(resolved).toBe('src/utils.ts');
  });

  test('resolves parent relative import', () => {
    const resolved = resolveImportPath('../shared/helper', 'src/features/auth/service.ts', files);
    expect(resolved).toBe('src/features/shared/helper.py');
  });

  test('resolves index file imports', () => {
    const resolved = resolveImportPath('./core', 'src/main.ts', files);
    expect(resolved).toBe('src/core/index.ts');
  });

  test('rejects external modules', () => {
    const resolved = resolveImportPath('lodash', 'src/main.ts', files);
    expect(resolved).toBeNull();
  });
});

describe('ImportResolver cache', () => {
  test('returns cached result on subsequent calls', () => {
    const files = new Set(['src/a.ts', 'src/b.ts']);
    const resolver = new ImportResolver(files);

    expect(resolver.resolve('./b', 'src/a.ts')).toBe('src/b.ts');
    files.delete('src/b.ts');
    expect(resolver.resolve('./b', 'src/a.ts')).toBe('src/b.ts');

    resolver.clear();
    expect(resolver.resolve('./b', 'src/a.ts')).toBeNull();
  });
});
