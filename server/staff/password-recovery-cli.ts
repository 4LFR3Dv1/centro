import { createDatabasePool } from '../db/pool.js';
import { recoverStaffPassword } from './security.js';

function firstNonBlank(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value?.trim()) return value.trim();
  }
  return '';
}

function firstPresent(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value.length > 0) return value;
  }
  return '';
}

async function run(): Promise<void> {
  const username = firstNonBlank('CENTRO_ADMIN_RECOVERY_USERNAME', 'CENTRO_BOOTSTRAP_ADMIN_USERNAME');
  const newPassword = firstPresent('CENTRO_ADMIN_RECOVERY_PASSWORD', 'CENTRO_BOOTSTRAP_ADMIN_PASSWORD');
  if (!username || !newPassword) {
    throw new Error(
      'CENTRO_ADMIN_RECOVERY_USERNAME/CENTRO_ADMIN_RECOVERY_PASSWORD or the bootstrap username/password variables are required.',
    );
  }

  const pool = createDatabasePool();
  try {
    const result = await recoverStaffPassword(pool, { username, newPassword });
    if (!result.recovered) throw new Error(`staff user not found: ${username}`);
    console.log(`[centro-admin] credential recovered for ${username}; ${result.revokedSessions} active session(s) revoked`);
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error('[centro-admin] password recovery failed');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
