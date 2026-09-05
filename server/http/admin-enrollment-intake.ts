import type { IncomingMessage, ServerResponse } from 'node:http';
import type pg from 'pg';
import {
  materializeEnrollment,
  type EnrollmentIntakeSituation,
  type IdentityDocumentType,
} from '../enrollments/materialize.js';
import { resolveStaffSession } from '../staff/auth.js';

const SESSION_COOKIE = 'centro_admin_session';
const MAX_BODY_BYTES = 64 * 1024;

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
  const token = parseCookies(req)[SESSION_COOKIE] ?? '';
  const session = await resolveStaffSession(pool, token);
  if (!session) throw new HttpError(401, 'Authentication required.');
  return session;
}

function publicMessage(error: unknown): { status: number; message: string } {
  if (error instanceof HttpError) return { status: error.status, message: error.message };
  if (error && typeof error === 'object' && 'code' in error) {
    const candidate = error as { code?: string; constraint?: string };
    if (candidate.code === '23505') {
      if (candidate.constraint === 'enrollments_one_open_per_service_category') {
        return { status: 409, message: 'Este aluno já possui uma matrícula aberta para o mesmo serviço e categoria.' };
      }
      if (candidate.constraint === 'enrollments_renach_unique') {
        return { status: 409, message: 'Este RENACH já está associado a outra matrícula.' };
      }
      if (candidate.constraint === 'students_cpf_unique') {
        return { status: 409, message: 'Este CPF já pertence a outro aluno.' };
      }
      return { status: 409, message: 'Os dados informados entram em conflito com um cadastro existente.' };
    }
  }
  if (error instanceof Error) return { status: 400, message: error.message };
  return { status: 500, message: 'Não foi possível criar a matrícula.' };
}

export type AdminEnrollmentIntakeOptions = {
  publicOrigin?: string;
};

export function createAdminEnrollmentIntakeApiHandler(
  pool: pg.Pool,
  options: AdminEnrollmentIntakeOptions = {},
) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://centro.local');
    if (url.pathname !== '/api/admin/enrollments') return false;
    if (req.method !== 'POST') return false;

    try {
      assertOrigin(req, options.publicOrigin);
      const session = await requireStaff(pool, req);
      const body = await readJson<{
        fullName?: string;
        cpf?: string;
        phone?: string;
        email?: string | null;
        birthDate?: string | null;
        identityDocument?: {
          type?: IdentityDocumentType | string;
          number?: string;
          uf?: string | null;
        } | null;
        address?: {
          postalCode?: string | null;
          street?: string | null;
          number?: string | null;
          complement?: string | null;
        } | null;
        intake?: {
          situation?: EnrollmentIntakeSituation | string;
          renach?: string | null;
        } | null;
        serviceType?: string;
        category?: string;
        notes?: string | null;
      }>(req);

      const receipt = await materializeEnrollment(pool, {
        fullName: body.fullName ?? '',
        cpf: body.cpf ?? '',
        phone: body.phone ?? '',
        email: body.email ?? null,
        birthDate: body.birthDate ?? null,
        identityDocument: body.identityDocument ?? null,
        address: body.address ?? null,
        intake: body.intake ?? null,
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
          intakeSituation: receipt.intakeSituation,
          renach: receipt.renach,
        },
        credential: {
          created: false,
          initialPassword: null,
          mustChangePassword: false,
        },
      });
      return true;
    } catch (error) {
      const mapped = publicMessage(error);
      sendJson(res, mapped.status, { error: mapped.message });
      return true;
    }
  };
}
