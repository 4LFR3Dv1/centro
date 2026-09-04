import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { createAdminApiHandler } from './http/admin-api.js';
import { createAdminExamsApiHandler } from './http/admin-exams.js';
import { createAdminTodayApiHandler } from './http/admin-today.js';
import { createProcessApiHandler } from './http/process-api.js';
import { createStaffSecurityApiHandler } from './http/staff-security-api.js';
import { createStudentApiHandler } from './http/student-api.js';
import { createStudentExperienceApiHandler } from './http/student-experience-api.js';
import { createStudentGuideApiHandler } from './http/student-guide-api.js';
import { createDatabasePool } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { bootstrapFirstAdmin } from './staff/auth.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function env(name: string): string {
  return process.env[name]?.trim() ?? '';
}

function sendText(res: ServerResponse, status: number, body: string, contentType = 'text/plain; charset=utf-8'): void {
  res.statusCode = status;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

function setBaseHeaders(res: ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), payment=()');
}

function isInsideDist(distDir: string, candidate: string): boolean {
  return candidate === distDir || candidate.startsWith(`${distDir}${sep}`);
}

async function fileExists(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile(); }
  catch { return false; }
}

async function serveFile(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  const metadata = await stat(path);
  const extension = extname(path).toLowerCase();
  res.statusCode = 200;
  res.setHeader('Content-Type', MIME[extension] ?? 'application/octet-stream');
  res.setHeader('Content-Length', String(metadata.size));

  if (path.includes(`${sep}assets${sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  else if (extension === '.html') res.setHeader('Cache-Control', 'no-cache');
  else if (path.includes(`${sep}data${sep}`)) res.setHeader('Cache-Control', 'public, max-age=300');
  else res.setHeader('Cache-Control', 'public, max-age=3600');

  if (req.method === 'HEAD') { res.end(); return; }
  await new Promise<void>((resolveStream, reject) => {
    const stream = createReadStream(path);
    stream.on('error', reject);
    stream.on('end', resolveStream);
    stream.pipe(res);
  });
}

async function bootstrapConfiguredAdmin(pool: ReturnType<typeof createDatabasePool>): Promise<void> {
  const username = env('CENTRO_BOOTSTRAP_ADMIN_USERNAME');
  const displayName = env('CENTRO_BOOTSTRAP_ADMIN_NAME');
  const password = env('CENTRO_BOOTSTRAP_ADMIN_PASSWORD');
  const configured = [username, displayName, password].filter(Boolean).length;
  if (configured === 0) return;
  if (configured !== 3) throw new Error('Bootstrap admin requires CENTRO_BOOTSTRAP_ADMIN_USERNAME, CENTRO_BOOTSTRAP_ADMIN_NAME and CENTRO_BOOTSTRAP_ADMIN_PASSWORD together.');
  const result = await bootstrapFirstAdmin(pool, { username, displayName, password });
  console.log(result.created ? `[centro-runtime] first admin created: ${username}` : '[centro-runtime] staff already exists; bootstrap credential was not applied');
}

export async function startCentroRuntime(): Promise<void> {
  const port = Number(env('PORT') || '8080');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port.');
  const publicOrigin = env('CENTRO_PUBLIC_ORIGIN');
  if (process.env.NODE_ENV === 'production' && !publicOrigin) throw new Error('CENTRO_PUBLIC_ORIGIN is required in production.');

  await runMigrations();
  const pool = createDatabasePool();
  await pool.query('SELECT 1');
  await bootstrapConfiguredAdmin(pool);

  const distDir = resolve(env('CENTRO_DIST_DIR') || 'dist');
  const indexPath = resolve(distDir, 'index.html');
  if (!await fileExists(indexPath)) throw new Error(`Frontend build not found at ${indexPath}.`);

  const guideApi = createStudentGuideApiHandler(pool, { publicOrigin: publicOrigin || undefined });
  const processApi = createProcessApiHandler(pool, { publicOrigin: publicOrigin || undefined });
  const studentExperienceApi = createStudentExperienceApiHandler(pool, { publicOrigin: publicOrigin || undefined });
  const examsApi = createAdminExamsApiHandler(pool, { publicOrigin: publicOrigin || undefined });
  const todayApi = createAdminTodayApiHandler(pool);
  const securityApi = createStaffSecurityApiHandler(pool, { publicOrigin: publicOrigin || undefined });
  const adminApi = createAdminApiHandler(pool, {
    publicOrigin: publicOrigin || undefined,
    secureCookies: process.env.NODE_ENV === 'production',
  });
  const studentApi = createStudentApiHandler(pool, {
    publicOrigin: publicOrigin || undefined,
    secureCookies: process.env.NODE_ENV === 'production',
  });

  const server = createServer((req, res) => {
    void (async () => {
      setBaseHeaders(res);
      const url = new URL(req.url ?? '/', 'http://centro.local');

      if (url.pathname === '/healthz') {
        try { await pool.query('SELECT 1'); sendText(res, 200, 'ok\n'); }
        catch { sendText(res, 503, 'database unavailable\n'); }
        return;
      }

      if (await guideApi(req, res)) return;
      if (await processApi(req, res)) return;
      if (await studentExperienceApi(req, res)) return;
      if (await examsApi(req, res)) return;
      if (await todayApi(req, res)) return;
      if (await securityApi(req, res)) return;
      if (await adminApi(req, res)) return;
      if (await studentApi(req, res)) return;

      if (req.method !== 'GET' && req.method !== 'HEAD') { sendText(res, 405, 'Method not allowed.'); return; }

      let pathname: string;
      try { pathname = decodeURIComponent(url.pathname); }
      catch { sendText(res, 400, 'Invalid URL.'); return; }

      const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const candidate = resolve(distDir, relativePath);
      if (!isInsideDist(distDir, candidate)) { sendText(res, 403, 'Forbidden.'); return; }
      if (await fileExists(candidate)) { await serveFile(req, res, candidate); return; }
      if (!extname(pathname)) { await serveFile(req, res, indexPath); return; }
      sendText(res, 404, 'Not found.');
    })().catch((error) => {
      console.error('[centro-runtime] request failed', error instanceof Error ? error.message : error);
      if (!res.headersSent) sendText(res, 500, 'Internal server error.');
      else if (!res.writableEnded) res.end();
    });
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => resolveListen());
  });
  console.log(`[centro-runtime] listening on ${port}`);

  async function shutdown(signal: string) {
    console.log(`[centro-runtime] ${signal} received; shutting down`);
    server.close();
    await pool.end();
  }
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

startCentroRuntime().catch((error) => {
  console.error('[centro-runtime] startup failed');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
