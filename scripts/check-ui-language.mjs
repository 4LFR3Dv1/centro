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

function uiTextSegments(source) {
  const segments = [];
  const literal = /(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  let match;
  while ((match = literal.exec(source))) segments.push({ text: match[2], index: match.index });

  const jsxText = />\s*([^<{][^<]*)\s*</g;
  while ((match = jsxText.exec(source))) segments.push({ text: match[1], index: match.index });
  return segments;
}

function lineAt(source, index) {
  return source.slice(0, index).split('\n').length;
}

const files = [...roots.flatMap(listFiles), ...explicitFiles.filter(fs.existsSync)];
const violations = [];

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  for (const segment of uiTextSegments(source)) {
    for (const rule of forbidden) {
      if (rule.pattern.test(segment.text)) {
        violations.push(`${file}:${lineAt(source, segment.index)} — ${rule.label}: ${JSON.stringify(segment.text.trim().slice(0, 160))}`);
      }
      rule.pattern.lastIndex = 0;
    }
  }
}

if (violations.length) {
  console.error('Zero-training language guard failed. User-facing implementation language was found:\n');
  for (const violation of violations) console.error(`- ${violation}`);
  console.error('\nSee docs/operations/UX-001-PLAIN-LANGUAGE.md.');
  process.exit(1);
}

console.log(`Zero-training language guard passed across ${files.length} source files.`);
