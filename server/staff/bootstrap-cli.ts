import { createDatabasePool } from '../db/pool.js';
import { bootstrapFirstAdmin } from './auth.js';

async function run(): Promise<void> {
  const username = (
    process.env.CENTRO_BOOTSTRAP_ADMIN_USERNAME
    ?? process.env.ADMIN_BOOTSTRAP_USERNAME
    ?? ''
  ).trim();
  const displayName = (
    process.env.CENTRO_BOOTSTRAP_ADMIN_NAME
    ?? process.env.ADMIN_BOOTSTRAP_DISPLAY_NAME
    ?? 'Administrador'
  ).trim();
  const password = process.env.CENTRO_BOOTSTRAP_ADMIN_PASSWORD ?? process.env.ADMIN_BOOTSTRAP_PASSWORD ?? '';

  if (!username || !password) {
    throw new Error('CENTRO_BOOTSTRAP_ADMIN_USERNAME and CENTRO_BOOTSTRAP_ADMIN_PASSWORD are required.');
  }

  const pool = createDatabasePool();
  try {
    const result = await bootstrapFirstAdmin(pool, { username, displayName, password });
    if (result.created) {
      console.log(`[centro-admin] first admin created: ${username}`);
    } else {
      console.log('[centro-admin] staff already exists; bootstrap skipped.');
    }
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error('[centro-admin] bootstrap failed');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
