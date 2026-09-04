import { createDatabasePool } from '../db/pool.js';
import { authenticateStaff, revokeStaffSession } from './auth.js';
import { recoverStaffPassword } from './security.js';

function usernameFromEnv(): string {
  return process.env.CENTRO_ADMIN_RECOVERY_USERNAME?.trim() ?? '';
}

function passwordFromEnv(): string {
  return process.env.CENTRO_ADMIN_RECOVERY_PASSWORD ?? '';
}

async function run(): Promise<void> {
  const username = usernameFromEnv();
  const password = passwordFromEnv();
  if (!username || !password) {
    throw new Error('CENTRO_ADMIN_RECOVERY_USERNAME and CENTRO_ADMIN_RECOVERY_PASSWORD are required.');
  }

  const pool = createDatabasePool();
  try {
    const recovered = await recoverStaffPassword(pool, { username, newPassword: password });
    if (!recovered.recovered || !recovered.staffUserId) {
      throw new Error('recovery did not find the Staff credential');
    }

    const auth = await authenticateStaff(pool, username, password);
    if (!auth) {
      throw new Error('authenticateStaff rejected the freshly recovered credential');
    }

    await revokeStaffSession(pool, auth.token, auth.session.staffUserId);
    console.log(JSON.stringify({
      probe: 'STAFF_AUTH',
      recovered: true,
      authenticated: true,
      canonicalUsername: auth.session.username,
      passwordVersion: recovered.passwordVersion,
      revokedSessionsDuringRecovery: recovered.revokedSessions,
      probeSessionRevoked: true,
    }));
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error('[centro-admin-auth-probe] failed');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
