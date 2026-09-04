import type { IncomingMessage, ServerResponse } from 'node:http';
import type pg from 'pg';
import { resolveStaffSession } from '../staff/auth.js';
import {
  changeOwnStaffPassword,
  getStaffSecuritySnapshot,
  StaffSecurityInputError,
} from '../staff/security.js';

const ADMIN_COOKIE = 'centro_admin_session';
const MAX_BODY_BYTES = 32 * 1024;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.end(JSON.stringify(body));
}

function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  return Object.fromEntries(
    header.split(';').map((part) => {
      const index = part.indexOf('=');
      if (index === -1) return [part.trim(), ''];
      return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
    }),
  );
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Request body is too large.');
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as T;
  } catch {
    throw new HttpError(400, 'Invalid JSON body.');
  }
}

function assertOrigin(req: IncomingMessage, publicOrigin?: string): void {
  if (!publicOrigin) return;
  if (req.headers.origin !== publicOrigin) throw new HttpError(403, 'Request origin is not allowed.');
}

export function createStaffSecurityApiHandler(pool: pg.Pool, options: { publicOrigin?: string } = {}) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://centro.local');
    if (!url.pathname.startsWith('/api/admin/security')) return false;

    try {
      const token = parseCookies(req)[ADMIN_COOKIE] ?? '';
      const session = await resolveStaffSession(pool, token);
      if (!session) throw new HttpError(401, 'Authentication required.');

      if (req.method === 'GET' && url.pathname === '/api/admin/security') {
        const snapshot = await getStaffSecuritySnapshot(pool, session.staffUserId);
        if (!snapshot) throw new HttpError(404, 'Staff credential not found.');
        sendJson(res, 200, {
          passwordVersion: snapshot.passwordVersion,
          credentialUpdatedAt: snapshot.credentialUpdatedAt.toISOString(),
          failedAttempts: snapshot.failedAttempts,
          lockedUntil: snapshot.lockedUntil?.toISOString() ?? null,
          disabled: Boolean(snapshot.disabledAt),
          activeSessions: snapshot.activeSessions,
        });
        return true;
      }

      if (req.method === 'POST' && url.pathname === '/api/admin/security/password') {
        assertOrigin(req, options.publicOrigin);
        const body = await readJson<{ currentPassword?: string; newPassword?: string }>(req);
        const result = await changeOwnStaffPassword(pool, {
          staffUserId: session.staffUserId,
          currentSessionId: session.sessionId,
          currentPassword: body.currentPassword ?? '',
          newPassword: body.newPassword ?? '',
        });
        sendJson(res, 200, result);
        return true;
      }

      sendJson(res, 404, { error: 'Not found.' });
      return true;
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(res, error.status, { error: error.message });
        return true;
      }
      if (error instanceof StaffSecurityInputError) {
        sendJson(res, 400, { error: error.message });
        return true;
      }
      console.error('[centro-staff-security-api] request failed', error instanceof Error ? error.message : error);
      sendJson(res, 500, { error: 'Internal server error.' });
      return true;
    }
  };
}
