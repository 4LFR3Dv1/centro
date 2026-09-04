import type { IncomingMessage, ServerResponse } from 'node:http';
import type pg from 'pg';
import {
  generateStudentGuide,
  getStudentGuide,
  listStudentGuides,
  previewStudentGuide,
  StudentGuideInputError,
  type StudentGuideRecord,
} from '../guides/student-guide.js';
import { resolveStaffSession } from '../staff/auth.js';
import { resolveStudentSession } from '../student/auth.js';

const ADMIN_COOKIE = 'centro_admin_session';
const STUDENT_COOKIE = 'centro_student_session';
const MAX_BODY_BYTES = 32 * 1024;
const UUID_PATH = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}';

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
  const session = await resolveStaffSession(pool, parseCookies(req)[ADMIN_COOKIE] ?? '');
  if (!session) throw new HttpError(401, 'Authentication required.');
  return session;
}

async function requireStudent(pool: pg.Pool, req: IncomingMessage) {
  const session = await resolveStudentSession(pool, parseCookies(req)[STUDENT_COOKIE] ?? '');
  if (!session) throw new HttpError(401, 'Authentication required.');
  if (session.mustChangePassword) {
    throw new HttpError(403, 'Troque a senha inicial antes de acessar seus guias.');
  }
  return session;
}

function guidePayload(guide: StudentGuideRecord) {
  return {
    id: guide.id,
    studentId: guide.studentId,
    enrollmentId: guide.enrollmentId,
    template: {
      id: guide.templateId,
      version: guide.templateVersion,
    },
    contentSha256: guide.contentSha256,
    generatedAt: guide.generatedAt.toISOString(),
    snapshot: guide.snapshot,
  };
}

export type StudentGuideApiOptions = {
  publicOrigin?: string;
};

export function createStudentGuideApiHandler(pool: pg.Pool, options: StudentGuideApiOptions = {}) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://centro.local');
    const admin = url.pathname.startsWith('/api/admin/guides');
    const student = url.pathname.startsWith('/api/student/guides');
    if (!admin && !student) return false;

    try {
      if (req.method === 'POST') assertOrigin(req, options.publicOrigin);

      if (req.method === 'GET' && url.pathname === '/api/admin/guides/preview') {
        await requireStaff(pool, req);
        const studentId = url.searchParams.get('studentId')?.trim() ?? '';
        const enrollmentId = url.searchParams.get('enrollmentId')?.trim() ?? '';
        if (!studentId || !enrollmentId) throw new HttpError(400, 'studentId e enrollmentId são obrigatórios.');
        sendJson(res, 200, await previewStudentGuide(pool, { studentId, enrollmentId }));
        return true;
      }

      if (req.method === 'GET' && url.pathname === '/api/admin/guides') {
        await requireStaff(pool, req);
        const studentId = url.searchParams.get('studentId')?.trim() ?? '';
        if (!studentId) throw new HttpError(400, 'studentId é obrigatório.');
        const guides = await listStudentGuides(pool, studentId);
        sendJson(res, 200, { guides: guides.map(guidePayload) });
        return true;
      }

      if (req.method === 'POST' && url.pathname === '/api/admin/guides') {
        const session = await requireStaff(pool, req);
        const body = await readJson<{ studentId?: string; enrollmentId?: string }>(req);
        const studentId = body.studentId?.trim() ?? '';
        const enrollmentId = body.enrollmentId?.trim() ?? '';
        if (!studentId || !enrollmentId) throw new HttpError(400, 'studentId e enrollmentId são obrigatórios.');
        const guide = await generateStudentGuide(pool, {
          studentId,
          enrollmentId,
          actorStaffUserId: session.staffUserId,
        });
        sendJson(res, 201, {
          receipt: {
            guideId: guide.id,
            templateId: guide.templateId,
            templateVersion: guide.templateVersion,
            contentSha256: guide.contentSha256,
            generatedAt: guide.generatedAt.toISOString(),
          },
          guide: guidePayload(guide),
        });
        return true;
      }

      if (req.method === 'GET') {
        const adminDetail = url.pathname.match(new RegExp(`^/api/admin/guides/(${UUID_PATH})$`));
        if (adminDetail) {
          await requireStaff(pool, req);
          const guide = await getStudentGuide(pool, adminDetail[1]);
          if (!guide) throw new HttpError(404, 'Guia não encontrado.');
          sendJson(res, 200, { guide: guidePayload(guide) });
          return true;
        }
      }

      if (req.method === 'GET' && url.pathname === '/api/student/guides') {
        const session = await requireStudent(pool, req);
        const guides = await listStudentGuides(pool, session.studentId);
        sendJson(res, 200, { guides: guides.map(guidePayload) });
        return true;
      }

      if (req.method === 'GET') {
        const studentDetail = url.pathname.match(new RegExp(`^/api/student/guides/(${UUID_PATH})$`));
        if (studentDetail) {
          const session = await requireStudent(pool, req);
          const guide = await getStudentGuide(pool, studentDetail[1], session.studentId);
          if (!guide) throw new HttpError(404, 'Guia não encontrado.');
          sendJson(res, 200, { guide: guidePayload(guide) });
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
      if (error instanceof StudentGuideInputError) {
        sendJson(res, 400, { error: error.message });
        return true;
      }

      const candidate = error as { code?: string; message?: string };
      if (candidate.code === '23503' || candidate.code === '23514') {
        sendJson(res, 409, { error: 'O guia não pode ser gerado a partir desse estado institucional.' });
        return true;
      }
      console.error('[centro-student-guide-api] request failed', candidate.code ?? candidate.message ?? error);
      sendJson(res, 500, { error: 'Internal server error.' });
      return true;
    }
  };
}
