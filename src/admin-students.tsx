import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AccessQr, studentAccessUrl } from './access-qr';
import { AdminOperationalGuidance } from './admin-operational-guidance';
import { AdminProcessPanel } from './admin-process';
import { AdminQrScanner } from './admin-qr-scanner';

type IdentityDocument = {
  type: 'CIN' | 'RG' | 'RNE' | 'CRNM';
  number: string;
  uf: string | null;
};

type StudentAddress = {
  postalCode: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
};

type StudentSummary = {
  id: string;
  publicId: string;
  fullName: string;
  phone: string;
  email: string | null;
  document: string | null;
  cpf: string | null;
  birthDate: string | null;
  identityDocument: IdentityDocument | null;
  address: StudentAddress | null;
  status: 'ACTIVE' | 'ARCHIVED';
  activeEnrollments: number;
  totalEnrollments: number;
  createdAt: string;
  updatedAt: string;
};

type IntakeObservation = {
  id: string;
  kind: 'DETRAN_PROCESS_STARTED' | 'RENACH_OBSERVED' | 'THEORY_COURSE_COMPLETED' | 'THEORY_EXAM_PASSED';
  value: string | null;
  observedAt: string;
  recordedByStaffUserId: string;
};

type StudentEnrollment = {
  id: string;
  serviceType: 'FIRST_LICENSE' | 'CATEGORY_ADDITION' | 'CATEGORY_CHANGE' | 'LICENSED_TRAINING';
  category: 'A' | 'B' | 'AB' | 'D';
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
  openedAt: string;
  completedAt: string | null;
  notes: string | null;
  renach: string | null;
  intakeObservations: IntakeObservation[];
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

type AccessQrPayload = {
  qr: {
    id: string;
    publicToken: string;
    createdAt: string;
    activatedAt: string | null;
    activationRequired: boolean;
  };
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

const intakeLabels: Record<IntakeObservation['kind'], { title: string; detail: string }> = {
  DETRAN_PROCESS_STARTED: {
    title: 'Processo no Detran iniciado',
    detail: 'O intake declarou que o processo oficial já havia começado.',
  },
  RENACH_OBSERVED: {
    title: 'RENACH observado',
    detail: 'O RENACH foi informado como fato da matrícula.',
  },
  THEORY_COURSE_COMPLETED: {
    title: 'Curso teórico concluído',
    detail: 'Conclusão do curso observada; aprovação na prova não é presumida.',
  },
  THEORY_EXAM_PASSED: {
    title: 'Aprovação teórica observada',
    detail: 'A aprovação na prova teórica foi declarada no intake.',
  },
};

const auditLabels: Record<string, string> = {
  STUDENT_CREATED: 'Aluno criado',
  STUDENT_CREDENTIAL_CREATED: 'Acesso legado criado',
  STUDENT_ACCESS_QR_CREATED: 'QR de acesso criado',
  STUDENT_ACCESS_QR_ROTATED: 'QR de acesso substituído',
  STUDENT_ACCESS_ACTIVATED: 'Acesso ativado pelo aluno',
  ENROLLMENT_CREATED: 'Matrícula criada',
  ENROLLMENT_INTAKE_RECORDED: 'Intake institucional registrado',
  STUDENT_LOGIN: 'Aluno entrou no portal',
  STUDENT_LOGOUT: 'Aluno saiu do portal',
  STUDENT_INITIAL_PASSWORD_CHANGED: 'Senha inicial legada alterada',
  STUDENT_PASSWORD_CHANGED: 'Senha alterada pelo aluno',
  STUDENT_OTHER_SESSIONS_REVOKED: 'Outras sessões encerradas',
  PROCESS_MILESTONE_SCHEDULED: 'Marco processual agendado',
  PROCESS_MILESTONE_ACHIEVED: 'Marco processual concluído',
  PROCESS_MILESTONE_REVOKED: 'Marco processual revertido',
};

async function adminApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || 'Não foi possível carregar os dados.');
  return body;
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function dateOnly(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(new Date(value));
}

function birthDateLabel(value: string | null): string {
  if (!value) return '—';
  const [year, month, day] = value.slice(0, 10).split('-');
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function documentLabel(value: string | null): string {
  if (!value) return '—';
  if (value.length === 11) return `${value.slice(0, 3)}.${value.slice(3, 6)}.${value.slice(6, 9)}-${value.slice(9)}`;
  return value;
}

function identityLabel(identity: IdentityDocument | null): string {
  if (!identity) return '—';
  return `${identity.type} ${identity.number}${identity.uf ? ` · ${identity.uf}` : ''}`;
}

function postalCodeLabel(value: string | null): string {
  if (!value || value.length !== 8) return value || '—';
  return `${value.slice(0, 5)}-${value.slice(5)}`;
}

function addressLabel(address: StudentAddress | null): string {
  if (!address) return 'Não informado';
  const line = [address.street, address.number].filter(Boolean).join(', ');
  return [line, address.complement, address.postalCode ? `CEP ${postalCodeLabel(address.postalCode)}` : null].filter(Boolean).join(' · ') || 'Não informado';
}

function credentialState(credential: StudentCredential): { title: string; detail: string; tone: string } {
  if (!credential.exists) return { title: 'Sem credencial', detail: 'A credencial ainda não foi materializada.', tone: 'neutral' };
  if (credential.disabledAt) return { title: 'Acesso desativado', detail: 'A credencial está desativada.', tone: 'warning' };
  if (credential.lockedUntil && new Date(credential.lockedUntil).getTime() > Date.now()) {
    return { title: 'Acesso bloqueado', detail: `Bloqueio temporário até ${dateTime(credential.lockedUntil)}.`, tone: 'warning' };
  }
  if (credential.mustChangePassword) return { title: 'Migração de senha pendente', detail: 'Credencial legada ainda exige troca da senha inicial.', tone: 'pending' };
  return { title: 'Acesso ativo', detail: `Senha institucional na versão ${credential.passwordVersion}.`, tone: 'ok' };
}

export function AdminStudents() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [students, setStudents] = useState<StudentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);

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
        <p>Busque por nome, ID Centro, CPF, identidade, telefone ou e-mail. O QR é uma busca interna rápida e nunca substitui a autenticação.</p>
      </div>

      <div className="admin-student-search-row">
        <form className="admin-student-search" onSubmit={submit}>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Nome, CEN-26-00001, CPF, identidade, telefone…"
            aria-label="Buscar aluno"
          />
          <button className="admin-primary" type="submit">Buscar</button>
        </form>
        <button className="admin-secondary admin-scan-button" type="button" onClick={() => setScannerOpen(true)}>Ler QR</button>
      </div>

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
            <button key={student.id} type="button" className="admin-student-row" onClick={() => navigate(`/admin/alunos/${student.id}`)}>
              <span className="admin-student-identity"><strong>{student.fullName}</strong><small>{student.publicId} · {documentLabel(student.cpf || student.document)}</small></span>
              <span><strong>{student.activeEnrollments}</strong><small>{student.totalEnrollments} no histórico</small></span>
              <span><strong>{student.phone}</strong><small>{student.email || 'Sem e-mail'}</small></span>
              <span><strong>{dateOnly(student.updatedAt)}</strong><small>{student.status === 'ACTIVE' ? 'Aluno ativo' : 'Arquivado'}</small></span>
            </button>
          ))}
        </div>
      )}

      {scannerOpen && (
        <AdminQrScanner
          onClose={() => setScannerOpen(false)}
          onResolved={(studentId, meta) => {
            setScannerOpen(false);
            if (!meta.active) window.alert(`QR antigo de ${meta.fullName}. Abrindo o cadastro atual.`);
            navigate(`/admin/alunos/${studentId}`);
          }}
        />
      )}
    </section>
  );
}

