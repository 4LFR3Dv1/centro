import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AccessQr, studentAccessUrl } from './access-qr';
import { AdminProcessPanel } from './admin-process';
import { AdminQrScanner } from './admin-qr-scanner';
import { AdminStudentGuides } from './admin-student-guides';
import './admin-student-workspace.css';

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
    detail: 'O processo no Detran já havia sido iniciado quando a matrícula foi criada.',
  },
  RENACH_OBSERVED: {
    title: 'RENACH informado',
    detail: 'O número foi informado na matrícula.',
  },
  THEORY_COURSE_COMPLETED: {
    title: 'Curso teórico concluído',
    detail: 'O curso teórico já estava concluído quando a matrícula foi criada.',
  },
  THEORY_EXAM_PASSED: {
    title: 'Prova teórica aprovada',
    detail: 'A aprovação já havia sido confirmada quando a matrícula foi criada.',
  },
};

const auditLabels: Record<string, string> = {
  STUDENT_CREATED: 'Aluno criado',
  STUDENT_CREDENTIAL_CREATED: 'Acesso antigo criado',
  STUDENT_ACCESS_QR_CREATED: 'QR do aluno criado',
  STUDENT_ACCESS_QR_ROTATED: 'QR do aluno substituído',
  STUDENT_ACCESS_ACTIVATED: 'Primeiro acesso concluído',
  ENROLLMENT_CREATED: 'Matrícula criada',
  ENROLLMENT_INTAKE_RECORDED: 'Situação inicial da matrícula registrada',
  STUDENT_LOGIN: 'Aluno entrou na área do aluno',
  STUDENT_LOGOUT: 'Aluno saiu da área do aluno',
  STUDENT_INITIAL_PASSWORD_CHANGED: 'Senha inicial antiga alterada',
  STUDENT_PASSWORD_CHANGED: 'Senha alterada pelo aluno',
  STUDENT_OTHER_SESSIONS_REVOKED: 'Outros acessos encerrados',
  PROCESS_MILESTONE_SCHEDULED: 'Etapa agendada',
  PROCESS_MILESTONE_ACHIEVED: 'Etapa concluída',
  PROCESS_MILESTONE_REVOKED: 'Etapa reaberta',
};

