import { FormEvent, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { StudentAccessEntry } from './student-access-entry';
import { StudentCalendar, StudentLessonDetail } from './student-calendar';
import { StudentExamDetail, StudentExams } from './student-exams';
import { StudentGuides } from './student-guides';
import { StudentHome } from './student-home';
import { StudentProcess } from './student-process';
import { StudentSecurity } from './student-security';
import './student.css';

type StudentSessionPayload = {
  student: { id: string; publicId: string; fullName: string };
  credential: { mustChangePassword: boolean };
  enrollments: Array<{
    id: string;
    serviceType: 'FIRST_LICENSE' | 'CATEGORY_ADDITION' | 'CATEGORY_CHANGE' | 'LICENSED_TRAINING';
    category: 'A' | 'B' | 'AB' | 'D';
    status: 'ACTIVE';
    openedAt: string;
  }>;
  nextAction: { code: 'CHANGE_INITIAL_PASSWORD'; href: '/aluno/trocar-senha' } | null;
  expiresAt: string;
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
  if (!response.ok) throw new Error(body.error || 'Não foi possível concluir esta ação.');
  return body;
}

function StudentLogin({ onAuthenticated }: { onAuthenticated: (session: StudentSessionPayload) => void }) {
  const [publicId, setPublicId] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const session = await api<StudentSessionPayload>('/api/student/auth/login', {
        method: 'POST', body: JSON.stringify({ publicId, password }),
      });
      setPassword('');
      onAuthenticated(session);
    } catch (candidate) {
      setError(candidate instanceof Error ? candidate.message : 'Não foi possível entrar. Confira seu ID e sua senha.');
    } finally { setBusy(false); }
  }

  return (
    <main className="student-login-page">
      <section className="student-login-card" aria-labelledby="student-login-title">
        <a className="student-wordmark" href="/">Centro</a>
        <p className="student-eyebrow">ÁREA DO ALUNO</p>
        <h1 id="student-login-title">Seu caminho para a CNH.</h1>
        <p className="student-lead">Entre com seu ID Centro e sua senha. Seu CPF e seus documentos não são usados para entrar.</p>
        <form className="student-form" onSubmit={submit}>
          <label>Seu ID Centro<input value={publicId} onChange={(event) => setPublicId(event.target.value.toUpperCase())} placeholder="CEN-26-00001" autoComplete="username" required /></label>
          <label>Senha<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
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
    event.preventDefault(); setError('');
    if (newPassword.length < 12) { setError('Sua nova senha precisa ter pelo menos 12 caracteres.'); return; }
    if (newPassword !== confirmation) { setError('As duas senhas precisam ser iguais.'); return; }
    setBusy(true);
    try {
      const session = await api<StudentSessionPayload>('/api/student/auth/change-initial-password', {
        method: 'POST', body: JSON.stringify({ newPassword }),
      });
      setNewPassword(''); setConfirmation(''); onChanged(session);
    } catch (candidate) {
      setError(candidate instanceof Error ? candidate.message : 'Não foi possível trocar sua senha. Tente novamente.');
    } finally { setBusy(false); }
  }

  return (
    <section className="student-focus-card" aria-labelledby="student-password-title">
      <p className="student-eyebrow">ATUALIZAÇÃO DE ACESSO</p>
      <h1 id="student-password-title">Crie uma nova senha.</h1>
      <p>Este passo aparece apenas para contas antigas que ainda usam uma senha provisória. Depois da troca, use somente a nova senha.</p>
      <form className="student-form student-password-form" onSubmit={submit}>
        <label>Nova senha<input type="password" minLength={12} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /><small>Use pelo menos 12 caracteres.</small></label>
        <label>Digite a nova senha novamente<input type="password" minLength={12} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required /></label>
        {error && <p className="student-error" role="alert">{error}</p>}
        <button className="student-primary" disabled={busy} type="submit">{busy ? 'Salvando…' : 'Trocar minha senha'}</button>
      </form>
    </section>
  );
}

