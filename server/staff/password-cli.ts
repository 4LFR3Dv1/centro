import { createDatabasePool } from '../db/pool.js';
import { rotateStaffPassword } from './auth.js';

function env(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value?.trim()) return value.trim();
  }
  return '';
}

async function run(): Promise<void> {
  const username = env('CENTRO_ADMIN_ROTATE_USERNAME', 'CENTRO_BOOTSTRAP_ADMIN_USERNAME');
  const password = env('CENTRO_ADMIN_ROTATE_PASSWORD', 'CENTRO_BOOTSTRAP_ADMIN_PASSWORD');

  if (!username || !password) {
    throw new Error(
      'CENTRO_ADMIN_ROTATE_USERNAME/CENTRO_ADMIN_ROTATE_PASSWORD (or the bootstrap username/password variables) are required.',
    );
  }

  const pool = createDatabasePool();
  try {
    const result = await rotateStaffPassword(pool, { username, password });
    if (!result.rotated) throw new Error(`staff user not found: ${username}`);
    console.log(`[centro-admin] credential rotated for ${username}; active Staff sessions revoked`);
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error('[centro-admin] password rotation failed');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
