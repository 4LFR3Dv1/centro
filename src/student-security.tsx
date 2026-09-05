import { FormEvent, useEffect, useState } from 'react';
import { ExceptionGuidanceCard, type ExceptionGuidance } from './exception-guidance';
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
  if (!response.ok) throw new Error(body.error || 'Não foi possível concluir esta ação.');
  return body;
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function accessState(snapshot: SecuritySnapshot | null): ExceptionGuidance | null {
  if (!snapshot) return null;
  if (snapshot.disabledAt) {
    return {
      kind: 'ACCESS_BLOCKED',
      title: 'Seu acesso foi desativado pela escola.',
      detail: 'Você não conseguirá iniciar novas entradas enquanto o acesso estiver desativado.',
      consequence: 'Sua matrícula e seu histórico não são apagados por causa disso.',
      actor: 'STAFF',
      actionHint: 'Entre em contato com a escola para solicitar a liberação.',
    };
  }
  if (snapshot.lockedUntil && new Date(snapshot.lockedUntil).getTime() > Date.now()) {
    return {
      kind: 'ACCESS_BLOCKED',
      title: 'Novas tentativas estão temporariamente bloqueadas.',
      detail: `Você poderá tentar entrar novamente depois de ${dateTime(snapshot.lockedUntil)}.`,
      consequence: 'Não é necessário trocar sua senha apenas por causa deste bloqueio temporário.',
      actor: 'NONE',
    };
  }
  return null;
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
    if (newPassword.length < 12) { setError('Sua nova senha precisa ter pelo menos 12 caracteres.'); return; }
    if (newPassword !== confirmation) { setError('As duas novas senhas precisam ser iguais.'); return; }
    setBusy(true);
    try {
      const result = await securityApi<{ revokedSessions: number; passwordVersion: number }>('/api/student/security/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword(''); setNewPassword(''); setConfirmation('');
      setMessage(result.revokedSessions > 0 ? `Senha alterada. Você saiu de ${result.revokedSessions} outro(s) dispositivo(s).` : 'Senha alterada com sucesso.');
      await reload();
    } catch (candidate) {
      setError(candidate instanceof Error ? candidate.message : 'Não foi possível alterar sua senha. Confira a senha atual e tente novamente.');
    } finally { setBusy(false); }
  }

  async function revokeOthers() {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await securityApi<{ revokedSessions: number }>('/api/student/security/sessions/revoke-others', { method: 'POST' });
      setMessage(result.revokedSessions ? `Você saiu de ${result.revokedSessions} outro(s) dispositivo(s).` : 'Você não estava conectado em outros dispositivos.');
      await reload();
    } catch (candidate) {
      setError(candidate instanceof Error ? candidate.message : 'Não foi possível sair dos outros dispositivos. Tente novamente.');
    } finally { setBusy(false); }
  }

  const exception = accessState(snapshot);

  return (
    <div className="student-security-page">
      <section className="student-security-hero"><p className="student-eyebrow">MINHA CONTA</p><h1>Seu acesso.</h1><p>Use seu ID Centro e sua senha para entrar. CPF e documento não são usados no login.</p></section>
      <section className="student-security-overview">
        <div><span>SEU ID CENTRO</span><strong>{publicId}</strong></div>
        <div><span>DISPOSITIVOS CONECTADOS</span><strong>{snapshot?.activeSessions ?? '—'}</strong></div>
        <div><span>ÚLTIMA TROCA DE SENHA</span><strong>{snapshot ? dateTime(snapshot.credentialUpdatedAt) : '—'}</strong></div>
      </section>

      {exception && <ExceptionGuidanceCard guidance={exception} />}

      <section className="student-panel student-security-form-card">
        <div><p className="student-eyebrow">SENHA</p><h2>Trocar minha senha</h2><p>Depois da troca, este dispositivo continua conectado e os outros são desconectados.</p></div>
        <form className="student-form" onSubmit={changePassword}>
          <label>Senha atual<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label>
          <label>Nova senha<input type="password" minLength={12} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /><small>Use pelo menos 12 caracteres.</small></label>
          <label>Digite a nova senha novamente<input type="password" minLength={12} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required /></label>
          {error && <p className="student-error" role="alert">{error}</p>}
          {message && <p className="student-security-success" role="status">{message}</p>}
          <button className="student-primary" type="submit" disabled={busy}>{busy ? 'Salvando…' : 'Trocar minha senha'}</button>
        </form>
      </section>

      <section className="student-panel student-security-sessions">
        <div><p className="student-eyebrow">DISPOSITIVOS</p><h2>Onde sua conta está conectada</h2><p>{snapshot?.activeSessions ?? 0} dispositivo(s) conectado(s). Se você não reconhecer algum acesso, saia dos outros dispositivos e troque sua senha.</p></div>
        <button className="student-secondary" type="button" onClick={() => void revokeOthers()} disabled={busy || (snapshot?.activeSessions ?? 0) <= 1}>Sair dos outros dispositivos</button>
      </section>
    </div>
  );
}
