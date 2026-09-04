import { FormEvent, useEffect, useState } from 'react';
import './admin-security.css';

type SecuritySnapshot = {
  passwordVersion: number;
  credentialUpdatedAt: string;
  failedAttempts: number;
  lockedUntil: string | null;
  disabled: boolean;
  activeSessions: number;
};

type ChangeReceipt = {
  passwordVersion: number;
  revokedOtherSessions: number;
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
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || 'Não foi possível concluir a operação.');
  return body;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function AdminSecurity() {
  const [snapshot, setSnapshot] = useState<SecuritySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function load() {
    const value = await api<SecuritySnapshot>('/api/admin/security');
    setSnapshot(value);
  }

  useEffect(() => {
    let alive = true;
    void api<SecuritySnapshot>('/api/admin/security')
      .then((value) => { if (alive) setSnapshot(value); })
      .catch((candidate) => { if (alive) setError(candidate instanceof Error ? candidate.message : 'Não foi possível carregar a segurança.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSuccess('');
    const form = event.currentTarget;
    const data = new FormData(form);
    const currentPassword = String(data.get('currentPassword') || '');
    const newPassword = String(data.get('newPassword') || '');
    const confirmPassword = String(data.get('confirmPassword') || '');

    if (newPassword.length < 12) {
      setError('A nova senha deve ter pelo menos 12 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('A confirmação da nova senha não confere.');
      return;
    }

    setBusy(true);
    try {
      const receipt = await api<ChangeReceipt>('/api/admin/security/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      form.reset();
      await load();
      setSuccess(
        receipt.revokedOtherSessions === 0
          ? 'Senha alterada. Esta sessão continua ativa.'
          : `Senha alterada. ${receipt.revokedOtherSessions} outra(s) sessão(ões) foram encerradas.`,
      );
    } catch (candidate) {
      setError(candidate instanceof Error ? candidate.message : 'Não foi possível alterar a senha.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-security" aria-labelledby="security-title">
      <header className="admin-security-head">
        <div>
          <p className="admin-eyebrow">CONTA</p>
          <h1 id="security-title">Segurança</h1>
          <p>Altere sua própria credencial sem depender das variáveis de bootstrap da infraestrutura.</p>
        </div>
      </header>

      {loading ? (
        <div className="admin-security-loading">Carregando estado da credencial…</div>
      ) : snapshot ? (
        <div className="admin-security-facts" aria-label="Estado da credencial">
          <article>
            <span>VERSÃO DA SENHA</span>
            <strong>{snapshot.passwordVersion}</strong>
            <small>Incrementa a cada alteração ou recuperação.</small>
          </article>
          <article>
            <span>ÚLTIMA ALTERAÇÃO</span>
            <strong>{formatDate(snapshot.credentialUpdatedAt)}</strong>
            <small>Timestamp persistido no PostgreSQL.</small>
          </article>
          <article>
            <span>SESSÕES ATIVAS</span>
            <strong>{snapshot.activeSessions}</strong>
            <small>Ao trocar a senha, apenas esta sessão permanece.</small>
          </article>
          <article>
            <span>ESTADO</span>
            <strong>{snapshot.disabled ? 'Desabilitada' : snapshot.lockedUntil ? 'Bloqueio temporário' : 'Ativa'}</strong>
            <small>{snapshot.failedAttempts ? `${snapshot.failedAttempts} tentativa(s) inválida(s) acumulada(s).` : 'Sem tentativas inválidas acumuladas.'}</small>
          </article>
        </div>
      ) : null}

      <div className="admin-security-grid">
        <form className="admin-security-card admin-security-form" onSubmit={submit}>
          <div>
            <p className="admin-eyebrow">CREDENCIAL</p>
            <h2>Alterar senha</h2>
            <p>A senha atual é verificada contra o hash Argon2id. A nova senha nunca é persistida em texto.</p>
          </div>

          <label>
            Senha atual
            <input name="currentPassword" type="password" autoComplete="current-password" required />
          </label>
          <label>
            Nova senha
            <input name="newPassword" type="password" autoComplete="new-password" minLength={12} required />
            <small>Mínimo de 12 caracteres e diferente da senha atual.</small>
          </label>
          <label>
            Confirmar nova senha
            <input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} required />
          </label>

          {error && <p className="admin-security-error" role="alert">{error}</p>}
          {success && <p className="admin-security-success" role="status">{success}</p>}
          <button className="admin-primary" type="submit" disabled={busy}>{busy ? 'Alterando…' : 'Alterar senha'}</button>
        </form>

        <aside className="admin-security-card admin-security-recovery">
          <p className="admin-eyebrow">RECUPERAÇÃO</p>
          <h2>Perdeu o acesso?</h2>
          <p>A recuperação é uma operação separada da troca normal. Ela não acontece automaticamente quando uma variável da Railway muda.</p>
          <div className="admin-security-rule">
            <strong>Troca normal</strong>
            <span>Exige sessão autenticada + senha atual. Mantém esta sessão e encerra as demais.</span>
          </div>
          <div className="admin-security-rule">
            <strong>Recuperação operacional</strong>
            <span>É executada fora da sessão, substitui a credencial persistida, limpa bloqueios e encerra todas as sessões.</span>
          </div>
          <p className="admin-security-note">A variável <code>CENTRO_BOOTSTRAP_ADMIN_PASSWORD</code> continua sendo somente a origem do primeiro bootstrap; ela não é uma fonte de verdade contínua da senha.</p>
        </aside>
      </div>
    </section>
  );
}
