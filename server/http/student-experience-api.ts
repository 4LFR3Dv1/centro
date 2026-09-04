import type { IncomingMessage, ServerResponse } from 'node:http';
import type pg from 'pg';
import { getStudentCalendar, getStudentCalendarRange, type StudentCalendarEvent, type StudentLessonView } from '../student/calendar.js';
import { getStudentExam, listStudentExams, type StudentExamView } from '../student/exams.js';
import { getStudentHome } from '../student/home.js';
import { resolveStudentSession, type StudentSession } from '../student/auth.js';
import {
  changeOwnStudentPassword,
  getStudentSecuritySnapshot,
  revokeOtherStudentSessions,
  StudentSecurityInputError,
} from '../student/security.js';

const SESSION_COOKIE = 'centro_student_session';
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

async function requireStudent(pool: pg.Pool, req: IncomingMessage): Promise<StudentSession> {
  const token = parseCookies(req)[SESSION_COOKIE] ?? '';
  const session = await resolveStudentSession(pool, token);
  if (!session) throw new HttpError(401, 'Authentication required.');
  if (session.mustChangePassword) throw new HttpError(403, 'Troque a senha inicial antes de continuar.');
  return session;
}

function parseRange(url: URL): { from: Date; to: Date } {
  const now = new Date();
  const from = url.searchParams.get('from') ? new Date(url.searchParams.get('from')!) : new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  const to = url.searchParams.get('to') ? new Date(url.searchParams.get('to')!) : new Date(now.getTime() + 120 * 24 * 60 * 60 * 1000);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from) {
    throw new HttpError(400, 'Invalid calendar range.');
  }
  if (to.getTime() - from.getTime() > 370 * 24 * 60 * 60 * 1000) {
    throw new HttpError(400, 'Calendar range is too large.');
  }
  return { from, to };
}

function lessonPayload(lesson: StudentLessonView) {
  return {
    id: lesson.id,
    enrollmentId: lesson.enrollmentId,
    category: lesson.category,
    startsAt: lesson.startsAt.toISOString(),
    endsAt: lesson.endsAt.toISOString(),
    status: lesson.status,
    instructorName: lesson.instructorName,
    vehicleLabel: lesson.vehicleLabel,
    notes: lesson.notes,
  };
}

function calendarEventPayload(event: StudentCalendarEvent) {
  return {
    ...event,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
  };
}

function examPayload(exam: StudentExamView) {
  return {
    ...exam,
    sessionStartsAt: exam.sessionStartsAt.toISOString(),
    sessionEndsAt: exam.sessionEndsAt.toISOString(),
    officialScheduledFor: exam.officialScheduledFor.toISOString(),
    resultReconciledAt: exam.resultReconciledAt?.toISOString() ?? null,
  };
}

function processPayload(process: Awaited<ReturnType<typeof getStudentHome>>['process']) {
  if (!process) return null;
  return {
    ...process,
    enrollment: { ...process.enrollment, openedAt: process.enrollment.openedAt.toISOString() },
    milestones: process.milestones.map((milestone) => ({
      ...milestone,
      achievedAt: milestone.achievedAt?.toISOString() ?? null,
      scheduledFor: milestone.scheduledFor?.toISOString() ?? null,
    })),
    progress: { ...process.progress, nextLessonAt: process.progress.nextLessonAt?.toISOString() ?? null },
  };
}

export type StudentExperienceApiOptions = { publicOrigin?: string };

export function createStudentExperienceApiHandler(pool: pg.Pool, options: StudentExperienceApiOptions = {}) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://centro.local');
    const candidate =
      url.pathname === '/api/student/home' ||
      url.pathname === '/api/student/calendar' ||
      url.pathname === '/api/student/exams' ||
      url.pathname.startsWith('/api/student/exams/') ||
      url.pathname === '/api/student/security' ||
      url.pathname.startsWith('/api/student/security/');
    if (!candidate) return false;

    try {
      if (req.method === 'POST') assertOrigin(req, options.publicOrigin);
      const session = await requireStudent(pool, req);

      if (req.method === 'GET' && url.pathname === '/api/student/home') {
        const home = await getStudentHome(pool, session.studentId);
        sendJson(res, 200, {
          process: processPayload(home.process),
          primaryAction: home.primaryAction ? { ...home.primaryAction, dueAt: home.primaryAction.dueAt?.toISOString() ?? null } : null,
          nextLesson: home.nextLesson ? {
            ...home.nextLesson,
            startsAt: home.nextLesson.startsAt.toISOString(),
            endsAt: home.nextLesson.endsAt.toISOString(),
          } : null,
          nextExam: home.nextExam ? examPayload(home.nextExam) : null,
          lessonSummary: home.lessonSummary,
        });
        return true;
      }

      if (req.method === 'GET' && url.pathname === '/api/student/calendar') {
        const range = parseRange(url);
        const [events, legacy] = await Promise.all([
          getStudentCalendarRange(pool, session.studentId, range),
          getStudentCalendar(pool, session.studentId),
        ]);
        sendJson(res, 200, {
          events: events.map(calendarEventPayload),
          upcoming: legacy.upcoming.map(lessonPayload),
          past: legacy.past.map(lessonPayload),
        });
        return true;
      }

      if (req.method === 'GET' && url.pathname === '/api/student/exams') {
        const exams = await listStudentExams(pool, session.studentId);
        sendJson(res, 200, { exams: exams.map(examPayload) });
        return true;
      }

      if (req.method === 'GET') {
        const match = url.pathname.match(new RegExp(`^/api/student/exams/(${UUID_PATH})$`));
        if (match) {
          const exam = await getStudentExam(pool, session.studentId, match[1]);
          if (!exam) throw new HttpError(404, 'Exame não encontrado.');
          sendJson(res, 200, { exam: examPayload(exam) });
          return true;
        }
      }

      if (req.method === 'GET' && url.pathname === '/api/student/security') {
        const security = await getStudentSecuritySnapshot(pool, session.studentId);
        sendJson(res, 200, {
          ...security,
          credentialUpdatedAt: security.credentialUpdatedAt.toISOString(),
          lockedUntil: security.lockedUntil?.toISOString() ?? null,
          disabledAt: security.disabledAt?.toISOString() ?? null,
          currentSessionId: session.sessionId,
        });
        return true;
      }

      if (req.method === 'POST' && url.pathname === '/api/student/security/password') {
        const body = await readJson<{ currentPassword?: string; newPassword?: string }>(req);
        const result = await changeOwnStudentPassword(pool, {
          studentId: session.studentId,
          currentSessionId: session.sessionId,
          currentPassword: body.currentPassword ?? '',
          newPassword: body.newPassword ?? '',
        });
        sendJson(res, 200, result);
        return true;
      }

      if (req.method === 'POST' && url.pathname === '/api/student/security/sessions/revoke-others') {
        const result = await revokeOtherStudentSessions(pool, {
          studentId: session.studentId,
          currentSessionId: session.sessionId,
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
      if (error instanceof StudentSecurityInputError) {
        sendJson(res, 400, { error: error.message });
        return true;
      }
      console.error('[centro-student-experience-api] request failed', error instanceof Error ? error.message : error);
      sendJson(res, 500, { error: 'Internal server error.' });
      return true;
    }
  };
}
