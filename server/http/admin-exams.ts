import type { IncomingMessage, ServerResponse } from 'node:http';
import type pg from 'pg';
import {
  addPracticalExamCandidate,
  createPracticalExamSession,
  ExamConflictError,
  ExamInputError,
  getExamOptions,
  getPracticalExamSession,
  listPracticalExamSessions,
  reconcilePracticalExamOfficialResult,
  recordPracticalExamAttendance,
  recordPracticalExamObservedResult,
  removePracticalExamCandidate,
  setPracticalExamSessionStatus,
  updatePracticalExamCandidateDetails,
} from '../exams/admin.js';
import { resolveStaffSession } from '../staff/auth.js';

const ADMIN_COOKIE = 'centro_admin_session';
const MAX_BODY_BYTES = 64 * 1024;
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
  const token = parseCookies(req)[ADMIN_COOKIE] ?? '';
  const session = await resolveStaffSession(pool, token);
  if (!session) throw new HttpError(401, 'Authentication required.');
  return session;
}

function conflictMessage(constraint?: string): string {
  switch (constraint) {
    case 'practical_exam_sessions_no_instructor_overlap':
      return 'O instrutor já está comprometido com outra lista de exame nesse período.';
    case 'practical_exam_sessions_no_vehicle_overlap':
      return 'O veículo já está comprometido com outra lista de exame nesse período.';
    case 'practical_exam_session_instructor_authorized':
      return 'O instrutor não está ativo ou não é autorizado para a categoria.';
    case 'practical_exam_session_vehicle_compatible':
      return 'O veículo não está ativo ou não pertence à categoria da lista.';
    case 'practical_exam_session_instructor_lesson_conflict':
      return 'O instrutor possui aula marcada durante esta lista de exame.';
    case 'practical_exam_session_vehicle_lesson_conflict':
      return 'O veículo possui aula marcada durante esta lista de exame.';
    case 'practical_exam_candidate_open_session_required':
      return 'A lista não está aberta para receber alunos.';
    case 'practical_exam_candidate_inside_session_window':
      return 'O horário oficial do aluno precisa estar dentro da janela da lista.';
    case 'practical_exam_candidate_active_enrollment_required':
      return 'O aluno e a matrícula precisam estar ativos.';
    case 'practical_exam_candidate_category_compatible':
      return 'A categoria da matrícula não é compatível com esta lista.';
    case 'practical_exam_candidate_practice_done_required':
      return 'Na primeira habilitação, a preparação prática precisa estar concluída antes do exame.';
    case 'practical_exam_candidate_not_already_approved':
      return 'Este aluno já possui aprovação prática confirmada.';
    case 'practical_exam_candidate_student_lesson_conflict':
      return 'O aluno possui uma aula no horário oficial do exame.';
    case 'practical_exam_candidate_single_open_roster':
      return 'Esta matrícula já pertence a outra lista de exame aberta.';
    case 'practical_exam_candidates_session_id_enrollment_id_key':
      return 'Este aluno já está nesta lista de exame.';
    default:
      return 'A operação foi rejeitada por uma regra operacional de exames.';
  }
}

export type AdminExamsApiOptions = {
  publicOrigin?: string;
};

