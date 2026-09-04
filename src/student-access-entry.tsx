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
  const [publicId, setPublicId] = useState('');
  const [password, setPassword] = useState('');
  const [resolving, setResolving] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setResolving(true);
    setError('');
    void json<{ publicId: string }>(`/api/student/access/${encodeURIComponent(publicToken)}`)
      .then((value) => { if (alive) setPublicId(value.publicId); })
      .catch((candidate) => { if (alive) setError(candidate instanceof Error ? candidate.message : 'QR inválido.'); })
      .finally(() => { if (alive) setResolving(false); });
    return () => { alive = false; };
  }, [publicToken]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!publicId) return;
    setBusy(true);
    setError('');
    try {
      const session = await json<StudentSessionPayload>('/api/student/auth/login', {
        method: 'POST',
        body: JSON.stringify({ publicId, password }),
      });
      setPassword('');
      onAuthenticated(session);
    } catch (candidate) {
      setError(candidate instanceof Error ? candidate.message : 'Não foi possível entrar.');
    } finally { setBusy(false); }
  }

  return (
    <main className="student-login-page student-access-entry">
      <section className="student-login-card" aria-labelledby="student-access-title">
        <a className="student-wordmark" href="/">Centro</a>
        <p className="student-eyebrow">ACESSO POR QR</p>
        <h1 id="student-access-title">Sua área, direto do cartão.</h1>
        {resolving ? (
          <p className="student-lead">Identificando seu acesso…</p>
        ) : publicId ? (
          <>
            <div className="student-access-identity">
              <span>ID CENTRO</span>
              <strong>{publicId}</strong>
              <small>O QR só localiza sua identidade. Sua senha continua obrigatória.</small>
            </div>
            <form className="student-form" onSubmit={submit}>
              <label>Senha<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" autoFocus required /></label>
              {error && <p className="student-error" role="alert">{error}</p>}
              <button className="student-primary" disabled={busy} type="submit">{busy ? 'Entrando…' : 'Entrar'}</button>
            </form>
          </>
        ) : (
          <>
            <p className="student-error" role="alert">{error || 'Este QR não está disponível.'}</p>
            <button className="student-primary" type="button" onClick={onManualLogin}>Digitar meu ID</button>
          </>
        )}
      </section>
    </main>
  );
}
