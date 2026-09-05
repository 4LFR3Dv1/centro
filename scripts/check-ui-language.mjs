import fs from 'node:fs';
import path from 'node:path';

const roots = ['src'];
const explicitFiles = ['server/admin/student-operations.ts'];
const extensions = new Set(['.ts', '.tsx']);

const forbidden = [
  { label: 'materialization language', pattern: /materializa(?:r|do|da|dos|das|ção|ções)/i },
  { label: 'Process Kernel', pattern: /process\s+kernel/i },
  { label: 'Lesson Kernel', pattern: /lesson\s+kernel/i },
  { label: 'ProcessResolver', pattern: /processresolver/i },
  { label: 'OperationalCommand', pattern: /operationalcommand/i },
  { label: 'institutional domain language', pattern: /dom[ií]nios?\s+institucionais?/i },
  { label: 'process milestone language', pattern: /marcos?\s+processuais?/i },
  { label: 'institutional intake language', pattern: /intake\s+institucional/i },
  { label: 'credential language', pattern: /credencial(?:\s|\.|,|$)/i },
  { label: 'derived-operation loading language', pattern: /derivando\s+(?:orienta[cç][aã]o|opera[cç][aã]o|seu\s+processo)/i },
  { label: 'derived current-step language', pattern: /etapa\s+atual\s+derivada/i },
  { label: 'implementation badge THEORY-EXAM', pattern: /theory-exam-001/i },
  { label: 'implementation badge EXAMS', pattern: /exams-001/i },
  { label: 'contextual execution implementation label', pattern: /execu[cç][aã]o\s+contextual/i },
];

function listFiles(root) {
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (extensions.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

function lineAt(source, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) if (source.charCodeAt(cursor) === 10) line += 1;
  return line;
}

function skipQuoted(source, start, quote) {
  let cursor = start + 1;
  while (cursor < source.length) {
    if (source[cursor] === '\\') { cursor += 2; continue; }
    if (source[cursor] === quote) return cursor + 1;
    cursor += 1;
  }
  return cursor;
}

function skipComment(source, start) {
  if (source[start + 1] === '/') {
    const end = source.indexOf('\n', start + 2);
    return end === -1 ? source.length : end + 1;
  }
  if (source[start + 1] === '*') {
    const end = source.indexOf('*/', start + 2);
    return end === -1 ? source.length : end + 2;
  }
  return start;
}

function skipTemplateExpression(source, start) {
  let cursor = start;
  let depth = 1;
  while (cursor < source.length && depth > 0) {
    const char = source[cursor];
    if (char === '\'' || char === '"') { cursor = skipQuoted(source, cursor, char); continue; }
    if (char === '`') { cursor = skipTemplate(source, cursor).end; continue; }
    if (char === '/' && (source[cursor + 1] === '/' || source[cursor + 1] === '*')) { cursor = skipComment(source, cursor); continue; }
    if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    cursor += 1;
  }
  return cursor;
}

function skipTemplate(source, start, collect = null) {
  let cursor = start + 1;
  let chunkStart = cursor;
  while (cursor < source.length) {
    if (source[cursor] === '\\') { cursor += 2; continue; }
    if (source[cursor] === '`') {
      if (collect && cursor > chunkStart) collect(source.slice(chunkStart, cursor), chunkStart);
      return { end: cursor + 1 };
    }
    if (source[cursor] === '$' && source[cursor + 1] === '{') {
      if (collect && cursor > chunkStart) collect(source.slice(chunkStart, cursor), chunkStart);
      cursor = skipTemplateExpression(source, cursor + 2);
      chunkStart = cursor;
      continue;
    }
    cursor += 1;
  }
  if (collect && cursor > chunkStart) collect(source.slice(chunkStart, cursor), chunkStart);
  return { end: cursor };
}

function stringSegments(source) {
  const segments = [];
  let cursor = 0;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === '/' && (source[cursor + 1] === '/' || source[cursor + 1] === '*')) {
      cursor = skipComment(source, cursor);
      continue;
    }
    if (char === '\'' || char === '"') {
      const end = skipQuoted(source, cursor, char);
      segments.push({ text: source.slice(cursor + 1, Math.max(cursor + 1, end - 1)), index: cursor });
      cursor = end;
      continue;
    }
    if (char === '`') {
      cursor = skipTemplate(source, cursor, (text, index) => segments.push({ text, index })).end;
      continue;
    }
    cursor += 1;
  }
  return segments;
}

function jsxTextSegments(source) {
  const segments = [];
  for (let cursor = 0; cursor < source.length; cursor += 1) {
    if (source[cursor] !== '>') continue;
    const tagStart = source.lastIndexOf('<', cursor);
    if (tagStart === -1 || cursor - tagStart > 800) continue;
    const tag = source.slice(tagStart, cursor + 1);
    if (!/^<\/?[a-z][A-Za-z0-9:_-]*(?:\s[^<>]*)?>$/.test(tag) && tag !== '<>' && tag !== '</>') continue;

    const textStart = cursor + 1;
    let end = textStart;
    while (end < source.length && source[end] !== '<' && source[end] !== '{') end += 1;
    const text = source.slice(textStart, end);
    if (text.trim()) segments.push({ text, index: textStart });
    cursor = Math.max(cursor, end - 1);
  }
  return segments;
}

function uiTextSegments(source) {
  return [...stringSegments(source), ...jsxTextSegments(source)];
}

const files = [...new Set([...roots.flatMap(listFiles), ...explicitFiles.filter(fs.existsSync)])];
const violations = [];

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  for (const segment of uiTextSegments(source)) {
    for (const rule of forbidden) {
      rule.pattern.lastIndex = 0;
      if (rule.pattern.test(segment.text)) {
        violations.push(`${file}:${lineAt(source, segment.index)} — ${rule.label}: ${JSON.stringify(segment.text.trim().slice(0, 160))}`);
      }
    }
  }
}

if (violations.length) {
  console.error('Zero-training language guard failed. User-facing implementation language was found:\n');
  for (const violation of violations) console.error(`- ${violation}`);
  console.error('\nSee docs/operations/UX-001-PLAIN-LANGUAGE.md.');
  process.exit(1);
}

console.log(`Zero-training language guard passed across ${files.length} source files with the self-contained UI text scanner.`);
