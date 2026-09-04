import { FormEvent, useEffect, useState } from 'react';
import './student-security.css';

type SecuritySnapshot = {
  passwordVersion: number;
  credentialUpdatedAt: string;
  failedAttempts: number;
  lockedUntil: string | null;
  disabledAt: string | null;
  activeSessions: number;
  currentSessionId: string;
};

async function securityApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || 'Não foi possível concluir a operação de segurança.');
  return body;
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function StudentSecurity({ publicId }: { publicId: string }) {
  const [snapshot, setSnapshot] = useState<SecuritySnapshot | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function reload() {
    setSnapshot(await securityApi<SecuritySnapshot>('/api/student/security'));
  }

  useEffect(() => { void reload().catch((candidate) => setError(candidate instanceof Error ? candidate.message : 'Não foi possível carregar sua conta.')); }, []);

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setError(''); setMessage('');
    if (newPassword.length < 12) { setError('Use pelo menos 12 caracteres.'); return; }
    if (newPassword !== confirmation) { setError('As senhas não coincidem.'); return; }
    setBusy(true);
    try {
      const result = await securityApi<{ revokedSessions: number; passwordVersion: number }>('/api/student/security/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword(''); setNewPassword(''); setConfirmation('');
      setMessage(result.revokedSessions > 0 ? `Senha alterada. ${result.revokedSessions} outra(s) sessão(ões) foram encerradas.` : 'Senha alterada.');
      await reload();
    } catch (candidate) {
      setError(candidate instanceof Error ? candidate.message : 'Não foi possível alterar sua senha.');
    } finally { setBusy(false); }
  }

  async function revokeOthers() {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await securityApi<{ revokedSessions: number }>('/api/student/security/sessions/revoke-others', { method: 'POST' });
      setMessage(result.revokedSessions ? `${result.revokedSessions} outra(s) sessão(ões) encerradas.` : 'Não havia outras sessões ativas.');
      await reload();
    } catch (candidate) {
      setError(candidate instanceof Error ? candidate.message : 'Não foi possível encerrar outras sessões.');
    } finally { setBusy(false); }
  }

  return (
    <div className="student-security-page">
      <section className="student-security-hero"><p className="student-eyebrow">MINHA CONTA</p><h1>Seu acesso.</h1><p>Seu ID do aluno é sua identidade de entrada. Documento e CPF nunca são usados como login.</p></section>
      <section className="student-security-overview">
        <div><span>ID DO ALUNO</span><strong>{publicId}</strong></div>
        <div><span>VERSÃO DA SENHA</span><strong>{snapshot?.passwordVersion ?? '—'}</strong></div>
        <div><span>SESSÕES ATIVAS</span><strong>{snapshot?.activeSessions ?? '—'}</strong></div>
        <div><span>ÚLTIMA ALTERAÇÃO</span><strong>{snapshot ? dateTime(snapshot.credentialUpdatedAt) : '—'}</strong></div>
      </section>

      <section className="student-panel student-security-form-card">
        <div><p className="student-eyebrow">SENHA</p><h2>Alterar senha</h2><p>Ao trocar sua senha, esta sessão continua aberta e as outras sessões ativas são revogadas.</p></div>
        <form className="student-form" onSubmit={changePassword}>
          <label>Senha atual<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label>
          <label>Nova senha<input type="password" minLength={12} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label>
          <label>Confirmar nova senha<input type="password" minLength={12} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required /></label>
          {error && <p className="student-error" role="alert">{error}</p>}
          {message && <p className="student-security-success">{message}</p>}
          <button className="student-primary" type="submit" disabled={busy}>{busy ? 'Salvando…' : 'Alterar senha'}</button>
        </form>
      </section>

      <section className="student-panel student-security-sessions">
        <div><p className="student-eyebrow">SESSÕES</p><h2>Dispositivos conectados</h2><p>{snapshot?.activeSessions ?? 0} sessão(ões) ativas. Você pode encerrar todas as outras sem sair deste dispositivo.</p></div>
        <button className="student-secondary" type="button" onClick={() => void revokeOthers()} disabled={busy || (snapshot?.activeSessions ?? 0) <= 1}>Encerrar outras sessões</button>
      </section>
    </div>
  );
}
