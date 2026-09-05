import type { IncomingMessage, ServerResponse } from 'node:http';
import type pg from 'pg';
import { resolveStudentOperationalContext } from '../admin/student-operations.js';
import {
  achieveProcessMilestone,
  ProcessConflictError,
  ProcessInputError,
  resolveEnrollmentProcess,
  resolveStudentProcesses,
  revokeProcessMilestone,
  scheduleProcessMilestone,
} from '../process/resolver.js';
import { resolveStaffSession } from '../staff/auth.js';
import { resolveStudentSession } from '../student/auth.js';

const ADMIN_COOKIE = 'centro_admin_session';
const STUDENT_COOKIE = 'centro_student_session';
const MAX_BODY_BYTES = 32 * 1024;
const UUID_PATH = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}';
const CODE_PATH = '[A-Z_]+';

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

async function requireStaff(pool: pg.Pool, req: IncomingMessage) {
  const token = parseCookies(req)[ADMIN_COOKIE] ?? '';
  const session = await resolveStaffSession(pool, token);
  if (!session) throw new HttpError(401, 'Authentication required.');
  return session;
}

async function requireStudent(pool: pg.Pool, req: IncomingMessage) {
  const token = parseCookies(req)[STUDENT_COOKIE] ?? '';
  const session = await resolveStudentSession(pool, token);
  if (!session) throw new HttpError(401, 'Authentication required.');
  if (session.mustChangePassword) {
    throw new HttpError(403, 'Troque a senha inicial antes de acessar seu processo.');
  }
  return session;
}

export type ProcessApiOptions = {
  publicOrigin?: string;
};

export function createProcessApiHandler(pool: pg.Pool, options: ProcessApiOptions = {}) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://centro.local');
    const isAdminProcess = url.pathname.startsWith('/api/admin/process/');
    const isStudentProcess = url.pathname === '/api/student/process';
    if (!isAdminProcess && !isStudentProcess) return false;

    try {
      if (req.method === 'POST') assertOrigin(req, options.publicOrigin);

      if (req.method === 'GET' && url.pathname === '/api/student/process') {
        const session = await requireStudent(pool, req);
        const processes = await resolveStudentProcesses(pool, session.studentId);
        sendJson(res, 200, { processes });
        return true;
      }

      if (req.method === 'GET') {
        const operationsMatch = url.pathname.match(new RegExp(`^/api/admin/process/students/(${UUID_PATH})/operations$`));
        if (operationsMatch) {
          await requireStaff(pool, req);
          const exists = await pool.query('SELECT 1 FROM students WHERE id = $1', [operationsMatch[1]]);
          if (!exists.rowCount) throw new HttpError(404, 'Aluno não encontrado.');
          const operations = await resolveStudentOperationalContext(pool, operationsMatch[1]);
          sendJson(res, 200, { operations });
          return true;
        }

        const match = url.pathname.match(new RegExp(`^/api/admin/process/enrollments/(${UUID_PATH})$`));
        if (match) {
          await requireStaff(pool, req);
          const process = await resolveEnrollmentProcess(pool, match[1]);
          if (!process) throw new HttpError(404, 'Matrícula não encontrada.');
          sendJson(res, 200, { process });
          return true;
        }
      }

      if (req.method === 'POST') {
        const match = url.pathname.match(
          new RegExp(`^/api/admin/process/enrollments/(${UUID_PATH})/milestones/(${CODE_PATH})/(achieve|revoke|schedule)$`),
        );
        if (match) {
          const session = await requireStaff(pool, req);
          const [, enrollmentId, code, action] = match;
          const body = await readJson<{ scheduledFor?: string; note?: string | null }>(req);

          if (action === 'achieve') {
            const process = await achieveProcessMilestone(pool, {
              enrollmentId,
              code,
              actorStaffUserId: session.staffUserId,
              note: body.note ?? null,
            });
            sendJson(res, 200, { process });
            return true;
          }

          if (action === 'revoke') {
            const process = await revokeProcessMilestone(pool, {
              enrollmentId,
              code,
              actorStaffUserId: session.staffUserId,
              note: body.note ?? null,
            });
            sendJson(res, 200, { process });
            return true;
          }

          const process = await scheduleProcessMilestone(pool, {
            enrollmentId,
            code,
            scheduledFor: body.scheduledFor ?? '',
            actorStaffUserId: session.staffUserId,
            note: body.note ?? null,
          });
          sendJson(res, 200, { process });
          return true;
        }
      }

      sendJson(res, 404, { error: 'Not found.' });
      return true;
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(res, error.status, { error: error.message });
        return true;
      }
      if (error instanceof ProcessInputError) {
        sendJson(res, 400, { error: error.message });
        return true;
      }
      if (error instanceof ProcessConflictError) {
        sendJson(res, 409, { error: error.message });
        return true;
      }

      const candidate = error as { code?: string; message?: string };
      if (candidate.code === '23514' || candidate.code === '23505') {
        sendJson(res, 409, { error: 'O estado processual rejeitou a operação por uma regra institucional.' });
        return true;
      }

      console.error('[centro-process-api] request failed', candidate.code ?? candidate.message ?? error);
      sendJson(res, 500, { error: 'Internal server error.' });
      return true;
    }
  };
}