const actorLabels: Record<AuditEvent['actorType'], string> = {
  SYSTEM: 'Automático',
  STUDENT: 'Aluno',
  STAFF: 'Equipe',
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
  if (!credential.exists) return { title: 'Aguardando primeiro acesso', detail: 'O aluno ainda não criou a própria senha.', tone: 'neutral' };
  if (credential.disabledAt) return { title: 'Acesso desativado', detail: 'O aluno não consegue entrar enquanto o acesso estiver desativado.', tone: 'warning' };
  if (credential.lockedUntil && new Date(credential.lockedUntil).getTime() > Date.now()) {
    return { title: 'Acesso temporariamente bloqueado', detail: `O aluno poderá tentar novamente depois de ${dateTime(credential.lockedUntil)}.`, tone: 'warning' };
  }
  if (credential.mustChangePassword) return { title: 'Precisa trocar a senha', detail: 'Este acesso antigo ainda pede a troca da senha inicial.', tone: 'pending' };
  return { title: 'Acesso ativo', detail: 'O aluno já definiu a senha e pode entrar normalmente.', tone: 'ok' };
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
          <h2 id="students-title">Alunos</h2>
        </div>
        <p>Busque pelo dado que você tiver em mãos — nome, ID Centro, CPF, documento, telefone ou e-mail. Você também pode ler o QR do aluno.</p>
      </div>

      <div className="admin-student-search-row">
        <form className="admin-student-search" onSubmit={submit} role="search">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Nome, ID Centro, CPF, documento, telefone…"
            aria-label="Buscar aluno"
          />
          <button className="admin-primary" type="submit">Buscar</button>
        </form>
        <button className="admin-secondary admin-scan-button" type="button" onClick={() => setScannerOpen(true)}>Ler QR do aluno</button>
      </div>

      {error && <p className="admin-error" role="alert">{error}</p>}
      {loading ? (
        <p className="admin-empty" aria-live="polite">Carregando alunos…</p>
      ) : students.length === 0 ? (
        <div className="admin-empty">
          <strong>Nenhum aluno encontrado.</strong>
          <span>{appliedQuery ? 'Tente outro dado do aluno.' : 'Os alunos aparecem aqui assim que a primeira matrícula é criada.'}</span>
        </div>
      ) : (
        <div className="admin-student-table" role="table" aria-label="Alunos">
          <div className="admin-student-row admin-student-row-head" role="row">
            <span>Aluno</span><span>Matrículas</span><span>Contato</span><span>Atualizado</span>
          </div>
          {students.map((student) => (
            <button key={student.id} type="button" className="admin-student-row" onClick={() => navigate(`/admin/alunos/${student.id}`)} aria-label={`Ver ${student.fullName}`}>
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
          onResolved={(resolvedStudentId, meta) => {
            setScannerOpen(false);
            if (!meta.active) window.alert(`Este é um QR antigo de ${meta.fullName}. Vamos abrir o cadastro atual do aluno.`);
            navigate(`/admin/alunos/${resolvedStudentId}`);
          }}
        />
      )}
    </section>
  );
}

export function AdminStudentDetail({ studentId }: { studentId: string; onNewEnrollment: () => void }) {
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
    if (!workspace || !window.confirm('Substituir o QR atual? O código anterior deixará de abrir o acesso do aluno.')) return;
    setRotating(true);
    setError('');
    try {
      const next = await adminApi<AccessQrPayload>(`/api/admin/students/${studentId}/access-qr/rotate`, {
        method: 'POST', body: JSON.stringify({}),
      });
      setAccessQr(next.qr);
      await loadWorkspace();
    } catch (candidate) {
      setError(candidate instanceof Error ? candidate.message : 'Não foi possível substituir o QR. Tente novamente.');
    } finally { setRotating(false); }
  }

  if (loading) return <section className="admin-work-card"><p className="admin-empty" aria-live="polite">Abrindo aluno…</p></section>;
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
    ? { title: 'Aguardando primeiro acesso', detail: 'Entregue o QR atual ao aluno. Ele criará a própria senha no primeiro acesso.', tone: 'pending' }
    : credentialState(credential);
  const operationalEnrollments = enrollments.filter((enrollment) => enrollment.status === 'ACTIVE' || enrollment.status === 'PAUSED');
  const currentEnrollment = operationalEnrollments.find((enrollment) => enrollment.status === 'ACTIVE') ?? operationalEnrollments[0] ?? null;

  return (
    <section className="admin-student-detail" aria-labelledby="student-detail-title">
      <button className="admin-back" type="button" onClick={() => navigate('/admin/alunos')}>← Alunos</button>

      <div className="admin-student-hero">
        <div>
          <div className="admin-student-identity-meta">
            <p className="admin-eyebrow">{student.publicId}</p>
            <span className={`admin-state admin-state-${student.status === 'ACTIVE' ? 'ok' : 'neutral'}`}>{student.status === 'ACTIVE' ? 'ATIVO' : 'ARQUIVADO'}</span>
          </div>
          <h1 id="student-detail-title">{student.fullName}</h1>
          <p>{student.phone}{student.email ? ` · ${student.email}` : ''}</p>
        </div>
      </div>

      <div className="admin-student-facts">
        <div><span>CPF</span><strong>{documentLabel(student.cpf)}</strong></div>
        <div><span>Nascimento</span><strong>{birthDateLabel(student.birthDate)}</strong></div>
        <div><span>Identidade</span><strong>{identityLabel(student.identityDocument)}</strong></div>
        <div><span>Aluno desde</span><strong>{dateOnly(student.createdAt)}</strong></div>
      </div>

      <details className="admin-detail-card admin-student-record-details">
        <summary>
          <span>DADOS DO ALUNO</span>
          <strong>Ver todos os dados</strong>
        </summary>
        <dl className="admin-detail-list">
          <div><dt>CPF</dt><dd>{documentLabel(student.cpf)}</dd></div>
          <div><dt>Documento de identidade</dt><dd>{identityLabel(student.identityDocument)}</dd></div>
          <div><dt>Data de nascimento</dt><dd>{birthDateLabel(student.birthDate)}</dd></div>
          <div><dt>Telefone</dt><dd>{student.phone}</dd></div>
          <div><dt>E-mail</dt><dd>{student.email || 'Não informado'}</dd></div>
          <div><dt>Endereço</dt><dd>{addressLabel(student.address)}</dd></div>
        </dl>
      </details>

      <div className="admin-student-workspace-grid">
        <aside className="admin-student-context-rail" aria-label="Informações do aluno">
          <div className="admin-detail-card admin-access-card">
            <div className="admin-card-title"><span>ACESSO</span><strong className={`admin-state admin-state-${access.tone}`}>{access.title}</strong></div>
            <p>{access.detail}</p>
            <div className="admin-access-qr-layout">
              {accessQr && <AccessQr publicToken={accessQr.publicToken} size={190} />}
              <div>
                <strong>{student.publicId}</strong>
                {accessQr && <small>QR criado em {dateTime(accessQr.createdAt)}</small>}
                {accessQr?.activatedAt && <small>Primeiro acesso em {dateTime(accessQr.activatedAt)}</small>}
                <small>
                  {accessQr?.activationRequired
                    ? 'No primeiro acesso com este QR, o aluno cria a própria senha.'
                    : 'O QR abre a entrada com o ID do aluno. A senha continua obrigatória.'}
                </small>
              </div>
            </div>
            {credential.exists ? (
              <dl className="admin-detail-list">
                <div><dt>Estado</dt><dd>{credential.mustChangePassword ? 'Precisa trocar a senha' : 'Ativo'}</dd></div>
                <div><dt>Tentativas de senha incorreta</dt><dd>{credential.failedAttempts}</dd></div>
              </dl>
            ) : (
              <dl className="admin-detail-list">
                <div><dt>Estado</dt><dd>Aguardando primeiro acesso</dd></div>
                <div><dt>Senha</dt><dd>O aluno ainda não criou uma senha</dd></div>
              </dl>
            )}
            <div className="admin-access-actions">
              {accessQr && <button className="admin-secondary" type="button" onClick={() => void navigator.clipboard.writeText(studentAccessUrl(accessQr.publicToken))}>Copiar link de acesso</button>}
              {accessQr && <button className="admin-secondary" type="button" onClick={() => window.print()}>Imprimir QR</button>}
              <button className="admin-secondary" type="button" onClick={() => void rotateQr()} disabled={rotating}>{rotating ? 'Substituindo…' : 'Substituir QR'}</button>
            </div>
            <small>A escola nunca cria, recebe ou recupera a senha escolhida pelo aluno.</small>
          </div>

          {currentEnrollment && (
            <div className="admin-detail-card admin-current-enrollment-card">
              <div className="admin-card-title">
                <span>MATRÍCULA ATUAL</span>
                <strong className={`admin-state admin-state-${currentEnrollment.status === 'ACTIVE' ? 'ok' : 'pending'}`}>
                  {enrollmentStatusLabels[currentEnrollment.status]}
                </strong>
              </div>
              <div className="admin-current-enrollment-title">
                <strong>{serviceLabels[currentEnrollment.serviceType]}</strong>
                <span>Categoria {currentEnrollment.category}</span>
              </div>
              <dl className="admin-detail-list admin-current-enrollment-facts">
                <div><dt>RENACH</dt><dd>{currentEnrollment.renach || 'Não informado'}</dd></div>
                <div><dt>Aberta em</dt><dd>{dateOnly(currentEnrollment.openedAt)}</dd></div>
              </dl>
            </div>
          )}

          {operationalEnrollments.length > 0 && (
            <AdminStudentGuides studentId={studentId} enrollments={operationalEnrollments} />
          )}
        </aside>

        <div className="admin-student-operation-column" id="processo">
          <AdminProcessPanel enrollments={enrollments} />
        </div>
      </div>

      <div className="admin-detail-card admin-enrollment-history">
        <div className="admin-card-title"><span>HISTÓRICO DE MATRÍCULAS</span><strong>{enrollments.length} registro(s)</strong></div>
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
        <div className="admin-card-title"><span>HISTÓRICO DE ATIVIDADES</span><strong>Últimas {recentAudit.length}</strong></div>
        {recentAudit.length === 0 ? <p>Nenhuma atividade registrada ainda.</p> : recentAudit.map((event) => (
          <div className="admin-audit-row" key={event.id}>
            <span>{dateTime(event.occurredAt)}</span>
            <strong>{auditLabels[event.action] || 'Atividade registrada'}</strong>
            <small>{actorLabels[event.actorType]}</small>
          </div>
        ))}
      </div>
    </section>
  );
}