export function AdminStudentDetail({ studentId, onNewEnrollment }: { studentId: string; onNewEnrollment: () => void }) {
  const navigate = useNavigate();
  const [workspace, setWorkspace] = useState<StudentWorkspace | null>(null);
  const [accessQr, setAccessQr] = useState<AccessQrPayload['qr'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rotating, setRotating] = useState(false);

  async function loadWorkspace() {
    const [workspaceValue, qrValue] = await Promise.all([
      adminApi<StudentWorkspace>(`/api/admin/students/${studentId}`),
      adminApi<AccessQrPayload>(`/api/admin/students/${studentId}/access-qr`),
    ]);
    setWorkspace(workspaceValue);
    setAccessQr(qrValue.qr);
  }

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    void Promise.all([
      adminApi<StudentWorkspace>(`/api/admin/students/${studentId}`),
      adminApi<AccessQrPayload>(`/api/admin/students/${studentId}/access-qr`),
    ]).then(([workspaceValue, qrValue]) => {
      if (!alive) return;
      setWorkspace(workspaceValue);
      setAccessQr(qrValue.qr);
    }).catch((candidate) => {
      if (alive) setError(candidate instanceof Error ? candidate.message : 'Não foi possível abrir o aluno.');
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [studentId]);

  async function rotateQr() {
    if (!workspace || !window.confirm('Substituir o QR atual? Cartões antigos deixarão de abrir o login ou a ativação do aluno.')) return;
    setRotating(true);
    setError('');
    try {
      const next = await adminApi<AccessQrPayload>(`/api/admin/students/${studentId}/access-qr/rotate`, {
        method: 'POST', body: JSON.stringify({}),
      });
      setAccessQr(next.qr);
      await loadWorkspace();
    } catch (candidate) {
      setError(candidate instanceof Error ? candidate.message : 'Não foi possível substituir o QR.');
    } finally { setRotating(false); }
  }

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
  const access = accessQr?.activationRequired
    ? { title: 'Aguardando ativação', detail: 'O aluno ainda não criou a própria senha. Entregue o QR ativo para concluir o primeiro acesso.', tone: 'pending' }
    : credentialState(credential);

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

      <AdminOperationalGuidance studentId={studentId} />

      <div className="admin-student-facts">
        <div><span>CPF</span><strong>{documentLabel(student.cpf)}</strong></div>
        <div><span>Nascimento</span><strong>{birthDateLabel(student.birthDate)}</strong></div>
        <div><span>Identidade</span><strong>{identityLabel(student.identityDocument)}</strong></div>
        <div><span>Aluno desde</span><strong>{dateOnly(student.createdAt)}</strong></div>
      </div>

      <div className="admin-detail-card">
        <div className="admin-card-title"><span>REGISTRO INSTITUCIONAL</span><strong>Dados do aluno</strong></div>
        <dl className="admin-detail-list">
          <div><dt>CPF</dt><dd>{documentLabel(student.cpf)}</dd></div>
          <div><dt>Documento de identidade</dt><dd>{identityLabel(student.identityDocument)}</dd></div>
          <div><dt>Data de nascimento</dt><dd>{birthDateLabel(student.birthDate)}</dd></div>
          <div><dt>Telefone</dt><dd>{student.phone}</dd></div>
          <div><dt>E-mail</dt><dd>{student.email || 'Não informado'}</dd></div>
          <div><dt>Endereço</dt><dd>{addressLabel(student.address)}</dd></div>
        </dl>
      </div>

      <div className="admin-student-columns">
        <div className="admin-detail-card admin-access-card">
          <div className="admin-card-title"><span>ACESSO</span><strong className={`admin-state admin-state-${access.tone}`}>{access.title}</strong></div>
          <p>{access.detail}</p>
          <div className="admin-access-qr-layout">
            {accessQr && <AccessQr publicToken={accessQr.publicToken} size={190} />}
            <div>
              <strong>{student.publicId}</strong>
              {accessQr && <small>QR atual emitido em {dateTime(accessQr.createdAt)}</small>}
              {accessQr?.activatedAt && <small>Acesso ativado em {dateTime(accessQr.activatedAt)}</small>}
              <small>
                {accessQr?.activationRequired
                  ? 'No primeiro scan deste QR, o aluno cria a própria senha.'
                  : 'O QR localiza esta identidade. A senha continua obrigatória no portal.'}
              </small>
            </div>
          </div>
          {credential.exists ? (
            <dl className="admin-detail-list">
              <div><dt>Credencial</dt><dd>Materializada</dd></div>
              <div><dt>Versão da senha</dt><dd>{credential.passwordVersion ?? '—'}</dd></div>
              <div><dt>Tentativas inválidas</dt><dd>{credential.failedAttempts}</dd></div>
            </dl>
          ) : (
            <dl className="admin-detail-list">
              <div><dt>Credencial</dt><dd>Aguardando ativação</dd></div>
              <div><dt>Senha</dt><dd>Não existe ainda</dd></div>
            </dl>
          )}
          <div className="admin-access-actions">
            {accessQr && <button className="admin-secondary" type="button" onClick={() => void navigator.clipboard.writeText(studentAccessUrl(accessQr.publicToken))}>Copiar link</button>}
            {accessQr && <button className="admin-secondary" type="button" onClick={() => window.print()}>Imprimir QR</button>}
            <button className="admin-secondary" type="button" onClick={() => void rotateQr()} disabled={rotating}>{rotating ? 'Substituindo…' : 'Girar QR'}</button>
          </div>
          <small>A escola nunca cria, recebe ou recupera a senha escolhida pelo aluno.</small>
        </div>

        <div id="processo">
          <AdminProcessPanel enrollments={enrollments} />
        </div>
      </div>

      <div className="admin-detail-card admin-enrollment-history">
        <div className="admin-card-title"><span>MATRÍCULAS</span><strong>{enrollments.length} registro(s)</strong></div>
        {enrollments.length === 0 ? <p>Nenhuma matrícula registrada.</p> : enrollments.map((enrollment) => (
          <article key={enrollment.id} className="admin-enrollment-record">
            <div>
              <strong>{serviceLabels[enrollment.serviceType]} · {enrollment.category}</strong>
              <small>Aberta em {dateTime(enrollment.openedAt)}{enrollment.renach ? ` · RENACH ${enrollment.renach}` : ''}</small>
            </div>
            <span className={`admin-state admin-state-${enrollment.status === 'ACTIVE' ? 'ok' : enrollment.status === 'PAUSED' ? 'pending' : 'neutral'}`}>{enrollmentStatusLabels[enrollment.status]}</span>
            {enrollment.notes && <p>{enrollment.notes}</p>}
            {enrollment.intakeObservations.length > 0 && (
              <dl className="admin-detail-list">
                {enrollment.intakeObservations.map((observation) => (
                  <div key={observation.id}>
                    <dt>{dateTime(observation.observedAt)}</dt>
                    <dd>
                      <strong>{intakeLabels[observation.kind].title}</strong>
                      <small>{observation.value ? `${intakeLabels[observation.kind].detail} · ${observation.value}` : intakeLabels[observation.kind].detail}</small>
                    </dd>
                  </div>
                ))}
              </dl>
            )}
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
