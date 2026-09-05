import type { IncomingMessage, ServerResponse } from 'node:http';
import type pg from 'pg';
import {
  createTheoryExamAttempt,
  getTheoryExamAttempt,
  listTheoryExamAttempts,
  reconcileTheoryExamOfficialResult,
  recordTheoryExamAttendance,
  recordTheoryExamObservedResult,
  rescheduleTheoryExamAttempt,
  TheoryExamConflictError,
  TheoryExamInputError,
} from '../theory-exams/admin.js';
import { resolveStaffSession } from '../staff/auth.js';

const ADMIN_COOKIE = 'centro_admin_session';
const MAX_BODY_BYTES = 32 * 1024;
const UUID_PATH = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}';

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

async function requireStaff(pool: pg.Pool, req: IncomingMessage) {
  const token = parseCookies(req)[ADMIN_COOKIE] ?? '';
  const session = await resolveStaffSession(pool, token);
  if (!session) throw new HttpError(401, 'Authentication required.');
  return session;
}

export type AdminTheoryExamsApiOptions = { publicOrigin?: string };

export function createAdminTheoryExamsApiHandler(pool: pg.Pool, options: AdminTheoryExamsApiOptions = {}) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://centro.local');
    if (!url.pathname.startsWith('/api/admin/theory-exams')) return false;

    try {
      if (req.method !== 'GET') assertOrigin(req, options.publicOrigin);
      const staff = await requireStaff(pool, req);

      if (req.method === 'GET' && url.pathname === '/api/admin/theory-exams') {
        const enrollmentId = url.searchParams.get('enrollmentId') ?? '';
        if (!enrollmentId) throw new HttpError(400, 'enrollmentId is required.');
        sendJson(res, 200, { attempts: await listTheoryExamAttempts(pool, enrollmentId) });
        return true;
      }

      if (req.method === 'POST' && url.pathname === '/api/admin/theory-exams') {
        const body = await readJson<{
          enrollmentId?: string;
          scheduledFor?: string;
          bookingSource?: string;
          protocol?: string | null;
        }>(req);
        const attempt = await createTheoryExamAttempt(pool, {
          enrollmentId: body.enrollmentId ?? '',
          scheduledFor: body.scheduledFor ?? '',
          bookingSource: body.bookingSource,
          protocol: body.protocol ?? null,
          actorStaffUserId: staff.staffUserId,
        });
        sendJson(res, 201, { attempt });
        return true;
      }

      if (req.method === 'GET') {
        const detailMatch = url.pathname.match(new RegExp(`^/api/admin/theory-exams/(${UUID_PATH})$`));
        if (detailMatch) {
          const attempt = await getTheoryExamAttempt(pool, detailMatch[1]);
          if (!attempt) throw new HttpError(404, 'Tentativa de prova teórica não encontrada.');
          sendJson(res, 200, { attempt });
          return true;
        }
      }

      if (req.method === 'POST') {
        const rescheduleMatch = url.pathname.match(new RegExp(`^/api/admin/theory-exams/(${UUID_PATH})/reschedule$`));
        if (rescheduleMatch) {
          const body = await readJson<{ scheduledFor?: string; protocol?: string | null }>(req);
          const attempt = await rescheduleTheoryExamAttempt(pool, {
            attemptId: rescheduleMatch[1],
            scheduledFor: body.scheduledFor ?? '',
            protocol: body.protocol ?? null,
            actorStaffUserId: staff.staffUserId,
          });
          sendJson(res, 200, { attempt });
          return true;
        }

        const attendanceMatch = url.pathname.match(new RegExp(`^/api/admin/theory-exams/(${UUID_PATH})/attendance$`));
        if (attendanceMatch) {
          const body = await readJson<{ attendanceStatus?: string }>(req);
          const attempt = await recordTheoryExamAttendance(pool, {
            attemptId: attendanceMatch[1],
            attendanceStatus: body.attendanceStatus ?? '',
            actorStaffUserId: staff.staffUserId,
          });
          sendJson(res, 200, { attempt });
          return true;
        }

        const observedMatch = url.pathname.match(new RegExp(`^/api/admin/theory-exams/(${UUID_PATH})/observed-result$`));
        if (observedMatch) {
          const body = await readJson<{ result?: string }>(req);
          const attempt = await recordTheoryExamObservedResult(pool, {
            attemptId: observedMatch[1],
            result: body.result ?? '',
            actorStaffUserId: staff.staffUserId,
          });
          sendJson(res, 200, { attempt });
          return true;
        }

        const officialMatch = url.pathname.match(new RegExp(`^/api/admin/theory-exams/(${UUID_PATH})/official-result$`));
        if (officialMatch) {
          const body = await readJson<{ result?: string }>(req);
          const attempt = await reconcileTheoryExamOfficialResult(pool, {
            attemptId: officialMatch[1],
            result: body.result ?? '',
            actorStaffUserId: staff.staffUserId,
          });
          sendJson(res, 200, { attempt });
          return true;
        }
      }

      sendJson(res, 404, { error: 'Not found.' });
      return true;
    } catch (error) {
      if (error instanceof HttpError) { sendJson(res, error.status, { error: error.message }); return true; }
      if (error instanceof TheoryExamInputError) { sendJson(res, 400, { error: error.message }); return true; }
      if (error instanceof TheoryExamConflictError) { sendJson(res, 409, { error: error.message }); return true; }
      const candidate = error as { code?: string; constraint?: string; message?: string };
      if (candidate.code === '23514' || candidate.code === '23505') {
        sendJson(res, 409, { error: candidate.message ?? 'A operação foi rejeitada pelo kernel da prova teórica.' });
        return true;
      }
      if (candidate.code === '22P02') { sendJson(res, 400, { error: 'Identificador inválido.' }); return true; }
      console.error('[centro-admin-theory-exams-api] request failed', candidate.code ?? candidate.message ?? error);
      sendJson(res, 500, { error: 'Internal server error.' });
      return true;
    }
  };
}
