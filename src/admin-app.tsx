import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AccessQr, studentAccessUrl } from './access-qr';
import { AdminCalendar } from './admin-calendar';
import { AdminExams } from './admin-exams';
import { AdminSecurity } from './admin-security';
import { AdminStudentDetail, AdminStudents } from './admin-students';
import { AdminToday } from './admin-today';
import './admin.css';

type Staff = {
  id: string;
  username: string;
  displayName: string;
  role: 'STAFF' | 'ADMIN';
};

type SessionPayload = {
  staff: Staff;
  expiresAt: string;
};

type ServiceType = 'FIRST_LICENSE' | 'CATEGORY_ADDITION' | 'CATEGORY_CHANGE' | 'LICENSED_TRAINING';
type Category = 'A' | 'B' | 'AB' | 'D';
type IdentityDocumentType = 'CIN' | 'RG' | 'RNE' | 'CRNM';
type IntakeSituation = 'NOT_STARTED' | 'PROCESS_STARTED' | 'RENACH_ISSUED' | 'THEORY_COURSE_COMPLETED' | 'THEORY_EXAM_PASSED';

type EnrollmentReceipt = {
  student: { id: string; publicId: string };
  enrollment: {
    id: string;
    serviceType: ServiceType;
    category: Category;
    intakeSituation: IntakeSituation;
    renach: string | null;
  };
  credential: {
    created: boolean;
    initialPassword: string | null;
    mustChangePassword: boolean;
  };
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

const RECEIPT_PATH = '/admin/matriculas/receipt';

const serviceLabels: Record<ServiceType, string> = {
  FIRST_LICENSE: 'Primeira habilitação',
  CATEGORY_ADDITION: 'Adição de categoria',
  CATEGORY_CHANGE: 'Mudança de categoria',
  LICENSED_TRAINING: 'Treinamento para habilitado',
};

const categoryLabels: Record<Category, string> = {
  A: 'A · Moto',
  B: 'B · Carro',
  AB: 'A+B · Moto e carro',
  D: 'D · Passageiros',
};

const intakeLabels: Record<IntakeSituation, { title: string; detail: string }> = {
  NOT_STARTED: {
    title: 'Ainda não iniciou no Detran',
    detail: 'A matrícula começa antes de qualquer fato oficial observado.',
  },
  PROCESS_STARTED: {
    title: 'Processo oficial iniciado',
    detail: 'O candidato já abriu o processo oficial, mas ainda não informou RENACH.',
  },
  RENACH_ISSUED: {
    title: 'Já possui RENACH',
    detail: 'O RENACH será guardado como referência externa desta matrícula.',
  },
  THEORY_COURSE_COMPLETED: {
    title: 'Teoria concluída',
    detail: 'O curso teórico foi concluído; aprovação na prova ainda não é presumida.',
  },
  THEORY_EXAM_PASSED: {
    title: 'Aprovado na prova teórica',
    detail: 'A aprovação já ocorrida materializa os milestones oficiais anteriores necessários.',
  },
};

const brazilStates = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });

  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(body.error || 'Não foi possível concluir a operação.');
  return body;
}

