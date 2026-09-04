import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertLessonCategoryForEnrollment,
  assertLessonWindow,
  lessonCategories,
  lessonStatuses,
} from './contracts.js';

test('SCHEDULE-001 lesson categories are physical driving categories', () => {
  assert.deepEqual(lessonCategories, ['A', 'B', 'D']);
  assert.deepEqual(lessonStatuses, ['SCHEDULED', 'COMPLETED', 'NO_SHOW', 'CANCELLED']);
});

test('SCHEDULE-001 A+B Enrollment admits A or B lessons but never D', () => {
  assert.doesNotThrow(() => assertLessonCategoryForEnrollment('AB', 'A'));
  assert.doesNotThrow(() => assertLessonCategoryForEnrollment('AB', 'B'));
  assert.throws(() => assertLessonCategoryForEnrollment('AB', 'D'));
});

test('SCHEDULE-001 single-category Enrollment rejects another lesson category', () => {
  assert.doesNotThrow(() => assertLessonCategoryForEnrollment('B', 'B'));
  assert.throws(() => assertLessonCategoryForEnrollment('B', 'A'));
  assert.throws(() => assertLessonCategoryForEnrollment('D', 'B'));
});

test('SCHEDULE-001 lesson window must be strictly positive', () => {
  const start = new Date('2026-09-10T12:00:00.000Z');
  assert.doesNotThrow(() => assertLessonWindow(start, new Date('2026-09-10T13:00:00.000Z')));
  assert.throws(() => assertLessonWindow(start, new Date('2026-09-10T12:00:00.000Z')));
  assert.throws(() => assertLessonWindow(start, new Date('2026-09-10T11:59:59.000Z')));
  assert.throws(() => assertLessonWindow(new Date('invalid'), new Date('2026-09-10T13:00:00.000Z')));
});
