import type { IncomingMessage, ServerResponse } from 'node:http';
import type pg from 'pg';
import { resolveStaffSession } from '../staff/auth.js';
import {
  activateStudentAccessQr,
  getCurrentStudentAccessQr,
  resolveStudentAccessQr,
  rotateStudentAccessQr,
  StudentAccessActivationError,
} from '../student/access.js';
import type { StudentSession } from '../student/auth.js';

const ADMIN_COOKIE = 'centro_admin_session';
const STUDENT_COOKIE = 'centro_student_session';
const TOKEN_PATH = '[A-Za-z0-9_-]{20,80}';
const UUID_PATH = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}';
const MAX_BODY_BYTES = 16 * 1024;

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
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
  return Object.fromEntries(header.split(';').map((part) => {
    const index = part.indexOf('=');
    if (index === -1) return [part.trim(), ''];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }));
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
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as T; }
  catch { throw new HttpError(400, 'Invalid JSON body.'); }
}

function assertOrigin(req: IncomingMessage, publicOrigin?: string): void {
  if (!publicOrigin) return;
  if (req.headers.origin !== publicOrigin) throw new HttpError(403, 'Request origin is not allowed.');
}

function setStudentSessionCookie(res: ServerResponse, token: string, secure: boolean): void {
  const attributes = [
    `${STUDENT_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=43200',
  ];
  if (secure) attributes.push('Secure');
  res.setHeader('Set-Cookie', attributes.join('; '));
}

async function requireStaff(pool: pg.Pool, req: IncomingMessage) {
  const token = parseCookies(req)[ADMIN_COOKIE] ?? '';
  const session = await resolveStaffSession(pool, token);
  if (!session) throw new HttpError(401, 'Authentication required.');
  return session;
}

function extractToken(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new HttpError(400, 'QR code is required.');
  const direct = trimmed.match(new RegExp(`^${TOKEN_PATH}$`));
  if (direct) return direct[0];
  try {
    const parsed = new URL(trimmed);
    const match = parsed.pathname.match(new RegExp(`^/aluno/acesso/(${TOKEN_PATH})/?$`));
    if (match) return match[1];
  } catch { /* raw token fallback */ }
  throw new HttpError(400, 'QR code is not a Centro student access code.');
}

function sessionPayload(session: StudentSession) {
  return {
    student: {
      id: session.studentId,
      publicId: session.publicId,
      fullName: session.fullName,
    },
    credential: { mustChangePassword: session.mustChangePassword },
    enrollments: session.enrollments.map((enrollment) => ({
      id: enrollment.id,
      serviceType: enrollment.serviceType,
      category: enrollment.category,
      status: enrollment.status,
      openedAt: enrollment.openedAt.toISOString(),
    })),
    nextAction: null,
    expiresAt: session.expiresAt.toISOString(),
  };
}

export type StudentAccessApiOptions = {
  publicOrigin?: string;
  secureCookies?: boolean;
};

export function createStudentAccessApiHandler(pool: pg.Pool, options: StudentAccessApiOptions = {}) {
  const secureCookies = options.secureCookies ?? process.env.NODE_ENV === 'production';

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://centro.local');
    const publicMatch = url.pathname.match(new RegExp(`^/api/student/access/(${TOKEN_PATH})$`));
    const activationMatch = url.pathname.match(new RegExp(`^/api/student/access/(${TOKEN_PATH})/activate$`));
    const currentMatch = url.pathname.match(new RegExp(`^/api/admin/students/(${UUID_PATH})/access-qr$`));
    const rotateMatch = url.pathname.match(new RegExp(`^/api/admin/students/(${UUID_PATH})/access-qr/rotate$`));
    const lookup = url.pathname === '/api/admin/student-access/lookup';
    if (!publicMatch && !activationMatch && !currentMatch && !rotateMatch && !lookup) return false;

    try {
      if (req.method === 'POST') assertOrigin(req, options.publicOrigin);

      if (req.method === 'GET' && publicMatch) {
        const resolved = await resolveStudentAccessQr(pool, publicMatch[1]);
        if (!resolved) throw new HttpError(404, 'QR de acesso não encontrado.');
        if (resolved.revokedAt || resolved.studentStatus !== 'ACTIVE') {
          throw new HttpError(410, 'Este QR de acesso foi substituído. Use o QR atual ou digite seu ID Centro.');
        }
        sendJson(res, 200, {
          publicId: resolved.publicId,
          firstName: resolved.fullName.trim().split(/\s+/)[0] || 'Aluno',
          activationRequired: resolved.activationRequired,
        });
        return true;
      }

      if (req.method === 'POST' && activationMatch) {
        const body = await readJson<{ password?: string }>(req);
        const activated = await activateStudentAccessQr(pool, {
          publicToken: activationMatch[1],
          password: body.password ?? '',
        });
        setStudentSessionCookie(res, activated.token, secureCookies);
        sendJson(res, 201, sessionPayload(activated.session));
        return true;
      }

      if (req.method === 'GET' && currentMatch) {
        await requireStaff(pool, req);
        const qr = await getCurrentStudentAccessQr(pool, currentMatch[1]);
        if (!qr) throw new HttpError(404, 'QR ativo não encontrado.');
        const resolved = await resolveStudentAccessQr(pool, qr.publicToken);
        sendJson(res, 200, {
          qr: {
            id: qr.id,
            publicToken: qr.publicToken,
            createdAt: qr.createdAt.toISOString(),
            activatedAt: qr.activatedAt?.toISOString() ?? null,
            activationRequired: resolved?.activationRequired ?? true,
          },
        });
        return true;
      }

      if (req.method === 'POST' && lookup) {
        await requireStaff(pool, req);
        const body = await readJson<{ value?: string }>(req);
        const publicToken = extractToken(body.value ?? '');
        const resolved = await resolveStudentAccessQr(pool, publicToken);
        if (!resolved) throw new HttpError(404, 'QR não reconhecido.');
        sendJson(res, 200, {
          student: {
            id: resolved.studentId,
            publicId: resolved.publicId,
            fullName: resolved.fullName,
          },
          qr: {
            id: resolved.id,
            active: !resolved.revokedAt,
            revokedAt: resolved.revokedAt?.toISOString() ?? null,
            activatedAt: resolved.activatedAt?.toISOString() ?? null,
            activationRequired: resolved.activationRequired,
          },
        });
        return true;
      }

      if (req.method === 'POST' && rotateMatch) {
        const session = await requireStaff(pool, req);
        const qr = await rotateStudentAccessQr(pool, {
          studentId: rotateMatch[1],
          actorStaffUserId: session.staffUserId,
        });
        const resolved = await resolveStudentAccessQr(pool, qr.publicToken);
        sendJson(res, 200, {
          qr: {
            id: qr.id,
            publicToken: qr.publicToken,
            createdAt: qr.createdAt.toISOString(),
            activatedAt: qr.activatedAt?.toISOString() ?? null,
            activationRequired: resolved?.activationRequired ?? true,
          },
        });
        return true;
      }

      sendJson(res, 405, { error: 'Method not allowed.' });
      return true;
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(res, error.status, { error: error.message });
        return true;
      }
      if (error instanceof StudentAccessActivationError) {
        const status = error.code === 'NOT_FOUND' ? 404
          : error.code === 'GONE' ? 410
            : error.code === 'ALREADY_ACTIVATED' || error.code === 'NO_ACTIVE_ENROLLMENT' ? 409
              : 400;
        sendJson(res, status, { error: error.message, code: error.code });
        return true;
      }
      console.error('[centro-student-access-api] request failed', error instanceof Error ? error.message : error);
      sendJson(res, 500, { error: 'Internal server error.' });
      return true;
    }
  };
}
