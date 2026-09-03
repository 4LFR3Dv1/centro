import { createHash, randomBytes } from 'node:crypto';
import { Algorithm, hash, verify } from '@node-rs/argon2';

const HUMAN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const INITIAL_PASSWORD_SYMBOLS = 12;

export function generateInitialPassword(): string {
  const bytes = randomBytes(INITIAL_PASSWORD_SYMBOLS);
  const symbols = Array.from(bytes, (byte) => HUMAN_ALPHABET[byte & 31]).join('');
  return symbols.match(/.{1,4}/g)?.join('-') ?? symbols;
}

export async function hashPassword(plaintext: string): Promise<string> {
  if (plaintext.length < 10) {
    throw new Error('Password must contain at least 10 characters.');
  }

  return hash(plaintext, {
    algorithm: Algorithm.Argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
    outputLen: 32,
  });
}

export async function verifyPassword(passwordHash: string, plaintext: string): Promise<boolean> {
  return verify(passwordHash, plaintext);
}

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function formatStudentPublicId(sequence: number, at: Date = new Date()): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error('Student public ID sequence must be a positive integer.');
  }

  const year = new Intl.DateTimeFormat('en-US', {
    year: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(at);

  return `CEN-${year}-${String(sequence).padStart(5, '0')}`;
}
