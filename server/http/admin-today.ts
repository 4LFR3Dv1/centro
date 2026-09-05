import type { IncomingMessage, ServerResponse } from 'node:http';
import type pg from 'pg';
import { projectAdminHome } from '../admin/today.js';
import type { SchoolOperationalCommand } from '../admin/student-operations.js';
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
  return resolveStaffSession(pool, token);
}

function serializeCommand(command: SchoolOperationalCommand | null) {
  if (!command) return null;
  if (command.kind === 'MANAGE_THEORY_EXAM') {
    return { ...command, scheduledFor: command.scheduledFor.toISOString() };
  }
  if (command.kind === 'MANAGE_PRACTICAL_EXAM') {
    return { ...command, officialScheduledFor: command.officialScheduledFor.toISOString() };
  }
  return command;
}

function serializeAttention(item: Awaited<ReturnType<typeof projectAdminHome>>['attention']['actionRequired'][number]) {
  return {
    ...item,
    action: {
      ...item.action,
      primaryCommand: serializeCommand(item.action.primaryCommand),
      secondaryCommands: item.action.secondaryCommands.map((command) => serializeCommand(command)),
    },
  };
}

export function createAdminTodayApiHandler(pool: pg.Pool) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://centro.local');
    if (url.pathname !== '/api/admin/home' && url.pathname !== '/api/admin/today') return false;

    if (req.method !== 'GET') {
      sendJson(res, 404, { error: 'Not found.' });
      return true;
    }

    const session = await requireStaff(pool, req);
    if (!session) {
      sendJson(res, 401, { error: 'Authentication required.' });
      return true;
    }

    try {
      const projection = await projectAdminHome(pool);
      sendJson(res, 200, {
        version: projection.version,
        timezone: projection.timezone,
        generatedAt: projection.generatedAt.toISOString(),
        summary: projection.summary,
        now: projection.now.map((event) => ({
          ...event,
          startsAt: event.startsAt.toISOString(),
          endsAt: event.endsAt?.toISOString() ?? null,
        })),
        upcoming: projection.upcoming.map((event) => ({
          ...event,
          startsAt: event.startsAt.toISOString(),
          endsAt: event.endsAt?.toISOString() ?? null,
        })),
        attention: {
          blocking: projection.attention.blocking.map(serializeAttention),
          actionRequired: projection.attention.actionRequired.map(serializeAttention),
          waiting: projection.attention.waiting.map(serializeAttention),
        },
        pendingFirstAccess: projection.pendingFirstAccess,
      });
      return true;
    } catch (error) {
      console.error('[centro-admin-home-api] request failed', error instanceof Error ? error.message : error);
      sendJson(res, 500, { error: 'Internal server error.' });
      return true;
    }
  };
}
