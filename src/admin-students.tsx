import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AdminProcessPanel } from './admin-process';

type StudentSummary = {
  id: string;
  publicId: string;
  fullName: string;
  phone: string;
  email: string | null;
  document: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
  activeEnrollments: number;
  totalEnrollments: number;
  createdAt: string;
  updatedAt: string;
};

type StudentEnrollment = {
  id: string;
  serviceType: 'FIRST_LICENSE' | 'CATEGORY_ADDITION' | 'CATEGORY_CHANGE' | 'LICENSED_TRAINING';
  category: 'A' | 'B' | 'AB' | 'D';
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
  openedAt: string;
  completedAt: string | null;
  notes: string | null;
};

type StudentCredential = {
  exists: boolean;
  mustChangePassword: boolean;
  passwordVersion: number | null;
  failedAttempts: number;
  lockedUntil: string | null;
  disabledAt: string | null;
  updatedAt: string | null;
};

type AuditEvent = {
  id: string;
  actorType: 'SYSTEM' | 'STUDENT' | 'STAFF';
  action: string;
  entityType: string;
  entityId: string | null;
  occurredAt: string;
};

type StudentWorkspace = {
  student: StudentSummary;
  credential: StudentCredential;
  enrollments: StudentEnrollment[];
  recentAudit: AuditEvent[];
};

const serviceLabels: Record<StudentEnrollment['serviceType'], string> = {
  FIRST_LICENSE: 'Primeira habilitação',
  CATEGORY_ADDITION: 'Adição de categoria',
  CATEGORY_CHANGE: 'Mudança de categoria',
  LICENSED_TRAINING: 'Treinamento para habilitado',
};

const enrollmentStatusLabels: Record<StudentEnrollment['status'], string> = {
  DRAFT: 'Rascunho',
  ACTIVE: 'Ativa',
  PAUSED: 'Pausada',
  COMPLETED: 'Concluída',
  CANCELLED: 'Cancelada',
};

const auditLabels: Record<string, string> = {
  STUDENT_CREATED: 'Aluno criado',
  STUDENT_CREDENTIAL_CREATED: 'Acesso criado',
  ENROLLMENT_CREATED: 'Matrícula criada',
  STUDENT_LOGIN: 'Aluno entrou no portal',
  STUDENT_LOGOUT: 'Aluno saiu do portal',
  STUDENT_INITIAL_PASSWORD_CHANGED: 'Senha inicial alterada',
  PROCESS_MILESTONE_SCHEDULED: 'Marco processual agendado',
  PROCESS_MILESTONE_ACHIEVED: 'Marco processual concluído',
  PROCESS_MILESTONE_REVOKED: 'Marco processual revertido',
};

async function adminApi<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin' });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || 'Não foi possível carregar os dados.');
  return body;
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function dateOnly(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(new Date(value));
}

function documentLabel(value: string | null): string {
  if (!value) return '—';
  if (value.length === 11) return `${value.slice(0, 3)}.${value.slice(3, 6)}.${value.slice(6, 9)}-${value.slice(9)}`;
  return value;
}

function credentialState(credential: StudentCredential): { title: string; detail: string; tone: string } {
  if (!credential.exists) return { title: 'Sem acesso', detail: 'Nenhuma credencial foi materializada.', tone: 'neutral' };
  if (credential.disabledAt) return { title: 'Acesso desativado', detail: 'A credencial está desativada.', tone: 'warning' };
  if (credential.lockedUntil && new Date(credential.lockedUntil).getTime() > Date.now()) {
    return { title: 'Acesso bloqueado', detail: `Bloqueio temporário até ${dateTime(credential.lockedUntil)}.`, tone: 'warning' };
  }
  if (credential.mustChangePassword) return { title: 'Primeiro acesso pendente', detail: 'O aluno ainda precisa substituir a senha inicial.', tone: 'pending' };
  return { title: 'Acesso ativo', detail: `Senha institucional na versão ${credential.passwordVersion}.`, tone: 'ok' };
}

