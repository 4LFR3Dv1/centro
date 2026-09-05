import fs from 'node:fs';

const files = {
  home: 'src/admin-today.tsx',
  guidance: 'src/admin-operational-guidance.tsx',
  scheduler: 'src/contextual-lesson-scheduler.tsx',
  studentHome: 'src/student-home.tsx',
};

const source = Object.fromEntries(
  Object.entries(files).map(([key, file]) => [key, fs.readFileSync(file, 'utf8')]),
);

const failures = [];

function requireText(key, text, message) {
  if (!source[key].includes(text)) failures.push(message);
}

function forbidText(key, text, message) {
  if (source[key].includes(text)) failures.push(message);
}

requireText('home', "from './contextual-lesson-scheduler'", 'Admin Home must use the shared contextual lesson scheduler.');
requireText('guidance', "from './contextual-lesson-scheduler'", 'Student Detail guidance must use the shared contextual lesson scheduler.');

forbidText('home', 'HomeLessonScheduler', 'Admin Home reintroduced a private lesson scheduler.');
forbidText('guidance', 'QuickLessonScheduler', 'Student Detail reintroduced a private lesson scheduler.');
forbidText('home', '/api/admin/schedule/options', 'Admin Home must not own contextual scheduling option loading.');
forbidText('home', '/api/admin/schedule/lessons', 'Admin Home must not own contextual lesson creation.');
forbidText('guidance', '/api/admin/schedule/options', 'Student Detail guidance must not own contextual scheduling option loading.');
forbidText('guidance', '/api/admin/schedule/lessons', 'Student Detail guidance must not own contextual lesson creation.');

requireText('scheduler', "enrollmentCategory === 'AB' ? '' : enrollmentCategory", 'A+B scheduling must begin without inventing A or B.');
requireText('scheduler', 'Escolha A ou B', 'A+B scheduling must ask for an intentional category choice.');
forbidText('scheduler', "enrollmentCategory === 'AB' ? 'B'", 'A+B scheduling must not silently default to B.');

requireText('studentHome', 'lessonIsPrimary', 'Student Home must detect when the next lesson is already the primary action.');
requireText('studentHome', 'examIsPrimary', 'Student Home must detect when the next exam is already the primary action.');

if (failures.length) {
  console.error('Operational friction guard failed:\n');
  for (const failure of failures) console.error(`- ${failure}`);
  console.error('\nSee docs/operations/UX-007-FRICTION-AUDIT.md and UX-011-FRICTION-WITNESS.md.');
  process.exit(1);
}

console.log('Operational friction guard passed: contextual scheduling is single-path, A+B remains intentional, and Student Home avoids duplicate action emphasis.');
