import type { IncomingMessage, ServerResponse } from 'node:http';
import type pg from 'pg';
import { getAdminStudentWorkspace, listAdminStudents } from '../admin/students.js';
import { materializeEnrollment } from '../enrollments/materialize.js';
import {
  createScheduleInstructor,
  createScheduleLesson,
  createScheduleVehicle,
  getScheduleOptions,
  listScheduleLessons,
  replaceSchedulePolicy,
  rescheduleLesson,
  resolveLesson,
  ScheduleInputError,
} from '../schedule/admin.js';
import {
  authenticateStaff,
  resolveStaffSession,
  revokeStaffSession,
  type StaffSession,
} from '../staff/auth.js';

const SESSION_COOKIE = 'centro_admin_session';
const MAX_BODY_BYTES = 64 * 1024;
const UUID_PATH = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}';

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

async function requireStaff(pool: pg.Pool, req: IncomingMessage): Promise<{ token: string; session: StaffSession }> {
  const token = parseCookies(req)[SESSION_COOKIE] ?? '';
  const session = await resolveStaffSession(pool, token);
  if (!session) throw new HttpError(401, 'Authentication required.');
  return { token, session };
}

function scheduleConflictMessage(constraint?: string): string {
  switch (constraint) {
    case 'lessons_no_student_overlap': return 'Conflito de agenda: o aluno já possui uma aula nesse horário.';
    case 'lessons_no_instructor_overlap': return 'Conflito de agenda: o instrutor já está ocupado nesse horário.';
    case 'lessons_no_vehicle_overlap': return 'Conflito de agenda: o veículo já está ocupado nesse horário.';
    case 'lessons_active_student_enrollment_required': return 'A aula exige aluno e matrícula ativos.';
    case 'lessons_enrollment_category_compatible': return 'A categoria da aula não é compatível com a matrícula.';
    case 'lessons_instructor_category_authorized': return 'O instrutor não está ativo ou autorizado para esta categoria.';
    case 'lessons_vehicle_category_compatible': return 'O veículo não está ativo ou não pertence à categoria da aula.';
    case 'vehicles_plate_unique_ci': return 'Já existe um veículo com esta placa.';
    default: return 'A agenda rejeitou a operação por uma regra operacional.';
  }
}

export type AdminApiOptions = {
  publicOrigin?: string;
  secureCookies?: boolean;
};

