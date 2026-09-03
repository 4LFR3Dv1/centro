import type { IncomingMessage, ServerResponse } from 'node:http';
import type pg from 'pg';
import {
  authenticateStudent,
  changeInitialStudentPassword,
  resolveStudentSession,
  revokeStudentSession,
  type StudentSession,
} from '../student/auth.js';

const SESSION_COOKIE = 'centro_student_session';
const MAX_BODY_BYTES = 32 * 1024;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.end(payload);
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

function setSessionCookie(res: ServerResponse, token: string, secure: boolean): void {
  const attributes = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=43200',
  ];
  if (secure) attributes.push('Secure');
  res.setHeader('Set-Cookie', attributes.join('; '));
}

function clearSessionCookie(res: ServerResponse, secure: boolean): void {
  const attributes = [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (secure) attributes.push('Secure');
  res.setHeader('Set-Cookie', attributes.join('; '));
}

async function requireStudent(pool: pg.Pool, req: IncomingMessage): Promise<{ token: string; session: StudentSession }> {
  const token = parseCookies(req)[SESSION_COOKIE] ?? '';
  const session = await resolveStudentSession(pool, token);
  if (!session) throw new HttpError(401, 'Authentication required.');
  return { token, session };
}

function sessionPayload(session: StudentSession) {
  return {
    student: {
      id: session.studentId,
      publicId: session.publicId,
      fullName: session.fullName,
    },
    credential: {
      mustChangePassword: session.mustChangePassword,
    },
    enrollments: session.enrollments.map((enrollment) => ({
      id: enrollment.id,
      serviceType: enrollment.serviceType,
      category: enrollment.category,
      status: enrollment.status,
      openedAt: enrollment.openedAt.toISOString(),
    })),
    nextAction: session.mustChangePassword
      ? { code: 'CHANGE_INITIAL_PASSWORD', href: '/aluno/trocar-senha' }
      : null,
    expiresAt: session.expiresAt.toISOString(),
  };
}

export type StudentApiOptions = {
  publicOrigin?: string;
  secureCookies?: boolean;
};

export function createStudentApiHandler(pool: pg.Pool, options: StudentApiOptions = {}) {
  const secureCookies = options.secureCookies ?? process.env.NODE_ENV === 'production';

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://centro.local');
    if (!url.pathname.startsWith('/api/student/')) return false;

    try {
      if (req.method === 'POST') assertOrigin(req, options.publicOrigin);

      if (req.method === 'POST' && url.pathname === '/api/student/auth/login') {
        const body = await readJson<{ publicId?: string; password?: string }>(req);
        const auth = await authenticateStudent(pool, body.publicId ?? '', body.password ?? '');
        if (!auth) throw new HttpError(401, 'ID do aluno ou senha inválidos.');
        setSessionCookie(res, auth.token, secureCookies);
        sendJson(res, 200, sessionPayload(auth.session));
        return true;
      }

      if (req.method === 'GET' && url.pathname === '/api/student/auth/session') {
        const { session } = await requireStudent(pool, req);
        sendJson(res, 200, sessionPayload(session));
        return true;
      }

      if (req.method === 'POST' && url.pathname === '/api/student/auth/change-initial-password') {
        const { token, session } = await requireStudent(pool, req);
        if (!session.mustChangePassword) throw new HttpError(409, 'A senha inicial já foi alterada.');
        const body = await readJson<{ newPassword?: string }>(req);
        await changeInitialStudentPassword(pool, session, body.newPassword ?? '');
        const updated = await resolveStudentSession(pool, token);
        if (!updated) throw new HttpError(401, 'Authentication required.');
        sendJson(res, 200, sessionPayload(updated));
        return true;
      }

      if (req.method === 'POST' && url.pathname === '/api/student/auth/logout') {
        const { token, session } = await requireStudent(pool, req);
        await revokeStudentSession(pool, token, session.studentId);
        clearSessionCookie(res, secureCookies);
        res.statusCode = 204;
        res.setHeader('Cache-Control', 'no-store');
        res.end();
        return true;
      }

      sendJson(res, 404, { error: 'Not found.' });
      return true;
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(res, error.status, { error: error.message });
        return true;
      }

      const message = error instanceof Error ? error.message : '';
      if (message.includes('at least 12 characters') || message.includes('different from the initial password')) {
        sendJson(res, 400, { error: message });
        return true;
      }
      if (message.includes('already been changed')) {
        sendJson(res, 409, { error: 'A senha inicial já foi alterada.' });
        return true;
      }

      console.error('[centro-student-api] request failed', message || error);
      sendJson(res, 500, { error: 'Internal server error.' });
      return true;
    }
  };
}
