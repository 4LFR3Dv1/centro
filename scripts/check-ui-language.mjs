import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

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

function isStructuralLiteral(node) {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isLiteralTypeNode(parent)) return true;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return true;
  if (ts.isExternalModuleReference(parent)) return true;
  if ((ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent)) && parent.name === node) return true;
  if (ts.isElementAccessExpression(parent) && parent.argumentExpression === node) return true;
  return false;
}

function uiTextSegments(file, source) {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const segments = [];

  function add(text, node) {
    if (!text || !text.trim()) return;
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    segments.push({ text, line: line + 1 });
  }

  function visit(node) {
    if (ts.isJsxText(node)) {
      add(node.getText(sourceFile), node);
    } else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !isStructuralLiteral(node)) {
      add(node.text, node);
    } else if (ts.isTemplateExpression(node)) {
      add(node.head.text, node.head);
      for (const span of node.templateSpans) add(span.literal.text, span.literal);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return segments;
}

const files = [...new Set([...roots.flatMap(listFiles), ...explicitFiles.filter(fs.existsSync)])];
const violations = [];

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  for (const segment of uiTextSegments(file, source)) {
    for (const rule of forbidden) {
      rule.pattern.lastIndex = 0;
      if (rule.pattern.test(segment.text)) {
        violations.push(`${file}:${segment.line} — ${rule.label}: ${JSON.stringify(segment.text.trim().slice(0, 160))}`);
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

console.log(`Zero-training language guard passed across ${files.length} source files using the TypeScript AST.`);