export function createAdminExamsApiHandler(pool: pg.Pool, options: AdminExamsApiOptions = {}) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://centro.local');
    if (!url.pathname.startsWith('/api/admin/exams')) return false;

    try {
      if (req.method !== 'GET') assertOrigin(req, options.publicOrigin);
      const staff = await requireStaff(pool, req);

      if (req.method === 'GET' && url.pathname === '/api/admin/exams/options') {
        sendJson(res, 200, await getExamOptions(pool));
        return true;
      }

      if (req.method === 'GET' && url.pathname === '/api/admin/exams') {
        const now = new Date();
        const defaultTo = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
        const sessions = await listPracticalExamSessions(pool, {
          from: url.searchParams.get('from') || now,
          to: url.searchParams.get('to') || defaultTo,
        });
        sendJson(res, 200, { sessions });
        return true;
      }

      if (req.method === 'POST' && url.pathname === '/api/admin/exams') {
        const body = await readJson<{
          category?: string;
          locationLabel?: string;
          startsAt?: string;
          endsAt?: string;
          instructorId?: string;
          vehicleId?: string;
          notes?: string | null;
        }>(req);
        const session = await createPracticalExamSession(pool, {
          category: body.category ?? '',
          locationLabel: body.locationLabel ?? '',
          startsAt: body.startsAt ?? '',
          endsAt: body.endsAt ?? '',
          instructorId: body.instructorId ?? '',
          vehicleId: body.vehicleId ?? '',
          notes: body.notes ?? null,
          actorStaffUserId: staff.staffUserId,
        });
        sendJson(res, 201, { session });
        return true;
      }

      if (req.method === 'GET') {
        const detailMatch = url.pathname.match(new RegExp(`^/api/admin/exams/(${UUID_PATH})$`));
        if (detailMatch) {
          const session = await getPracticalExamSession(pool, detailMatch[1]);
          if (!session) throw new HttpError(404, 'Lista de exame não encontrada.');
          sendJson(res, 200, { session });
          return true;
        }
      }

      if (req.method === 'POST') {
        const candidateAddMatch = url.pathname.match(new RegExp(`^/api/admin/exams/(${UUID_PATH})/candidates$`));
        if (candidateAddMatch) {
          const body = await readJson<{
            enrollmentId?: string;
            officialScheduledFor?: string;
            bookingSource?: string;
            protocol?: string | null;
            renach?: string | null;
            feeStatus?: string;
            ladvStatus?: string;
          }>(req);
          const session = await addPracticalExamCandidate(pool, {
            sessionId: candidateAddMatch[1],
            enrollmentId: body.enrollmentId ?? '',
            officialScheduledFor: body.officialScheduledFor ?? '',
            bookingSource: body.bookingSource ?? 'SCHOOL',
            protocol: body.protocol ?? null,
            renach: body.renach ?? null,
            feeStatus: body.feeStatus ?? 'UNKNOWN',
            ladvStatus: body.ladvStatus ?? 'UNKNOWN',
            actorStaffUserId: staff.staffUserId,
          });
          sendJson(res, 201, { session });
          return true;
        }

        const detailsMatch = url.pathname.match(new RegExp(`^/api/admin/exams/(${UUID_PATH})/candidates/(${UUID_PATH})/details$`));
        if (detailsMatch) {
          const body = await readJson<{
            officialScheduledFor?: string;
            bookingSource?: string;
            protocol?: string | null;
            renach?: string | null;
            feeStatus?: string;
            ladvStatus?: string;
          }>(req);
          const session = await updatePracticalExamCandidateDetails(pool, {
            sessionId: detailsMatch[1],
            candidateId: detailsMatch[2],
            officialScheduledFor: body.officialScheduledFor ?? '',
            bookingSource: body.bookingSource ?? '',
            protocol: body.protocol ?? null,
            renach: body.renach ?? null,
            feeStatus: body.feeStatus ?? '',
            ladvStatus: body.ladvStatus ?? '',
            actorStaffUserId: staff.staffUserId,
          });
          sendJson(res, 200, { session });
          return true;
        }

        const attendanceMatch = url.pathname.match(new RegExp(`^/api/admin/exams/(${UUID_PATH})/candidates/(${UUID_PATH})/attendance$`));
        if (attendanceMatch) {
          const body = await readJson<{ attendanceStatus?: string }>(req);
          const session = await recordPracticalExamAttendance(pool, {
            sessionId: attendanceMatch[1],
            candidateId: attendanceMatch[2],
            attendanceStatus: body.attendanceStatus ?? '',
            actorStaffUserId: staff.staffUserId,
          });
          sendJson(res, 200, { session });
          return true;
        }

        const observedMatch = url.pathname.match(new RegExp(`^/api/admin/exams/(${UUID_PATH})/candidates/(${UUID_PATH})/observed-result$`));
        if (observedMatch) {
          const body = await readJson<{ result?: string }>(req);
          const session = await recordPracticalExamObservedResult(pool, {
            sessionId: observedMatch[1],
            candidateId: observedMatch[2],
            result: body.result ?? '',
            actorStaffUserId: staff.staffUserId,
          });
          sendJson(res, 200, { session });
          return true;
        }

        const reconcileMatch = url.pathname.match(new RegExp(`^/api/admin/exams/(${UUID_PATH})/candidates/(${UUID_PATH})/official-result$`));
        if (reconcileMatch) {
          const body = await readJson<{ result?: string }>(req);
          const session = await reconcilePracticalExamOfficialResult(pool, {
            sessionId: reconcileMatch[1],
            candidateId: reconcileMatch[2],
            result: body.result ?? '',
            actorStaffUserId: staff.staffUserId,
          });
          sendJson(res, 200, { session });
          return true;
        }

        const statusMatch = url.pathname.match(new RegExp(`^/api/admin/exams/(${UUID_PATH})/status$`));
        if (statusMatch) {
          const body = await readJson<{ status?: string }>(req);
          const session = await setPracticalExamSessionStatus(pool, {
            sessionId: statusMatch[1],
            status: body.status ?? '',
            actorStaffUserId: staff.staffUserId,
          });
          sendJson(res, 200, { session });
          return true;
        }
      }

      if (req.method === 'DELETE') {
        const removeMatch = url.pathname.match(new RegExp(`^/api/admin/exams/(${UUID_PATH})/candidates/(${UUID_PATH})$`));
        if (removeMatch) {
          const session = await removePracticalExamCandidate(pool, {
            sessionId: removeMatch[1],
            candidateId: removeMatch[2],
            actorStaffUserId: staff.staffUserId,
          });
          sendJson(res, 200, { session });
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
      if (error instanceof ExamInputError) {
        sendJson(res, 400, { error: error.message });
        return true;
      }
      if (error instanceof ExamConflictError) {
        sendJson(res, 409, { error: error.message });
        return true;
      }

      const candidate = error as { code?: string; constraint?: string; message?: string };
      if (candidate.code === '23P01' || candidate.code === '23514' || candidate.code === '23505') {
        sendJson(res, 409, { error: conflictMessage(candidate.constraint) });
        return true;
      }
      if (candidate.code === '22P02') {
        sendJson(res, 400, { error: 'Identificador inválido.' });
        return true;
      }

      console.error('[centro-admin-exams-api] request failed', candidate.code ?? candidate.message ?? error);
      sendJson(res, 500, { error: 'Internal server error.' });
      return true;
    }
  };
}