export function createAdminApiHandler(pool: pg.Pool, options: AdminApiOptions = {}) {
  const secureCookies = options.secureCookies ?? process.env.NODE_ENV === 'production';

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://centro.local');
    if (!url.pathname.startsWith('/api/admin/')) return false;

    try {
      if (req.method === 'POST') assertOrigin(req, options.publicOrigin);

      if (req.method === 'POST' && url.pathname === '/api/admin/auth/login') {
        const body = await readJson<{ username?: string; password?: string }>(req);
        const auth = await authenticateStaff(pool, body.username ?? '', body.password ?? '');
        if (!auth) throw new HttpError(401, 'Invalid credentials.');
        setSessionCookie(res, auth.token, secureCookies);
        sendJson(res, 200, {
          staff: {
            id: auth.session.staffUserId,
            username: auth.session.username,
            displayName: auth.session.displayName,
            role: auth.session.role,
          },
          expiresAt: auth.session.expiresAt.toISOString(),
        });
        return true;
      }

      if (req.method === 'GET' && url.pathname === '/api/admin/auth/session') {
        const { session } = await requireStaff(pool, req);
        sendJson(res, 200, {
          staff: {
            id: session.staffUserId,
            username: session.username,
            displayName: session.displayName,
            role: session.role,
          },
          expiresAt: session.expiresAt.toISOString(),
        });
        return true;
      }

      if (req.method === 'POST' && url.pathname === '/api/admin/auth/logout') {
        const { token, session } = await requireStaff(pool, req);
        await revokeStaffSession(pool, token, session.staffUserId);
        clearSessionCookie(res, secureCookies);
        res.statusCode = 204;
        res.setHeader('Cache-Control', 'no-store');
        res.end();
        return true;
      }

      if (req.method === 'GET' && url.pathname === '/api/admin/students') {
        await requireStaff(pool, req);
        const rawLimit = Number(url.searchParams.get('limit') ?? '50');
        const students = await listAdminStudents(pool, {
          query: url.searchParams.get('q') ?? '',
          limit: Number.isFinite(rawLimit) ? rawLimit : 50,
        });
        sendJson(res, 200, { students });
        return true;
      }

      if (req.method === 'GET') {
        const studentMatch = url.pathname.match(new RegExp(`^/api/admin/students/(${UUID_PATH})$`));
        if (studentMatch) {
          await requireStaff(pool, req);
          const workspace = await getAdminStudentWorkspace(pool, studentMatch[1]);
          if (!workspace) throw new HttpError(404, 'Student not found.');
          sendJson(res, 200, workspace);
          return true;
        }
      }

      if (req.method === 'POST' && url.pathname === '/api/admin/enrollments') {
        const { session } = await requireStaff(pool, req);
        const body = await readJson<{
          fullName?: string;
          phone?: string;
          email?: string | null;
          document?: string;
          birthDate?: string | null;
          serviceType?: string;
          category?: string;
          notes?: string | null;
        }>(req);

        const receipt = await materializeEnrollment(pool, {
          fullName: body.fullName ?? '',
          phone: body.phone ?? '',
          email: body.email ?? null,
          document: body.document ?? '',
          birthDate: body.birthDate ?? null,
          serviceType: body.serviceType as never,
          category: body.category as never,
          notes: body.notes ?? null,
          actorStaffUserId: session.staffUserId,
        });

        sendJson(res, 201, {
          student: {
            id: receipt.studentId,
            publicId: receipt.studentPublicId,
          },
          enrollment: {
            id: receipt.enrollmentId,
            serviceType: receipt.serviceType,
            category: receipt.category,
          },
          credential: {
            created: receipt.credentialCreated,
            initialPassword: receipt.initialPassword,
            mustChangePassword: receipt.credentialCreated,
          },
        });
        return true;
      }

      if (req.method === 'GET' && url.pathname === '/api/admin/schedule/options') {
        await requireStaff(pool, req);
        sendJson(res, 200, await getScheduleOptions(pool));
        return true;
      }

      if (req.method === 'GET' && url.pathname === '/api/admin/schedule/lessons') {
        await requireStaff(pool, req);
        const from = url.searchParams.get('from') ?? '';
        const to = url.searchParams.get('to') ?? '';
        const lessons = await listScheduleLessons(pool, {
          from,
          to,
          instructorId: url.searchParams.get('instructorId') ?? undefined,
          vehicleId: url.searchParams.get('vehicleId') ?? undefined,
        });
        sendJson(res, 200, { lessons });
        return true;
      }

      if (req.method === 'POST' && url.pathname === '/api/admin/schedule/instructors') {
        const { session } = await requireStaff(pool, req);
        const body = await readJson<{ displayName?: string; categories?: string[] }>(req);
        const instructor = await createScheduleInstructor(pool, {
          displayName: body.displayName ?? '',
          categories: Array.isArray(body.categories) ? body.categories : [],
          actorStaffUserId: session.staffUserId,
        });
        sendJson(res, 201, { instructor });
        return true;
      }

      if (req.method === 'POST' && url.pathname === '/api/admin/schedule/vehicles') {
        const { session } = await requireStaff(pool, req);
        const body = await readJson<{ plate?: string; label?: string; category?: string }>(req);
        const vehicle = await createScheduleVehicle(pool, {
          plate: body.plate ?? '',
          label: body.label ?? '',
          category: body.category ?? '',
          actorStaffUserId: session.staffUserId,
        });
        sendJson(res, 201, { vehicle });
        return true;
      }

      if (req.method === 'POST' && url.pathname === '/api/admin/schedule/policy') {
        const { session } = await requireStaff(pool, req);
        const body = await readJson<{
          name?: string;
          timezone?: string;
          slotMinutes?: number;
          lessonMinMinutes?: number;
          lessonMaxMinutes?: number;
        }>(req);
        const policy = await replaceSchedulePolicy(pool, {
          name: body.name ?? '',
          timezone: body.timezone,
          slotMinutes: Number(body.slotMinutes),
          lessonMinMinutes: Number(body.lessonMinMinutes),
          lessonMaxMinutes: Number(body.lessonMaxMinutes),
          actorStaffUserId: session.staffUserId,
        });
        sendJson(res, 201, { policy });
        return true;
      }

      if (req.method === 'POST' && url.pathname === '/api/admin/schedule/lessons') {
        const { session } = await requireStaff(pool, req);
        const body = await readJson<{
          enrollmentId?: string;
          studentId?: string;
          instructorId?: string;
          vehicleId?: string;
          category?: string;
          startsAt?: string;
          endsAt?: string;
          notes?: string | null;
        }>(req);
        const lesson = await createScheduleLesson(pool, {
          enrollmentId: body.enrollmentId ?? '',
          studentId: body.studentId ?? '',
          instructorId: body.instructorId ?? '',
          vehicleId: body.vehicleId ?? '',
          category: body.category ?? '',
          startsAt: body.startsAt ?? '',
          endsAt: body.endsAt ?? '',
          notes: body.notes ?? null,
          actorStaffUserId: session.staffUserId,
        });
        sendJson(res, 201, { lesson });
        return true;
      }

      if (req.method === 'POST') {
        const rescheduleMatch = url.pathname.match(new RegExp(`^/api/admin/schedule/lessons/(${UUID_PATH})/reschedule$`));
        if (rescheduleMatch) {
          const { session } = await requireStaff(pool, req);
          const body = await readJson<{
            instructorId?: string;
            vehicleId?: string;
            category?: string;
            startsAt?: string;
            endsAt?: string;
            notes?: string | null;
          }>(req);
          await rescheduleLesson(pool, rescheduleMatch[1], {
            instructorId: body.instructorId ?? '',
            vehicleId: body.vehicleId ?? '',
            category: body.category ?? '',
            startsAt: body.startsAt ?? '',
            endsAt: body.endsAt ?? '',
            notes: body.notes ?? null,
            actorStaffUserId: session.staffUserId,
          });
          res.statusCode = 204;
          res.setHeader('Cache-Control', 'no-store');
          res.end();
          return true;
        }

        const resolveMatch = url.pathname.match(new RegExp(`^/api/admin/schedule/lessons/(${UUID_PATH})/resolve$`));
        if (resolveMatch) {
          const { session } = await requireStaff(pool, req);
          const body = await readJson<{ status?: string; notes?: string | null }>(req);
          await resolveLesson(pool, resolveMatch[1], {
            status: body.status ?? '',
            notes: body.notes ?? null,
            actorStaffUserId: session.staffUserId,
          });
          res.statusCode = 204;
          res.setHeader('Cache-Control', 'no-store');
          res.end();
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
      if (error instanceof ScheduleInputError) {
        sendJson(res, 400, { error: error.message });
        return true;
      }

      const candidate = error as { code?: string; constraint?: string; message?: string };
      if (candidate.code === '23P01') {
        sendJson(res, 409, { error: scheduleConflictMessage(candidate.constraint) });
        return true;
      }
      if ((candidate.code === '23514' && candidate.constraint?.startsWith('lessons_'))
          || (candidate.code === '23505' && candidate.constraint === 'vehicles_plate_unique_ci')) {
        sendJson(res, 409, { error: scheduleConflictMessage(candidate.constraint) });
        return true;
      }
      if (candidate.code === '23514' || candidate.code === '23505') {
        sendJson(res, 409, { error: 'Enrollment data conflicts with an operational rule.' });
        return true;
      }

      if (candidate.message?.endsWith('is required.') || candidate.message?.endsWith('is invalid.') || candidate.message?.includes('cannot be materialized')) {
        sendJson(res, 400, { error: candidate.message });
        return true;
      }

      console.error('[centro-admin-api] request failed', candidate.code ?? candidate.message ?? error);
      sendJson(res, 500, { error: 'Internal server error.' });
      return true;
    }
  };
}