export function AdminStudents() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [students, setStudents] = useState<StudentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    const search = appliedQuery ? `?q=${encodeURIComponent(appliedQuery)}` : '';
    void adminApi<{ students: StudentSummary[] }>(`/api/admin/students${search}`)
      .then((value) => { if (alive) setStudents(value.students); })
      .catch((candidate) => { if (alive) setError(candidate instanceof Error ? candidate.message : 'Não foi possível carregar os alunos.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [appliedQuery]);

  function submit(event: FormEvent) {
    event.preventDefault();
    setAppliedQuery(query.trim());
  }

  return (
    <section className="admin-work-card admin-student-list" aria-labelledby="students-title">
      <div className="admin-section-head admin-student-head">
        <div>
          <p className="admin-eyebrow">ALUNOS</p>
          <h2 id="students-title">Workspace de alunos</h2>
        </div>
        <p>Busque por nome, ID Centro, documento, telefone ou e-mail. A senha do aluno nunca aparece nesta superfície.</p>
      </div>

      <form className="admin-student-search" onSubmit={submit}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Nome, CEN-26-00001, documento, telefone…"
          aria-label="Buscar aluno"
        />
        <button className="admin-primary" type="submit">Buscar</button>
      </form>

      {error && <p className="admin-error" role="alert">{error}</p>}
      {loading ? (
        <p className="admin-empty">Carregando alunos…</p>
      ) : students.length === 0 ? (
        <div className="admin-empty">
          <strong>Nenhum aluno encontrado.</strong>
          <span>{appliedQuery ? 'Tente outro termo de busca.' : 'A primeira matrícula materializada aparecerá aqui.'}</span>
        </div>
      ) : (
        <div className="admin-student-table" role="table" aria-label="Alunos">
          <div className="admin-student-row admin-student-row-head" role="row">
            <span>Aluno</span><span>Matrículas</span><span>Contato</span><span>Atualizado</span>
          </div>
          {students.map((student) => (
            <button
              key={student.id}
              type="button"
              className="admin-student-row"
              onClick={() => navigate(`/admin/alunos/${student.id}`)}
            >
              <span className="admin-student-identity">
                <strong>{student.fullName}</strong>
                <small>{student.publicId} · {documentLabel(student.document)}</small>
              </span>
              <span>
                <strong>{student.activeEnrollments}</strong>
                <small>{student.totalEnrollments} no histórico</small>
              </span>
              <span>
                <strong>{student.phone}</strong>
                <small>{student.email || 'Sem e-mail'}</small>
              </span>
              <span>
                <strong>{dateOnly(student.updatedAt)}</strong>
                <small>{student.status === 'ACTIVE' ? 'Aluno ativo' : 'Arquivado'}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export function AdminStudentDetail({ studentId, onNewEnrollment }: { studentId: string; onNewEnrollment: () => void }) {
  const navigate = useNavigate();
  const [workspace, setWorkspace] = useState<StudentWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    void adminApi<StudentWorkspace>(`/api/admin/students/${studentId}`)
      .then((value) => { if (alive) setWorkspace(value); })
      .catch((candidate) => { if (alive) setError(candidate instanceof Error ? candidate.message : 'Não foi possível abrir o aluno.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [studentId]);

  if (loading) return <section className="admin-work-card"><p className="admin-empty">Abrindo aluno…</p></section>;
  if (error || !workspace) {
    return (
      <section className="admin-work-card">
        <p className="admin-error" role="alert">{error || 'Aluno não encontrado.'}</p>
        <button className="admin-secondary" type="button" onClick={() => navigate('/admin/alunos')}>Voltar para alunos</button>
      </section>
    );
  }

  const { student, credential, enrollments, recentAudit } = workspace;
  const access = credentialState(credential);

  return (
    <section className="admin-student-detail" aria-labelledby="student-detail-title">
      <button className="admin-back" type="button" onClick={() => navigate('/admin/alunos')}>← Alunos</button>

      <div className="admin-student-hero">
        <div>
          <p className="admin-eyebrow">{student.publicId}</p>
          <h1 id="student-detail-title">{student.fullName}</h1>
          <p>{student.phone}{student.email ? ` · ${student.email}` : ''}</p>
        </div>
        <div className="admin-student-hero-actions">
          <span className={`admin-state admin-state-${student.status === 'ACTIVE' ? 'ok' : 'neutral'}`}>{student.status === 'ACTIVE' ? 'ALUNO ATIVO' : 'ARQUIVADO'}</span>
          <button className="admin-primary" type="button" onClick={onNewEnrollment}>Nova matrícula</button>
        </div>
      </div>

      <div className="admin-student-facts">
        <div><span>Documento</span><strong>{documentLabel(student.document)}</strong></div>
        <div><span>Matrículas abertas</span><strong>{student.activeEnrollments}</strong></div>
        <div><span>Matrículas totais</span><strong>{student.totalEnrollments}</strong></div>
        <div><span>Aluno desde</span><strong>{dateOnly(student.createdAt)}</strong></div>
      </div>

      <div className="admin-student-columns">
        <div className="admin-detail-card">
          <div className="admin-card-title"><span>ACESSO</span><strong className={`admin-state admin-state-${access.tone}`}>{access.title}</strong></div>
          <p>{access.detail}</p>
          {credential.exists && (
            <dl className="admin-detail-list">
              <div><dt>Troca inicial</dt><dd>{credential.mustChangePassword ? 'Pendente' : 'Concluída'}</dd></div>
              <div><dt>Versão da senha</dt><dd>{credential.passwordVersion ?? '—'}</dd></div>
              <div><dt>Tentativas inválidas</dt><dd>{credential.failedAttempts}</dd></div>
            </dl>
          )}
          <small>Senhas e hashes nunca são projetados para o admin.</small>
        </div>

        <AdminProcessPanel enrollments={enrollments} />
      </div>

      <div className="admin-detail-card admin-enrollment-history">
        <div className="admin-card-title"><span>MATRÍCULAS</span><strong>{enrollments.length} registro(s)</strong></div>
        {enrollments.length === 0 ? <p>Nenhuma matrícula registrada.</p> : enrollments.map((enrollment) => (
          <article key={enrollment.id} className="admin-enrollment-record">
            <div>
              <strong>{serviceLabels[enrollment.serviceType]} · {enrollment.category}</strong>
              <small>Aberta em {dateTime(enrollment.openedAt)}</small>
            </div>
            <span className={`admin-state admin-state-${enrollment.status === 'ACTIVE' ? 'ok' : enrollment.status === 'PAUSED' ? 'pending' : 'neutral'}`}>
              {enrollmentStatusLabels[enrollment.status]}
            </span>
            {enrollment.notes && <p>{enrollment.notes}</p>}
          </article>
        ))}
      </div>

      <div className="admin-detail-card admin-audit-history">
        <div className="admin-card-title"><span>HISTÓRICO OPERACIONAL</span><strong>Últimos {recentAudit.length}</strong></div>
        {recentAudit.length === 0 ? <p>Nenhum evento auditável projetado.</p> : recentAudit.map((event) => (
          <div className="admin-audit-row" key={event.id}>
            <span>{dateTime(event.occurredAt)}</span>
            <strong>{auditLabels[event.action] || event.action}</strong>
            <small>{event.actorType} · {event.entityType}</small>
          </div>
        ))}
      </div>
    </section>
  );
}