function Login({ onAuthenticated }: { onAuthenticated: (session: SessionPayload) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const session = await api<SessionPayload>('/api/admin/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      setPassword('');
      onAuthenticated(session);
    } catch (candidate) {
      setError(candidate instanceof Error ? candidate.message : 'Não foi possível entrar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="admin-login-page">
      <section className="admin-login-panel" aria-labelledby="admin-login-title">
        <a className="admin-wordmark" href="/">Centro</a>
        <p className="admin-eyebrow">AUTO ESCOLA CENTRO</p>
        <h1 id="admin-login-title">Operação da escola.</h1>
        <p className="admin-lead">Acesso reservado à equipe. O painel público e o acesso do aluno são separados desta área.</p>

        <form className="admin-form admin-login-form" onSubmit={submit}>
          <label>
            Usuário
            <input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required />
          </label>
          <label>
            Senha
            <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </label>
          {error && <p className="admin-error" role="alert">{error}</p>}
          <button className="admin-primary" type="submit" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
        </form>
      </section>
    </main>
  );
}

function Receipt({ receipt, onNew, onStudent }: { receipt: EnrollmentReceipt; onNew: () => void; onStudent: () => void }) {
  const service = serviceLabels[receipt.enrollment.serviceType];
  const category = categoryLabels[receipt.enrollment.category];
  const intake = intakeLabels[receipt.enrollment.intakeSituation];
  const [accessQr, setAccessQr] = useState<AccessQrPayload['qr'] | null>(null);
  const [qrError, setQrError] = useState('');

  useEffect(() => {
    let alive = true;
    void api<AccessQrPayload>(`/api/admin/students/${receipt.student.id}/access-qr`)
      .then((value) => { if (alive) setAccessQr(value.qr); })
      .catch((candidate) => { if (alive) setQrError(candidate instanceof Error ? candidate.message : 'Não foi possível carregar o QR.'); });
    return () => { alive = false; };
  }, [receipt.student.id]);

  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); } catch { /* copy is optional */ }
  }

  return (
    <section className="admin-receipt" aria-labelledby="receipt-title">
      <div className="admin-receipt-status">MATRÍCULA CRIADA</div>
      <h2 id="receipt-title">Acesso do aluno</h2>
      <p>{service} · {category} · {intake.title}{receipt.enrollment.renach ? ` · RENACH ${receipt.enrollment.renach}` : ''}</p>

      <div className="admin-receipt-progress" aria-label="Materialização do acesso">
        <span>✓ Matrícula</span>
        <span>✓ Identidade {receipt.student.publicId}</span>
        <span>{accessQr ? '✓ QR persistente' : '… QR persistente'}</span>
        <span>{accessQr?.activationRequired ? '○ Aguardando ativação pelo aluno' : accessQr ? '✓ Acesso ativado' : '… Estado de ativação'}</span>
      </div>

      <div className="admin-receipt-qr">
        <div>
          {accessQr ? <AccessQr publicToken={accessQr.publicToken} size={230} /> : <div className="admin-receipt-qr-placeholder">Gerando QR…</div>}
        </div>
        <div>
          <span>{accessQr?.activationRequired ? 'ESCANEIE PARA ATIVAR' : 'ESCANEIE PARA ACESSAR'}</span>
          <strong>{receipt.student.publicId}</strong>
          <p>
            {accessQr?.activationRequired
              ? 'No primeiro scan, o aluno cria a própria senha e entra diretamente na área do aluno.'
              : 'O acesso já está ativado. O QR abre o login com o ID Centro preenchido.'}
          </p>
          {accessQr && <button type="button" onClick={() => void copy(studentAccessUrl(accessQr.publicToken))}>Copiar link de acesso</button>}
          {qrError && <small>{qrError}</small>}
        </div>
      </div>

      <div className="admin-access-grid">
        <div>
          <span>ID DO ALUNO</span>
          <strong>{receipt.student.publicId}</strong>
          <button type="button" onClick={() => void copy(receipt.student.publicId)}>Copiar ID</button>
        </div>
        <div>
          <span>ATIVAÇÃO</span>
          <strong className="admin-access-existing">
            {accessQr?.activationRequired ? 'Aguardando aluno' : accessQr ? 'Acesso ativo' : 'Verificando…'}
          </strong>
          <small>
            {accessQr?.activationRequired
              ? 'A escola não cria nem conhece a senha. O aluno escolhe a senha ao ativar este QR.'
              : 'Nenhuma senha é projetada para a escola.'}
          </small>
        </div>
      </div>

      {accessQr?.activationRequired && (
        <p className="admin-receipt-warning">Entregue este QR ao aluno. A credencial só será criada quando ele escanear o código e escolher a própria senha.</p>
      )}

      <div className="admin-receipt-actions">
        <button className="admin-secondary" type="button" onClick={() => window.print()} disabled={!accessQr}>Imprimir acesso</button>
        <button className="admin-secondary" type="button" onClick={onStudent}>Abrir aluno</button>
        <button className="admin-primary" type="button" onClick={onNew}>Nova matrícula</button>
      </div>
    </section>
  );
}

