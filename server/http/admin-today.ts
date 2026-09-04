import type { IncomingMessage, ServerResponse } from 'node:http';
import type pg from 'pg';
import { projectAdminToday } from '../admin/today.js';
import { resolveStaffSession } from '../staff/auth.js';

const ADMIN_COOKIE = 'centro_admin_session';

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

async function requireStaff(pool: pg.Pool, req: IncomingMessage) {
  const token = parseCookies(req)[ADMIN_COOKIE] ?? '';
  const session = await resolveStaffSession(pool, token);
  if (!session) return null;
  return session;
}

function payloadDate(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function createAdminTodayApiHandler(pool: pg.Pool) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://centro.local');
    if (!url.pathname.startsWith('/api/admin/today')) return false;

    if (req.method !== 'GET' || url.pathname !== '/api/admin/today') {
      sendJson(res, 404, { error: 'Not found.' });
      return true;
    }

    const session = await requireStaff(pool, req);
    if (!session) {
      sendJson(res, 401, { error: 'Authentication required.' });
      return true;
    }

    try {
      const projection = await projectAdminToday(pool);
      sendJson(res, 200, {
        timezone: projection.timezone,
        generatedAt: projection.generatedAt.toISOString(),
        summary: projection.summary,
        lessons: projection.lessons.map((lesson) => ({
          ...lesson,
          startsAt: lesson.startsAt.toISOString(),
          endsAt: lesson.endsAt.toISOString(),
        })),
        upcomingExams: projection.upcomingExams.map((exam) => ({
          ...exam,
          scheduledFor: exam.scheduledFor.toISOString(),
        })),
        withoutNextLesson: projection.withoutNextLesson.map((item) => ({
          ...item,
          openedAt: item.openedAt.toISOString(),
        })),
        pendingFirstAccess: projection.pendingFirstAccess,
        withoutGuide: projection.withoutGuide.map((item) => ({
          ...item,
          openedAt: item.openedAt.toISOString(),
        })),
        recentNoShows: projection.recentNoShows.map((item) => ({
          ...item,
          startsAt: payloadDate(item.startsAt),
        })),
      });
      return true;
    } catch (error) {
      console.error('[centro-admin-today-api] request failed', error instanceof Error ? error.message : error);
      sendJson(res, 500, { error: 'Internal server error.' });
      return true;
    }
  };
}
