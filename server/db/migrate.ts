import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;
const migrationDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
const LOCK_KEY = 'centro-schema-migrations-v1';

async function run(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to run database migrations.');
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(migrationDir))
      .filter((file) => /^\d+_.+\.sql$/.test(file))
      .sort();

    for (const file of files) {
      const existing = await client.query<{ version: string }>(
        'SELECT version FROM schema_migrations WHERE version = $1',
        [file],
      );
      if (existing.rowCount) continue;

      const sql = await readFile(join(migrationDir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`[centro-db] applied ${file}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK_KEY]);
    } finally {
      await client.end();
    }
  }
}

run().catch((error) => {
  console.error('[centro-db] migration failed');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
