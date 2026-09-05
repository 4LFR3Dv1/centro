import { FormEvent, useEffect, useMemo, useState } from 'react';

type PersistentMilestoneCode = 'REGISTRATION_DONE' | 'HEALTH_DONE' | 'THEORY_PASSED' | 'PRACTICE_DONE' | 'PRACTICAL_EXAM_PASSED' | 'LICENSE_AVAILABLE';

type OperationalCommand =
  | { kind: 'ACHIEVE_MILESTONE'; label: string; milestoneCode: PersistentMilestoneCode; confirmationTitle: string; confirmationDetail: string }
  | { kind: 'SCHEDULE_THEORY_EXAM'; label: string }
  | { kind: 'MANAGE_THEORY_EXAM'; label: string; attemptId: string; scheduledFor: string; attendanceStatus: 'PENDING' | 'PRESENT'; observedResult: 'PENDING' | 'APPROVED' | 'FAILED'; officialResult: 'PENDING' | 'APPROVED' | 'FAILED' }
  | { kind: 'SCHEDULE_LESSON'; label: string }
  | { kind: 'ADD_TO_PRACTICAL_EXAM'; label: string }
  | { kind: 'MANAGE_PRACTICAL_EXAM'; label: string; sessionId: string; candidateId: string; officialScheduledFor: string; attendanceStatus: 'PENDING' | 'PRESENT' | 'ABSENT'; observedResult: 'PENDING' | 'APPROVED' | 'FAILED'; officialResult: 'PENDING' | 'APPROVED' | 'FAILED' }
  | { kind: 'OPEN_URL'; label: string; href: string };

type OperationalAction = {
  enrollmentId: string;
  category: 'A' | 'B' | 'AB' | 'D';
};

type ExamSession = {
  id: string;
  category: 'A' | 'B' | 'D';
  locationLabel: string;
  startsAt: string;
  endsAt: string;
  status: 'PLANNED' | 'CONFIRMED' | 'CLOSED' | 'CANCELLED';
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
  if (!response.ok) throw new Error(body.error || 'A operação não pôde ser concluída.');
  return body;
}

