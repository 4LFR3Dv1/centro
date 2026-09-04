import { FormEvent, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { StudentCalendar, StudentLessonDetail } from './student-calendar';
import { StudentProcess } from './student-process';
import './student.css';

type ServiceType = 'FIRST_LICENSE' | 'CATEGORY_ADDITION' | 'CATEGORY_CHANGE' | 'LICENSED_TRAINING';
type Category = 'A' | 'B' | 'AB' | 'D';

type StudentSessionPayload = {
  student: {
    id: string;
    publicId: string;
    fullName: string;
  };
  credential: {
    mustChangePassword: boolean;
  };
  enrollments: Array<{
    id: string;
    serviceType: ServiceType;
    category: Category;
    status: 'ACTIVE';
    openedAt: string;
  }>;
  nextAction: { code: 'CHANGE_INITIAL_PASSWORD'; href: '/aluno/trocar-senha' } | null;
  expiresAt: string;
};

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

function StudentLogin({ onAuthenticated }: { onAuthenticated: (session: StudentSessionPayload) => void }) {
  const [publicId, setPublicId] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const session = await api<StudentSessionPayload>('/api/student/auth/login', {
        method: 'POST',
        body: JSON.stringify({ publicId, password }),
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
    <main className="student-login-page">
      <section className="student-login-card" aria-labelledby="student-login-title">
        <a className="student-wordmark" href="/">Centro</a>
        <p className="student-eyebrow">ÁREA DO ALUNO</p>
        <h1 id="student-login-title">Seu caminho para a CNH.</h1>
        <p className="student-lead">Use o ID entregue pela Auto Escola Centro. CPF ou documento nunca são usados como login.</p>
        <form className="student-form" onSubmit={submit}>
          <label>
            ID do aluno
            <input
              value={publicId}
              onChange={(event) => setPublicId(event.target.value.toUpperCase())}
              placeholder="CEN-26-00001"
              autoComplete="username"
              required
            />
          </label>
          <label>
            Senha
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
          </label>
          {error && <p className="student-error" role="alert">{error}</p>}
          <button className="student-primary" disabled={busy} type="submit">{busy ? 'Entrando…' : 'Entrar'}</button>
        </form>
      </section>
    </main>
  );
}

function ChangeInitialPassword({ onChanged }: { onChanged: (session: StudentSessionPayload) => void }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (newPassword.length < 12) {
      setError('Use pelo menos 12 caracteres.');
      return;
    }
    if (newPassword !== confirmation) {
      setError('As senhas não coincidem.');
      return;
    }
    setBusy(true);
    try {
      const session = await api<StudentSessionPayload>('/api/student/auth/change-initial-password', {
        method: 'POST',
        body: JSON.stringify({ newPassword }),
      });
      setNewPassword('');
      setConfirmation('');
      onChanged(session);
    } catch (candidate) {
      setError(candidate instanceof Error ? candidate.message : 'Não foi possível alterar a senha.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="student-focus-card" aria-labelledby="student-password-title">
      <p className="student-eyebrow">PRIMEIRO ACESSO</p>
      <h1 id="student-password-title">Crie sua senha definitiva.</h1>
      <p>A senha entregue pela escola serve apenas para o primeiro acesso. Depois desta troca ela deixa de funcionar.</p>
      <form className="student-form student-password-form" onSubmit={submit}>
        <label>
          Nova senha
          <input type="password" minLength={12} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required />
        </label>
        <label>
          Confirmar nova senha
          <input type="password" minLength={12} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required />
        </label>
        {error && <p className="student-error" role="alert">{error}</p>}
        <button className="student-primary" disabled={busy} type="submit">{busy ? 'Salvando…' : 'Salvar nova senha'}</button>
      </form>
    </section>
  );
}

function StudentHome({ session, onCalendar }: { session: StudentSessionPayload; onCalendar: () => void }) {
  return (
    <div className="student-home-grid">
      <section className="student-hero-card">
        <p className="student-eyebrow">SEU ACESSO</p>
        <h1>Olá, {session.student.fullName.split(' ')[0]}.</h1>
        <p className="student-id">{session.student.publicId}</p>
        <p>Seu acesso está ativo. O portal mostra apenas fatos que já existem no estado da escola.</p>
      </section>

      <section className="student-panel" aria-labelledby="student-enrollments-title">
        <div className="student-panel-head">
          <div>
            <p className="student-eyebrow">MATRÍCULA</p>
            <h2 id="student-enrollments-title">Matrículas ativas</h2>
          </div>
          <span>{session.enrollments.length}</span>
        </div>
        <div className="student-enrollment-list">
          {session.enrollments.map((enrollment) => (
            <article key={enrollment.id}>
              <div>
                <strong>{serviceLabels[enrollment.serviceType]}</strong>
                <span>{categoryLabels[enrollment.category]}</span>
              </div>
              <span className="student-status">ATIVA</span>
            </article>
          ))}
        </div>
      </section>

      <StudentProcess compact />

      <section className="student-panel student-next-action" aria-labelledby="student-calendar-home-title">
        <p className="student-eyebrow">AGENDA</p>
        <h2 id="student-calendar-home-title">Suas aulas.</h2>
        <p>Os horários registrados pela escola são projetados diretamente para sua área, sem confirmação duplicada.</p>
        <button className="student-primary" type="button" onClick={onCalendar}>Abrir minha agenda</button>
      </section>
    </div>
  );
}

export default function StudentApp() {
  const location = useLocation();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [session, setSession] = useState<StudentSessionPayload | null>(null);

  useEffect(() => {
    let alive = true;
    void api<StudentSessionPayload>('/api/student/auth/session')
      .then((value) => { if (alive) setSession(value); })
      .catch(() => { if (alive) setSession(null); })
      .finally(() => { if (alive) setChecking(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (checking) return;
    if (!session && location.pathname !== '/aluno/login') {
      navigate('/aluno/login', { replace: true });
      return;
    }
    if (!session) return;
    if (session.credential.mustChangePassword && location.pathname !== '/aluno/trocar-senha') {
      navigate('/aluno/trocar-senha', { replace: true });
      return;
    }
    if (!session.credential.mustChangePassword && (location.pathname === '/aluno/login' || location.pathname === '/aluno/trocar-senha')) {
      navigate('/aluno', { replace: true });
    }
  }, [checking, session, location.pathname, navigate]);

  async function logout() {
    try { await api<void>('/api/student/auth/logout', { method: 'POST' }); } finally {
      setSession(null);
      navigate('/aluno/login', { replace: true });
    }
  }

  if (checking) return <main className="student-loading">Abrindo sua área…</main>;
  if (!session) {
    return <StudentLogin onAuthenticated={(value) => {
      setSession(value);
      navigate(value.credential.mustChangePassword ? '/aluno/trocar-senha' : '/aluno', { replace: true });
    }} />;
  }

  const lessonDetail = location.pathname.match(/^\/aluno\/agenda\/([0-9a-f-]{36})$/i);
  const calendarActive = location.pathname.startsWith('/aluno/agenda');
  const processActive = location.pathname === '/aluno/processo';
  const homeActive = location.pathname === '/aluno';

  let content;
  if (location.pathname === '/aluno/trocar-senha' && session.credential.mustChangePassword) {
    content = <ChangeInitialPassword onChanged={(value) => { setSession(value); navigate('/aluno', { replace: true }); }} />;
  } else if (lessonDetail) {
    content = <StudentLessonDetail lessonId={lessonDetail[1]} />;
  } else if (location.pathname === '/aluno/agenda') {
    content = <StudentCalendar />;
  } else if (processActive) {
    content = <StudentProcess />;
  } else {
    content = <StudentHome session={session} onCalendar={() => navigate('/aluno/agenda')} />;
  }

  return (
    <div className="student-shell">
      <header className="student-topbar">
        <div>
          <a className="student-wordmark" href="/">Centro</a>
          <span>Área do aluno</span>
        </div>
        {!session.credential.mustChangePassword && (
          <nav className="student-topnav" aria-label="Área do aluno">
            <button type="button" className={homeActive ? 'is-active' : ''} onClick={() => navigate('/aluno')}>Início</button>
            <button type="button" className={processActive ? 'is-active' : ''} onClick={() => navigate('/aluno/processo')}>Processo</button>
            <button type="button" className={calendarActive ? 'is-active' : ''} onClick={() => navigate('/aluno/agenda')}>Agenda</button>
          </nav>
        )}
        <button type="button" onClick={() => void logout()}>Sair</button>
      </header>
      <main className="student-main">{content}</main>
    </div>
  );
}
