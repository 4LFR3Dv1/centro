import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatStudentPublicId,
  generateInitialPassword,
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  verifyPassword,
} from './credentials.js';

const PASSWORD_PATTERN = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

test('initial password is human-readable, random-looking and never contains ambiguous symbols', () => {
  const values = new Set(Array.from({ length: 64 }, () => generateInitialPassword()));
  assert.equal(values.size, 64);
  for (const value of values) assert.match(value, PASSWORD_PATTERN);
});

test('password hashes use Argon2id and verify without preserving plaintext', async () => {
  const plaintext = generateInitialPassword();
  const passwordHash = await hashPassword(plaintext);

  assert.match(passwordHash, /^\$argon2id\$/);
  assert.equal(passwordHash.includes(plaintext), false);
  assert.equal(await verifyPassword(passwordHash, plaintext), true);
  assert.equal(await verifyPassword(passwordHash, `${plaintext}X`), false);
});

test('session token is high entropy and only its SHA-256 digest needs durable storage', () => {
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  assert.ok(token.length >= 40);
  assert.match(tokenHash, /^[a-f0-9]{64}$/);
  assert.equal(tokenHash.includes(token), false);
});

test('student public ID is stable, human-readable and uses São Paulo calendar year', () => {
  const publicId = formatStudentPublicId(481, new Date('2026-09-03T18:00:00-03:00'));
  assert.equal(publicId, 'CEN-26-00481');
});

test('student public ID rejects invalid sequence numbers', () => {
  assert.throws(() => formatStudentPublicId(0), /positive integer/);
  assert.throws(() => formatStudentPublicId(1.5), /positive integer/);
});