function localInput(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  const hour = String(value.getHours()).padStart(2, '0');
  const minute = String(value.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function defaultFuture(): string {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  date.setHours(9, 0, 0, 0);
  return localInput(date);
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function Shell({ title, eyebrow, onClose, children }: { title: string; eyebrow: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="admin-ops-modal-backdrop" role="presentation">
      <section className="admin-ops-modal" role="dialog" aria-modal="true">
        <div className="admin-card-title">
          <div><span>{eyebrow}</span><h2>{title}</h2></div>
          <button className="admin-ops-close" type="button" onClick={onClose} aria-label="Fechar">×</button>
        </div>
        {children}
      </section>
    </div>
  );
}

function MilestoneDialog({ studentId, action, command, onClose, onChanged }: {
  studentId: string;
  action: OperationalAction;
  command: Extract<OperationalCommand, { kind: 'ACHIEVE_MILESTONE' }>;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      await api(`/api/admin/process/enrollments/${action.enrollmentId}/milestones/${command.milestoneCode}/achieve`, {
        method: 'POST', body: JSON.stringify({ note: note || null }),
      });
      window.dispatchEvent(new CustomEvent('centro:process-changed', { detail: { studentId, enrollmentId: action.enrollmentId } }));
      onChanged();
    } catch (candidate) { setError(candidate instanceof Error ? candidate.message : 'Não foi possível registrar a conclusão.'); }
    finally { setBusy(false); }
  }

  return (
    <Shell title={command.confirmationTitle} eyebrow="CONFIRMAÇÃO INSTITUCIONAL" onClose={onClose}>
      <p>{command.confirmationDetail}</p>
      <form className="admin-ops-form" onSubmit={submit}>
        <label>Observação / evidência<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Opcional, mas útil para auditoria." /></label>
        {error && <p className="admin-error" role="alert">{error}</p>}
        <div className="admin-ops-form-actions">
          <button className="admin-secondary" type="button" onClick={onClose}>Cancelar</button>
          <button className="admin-primary" type="submit" disabled={busy}>{busy ? 'Registrando…' : 'Confirmar conclusão'}</button>
        </div>
      </form>
    </Shell>
  );
}

function TheoryDialog({ studentId, action, command, onClose, onChanged }: {
  studentId: string;
  action: OperationalAction;
  command: Extract<OperationalCommand, { kind: 'SCHEDULE_THEORY_EXAM' | 'MANAGE_THEORY_EXAM' }>;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [scheduledForLocal, setScheduledForLocal] = useState(command.kind === 'MANAGE_THEORY_EXAM' ? localInput(new Date(command.scheduledFor)) : defaultFuture());
  const [protocol, setProtocol] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run(path: string, body: unknown) {
    setBusy(true); setError('');
    try {
      await api(path, { method: 'POST', body: JSON.stringify(body) });
      window.dispatchEvent(new CustomEvent('centro:process-changed', { detail: { studentId, enrollmentId: action.enrollmentId } }));
      onChanged();
    } catch (candidate) { setError(candidate instanceof Error ? candidate.message : 'Não foi possível atualizar a prova teórica.'); }
    finally { setBusy(false); }
  }

  if (command.kind === 'SCHEDULE_THEORY_EXAM') {
    return (
      <Shell title="Agendar prova teórica" eyebrow="THEORY-EXAM-001" onClose={onClose}>
        <p>O agendamento cria uma tentativa histórica. Aprovação só será materializada depois da reconciliação do resultado oficial.</p>
        <form className="admin-ops-form" onSubmit={(event) => { event.preventDefault(); void run('/api/admin/theory-exams', { enrollmentId: action.enrollmentId, scheduledFor: new Date(scheduledForLocal).toISOString(), bookingSource: 'SCHOOL', protocol: protocol || null }); }}>
          <label>Data e hora<input type="datetime-local" required value={scheduledForLocal} onChange={(event) => setScheduledForLocal(event.target.value)} /></label>
          <label>Protocolo<input value={protocol} onChange={(event) => setProtocol(event.target.value)} placeholder="Opcional" /></label>
          {error && <p className="admin-error" role="alert">{error}</p>}
          <div className="admin-ops-form-actions"><button className="admin-secondary" type="button" onClick={onClose}>Cancelar</button><button className="admin-primary" disabled={busy}>{busy ? 'Agendando…' : 'Criar tentativa'}</button></div>
        </form>
      </Shell>
    );
  }

  const base = `/api/admin/theory-exams/${command.attemptId}`;
  return (
    <Shell title="Prova teórica" eyebrow="EXECUÇÃO CONTEXTUAL" onClose={onClose}>
      <p>Agendada para <strong>{dateTime(command.scheduledFor)}</strong>.</p>
      {command.attendanceStatus === 'PENDING' ? (
        <>
          <div className="admin-ops-form-actions">
            <button className="admin-primary" disabled={busy} type="button" onClick={() => void run(`${base}/attendance`, { attendanceStatus: 'PRESENT' })}>Registrar presença</button>
            <button className="admin-secondary" disabled={busy} type="button" onClick={() => void run(`${base}/attendance`, { attendanceStatus: 'ABSENT' })}>Registrar ausência</button>
          </div>
          <form className="admin-ops-form" onSubmit={(event) => { event.preventDefault(); void run(`${base}/reschedule`, { scheduledFor: new Date(scheduledForLocal).toISOString(), protocol: protocol || null }); }}>
            <label>Remarcar para<input type="datetime-local" value={scheduledForLocal} onChange={(event) => setScheduledForLocal(event.target.value)} /></label>
            <label>Protocolo<input value={protocol} onChange={(event) => setProtocol(event.target.value)} placeholder="Opcional" /></label>
            <button className="admin-secondary" disabled={busy}>Remarcar</button>
          </form>
        </>
      ) : command.observedResult === 'PENDING' ? (
        <div className="admin-ops-form-actions">
          <button className="admin-primary" disabled={busy} type="button" onClick={() => void run(`${base}/observed-result`, { result: 'APPROVED' })}>Observado: aprovado</button>
          <button className="admin-secondary" disabled={busy} type="button" onClick={() => void run(`${base}/observed-result`, { result: 'FAILED' })}>Observado: reprovado</button>
        </div>
      ) : (
        <>
          <p>Resultado observado: <strong>{command.observedResult === 'APPROVED' ? 'APROVADO' : 'REPROVADO'}</strong>. Agora registre o resultado oficial.</p>
          <div className="admin-ops-form-actions">
            <button className="admin-primary" disabled={busy} type="button" onClick={() => void run(`${base}/official-result`, { result: 'APPROVED' })}>Oficial: aprovado</button>
            <button className="admin-secondary" disabled={busy} type="button" onClick={() => void run(`${base}/official-result`, { result: 'FAILED' })}>Oficial: reprovado</button>
          </div>
        </>
      )}
      {error && <p className="admin-error" role="alert">{error}</p>}
    </Shell>
  );
}

function PracticalExamDialog({ studentId, action, command, onClose, onChanged }: {
  studentId: string;
  action: OperationalAction;
  command: Extract<OperationalCommand, { kind: 'ADD_TO_PRACTICAL_EXAM' | 'MANAGE_PRACTICAL_EXAM' }>;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [sessions, setSessions] = useState<ExamSession[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [officialLocal, setOfficialLocal] = useState('');
  const [protocol, setProtocol] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const compatible = useMemo(() => sessions.filter((session) => session.status === 'PLANNED' || session.status === 'CONFIRMED').filter((session) => action.category === 'AB' ? session.category === 'A' || session.category === 'B' : session.category === action.category), [sessions, action.category]);

  useEffect(() => {
    if (command.kind !== 'ADD_TO_PRACTICAL_EXAM') return;
    const from = new Date();
    const to = new Date(Date.now() + 90 * 86400000);
    void api<{ sessions: ExamSession[] }>(`/api/admin/exams?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`)
      .then((value) => setSessions(value.sessions))
      .catch((candidate) => setError(candidate instanceof Error ? candidate.message : 'Não foi possível carregar listas de exame.'));
  }, [command.kind]);

  useEffect(() => {
    if (command.kind !== 'ADD_TO_PRACTICAL_EXAM') return;
    const selected = compatible.find((item) => item.id === sessionId) ?? compatible[0];
    setSessionId(selected?.id ?? '');
    setOfficialLocal(selected ? localInput(new Date(selected.startsAt)) : '');
  }, [compatible.map((item) => item.id).join('|')]);

  async function run(path: string, body: unknown) {
    setBusy(true); setError('');
    try {
      await api(path, { method: 'POST', body: JSON.stringify(body) });
      window.dispatchEvent(new CustomEvent('centro:process-changed', { detail: { studentId, enrollmentId: action.enrollmentId } }));
      onChanged();
    } catch (candidate) { setError(candidate instanceof Error ? candidate.message : 'Não foi possível atualizar o exame prático.'); }
    finally { setBusy(false); }
  }

  if (command.kind === 'ADD_TO_PRACTICAL_EXAM') {
    const selected = compatible.find((item) => item.id === sessionId) ?? null;
    return (
      <Shell title="Encaminhar para exame prático" eyebrow="EXAMS-001" onClose={onClose}>
        <p>Escolha uma lista operacional compatível. A inclusão continuará sujeita ao kernel de categoria, matrícula, aluno e conflitos.</p>
        {compatible.length === 0 ? <p className="admin-ops-warning">Nenhuma lista aberta compatível. Crie uma lista em Exames antes de encaminhar este aluno.</p> : (
          <form className="admin-ops-form" onSubmit={(event) => { event.preventDefault(); if (!selected) return; void run(`/api/admin/exams/${selected.id}/candidates`, { enrollmentId: action.enrollmentId, officialScheduledFor: new Date(officialLocal).toISOString(), bookingSource: 'SCHOOL', protocol: protocol || null, feeStatus: 'UNKNOWN', ladvStatus: 'UNKNOWN' }); }}>
            <label>Lista<select value={sessionId} onChange={(event) => { const id = event.target.value; setSessionId(id); const next = compatible.find((item) => item.id === id); if (next) setOfficialLocal(localInput(new Date(next.startsAt))); }}>{compatible.map((item) => <option key={item.id} value={item.id}>{dateTime(item.startsAt)} · {item.category} · {item.locationLabel}</option>)}</select></label>
            <label>Horário oficial<input type="datetime-local" value={officialLocal} onChange={(event) => setOfficialLocal(event.target.value)} required /></label>
            <label>Protocolo<input value={protocol} onChange={(event) => setProtocol(event.target.value)} placeholder="Opcional" /></label>
            <div className="admin-ops-form-actions"><button className="admin-secondary" type="button" onClick={onClose}>Cancelar</button><button className="admin-primary" disabled={busy || !selected}>{busy ? 'Encaminhando…' : 'Adicionar à lista'}</button></div>
          </form>
        )}
        {error && <p className="admin-error" role="alert">{error}</p>}
      </Shell>
    );
  }

  const base = `/api/admin/exams/${command.sessionId}/candidates/${command.candidateId}`;
  return (
    <Shell title="Exame prático" eyebrow="EXECUÇÃO CONTEXTUAL" onClose={onClose}>
      <p>Horário oficial: <strong>{dateTime(command.officialScheduledFor)}</strong>.</p>
      {command.attendanceStatus === 'PENDING' ? (
        <div className="admin-ops-form-actions">
          <button className="admin-primary" disabled={busy} type="button" onClick={() => void run(`${base}/attendance`, { attendanceStatus: 'PRESENT' })}>Registrar presença</button>
          <button className="admin-secondary" disabled={busy} type="button" onClick={() => void run(`${base}/attendance`, { attendanceStatus: 'ABSENT' })}>Registrar ausência</button>
        </div>
      ) : command.attendanceStatus === 'ABSENT' ? (
        <p>Ausência já registrada. Encerre a lista operacional antes de um novo encaminhamento.</p>
      ) : command.observedResult === 'PENDING' ? (
        <div className="admin-ops-form-actions">
          <button className="admin-primary" disabled={busy} type="button" onClick={() => void run(`${base}/observed-result`, { result: 'APPROVED' })}>Observado: aprovado</button>
          <button className="admin-secondary" disabled={busy} type="button" onClick={() => void run(`${base}/observed-result`, { result: 'FAILED' })}>Observado: reprovado</button>
        </div>
      ) : (
        <>
          <p>Resultado observado: <strong>{command.observedResult === 'APPROVED' ? 'APROVADO' : 'REPROVADO'}</strong>. Reconcilie o resultado oficial.</p>
          <div className="admin-ops-form-actions">
            <button className="admin-primary" disabled={busy} type="button" onClick={() => void run(`${base}/official-result`, { result: 'APPROVED' })}>Oficial: aprovado</button>
            <button className="admin-secondary" disabled={busy} type="button" onClick={() => void run(`${base}/official-result`, { result: 'FAILED' })}>Oficial: reprovado</button>
          </div>
        </>
      )}
      {error && <p className="admin-error" role="alert">{error}</p>}
    </Shell>
  );
}

export function OperationalCommandDialog({ studentId, action, command, onClose, onChanged }: {
  studentId: string;
  action: OperationalAction;
  command: OperationalCommand;
  onClose: () => void;
  onChanged: () => void;
}) {
  if (command.kind === 'ACHIEVE_MILESTONE') return <MilestoneDialog studentId={studentId} action={action} command={command} onClose={onClose} onChanged={onChanged} />;
  if (command.kind === 'SCHEDULE_THEORY_EXAM' || command.kind === 'MANAGE_THEORY_EXAM') return <TheoryDialog studentId={studentId} action={action} command={command} onClose={onClose} onChanged={onChanged} />;
  if (command.kind === 'ADD_TO_PRACTICAL_EXAM' || command.kind === 'MANAGE_PRACTICAL_EXAM') return <PracticalExamDialog studentId={studentId} action={action} command={command} onClose={onClose} onChanged={onChanged} />;
  return null;
}

export type { OperationalAction, OperationalCommand };