function EnrollmentForm({ onCreated }: { onCreated: (receipt: EnrollmentReceipt) => void }) {
  const [serviceType, setServiceType] = useState<ServiceType>('FIRST_LICENSE');
  const [category, setCategory] = useState<Category>('B');
  const [identityType, setIdentityType] = useState<IdentityDocumentType>('CIN');
  const [intakeSituation, setIntakeSituation] = useState<IntakeSituation>('NOT_STARTED');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const categories = useMemo<Category[]>(
    () => serviceType === 'FIRST_LICENSE' ? ['A', 'B', 'AB'] : ['A', 'B', 'AB', 'D'],
    [serviceType],
  );

  useEffect(() => {
    if (!categories.includes(category)) setCategory(categories[0]);
  }, [categories, category]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);

    try {
      const receipt = await api<EnrollmentReceipt>('/api/admin/enrollments', {
        method: 'POST',
        body: JSON.stringify({
          fullName: String(form.get('fullName') || ''),
          cpf: String(form.get('cpf') || ''),
          phone: String(form.get('phone') || ''),
          email: String(form.get('email') || '') || null,
          birthDate: String(form.get('birthDate') || '') || null,
          identityDocument: {
            type: identityType,
            number: String(form.get('identityDocumentNumber') || ''),
            uf: String(form.get('identityDocumentUf') || '') || null,
          },
          address: {
            postalCode: String(form.get('postalCode') || '') || null,
            street: String(form.get('street') || '') || null,
            number: String(form.get('addressNumber') || '') || null,
            complement: String(form.get('addressComplement') || '') || null,
          },
          intake: {
            situation: intakeSituation,
            renach: String(form.get('renach') || '') || null,
          },
          serviceType,
          category,
          notes: String(form.get('notes') || '') || null,
        }),
      });
      onCreated(receipt);
    } catch (candidate) {
      setError(candidate instanceof Error ? candidate.message : 'Não foi possível criar a matrícula.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-work-card admin-enrollment-card" aria-labelledby="new-enrollment-title">
      <div className="admin-section-head">
        <div>
          <p className="admin-eyebrow">MATRÍCULAS</p>
          <h2 id="new-enrollment-title">Nova matrícula</h2>
        </div>
        <p>Cadastre apenas o necessário, localize o estado real do processo e entregue o QR persistente para ativação do aluno.</p>
      </div>

      <form className="admin-form admin-enrollment-form" onSubmit={submit}>
        <fieldset>
          <legend><span>01</span> Aluno</legend>
          <div className="admin-field-grid">
            <label className="admin-field-wide">Nome completo<input name="fullName" autoComplete="name" required /></label>
            <label>CPF<input name="cpf" inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" required /><small>Identificação fiscal. Nunca é usado como login.</small></label>
            <label>Data de nascimento<input name="birthDate" type="date" required /></label>
            <label>Telefone<input name="phone" inputMode="tel" autoComplete="tel" required /></label>
            <label>E-mail<input name="email" type="email" autoComplete="email" /></label>
          </div>

          <div className="admin-subsection">
            <div className="admin-subsection-title">
              <strong>Documento de identidade</strong>
              <span>RG, CIN ou documento migratório. Sem upload obrigatório.</span>
            </div>
            <div className="admin-field-grid admin-field-grid-three">
              <label>Tipo
                <select value={identityType} onChange={(event) => setIdentityType(event.target.value as IdentityDocumentType)} required>
                  <option value="CIN">CIN</option>
                  <option value="RG">RG</option>
                  <option value="RNE">RNE</option>
                  <option value="CRNM">CRNM</option>
                </select>
              </label>
              <label>Número<input name="identityDocumentNumber" autoComplete="off" required /></label>
              <label>UF emissora
                <select name="identityDocumentUf" defaultValue="SP">
                  <option value="">Não se aplica</option>
                  {brazilStates.map((state) => <option key={state} value={state}>{state}</option>)}
                </select>
              </label>
            </div>
          </div>
        </fieldset>

        <fieldset>
          <legend><span>02</span> Habilitação</legend>
          <div className="admin-form-block">
            <span className="admin-form-block-label">Serviço</span>
            <div className="admin-choice-grid" role="radiogroup" aria-label="Serviço da matrícula">
              {(Object.keys(serviceLabels) as ServiceType[]).map((value) => (
                <button key={value} type="button" role="radio" aria-checked={serviceType === value} className={serviceType === value ? 'is-selected' : ''} onClick={() => setServiceType(value)}>
                  {serviceLabels[value]}
                </button>
              ))}
            </div>
          </div>

          <div className="admin-form-block">
            <span className="admin-form-block-label">Categoria</span>
            <div className="admin-choice-grid admin-category-grid" role="radiogroup" aria-label="Categoria da matrícula">
              {categories.map((value) => (
                <button key={value} type="button" role="radio" aria-checked={category === value} className={category === value ? 'is-selected' : ''} onClick={() => setCategory(value)}>
                  {categoryLabels[value]}
                </button>
              ))}
            </div>
          </div>

          <div className="admin-form-block">
            <span className="admin-form-block-label">Situação atual do processo</span>
            <div className="admin-intake-grid" role="radiogroup" aria-label="Situação atual do processo de habilitação">
              {(Object.keys(intakeLabels) as IntakeSituation[]).map((value) => (
                <button key={value} type="button" role="radio" aria-checked={intakeSituation === value} className={intakeSituation === value ? 'is-selected' : ''} onClick={() => setIntakeSituation(value)}>
                  <strong>{intakeLabels[value].title}</strong>
                  <span>{intakeLabels[value].detail}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="admin-field-grid">
            <label>RENACH
              <input name="renach" autoComplete="off" required={intakeSituation === 'RENACH_ISSUED'} />
              <small>{intakeSituation === 'RENACH_ISSUED' ? 'Obrigatório porque o intake declara que o RENACH já existe.' : 'Opcional. Informe quando já estiver disponível.'}</small>
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend><span>03</span> Endereço</legend>
          <p className="admin-fieldset-note">Dados de endereço ajudam a operação, mas não bloqueiam a matrícula quando ainda não estão disponíveis.</p>
          <div className="admin-field-grid">
            <label>CEP<input name="postalCode" inputMode="numeric" autoComplete="postal-code" placeholder="00000-000" /></label>
            <label>Número<input name="addressNumber" autoComplete="address-line2" /></label>
            <label className="admin-field-wide">Endereço<input name="street" autoComplete="street-address" /></label>
            <label className="admin-field-wide">Complemento<input name="addressComplement" /></label>
          </div>
        </fieldset>

        <fieldset>
          <legend><span>04</span> Confirmação</legend>
          <label>Observação operacional<textarea name="notes" rows={3} placeholder="Somente o que a equipe realmente precisa saber para conduzir esta matrícula." /></label>
        </fieldset>

        {error && <p className="admin-error" role="alert">{error}</p>}
        <div className="admin-submit-row">
          <span>Aluno, matrícula, fatos de intake, QR e auditoria entram na mesma transação. A senha só nasce quando o aluno ativa o QR.</span>
          <button className="admin-primary" type="submit" disabled={busy}>{busy ? 'Criando…' : 'Confirmar matrícula'}</button>
        </div>
      </form>
    </section>
  );
}

export default function AdminApp() {
  const location = useLocation();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [receipt, setReceipt] = useState<EnrollmentReceipt | null>(null);

  useEffect(() => {
    let alive = true;
    void api<SessionPayload>('/api/admin/auth/session')
      .then((value) => { if (alive) setSession(value); })
      .catch(() => { if (alive) setSession(null); })
      .finally(() => { if (alive) setChecking(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (checking) return;
    if (!session && location.pathname !== '/admin/login') navigate('/admin/login', { replace: true });
    if (session && location.pathname === '/admin/login') navigate('/admin', { replace: true });
  }, [checking, session, location.pathname, navigate]);

  useEffect(() => {
    if (location.pathname !== RECEIPT_PATH && receipt) setReceipt(null);
    if (!checking && session && location.pathname === RECEIPT_PATH && !receipt) navigate('/admin/matriculas/nova', { replace: true });
  }, [checking, session, location.pathname, receipt, navigate]);

  async function logout() {
    try { await api<void>('/api/admin/auth/logout', { method: 'POST' }); } finally {
      setReceipt(null);
      setSession(null);
      navigate('/admin/login', { replace: true });
    }
  }

  function acceptReceipt(value: EnrollmentReceipt) {
    setReceipt(value);
    navigate(RECEIPT_PATH);
  }

  function startNewEnrollment() {
    setReceipt(null);
    navigate('/admin/matriculas/nova');
  }

  const studentDetail = location.pathname.match(/^\/admin\/alunos\/([0-9a-f-]{36})$/i);
  const todayActive = location.pathname === '/admin' || location.pathname === '/admin/hoje';
  const studentsActive = location.pathname.startsWith('/admin/alunos');
  const enrollmentsActive = location.pathname.startsWith('/admin/matriculas');
  const calendarActive = location.pathname.startsWith('/admin/agenda');
  const examsActive = location.pathname.startsWith('/admin/exames');
  const securityActive = location.pathname.startsWith('/admin/seguranca');

  if (checking) return <main className="admin-loading">Abrindo operação da escola…</main>;
  if (!session) return <Login onAuthenticated={(value) => { setSession(value); navigate('/admin', { replace: true }); }} />;

  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <div><a href="/" className="admin-wordmark">Centro</a><span>Auto Escola Centro · Administração</span></div>
        <div className="admin-user"><span>{session.staff.displayName}</span><button type="button" onClick={() => void logout()}>Sair</button></div>
      </header>

      <main className="admin-main">
        <aside className="admin-rail" aria-label="Administração">
          <p>OPERAÇÃO</p>
          <button type="button" className={todayActive ? 'is-active' : ''} onClick={() => navigate('/admin')}>Hoje</button>
          <button type="button" className={calendarActive ? 'is-active' : ''} onClick={() => navigate('/admin/agenda')}>Agenda</button>
          <button type="button" className={examsActive ? 'is-active' : ''} onClick={() => navigate('/admin/exames')}>Exames</button>
          <button type="button" className={studentsActive ? 'is-active' : ''} onClick={() => navigate('/admin/alunos')}>Alunos</button>
          <button type="button" className={enrollmentsActive ? 'is-active' : ''} onClick={startNewEnrollment}>Matrículas</button>
          <p>CONTA</p>
          <button type="button" className={securityActive ? 'is-active' : ''} onClick={() => navigate('/admin/seguranca')}>Segurança</button>
        </aside>

        <div className="admin-workspace">
          {location.pathname === RECEIPT_PATH && receipt ? (
            <Receipt receipt={receipt} onNew={startNewEnrollment} onStudent={() => navigate(`/admin/alunos/${receipt.student.id}`)} />
          ) : location.pathname === '/admin/matriculas/nova' ? (
            <EnrollmentForm onCreated={acceptReceipt} />
          ) : location.pathname === '/admin/agenda' ? (
            <AdminCalendar />
          ) : location.pathname === '/admin/exames' ? (
            <AdminExams />
          ) : location.pathname === '/admin/alunos' ? (
            <AdminStudents />
          ) : location.pathname === '/admin/seguranca' ? (
            <AdminSecurity />
          ) : studentDetail ? (
            <AdminStudentDetail studentId={studentDetail[1]} onNewEnrollment={startNewEnrollment} />
          ) : (
            <AdminToday />
          )}
        </div>
      </main>
    </div>
  );
}