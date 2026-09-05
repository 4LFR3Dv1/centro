import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const checks = [
  {
    file: 'src/contextual-lesson-scheduler.tsx',
    required: ['ExceptionGuidanceCard', 'scheduleExceptionGuidance', 'MISSING_DEPENDENCY'],
    forbidden: ['{error && <p className="admin-error"'],
  },
  {
    file: 'server/admin/student-operations.ts',
    required: [
      'LESSON_NO_SHOW_RECOVERY',
      'LESSON_CANCELLED_RECOVERY',
      'THEORY_EXAM_ABSENCE_RECOVERY',
      'THEORY_EXAM_FAILED_RECOVERY',
      'PRACTICAL_EXAM_ABSENCE_RECOVERY',
      'PRACTICAL_EXAM_FAILED_RECOVERY',
      "kind: 'SCHEDULE_LESSON'",
      "kind: 'SCHEDULE_THEORY_EXAM'",
      "kind: 'ADD_TO_PRACTICAL_EXAM'",
    ],
    forbidden: [],
  },
  {
    file: 'src/admin-exams.tsx',
    required: [
      'candidateExceptionGuidance',
      "kind: 'ABSENCE'",
      "kind: 'REJECTION'",
      "kind: 'DIVERGENCE'",
      'O resultado oficial é diferente do registro da escola.',
      'Informado:',
      'Oficial:',
    ],
    forbidden: ['reconciliação do resultado'],
  },
  {
    file: 'src/student-access-entry.tsx',
    required: ['accessExceptionGuidance', 'ExceptionGuidanceCard', 'Entrar com meu ID'],
    forbidden: [],
  },
  {
    file: 'src/student-security.tsx',
    required: ['ACCESS_BLOCKED', 'temporariamente bloqueadas', 'desativado pela escola'],
    forbidden: [],
  },
  {
    file: 'server/student/home.ts',
    required: [
      'WAIT_SCHOOL_REACTIVATE_ENROLLMENT',
      'WAIT_SCHOOL_AFTER_THEORY_ABSENCE',
      'WAIT_SCHOOL_AFTER_THEORY_FAILURE',
      'WAIT_SCHOOL_AFTER_LESSON_NO_SHOW',
      'WAIT_SCHOOL_AFTER_LESSON_CANCELLED',
      'WAIT_SCHOOL_AFTER_PRACTICAL_ABSENCE',
      'WAIT_SCHOOL_AFTER_PRACTICAL_FAILURE',
      'Você não precisa fazer nada no Centro agora.',
    ],
    forbidden: [],
  },
  {
    file: 'src/student-home.tsx',
    required: ["code.startsWith('WAIT_')", "code.startsWith('SCHOOL_')", '!passivePrimary'],
    forbidden: [],
  },
];

const failures = [];
for (const check of checks) {
  const source = read(check.file);
  for (const snippet of check.required) {
    if (!source.includes(snippet)) failures.push(`${check.file}: missing required exception-first contract: ${snippet}`);
  }
  for (const snippet of check.forbidden) {
    if (source.includes(snippet)) failures.push(`${check.file}: forbidden regression: ${snippet}`);
  }
}

const exceptionPrimitive = read('src/exception-guidance.tsx');
for (const kind of ['CONFLICT', 'MISSING_DEPENDENCY', 'ABSENCE', 'REJECTION', 'DIVERGENCE', 'PAUSED', 'ACCESS_BLOCKED', 'STALE_REFERENCE']) {
  if (!exceptionPrimitive.includes(`'${kind}'`)) failures.push(`src/exception-guidance.tsx: exception kind ${kind} is missing`);
}

const repositorySurface = [
  read('src/contextual-lesson-scheduler.tsx'),
  read('src/admin-exams.tsx'),
  read('src/student-access-entry.tsx'),
  read('server/admin/student-operations.ts'),
].join('\n');
for (const forbidden of ['/exceptions/resolve', '/exception/resolve', 'exception_workflows', 'exception_tasks']) {
  if (repositorySurface.includes(forbidden)) failures.push(`generic exception authority is forbidden: ${forbidden}`);
}

if (failures.length) {
  console.error('Exception-first UX guard failed:\n');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Exception-first UX guard passed. Known exceptions retain explicit consequence, actor and owner-domain recovery paths.');
