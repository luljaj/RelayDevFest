import { describe, expect, test } from 'vitest';
import { getFileLanguage, isRelativeImport, parseImports } from '@/lib/parser';

describe('parseImports', () => {
  test('parses ES module imports and exports', () => {
    const content = [
      "import { a } from './alpha';",
      "export { b } from '../beta';",
      '// import ignored from ./comment',
    ].join('\n');

    const result = parseImports(content, 'src/test.ts', 'ts');

    expect(result).toEqual([
      { raw: "import { a } from './alpha';", module: './alpha', lineNumber: 1 },
      { raw: "export { b } from '../beta';", module: '../beta', lineNumber: 2 },
    ]);
  });

  test('parses CommonJS and dynamic imports', () => {
    const content = [
      "const x = require('./utils');",
      "const y = import('../data');",
    ].join('\n');

    const result = parseImports(content, 'src/test.js', 'js');
    expect(result.map((entry) => entry.module)).toEqual(['./utils', '../data']);
  });

  test('parses Python imports and skips comments', () => {
    const content = ['# import fake', 'import os.path', 'from .helpers import run'].join('\n');

    const result = parseImports(content, 'tool.py', 'py');

    expect(result).toEqual([
      { raw: 'import os.path', module: 'os.path', lineNumber: 2 },
      { raw: 'from .helpers import run', module: '.helpers', lineNumber: 3 },
    ]);
  });
});

describe('language and relative helpers', () => {
  test('detects file language by extension', () => {
    expect(getFileLanguage('a.ts')).toBe('ts');
    expect(getFileLanguage('a.jsx')).toBe('js');
    expect(getFileLanguage('a.py')).toBe('py');
    expect(getFileLanguage('a.txt')).toBeNull();
  });

  test('detects relative import paths', () => {
    expect(isRelativeImport('./a')).toBe(true);
    expect(isRelativeImport('../a')).toBe(true);
    expect(isRelativeImport('/root/a')).toBe(true);
    expect(isRelativeImport('react')).toBe(false);
  });
});