export default function StudentApp() {
  const location = useLocation();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [session, setSession] = useState<StudentSessionPayload | null>(null);
  const accessToken = location.pathname.match(/^\/aluno\/acesso\/([A-Za-z0-9_-]{20,80})\/?$/)?.[1] ?? null;

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
    const publicEntry = location.pathname === '/aluno/login' || Boolean(accessToken);
    if (!session && !publicEntry) { navigate('/aluno/login', { replace: true }); return; }
    if (!session) return;
    if (session.credential.mustChangePassword && location.pathname !== '/aluno/trocar-senha') { navigate('/aluno/trocar-senha', { replace: true }); return; }
    if (!session.credential.mustChangePassword && (location.pathname === '/aluno/login' || location.pathname === '/aluno/trocar-senha' || Boolean(accessToken))) {
      navigate('/aluno', { replace: true });
    }
  }, [checking, session, location.pathname, navigate, accessToken]);

  async function logout() {
    try { await api<void>('/api/student/auth/logout', { method: 'POST' }); }
    finally { setSession(null); navigate('/aluno/login', { replace: true }); }
  }

  function acceptAuthentication(value: StudentSessionPayload) {
    setSession(value);
    navigate(value.credential.mustChangePassword ? '/aluno/trocar-senha' : '/aluno', { replace: true });
  }

  if (checking) return <main className="student-loading" aria-live="polite">Abrindo sua área…</main>;
  if (!session) {
    if (accessToken) {
      return <StudentAccessEntry publicToken={accessToken} onAuthenticated={acceptAuthentication} onManualLogin={() => navigate('/aluno/login', { replace: true })} />;
    }
    return <StudentLogin onAuthenticated={acceptAuthentication} />;
  }

  const lessonDetail = location.pathname.match(/^\/aluno\/agenda\/([0-9a-f-]{36})$/i);
  const examDetail = location.pathname.match(/^\/aluno\/exame\/([0-9a-f-]{36})$/i);
  const homeActive = location.pathname === '/aluno';
  const processActive = location.pathname === '/aluno/processo';
  const calendarActive = location.pathname.startsWith('/aluno/agenda');
  const examsActive = location.pathname.startsWith('/aluno/exame');
  const guidesActive = location.pathname === '/aluno/guia';
  const accountActive = location.pathname === '/aluno/conta';

  let content;
  if (location.pathname === '/aluno/trocar-senha' && session.credential.mustChangePassword) {
    content = <ChangeInitialPassword onChanged={(value) => { setSession(value); navigate('/aluno', { replace: true }); }} />;
  } else if (lessonDetail) {
    content = <StudentLessonDetail lessonId={lessonDetail[1]} />;
  } else if (examDetail) {
    content = <StudentExamDetail candidateId={examDetail[1]} />;
  } else if (calendarActive) {
    content = <StudentCalendar />;
  } else if (processActive) {
    content = <StudentProcess />;
  } else if (examsActive) {
    content = <StudentExams />;
  } else if (guidesActive) {
    content = <StudentGuides />;
  } else if (accountActive) {
    content = <StudentSecurity publicId={session.student.publicId} />;
  } else {
    content = <StudentHome student={session.student} />;
  }

  return (
    <div className="student-shell">
      <header className="student-topbar">
        <div><a className="student-wordmark" href="/">Centro</a><span>Área do aluno</span></div>
        {!session.credential.mustChangePassword && (
          <nav className="student-topnav" aria-label="Área do aluno">
            <button type="button" className={homeActive ? 'is-active' : ''} onClick={() => navigate('/aluno')}>Início</button>
            <button type="button" className={processActive ? 'is-active' : ''} onClick={() => navigate('/aluno/processo')}>Etapas</button>
            <button type="button" className={calendarActive ? 'is-active' : ''} onClick={() => navigate('/aluno/agenda')}>Agenda</button>
            <button type="button" className={examsActive ? 'is-active' : ''} onClick={() => navigate('/aluno/exame')}>Exames</button>
            <button type="button" className={guidesActive ? 'is-active' : ''} onClick={() => navigate('/aluno/guia')}>Guia</button>
            <button type="button" className={accountActive ? 'is-active' : ''} onClick={() => navigate('/aluno/conta')}>Conta</button>
          </nav>
        )}
        <button type="button" onClick={() => void logout()}>Sair</button>
      </header>
      <main className="student-main">{content}</main>
    </div>
  );
}
