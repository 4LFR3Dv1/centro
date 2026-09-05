import { FormEvent, useEffect, useState } from 'react';

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

type AccessResolution = {
  publicId: string;
  firstName: string;
  activationRequired: boolean;
};

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || 'Não foi possível abrir este acesso.');
  return body;
}

export function StudentAccessEntry({ publicToken, onAuthenticated, onManualLogin }: {
  publicToken: string;
  onAuthenticated: (session: StudentSessionPayload) => void;
  onManualLogin: () => void;
}) {
  const [resolution, setResolution] = useState<AccessResolution | null>(null);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [resolving, setResolving] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setResolving(true);
    setError('');
    setResolution(null);
    void json<AccessResolution>(`/api/student/access/${encodeURIComponent(publicToken)}`)
      .then((value) => { if (alive) setResolution(value); })
      .catch((candidate) => { if (alive) setError(candidate instanceof Error ? candidate.message : 'Este QR não está disponível.'); })
      .finally(() => { if (alive) setResolving(false); });
    return () => { alive = false; };
  }, [publicToken]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!resolution) return;
    setError('');

    if (resolution.activationRequired) {
      if (password.length < 12) { setError('Sua senha precisa ter pelo menos 12 caracteres.'); return; }
      if (password !== confirmation) { setError('As duas senhas precisam ser iguais.'); return; }
    }

    setBusy(true);
    try {
      const path = resolution.activationRequired
        ? `/api/student/access/${encodeURIComponent(publicToken)}/activate`
        : '/api/student/auth/login';
      const session = await json<StudentSessionPayload>(path, {
        method: 'POST',
        body: JSON.stringify(resolution.activationRequired
          ? { password }
          : { publicId: resolution.publicId, password }),
      });
      setPassword('');
      setConfirmation('');
      onAuthenticated(session);
    } catch (candidate) {
      setError(candidate instanceof Error ? candidate.message : resolution.activationRequired ? 'Não foi possível ativar seu acesso. Tente novamente.' : 'Não foi possível entrar. Confira sua senha.');
    } finally { setBusy(false); }
  }

  return (
    <main className="student-login-page student-access-entry">
      <section className="student-login-card" aria-labelledby="student-access-title">
        <a className="student-wordmark" href="/">Centro</a>
        <p className="student-eyebrow">{resolution?.activationRequired ? 'PRIMEIRO ACESSO' : 'ENTRAR COM QR'}</p>
        <h1 id="student-access-title">
          {resolution?.activationRequired ? `Olá, ${resolution.firstName}.` : 'Seu ID já está pronto.'}
        </h1>

        {resolving ? (
          <p className="student-lead" aria-live="polite">Verificando seu acesso…</p>
        ) : resolution ? (
          <>
            <div className="student-access-identity">
              <span>SEU ID CENTRO</span>
              <strong>{resolution.publicId}</strong>
              <small>
                {resolution.activationRequired
                  ? 'Sua matrícula está pronta. Crie agora a senha que você usará para entrar na sua área.'
                  : 'Seu ID já foi identificado. Digite sua senha para entrar.'}
              </small>
            </div>

            <form className="student-form" onSubmit={submit}>
              <label>
                {resolution.activationRequired ? 'Crie sua senha' : 'Senha'}
                <input
                  type="password"
                  minLength={resolution.activationRequired ? 12 : undefined}
                  maxLength={128}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={resolution.activationRequired ? 'new-password' : 'current-password'}
                  autoFocus
                  required
                />
                {resolution.activationRequired && <small>Use pelo menos 12 caracteres.</small>}
              </label>
              {resolution.activationRequired && (
                <label>
                  Digite a senha novamente
                  <input
                    type="password"
                    minLength={12}
                    maxLength={128}
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    autoComplete="new-password"
                    required
                  />
                </label>
              )}
              {error && <p className="student-error" role="alert">{error}</p>}
              <button className="student-primary" disabled={busy} type="submit">
                {busy
                  ? (resolution.activationRequired ? 'Ativando…' : 'Entrando…')
                  : (resolution.activationRequired ? 'Criar senha e entrar' : 'Entrar')}
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="student-error" role="alert">{error || 'Este QR não está disponível.'}</p>
            <p className="student-lead">Você ainda pode entrar usando seu ID Centro e sua senha.</p>
            <button className="student-primary" type="button" onClick={onManualLogin}>Entrar com meu ID</button>
          </>
        )}
      </section>
    </main>
  );
}
