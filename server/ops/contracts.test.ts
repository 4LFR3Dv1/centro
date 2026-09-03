import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STUDENT_PUBLIC_ID_PATTERN,
  assertEnrollmentCombination,
  enrollmentCategories,
  enrollmentStatuses,
  serviceTypes,
  staffRoles,
} from './contracts.js';

test('operational enums remain closed', () => {
  assert.deepEqual(serviceTypes, ['FIRST_LICENSE', 'CATEGORY_ADDITION', 'CATEGORY_CHANGE', 'LICENSED_TRAINING']);
  assert.deepEqual(enrollmentCategories, ['A', 'B', 'AB', 'D']);
  assert.deepEqual(enrollmentStatuses, ['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED']);
  assert.deepEqual(staffRoles, ['STAFF', 'ADMIN']);
});

test('category D cannot be represented as first license', () => {
  assert.throws(() => assertEnrollmentCombination('FIRST_LICENSE', 'D'), /cannot be materialized/);
  assert.doesNotThrow(() => assertEnrollmentCombination('CATEGORY_ADDITION', 'D'));
});

test('student public IDs use only the institutional access identifier format', () => {
  assert.equal(STUDENT_PUBLIC_ID_PATTERN.test('CEN-26-00481'), true);
  assert.equal(STUDENT_PUBLIC_ID_PATTERN.test('12345678900'), false);
  assert.equal(STUDENT_PUBLIC_ID_PATTERN.test('renan@example.com'), false);
});
