import { createDatabasePool } from '../db/pool.js';
import { verifyPassword } from '../ops/credentials.js';

function env(name: string): string {
  return process.env[name]?.trim() ?? '';
}

async function run(): Promise<void> {
  const username = env('CENTRO_ADMIN_RECOVERY_USERNAME');
  const password = process.env.CENTRO_ADMIN_RECOVERY_PASSWORD ?? '';
  if (!username || !password) {
    throw new Error('CENTRO_ADMIN_RECOVERY_USERNAME and CENTRO_ADMIN_RECOVERY_PASSWORD are required.');
  }

  const pool = createDatabasePool();
  try {
    const result = await pool.query<{
      username: string;
      active: boolean;
      password_hash: string;
      password_version: number;
      failed_attempts: number;
      locked_until: Date | null;
      disabled_at: Date | null;
    }>(
      `SELECT u.username,
              u.active,
              c.password_hash,
              c.password_version,
              c.failed_attempts,
              c.locked_until,
              c.disabled_at
       FROM staff_users u
       JOIN staff_credentials c ON c.staff_user_id = u.id
       WHERE lower(u.username) = lower($1)
       LIMIT 1`,
      [username],
    );

    const row = result.rows[0];
    const passwordMatches = row ? await verifyPassword(row.password_hash, password) : false;
    const payload = {
      found: Boolean(row),
      username: row?.username ?? null,
      active: row?.active ?? null,
      disabled: Boolean(row?.disabled_at),
      passwordMatches,
      passwordVersion: row?.password_version ?? null,
      failedAttempts: row?.failed_attempts ?? null,
      lockedUntil: row?.locked_until?.toISOString() ?? null,
    };

    console.log(`[centro-admin-diagnostic] ${JSON.stringify(payload)}`);

    if (!row || !passwordMatches || !row.active || row.disabled_at) {
      process.exitCode = 2;
    }
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error('[centro-admin-diagnostic] failed');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
