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

type EnrollmentReceipt = {
  student: { id: string; publicId: string };
  enrollment: { id: string; serviceType: ServiceType; category: Category };
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
      <p>{service} · {category}</p>

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
          document: String(form.get('document') || ''),
          phone: String(form.get('phone') || ''),
          email: String(form.get('email') || '') || null,
          birthDate: String(form.get('birthDate') || '') || null,
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
    <section className="admin-work-card" aria-labelledby="new-enrollment-title">
      <div className="admin-section-head">
        <div>
          <p className="admin-eyebrow">MATRÍCULAS</p>
          <h2 id="new-enrollment-title">Nova matrícula</h2>
        </div>
        <p>A matrícula cria ou reutiliza a identidade do aluno e entrega um QR persistente para ativação do portal.</p>
      </div>

      <form className="admin-form admin-enrollment-form" onSubmit={submit}>
        <fieldset>
          <legend>Aluno</legend>
          <div className="admin-field-grid">
            <label className="admin-field-wide">Nome completo<input name="fullName" autoComplete="name" required /></label>
            <label>CPF ou documento<input name="document" inputMode="numeric" required /><small>Usado para reconciliação administrativa. Nunca é o login.</small></label>
            <label>Telefone<input name="phone" inputMode="tel" autoComplete="tel" required /></label>
            <label>E-mail<input name="email" type="email" autoComplete="email" /></label>
            <label>Data de nascimento<input name="birthDate" type="date" /></label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Serviço</legend>
          <div className="admin-choice-grid" role="radiogroup" aria-label="Serviço da matrícula">
            {(Object.keys(serviceLabels) as ServiceType[]).map((value) => (
              <button key={value} type="button" role="radio" aria-checked={serviceType === value} className={serviceType === value ? 'is-selected' : ''} onClick={() => setServiceType(value)}>
                {serviceLabels[value]}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>Categoria</legend>
          <div className="admin-choice-grid admin-category-grid" role="radiogroup" aria-label="Categoria da matrícula">
            {categories.map((value) => (
              <button key={value} type="button" role="radio" aria-checked={category === value} className={category === value ? 'is-selected' : ''} onClick={() => setCategory(value)}>
                {categoryLabels[value]}
              </button>
            ))}
          </div>
        </fieldset>

        <label>Observação<textarea name="notes" rows={3} /></label>
        {error && <p className="admin-error" role="alert">{error}</p>}
        <div className="admin-submit-row">
          <span>A criação é transacional: aluno, QR, matrícula e auditoria entram juntos. A senha nasce somente quando o aluno ativa o QR.</span>
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
