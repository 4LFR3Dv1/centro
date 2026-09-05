import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';

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
  if (!response.ok) throw new Error(body.error || 'Não foi possível concluir esta ação.');
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
  const dialogRef = useRef<HTMLElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previousFocus.current?.focus();
    };
  }, [onClose]);

  const titleId = `dialog-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`;
  return (
    <div className="admin-ops-modal-backdrop" role="presentation">
      <section ref={dialogRef} tabIndex={-1} className="admin-ops-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="admin-card-title">
          <div><span>{eyebrow}</span><h2 id={titleId}>{title}</h2></div>
          <button className="admin-ops-close" type="button" onClick={onClose} aria-label={`Fechar ${title.toLowerCase()}`}>×</button>
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
    } catch (candidate) { setError(candidate instanceof Error ? candidate.message : 'Não foi possível registrar a conclusão. Tente novamente.'); }
    finally { setBusy(false); }
  }

  return (
    <Shell title={command.confirmationTitle} eyebrow="CONFIRMAR ETAPA" onClose={onClose}>
      <p>{command.confirmationDetail}</p>
      <form className="admin-ops-form" onSubmit={submit}>
        <label>Observação opcional<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Registre aqui alguma informação útil para a equipe." /></label>
        {error && <p className="admin-error" role="alert">{error}</p>}
        <div className="admin-ops-form-actions">
          <button className="admin-secondary" type="button" onClick={onClose}>Cancelar</button>
          <button className="admin-primary" type="submit" disabled={busy}>{busy ? 'Registrando…' : command.label}</button>
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
    } catch (candidate) { setError(candidate instanceof Error ? candidate.message : 'Não foi possível atualizar a prova teórica. Tente novamente.'); }
    finally { setBusy(false); }
  }

  if (command.kind === 'SCHEDULE_THEORY_EXAM') {
    return (
      <Shell title="Agendar prova teórica" eyebrow="PROVA TEÓRICA" onClose={onClose}>
        <p>Marque a data informada para o aluno. Depois da prova, a equipe poderá registrar presença e resultado nesta mesma ficha.</p>
        <form className="admin-ops-form" onSubmit={(event) => { event.preventDefault(); void run('/api/admin/theory-exams', { enrollmentId: action.enrollmentId, scheduledFor: new Date(scheduledForLocal).toISOString(), bookingSource: 'SCHOOL', protocol: protocol || null }); }}>
          <label>Data e hora<input type="datetime-local" required value={scheduledForLocal} onChange={(event) => setScheduledForLocal(event.target.value)} /></label>
          <label>Protocolo<input value={protocol} onChange={(event) => setProtocol(event.target.value)} placeholder="Opcional" /></label>
          {error && <p className="admin-error" role="alert">{error}</p>}
          <div className="admin-ops-form-actions"><button className="admin-secondary" type="button" onClick={onClose}>Cancelar</button><button className="admin-primary" disabled={busy}>{busy ? 'Agendando…' : 'Agendar prova'}</button></div>
        </form>
      </Shell>
    );
  }

  const base = `/api/admin/theory-exams/${command.attemptId}`;
  return (
    <Shell title="Prova teórica" eyebrow="ATUALIZAR PROVA" onClose={onClose}>
      <p>Marcada para <strong>{dateTime(command.scheduledFor)}</strong>.</p>
      {command.attendanceStatus === 'PENDING' ? (
        <>
          <p>Depois da prova, registre se o aluno compareceu.</p>
          <div className="admin-ops-form-actions">
            <button className="admin-primary" disabled={busy} type="button" onClick={() => void run(`${base}/attendance`, { attendanceStatus: 'PRESENT' })}>Registrar presença</button>
            <button className="admin-secondary" disabled={busy} type="button" onClick={() => void run(`${base}/attendance`, { attendanceStatus: 'ABSENT' })}>Registrar ausência</button>
          </div>
          <form className="admin-ops-form" onSubmit={(event) => { event.preventDefault(); void run(`${base}/reschedule`, { scheduledFor: new Date(scheduledForLocal).toISOString(), protocol: protocol || null }); }}>
            <label>Nova data e hora<input type="datetime-local" value={scheduledForLocal} onChange={(event) => setScheduledForLocal(event.target.value)} /></label>
            <label>Protocolo<input value={protocol} onChange={(event) => setProtocol(event.target.value)} placeholder="Opcional" /></label>
            <button className="admin-secondary" disabled={busy}>Remarcar prova</button>
          </form>
        </>
      ) : command.observedResult === 'PENDING' ? (
        <>
          <p>O aluno compareceu. Registre o resultado informado à escola.</p>
          <div className="admin-ops-form-actions">
            <button className="admin-primary" disabled={busy} type="button" onClick={() => void run(`${base}/observed-result`, { result: 'APPROVED' })}>Registrar aprovação</button>
            <button className="admin-secondary" disabled={busy} type="button" onClick={() => void run(`${base}/observed-result`, { result: 'FAILED' })}>Registrar reprovação</button>
          </div>
        </>
      ) : (
        <>
          <p>A escola registrou o resultado como <strong>{command.observedResult === 'APPROVED' ? 'APROVADO' : 'REPROVADO'}</strong>. Agora confirme o resultado oficial.</p>
          <div className="admin-ops-form-actions">
            <button className="admin-primary" disabled={busy} type="button" onClick={() => void run(`${base}/official-result`, { result: 'APPROVED' })}>Confirmar aprovação oficial</button>
            <button className="admin-secondary" disabled={busy} type="button" onClick={() => void run(`${base}/official-result`, { result: 'FAILED' })}>Confirmar reprovação oficial</button>
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
      .catch((candidate) => setError(candidate instanceof Error ? candidate.message : 'Não foi possível carregar as datas de exame.'));
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
    } catch (candidate) { setError(candidate instanceof Error ? candidate.message : 'Não foi possível atualizar o exame prático. Tente novamente.'); }
    finally { setBusy(false); }
  }

  if (command.kind === 'ADD_TO_PRACTICAL_EXAM') {
    const selected = compatible.find((item) => item.id === sessionId) ?? null;
    return (
      <Shell title="Marcar exame prático" eyebrow="EXAME PRÁTICO" onClose={onClose}>
        <p>Escolha uma data compatível com a categoria do aluno. O Centro impede combinações incompatíveis.</p>
        {compatible.length === 0 ? <p className="admin-ops-warning" role="status">Não há nenhuma data de exame disponível para esta categoria. Crie uma data em Exames antes de continuar.</p> : (
          <form className="admin-ops-form" onSubmit={(event) => { event.preventDefault(); if (!selected) return; void run(`/api/admin/exams/${selected.id}/candidates`, { enrollmentId: action.enrollmentId, officialScheduledFor: new Date(officialLocal).toISOString(), bookingSource: 'SCHOOL', protocol: protocol || null, feeStatus: 'UNKNOWN', ladvStatus: 'UNKNOWN' }); }}>
            <label>Data de exame<select value={sessionId} onChange={(event) => { const id = event.target.value; setSessionId(id); const next = compatible.find((item) => item.id === id); if (next) setOfficialLocal(localInput(new Date(next.startsAt))); }}>{compatible.map((item) => <option key={item.id} value={item.id}>{dateTime(item.startsAt)} · {item.category} · {item.locationLabel}</option>)}</select></label>
            <label>Horário do aluno<input type="datetime-local" value={officialLocal} onChange={(event) => setOfficialLocal(event.target.value)} required /></label>
            <label>Protocolo<input value={protocol} onChange={(event) => setProtocol(event.target.value)} placeholder="Opcional" /></label>
            <div className="admin-ops-form-actions"><button className="admin-secondary" type="button" onClick={onClose}>Cancelar</button><button className="admin-primary" disabled={busy || !selected}>{busy ? 'Marcando…' : 'Marcar exame'}</button></div>
          </form>
        )}
        {error && <p className="admin-error" role="alert">{error}</p>}
      </Shell>
    );
  }

  const base = `/api/admin/exams/${command.sessionId}/candidates/${command.candidateId}`;
  return (
    <Shell title="Exame prático" eyebrow="ATUALIZAR EXAME" onClose={onClose}>
      <p>Marcado para <strong>{dateTime(command.officialScheduledFor)}</strong>.</p>
      {command.attendanceStatus === 'PENDING' ? (
        <>
          <p>Depois do exame, registre se o aluno compareceu.</p>
          <div className="admin-ops-form-actions">
            <button className="admin-primary" disabled={busy} type="button" onClick={() => void run(`${base}/attendance`, { attendanceStatus: 'PRESENT' })}>Registrar presença</button>
            <button className="admin-secondary" disabled={busy} type="button" onClick={() => void run(`${base}/attendance`, { attendanceStatus: 'ABSENT' })}>Registrar ausência</button>
          </div>
        </>
      ) : command.attendanceStatus === 'ABSENT' ? (
        <p>A ausência já foi registrada. Finalize esta data de exame antes de marcar uma nova tentativa.</p>
      ) : command.observedResult === 'PENDING' ? (
        <>
          <p>O aluno compareceu. Registre o resultado informado à escola.</p>
          <div className="admin-ops-form-actions">
            <button className="admin-primary" disabled={busy} type="button" onClick={() => void run(`${base}/observed-result`, { result: 'APPROVED' })}>Registrar aprovação</button>
            <button className="admin-secondary" disabled={busy} type="button" onClick={() => void run(`${base}/observed-result`, { result: 'FAILED' })}>Registrar reprovação</button>
          </div>
        </>
      ) : (
        <>
          <p>A escola registrou o resultado como <strong>{command.observedResult === 'APPROVED' ? 'APROVADO' : 'REPROVADO'}</strong>. Agora confirme o resultado oficial.</p>
          <div className="admin-ops-form-actions">
            <button className="admin-primary" disabled={busy} type="button" onClick={() => void run(`${base}/official-result`, { result: 'APPROVED' })}>Confirmar aprovação oficial</button>
            <button className="admin-secondary" disabled={busy} type="button" onClick={() => void run(`${base}/official-result`, { result: 'FAILED' })}>Confirmar reprovação oficial</button>
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
