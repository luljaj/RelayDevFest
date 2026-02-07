export type FileLanguage = 'ts' | 'js' | 'py';

export interface ParsedImport {
  raw: string;
  module: string;
  lineNumber: number;
}

export function parseImports(content: string, filePath: string, language: FileLanguage): ParsedImport[] {
  const imports: ParsedImport[] = [];
  const lines = content.split('\n');

  if (language === 'ts' || language === 'js') {
    const es6ImportRegex = /^import\s+.*\s+from\s+['"]([^'"]+)['"]/;
    const es6ExportRegex = /^export\s+.*\s+from\s+['"]([^'"]+)['"]/;
    const cjsRegex = /(import|require)\(['"]([^'"]+)['"]\)/g;

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
        continue;
      }

      const es6ImportMatch = trimmed.match(es6ImportRegex);
      if (es6ImportMatch) {
        imports.push({ raw: line, module: es6ImportMatch[1], lineNumber: i + 1 });
        continue;
      }

      const es6ExportMatch = trimmed.match(es6ExportRegex);
      if (es6ExportMatch) {
        imports.push({ raw: line, module: es6ExportMatch[1], lineNumber: i + 1 });
        continue;
      }

      cjsRegex.lastIndex = 0;
      let cjsMatch: RegExpExecArray | null = null;
      while ((cjsMatch = cjsRegex.exec(line)) !== null) {
        imports.push({ raw: line, module: cjsMatch[2], lineNumber: i + 1 });
      }
    }
  } else if (language === 'py') {
    const directImportRegex = /^import\s+([\w\.]+)/;
    const fromImportRegex = /^from\s+([\w\.]+)\s+import/;

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed.startsWith('#')) {
        continue;
      }

      const directMatch = trimmed.match(directImportRegex);
      if (directMatch) {
        imports.push({ raw: line, module: directMatch[1], lineNumber: i + 1 });
        continue;
      }

      const fromMatch = trimmed.match(fromImportRegex);
      if (fromMatch) {
        imports.push({ raw: line, module: fromMatch[1], lineNumber: i + 1 });
      }
    }
  }

  return imports;
}

export function getFileLanguage(filePath: string): FileLanguage | null {
  if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) return 'ts';
  if (filePath.endsWith('.js') || filePath.endsWith('.jsx')) return 'js';
  if (filePath.endsWith('.py')) return 'py';
  return null;
}

export function isRelativeImport(importPath: string): boolean {
  return importPath.startsWith('.') || importPath.startsWith('/');
}
