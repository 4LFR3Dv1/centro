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
  if (!response.ok) throw new Error(body.error || 'Não foi possível concluir esta ação.');
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
      .catch((candidate) => { if (alive) setError(candidate instanceof Error ? candidate.message : 'Não foi possível carregar a segurança da sua conta.'); })
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
      setError('A nova senha precisa ter pelo menos 12 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('As duas novas senhas precisam ser iguais.');
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
          ? 'Senha alterada. Este dispositivo continua conectado.'
          : `Senha alterada. Você saiu de ${receipt.revokedOtherSessions} outro(s) dispositivo(s).`,
      );
    } catch (candidate) {
      setError(candidate instanceof Error ? candidate.message : 'Não foi possível alterar a senha. Confira a senha atual e tente novamente.');
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
          <p>Altere sua senha e veja se sua conta está conectada em outros dispositivos.</p>
        </div>
      </header>

      {loading ? (
        <div className="admin-security-loading" aria-live="polite">Carregando segurança da conta…</div>
      ) : snapshot ? (
        <div className="admin-security-facts" aria-label="Resumo de segurança da conta">
          <article>
            <span>ÚLTIMA TROCA DE SENHA</span>
            <strong>{formatDate(snapshot.credentialUpdatedAt)}</strong>
            <small>Data da última alteração registrada.</small>
          </article>
          <article>
            <span>DISPOSITIVOS CONECTADOS</span>
            <strong>{snapshot.activeSessions}</strong>
            <small>Ao trocar a senha, este dispositivo permanece conectado e os demais saem da conta.</small>
          </article>
          <article>
            <span>TENTATIVAS INCORRETAS</span>
            <strong>{snapshot.failedAttempts}</strong>
            <small>{snapshot.failedAttempts ? 'Tentativas recentes de senha incorreta.' : 'Nenhuma tentativa incorreta acumulada.'}</small>
          </article>
          <article>
            <span>ESTADO DO ACESSO</span>
            <strong>{snapshot.disabled ? 'Desativado' : snapshot.lockedUntil ? 'Bloqueado temporariamente' : 'Ativo'}</strong>
            <small>{snapshot.lockedUntil ? `Bloqueado até ${formatDate(snapshot.lockedUntil)}.` : snapshot.disabled ? 'Este acesso foi desativado.' : 'Você pode entrar normalmente.'}</small>
          </article>
        </div>
      ) : null}

      <div className="admin-security-grid">
        <form className="admin-security-card admin-security-form" onSubmit={submit}>
          <div>
            <p className="admin-eyebrow">SENHA</p>
            <h2>Trocar minha senha</h2>
            <p>Use sua senha atual para escolher uma nova. Depois da troca, os outros dispositivos serão desconectados.</p>
          </div>

          <label>
            Senha atual
            <input name="currentPassword" type="password" autoComplete="current-password" required />
          </label>
          <label>
            Nova senha
            <input name="newPassword" type="password" autoComplete="new-password" minLength={12} required />
            <small>Use pelo menos 12 caracteres e escolha uma senha diferente da atual.</small>
          </label>
          <label>
            Digite a nova senha novamente
            <input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} required />
          </label>

          {error && <p className="admin-security-error" role="alert">{error}</p>}
          {success && <p className="admin-security-success" role="status">{success}</p>}
          <button className="admin-primary" type="submit" disabled={busy}>{busy ? 'Salvando…' : 'Trocar minha senha'}</button>
        </form>

        <aside className="admin-security-card admin-security-recovery">
          <p className="admin-eyebrow">RECUPERAÇÃO</p>
          <h2>Não consegue entrar?</h2>
          <p>A recuperação de acesso é separada da troca normal de senha. Use-a somente quando você não consegue entrar na conta.</p>
          <div className="admin-security-rule">
            <strong>Se você ainda consegue entrar</strong>
            <span>Troque a senha nesta tela. Este dispositivo permanece conectado e os outros são desconectados.</span>
          </div>
          <div className="admin-security-rule">
            <strong>Se você perdeu o acesso</strong>
            <span>Peça a recuperação da conta a um administrador autorizado. A recuperação substitui a senha atual e encerra todos os acessos abertos.</span>
          </div>
          <p className="admin-security-note">A equipe não deve compartilhar senhas entre usuários. Cada pessoa usa o próprio acesso.</p>
        </aside>
      </div>
    </section>
  );
}
