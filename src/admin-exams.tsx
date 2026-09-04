import { FormEvent, useEffect, useMemo, useState } from 'react';
import './admin-exams.css';

type Category = 'A' | 'B' | 'D';
type EnrollmentCategory = Category | 'AB';
type SessionStatus = 'PLANNED' | 'CONFIRMED' | 'CLOSED' | 'CANCELLED';
type BookingSource = 'SELF' | 'SCHOOL';
type FeeStatus = 'UNKNOWN' | 'PENDING' | 'PAID';
type LadvStatus = 'UNKNOWN' | 'READY';
type AttendanceStatus = 'PENDING' | 'PRESENT' | 'ABSENT';
type ExamResult = 'PENDING' | 'APPROVED' | 'FAILED';

type SessionSummary = {
  id: string;
  category: Category;
  locationLabel: string;
  startsAt: string;
  endsAt: string;
  instructorId: string;
  instructorName: string;
  vehicleId: string;
  vehicleLabel: string;
  vehiclePlate: string;
  status: SessionStatus;
  notes: string | null;
  candidateCount: number;
  pendingCount: number;
  approvedCount: number;
  failedCount: number;
};

type Candidate = {
  id: string;
  sessionId: string;
  enrollmentId: string;
  studentId: string;
  studentPublicId: string;
  studentName: string;
  phone: string;
  documentMasked: string | null;
  serviceType: string;
  enrollmentCategory: EnrollmentCategory;
  officialScheduledFor: string;
  bookingSource: BookingSource;
  protocol: string | null;
  renach: string | null;
  feeStatus: FeeStatus;
  ladvStatus: LadvStatus;
  attendanceStatus: AttendanceStatus;
  observedResult: ExamResult;
  officialResult: ExamResult;
  resultReconciledAt: string | null;
};

type SessionDetail = SessionSummary & { candidates: Candidate[] };

type Options = {
  instructors: Array<{ id: string; displayName: string; categories: Category[] }>;
  vehicles: Array<{ id: string; plate: string; label: string; category: Category }>;
  enrollments: Array<{
    id: string;
    studentId: string;
    studentPublicId: string;
    studentName: string;
    phone: string;
    serviceType: string;
    category: EnrollmentCategory;
    practiceDone: boolean;
  }>;
};

type CandidateEditor = {
  candidateId: string;
  officialScheduledFor: string;
  bookingSource: BookingSource;
  protocol: string;
  renach: string;
  feeStatus: FeeStatus;
  ladvStatus: LadvStatus;
};

const statusLabel: Record<SessionStatus, string> = {
  PLANNED: 'Planejada',
  CONFIRMED: 'Confirmada',
  CLOSED: 'Encerrada',
  CANCELLED: 'Cancelada',
};

const resultLabel: Record<ExamResult, string> = {
  PENDING: 'Pendente',
  APPROVED: 'Aprovado',
  FAILED: 'Reprovado',
};

const attendanceLabel: Record<AttendanceStatus, string> = {
  PENDING: 'Aguardando',
  PRESENT: 'Presente',
  ABSENT: 'Ausente',
};

async function examsApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || 'Não foi possível concluir a operação de exames.');
  return body;
}

function localInput(value: Date | string): string {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function humanDate(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

function humanTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function compatible(enrollment: EnrollmentCategory, category: Category): boolean {
  return enrollment === category || (enrollment === 'AB' && (category === 'A' || category === 'B'));
}

function serviceLabel(value: string): string {
  if (value === 'FIRST_LICENSE') return 'Primeira habilitação';
  if (value === 'CATEGORY_ADDITION') return 'Adição de categoria';
  if (value === 'CATEGORY_CHANGE') return 'Mudança de categoria';
  if (value === 'LICENSED_TRAINING') return 'Treinamento';
  return value;
}

function emptySessionWindow(): { startsAt: string; endsAt: string } {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(8, 0, 0, 0);
  const end = new Date(start);
  end.setHours(12, 0, 0, 0);
  return { startsAt: localInput(start), endsAt: localInput(end) };
}

export function AdminExams() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [options, setOptions] = useState<Options | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingCandidate, setEditingCandidate] = useState<CandidateEditor | null>(null);
  const [sessionCategory, setSessionCategory] = useState<Category>('B');
  const [sessionWindow, setSessionWindow] = useState(emptySessionWindow);

  async function loadSessions(preferredId?: string | null) {
    const from = new Date();
    from.setDate(from.getDate() - 7);
    const to = new Date();
    to.setDate(to.getDate() + 90);
    const payload = await examsApi<{ sessions: SessionSummary[] }>(
      `/api/admin/exams?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
    );
    setSessions(payload.sessions);
    const next = preferredId || selectedId || payload.sessions[0]?.id || null;
    setSelectedId(next);
    if (!next) setDetail(null);
  }

  async function loadOptions() {
    setOptions(await examsApi<Options>('/api/admin/exams/options'));
  }

  async function loadDetail(id: string) {
    const payload = await examsApi<{ session: SessionDetail }>(`/api/admin/exams/${id}`);
    setDetail(payload.session);
  }

  async function refresh(session?: SessionDetail) {
    if (session) {
      setDetail(session);
      setSelectedId(session.id);
    }
    await Promise.all([loadSessions(session?.id), loadOptions()]);
  }

  useEffect(() => {
    let alive = true;
    void Promise.all([loadSessions(), loadOptions()])
      .catch((candidate) => { if (alive) setError(candidate instanceof Error ? candidate.message : 'Não foi possível carregar exames.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let alive = true;
    void loadDetail(selectedId).catch((candidate) => {
      if (alive) setError(candidate instanceof Error ? candidate.message : 'Não foi possível abrir a lista.');
    });
    return () => { alive = false; };
  }, [selectedId]);

  const sessionInstructors = useMemo(
    () => options?.instructors.filter((item) => item.categories.includes(sessionCategory)) ?? [],
    [options, sessionCategory],
  );
  const sessionVehicles = useMemo(
    () => options?.vehicles.filter((item) => item.category === sessionCategory) ?? [],
    [options, sessionCategory],
  );
  const eligibleForDetail = useMemo(
    () => detail && options ? options.enrollments.filter((item) => compatible(item.category, detail.category)) : [],
    [detail, options],
  );

  async function createSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!options) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      const payload = await examsApi<{ session: SessionDetail }>('/api/admin/exams', {
        method: 'POST',
        body: JSON.stringify({
          category: sessionCategory,
          locationLabel: String(form.get('locationLabel') || ''),
          startsAt: new Date(sessionWindow.startsAt).toISOString(),
          endsAt: new Date(sessionWindow.endsAt).toISOString(),
          instructorId: String(form.get('instructorId') || ''),
          vehicleId: String(form.get('vehicleId') || ''),
          notes: String(form.get('notes') || '') || null,
        }),
      });
      setCreating(false);
      setSessionWindow(emptySessionWindow());
      await refresh(payload.session);
    } catch (candidate) {
      setError(candidate instanceof Error ? candidate.message : 'Não foi possível criar a lista.');
    } finally {
      setBusy(false);
    }
  }

  async function addCandidate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      const payload = await examsApi<{ session: SessionDetail }>(`/api/admin/exams/${detail.id}/candidates`, {
        method: 'POST',
        body: JSON.stringify({
          enrollmentId: String(form.get('enrollmentId') || ''),
          officialScheduledFor: new Date(String(form.get('officialScheduledFor') || '')).toISOString(),
          bookingSource: String(form.get('bookingSource') || 'SCHOOL'),
          protocol: String(form.get('protocol') || '') || null,
          renach: String(form.get('renach') || '') || null,
          feeStatus: String(form.get('feeStatus') || 'UNKNOWN'),
          ladvStatus: String(form.get('ladvStatus') || 'UNKNOWN'),
        }),
      });
      event.currentTarget.reset();
      await refresh(payload.session);
    } catch (candidate) {
      setError(candidate instanceof Error ? candidate.message : 'Não foi possível incluir o aluno.');
    } finally {
      setBusy(false);
    }
  }

  async function mutate(path: string, body: unknown, method = 'POST') {
    if (!detail) return;
    setBusy(true);
    setError('');
    try {
      const payload = await examsApi<{ session: SessionDetail }>(path, {
        method,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      setEditingCandidate(null);
      await refresh(payload.session);
    } catch (candidate) {
      setError(candidate instanceof Error ? candidate.message : 'Não foi possível concluir a operação.');
    } finally {
      setBusy(false);
    }
  }

  function beginCandidateEdit(candidate: Candidate) {
    setEditingCandidate({
      candidateId: candidate.id,
      officialScheduledFor: localInput(candidate.officialScheduledFor),
      bookingSource: candidate.bookingSource,
      protocol: candidate.protocol ?? '',
      renach: candidate.renach ?? '',
      feeStatus: candidate.feeStatus,
      ladvStatus: candidate.ladvStatus,
    });
  }

  async function saveCandidateEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !editingCandidate) return;
    await mutate(`/api/admin/exams/${detail.id}/candidates/${editingCandidate.candidateId}/details`, {
      officialScheduledFor: new Date(editingCandidate.officialScheduledFor).toISOString(),
      bookingSource: editingCandidate.bookingSource,
      protocol: editingCandidate.protocol || null,
      renach: editingCandidate.renach || null,
      feeStatus: editingCandidate.feeStatus,
      ladvStatus: editingCandidate.ladvStatus,
    });
  }

  if (loading) return <section className="exams-loading">Carregando operação de exames…</section>;

  return (
    <section className="exams-page" aria-labelledby="exams-title">
      <header className="exams-head">
        <div>
          <p className="admin-eyebrow">EXAMES PRÁTICOS</p>
          <h1 id="exams-title">Listas de exame</h1>
          <p>Organize alunos, horário oficial, responsável, veículo, presença e reconciliação do resultado.</p>
        </div>
        <div className="exams-head-actions">
          <button className="admin-secondary" type="button" onClick={() => window.print()}>Imprimir</button>
          <button className="admin-primary" type="button" onClick={() => setCreating((value) => !value)}>
            {creating ? 'Fechar criação' : 'Nova lista'}
          </button>
        </div>
      </header>

      {error && <p className="admin-error exams-error" role="alert">{error}</p>}

      {creating && options && (
        <form className="exams-create" onSubmit={createSession}>
          <div className="exams-form-head">
            <div><span>NOVA LISTA</span><strong>Janela operacional do exame</strong></div>
            <small>Instrutor e veículo ficam reservados durante toda a janela.</small>
          </div>
          <div className="exams-form-grid">
            <label>Categoria
              <select value={sessionCategory} onChange={(event) => setSessionCategory(event.target.value as Category)}>
                <option value="A">A · Moto</option>
                <option value="B">B · Carro</option>
                <option value="D">D · Passageiros</option>
              </select>
            </label>
            <label className="exams-wide">Local / banca<input name="locationLabel" required placeholder="Ex.: Pátio Armênia" /></label>
            <label>Início<input type="datetime-local" value={sessionWindow.startsAt} onChange={(event) => setSessionWindow((value) => ({ ...value, startsAt: event.target.value }))} required /></label>
            <label>Fim<input type="datetime-local" value={sessionWindow.endsAt} onChange={(event) => setSessionWindow((value) => ({ ...value, endsAt: event.target.value }))} required /></label>
            <label>Instrutor responsável
              <select name="instructorId" required defaultValue="">
                <option value="" disabled>Selecione</option>
                {sessionInstructors.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}
              </select>
            </label>
            <label>Veículo
              <select name="vehicleId" required defaultValue="">
                <option value="" disabled>Selecione</option>
                {sessionVehicles.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.plate}</option>)}
              </select>
            </label>
            <label className="exams-wide">Observações<textarea name="notes" rows={2} /></label>
          </div>
          <div className="exams-form-footer">
            <span>Conflitos com aulas e outras listas são recusados antes da criação.</span>
            <button className="admin-primary" type="submit" disabled={busy}>Criar lista</button>
          </div>
        </form>
      )}

      <div className="exams-layout">
        <aside className="exams-list" aria-label="Listas de exame">
          <div className="exams-list-title"><span>PRÓXIMAS LISTAS</span><strong>{sessions.length}</strong></div>
          {sessions.length === 0 ? (
            <p className="exams-empty">Nenhuma lista no período.</p>
          ) : sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              className={`exams-list-item ${selectedId === session.id ? 'is-selected' : ''}`}
              onClick={() => setSelectedId(session.id)}
            >
              <div><span className={`exams-status status-${session.status.toLowerCase()}`}>{statusLabel[session.status]}</span><b>CAT. {session.category}</b></div>
              <strong>{humanDate(session.startsAt)}</strong>
              <span>{humanTime(session.startsAt)}–{humanTime(session.endsAt)} · {session.locationLabel}</span>
              <span>{session.candidateCount} aluno(s) · {session.instructorName}</span>
            </button>
          ))}
        </aside>

        <div className="exams-detail">
          {!detail ? (
            <div className="exams-empty-panel"><strong>Selecione uma lista</strong><span>ou crie a próxima operação de exame.</span></div>
          ) : (
            <>
              <header className="exams-detail-head">
                <div>
                  <div className="exams-detail-meta">
                    <span className={`exams-status status-${detail.status.toLowerCase()}`}>{statusLabel[detail.status]}</span>
                    <span>Categoria {detail.category}</span>
                  </div>
                  <h2>{humanDate(detail.startsAt)}</h2>
                  <p>{humanTime(detail.startsAt)}–{humanTime(detail.endsAt)} · {detail.locationLabel}</p>
                </div>
                <div className="exams-detail-actions">
                  {detail.status === 'PLANNED' && <button type="button" className="admin-primary" disabled={busy} onClick={() => void mutate(`/api/admin/exams/${detail.id}/status`, { status: 'CONFIRMED' })}>Confirmar lista</button>}
                  {detail.status === 'CONFIRMED' && <button type="button" className="admin-primary" disabled={busy} onClick={() => void mutate(`/api/admin/exams/${detail.id}/status`, { status: 'CLOSED' })}>Encerrar lista</button>}
                  {(detail.status === 'PLANNED' || detail.status === 'CONFIRMED') && <button type="button" className="admin-secondary" disabled={busy} onClick={() => void mutate(`/api/admin/exams/${detail.id}/status`, { status: 'CANCELLED' })}>Cancelar</button>}
                </div>
              </header>

              <div className="exams-resource-strip">
                <div><span>RESPONSÁVEL</span><strong>{detail.instructorName}</strong></div>
                <div><span>VEÍCULO</span><strong>{detail.vehicleLabel}</strong><small>{detail.vehiclePlate}</small></div>
                <div><span>ALUNOS</span><strong>{detail.candidateCount}</strong><small>{detail.pendingCount} resultado(s) pendente(s)</small></div>
                <div><span>RESULTADOS</span><strong>{detail.approvedCount} aprov. · {detail.failedCount} reprov.</strong></div>
              </div>

              {(detail.status === 'PLANNED' || detail.status === 'CONFIRMED') && (
                <form className="exams-add-candidate" onSubmit={addCandidate}>
                  <div className="exams-form-head"><div><span>INCLUIR ALUNO</span><strong>Agendamento oficial</strong></div></div>
                  <div className="exams-candidate-form-grid">
                    <label className="exams-wide">Aluno / matrícula
                      <select name="enrollmentId" required defaultValue="">
                        <option value="" disabled>Selecione um aluno elegível</option>
                        {eligibleForDetail.map((item) => (
                          <option key={item.id} value={item.id}>{item.studentName} · {item.studentPublicId} · {item.category}</option>
                        ))}
                      </select>
                    </label>
                    <label>Horário oficial<input name="officialScheduledFor" type="datetime-local" required defaultValue={localInput(detail.startsAt)} /></label>
                    <label>Origem
                      <select name="bookingSource" defaultValue="SCHOOL"><option value="SCHOOL">Autoescola</option><option value="SELF">Aluno</option></select>
                    </label>
                    <label>Protocolo<input name="protocol" /></label>
                    <label>RENACH<input name="renach" /></label>
                    <label>Taxa
                      <select name="feeStatus" defaultValue="UNKNOWN"><option value="UNKNOWN">Não conferida</option><option value="PENDING">Pendente</option><option value="PAID">Paga</option></select>
                    </label>
                    <label>LADV
                      <select name="ladvStatus" defaultValue="UNKNOWN"><option value="UNKNOWN">Não conferida</option><option value="READY">Pronta</option></select>
                    </label>
                  </div>
                  <div className="exams-form-footer"><span>A ordem da lista segue o horário oficial.</span><button className="admin-primary" type="submit" disabled={busy || eligibleForDetail.length === 0}>Adicionar aluno</button></div>
                </form>
              )}

              <div className="exams-roster-head">
                <div><span>LISTA DE CANDIDATOS</span><strong>{detail.candidateCount}</strong></div>
                <span>Ordenada por horário oficial</span>
              </div>

              {detail.candidates.length === 0 ? (
                <div className="exams-empty-panel compact"><strong>Lista vazia</strong><span>Inclua os alunos elegíveis acima.</span></div>
              ) : (
                <div className="exams-roster">
                  {detail.candidates.map((candidate, index) => (
                    <article key={candidate.id} className="exams-candidate">
                      <div className="exams-order">{String(index + 1).padStart(2, '0')}</div>
                      <div className="exams-candidate-main">
                        <div className="exams-candidate-title">
                          <div><strong>{candidate.studentName}</strong><span>{candidate.studentPublicId} · {serviceLabel(candidate.serviceType)} · Cat. {candidate.enrollmentCategory}</span></div>
                          <time>{humanTime(candidate.officialScheduledFor)}</time>
                        </div>

                        {editingCandidate?.candidateId === candidate.id ? (
                          <form className="exams-inline-edit" onSubmit={saveCandidateEdit}>
                            <label>Horário<input type="datetime-local" value={editingCandidate.officialScheduledFor} onChange={(event) => setEditingCandidate({ ...editingCandidate, officialScheduledFor: event.target.value })} /></label>
                            <label>Origem<select value={editingCandidate.bookingSource} onChange={(event) => setEditingCandidate({ ...editingCandidate, bookingSource: event.target.value as BookingSource })}><option value="SCHOOL">Autoescola</option><option value="SELF">Aluno</option></select></label>
                            <label>Protocolo<input value={editingCandidate.protocol} onChange={(event) => setEditingCandidate({ ...editingCandidate, protocol: event.target.value })} /></label>
                            <label>RENACH<input value={editingCandidate.renach} onChange={(event) => setEditingCandidate({ ...editingCandidate, renach: event.target.value })} /></label>
                            <label>Taxa<select value={editingCandidate.feeStatus} onChange={(event) => setEditingCandidate({ ...editingCandidate, feeStatus: event.target.value as FeeStatus })}><option value="UNKNOWN">Não conferida</option><option value="PENDING">Pendente</option><option value="PAID">Paga</option></select></label>
                            <label>LADV<select value={editingCandidate.ladvStatus} onChange={(event) => setEditingCandidate({ ...editingCandidate, ladvStatus: event.target.value as LadvStatus })}><option value="UNKNOWN">Não conferida</option><option value="READY">Pronta</option></select></label>
                            <div className="exams-inline-actions"><button className="admin-secondary" type="button" onClick={() => setEditingCandidate(null)}>Cancelar</button><button className="admin-primary" type="submit" disabled={busy}>Salvar</button></div>
                          </form>
                        ) : (
                          <>
                            <div className="exams-data-grid">
                              <div><span>CONTATO</span><strong>{candidate.phone}</strong><small>{candidate.documentMasked || 'Documento não informado'}</small></div>
                              <div><span>AGENDAMENTO</span><strong>{candidate.bookingSource === 'SCHOOL' ? 'Autoescola' : 'Aluno'}</strong><small>{candidate.protocol || 'Sem protocolo'}</small></div>
                              <div><span>RENACH</span><strong>{candidate.renach || '—'}</strong></div>
                              <div><span>PRÉ-CHECK</span><strong>{candidate.feeStatus === 'PAID' ? 'Taxa paga' : candidate.feeStatus === 'PENDING' ? 'Taxa pendente' : 'Taxa não conferida'}</strong><small>{candidate.ladvStatus === 'READY' ? 'LADV pronta' : 'LADV não conferida'}</small></div>
                            </div>

                            <div className="exams-state-row">
                              <span className={`exam-chip attendance-${candidate.attendanceStatus.toLowerCase()}`}>{attendanceLabel[candidate.attendanceStatus]}</span>
                              <span className={`exam-chip result-${candidate.observedResult.toLowerCase()}`}>Observado: {resultLabel[candidate.observedResult]}</span>
                              <span className={`exam-chip result-${candidate.officialResult.toLowerCase()}`}>Oficial: {resultLabel[candidate.officialResult]}</span>
                            </div>

                            {(detail.status === 'PLANNED' || detail.status === 'CONFIRMED') && candidate.officialResult === 'PENDING' && (
                              <div className="exams-candidate-actions">
                                <button type="button" disabled={busy} onClick={() => beginCandidateEdit(candidate)}>Editar dados</button>
                                {candidate.attendanceStatus === 'PENDING' && <><button type="button" disabled={busy} onClick={() => void mutate(`/api/admin/exams/${detail.id}/candidates/${candidate.id}/attendance`, { attendanceStatus: 'PRESENT' })}>Presente</button><button type="button" disabled={busy} onClick={() => void mutate(`/api/admin/exams/${detail.id}/candidates/${candidate.id}/attendance`, { attendanceStatus: 'ABSENT' })}>Falta</button></>}
                                {candidate.attendanceStatus === 'PRESENT' && <><button type="button" disabled={busy} onClick={() => void mutate(`/api/admin/exams/${detail.id}/candidates/${candidate.id}/observed-result`, { result: 'APPROVED' })}>Observado: aprovado</button><button type="button" disabled={busy} onClick={() => void mutate(`/api/admin/exams/${detail.id}/candidates/${candidate.id}/observed-result`, { result: 'FAILED' })}>Observado: reprovado</button></>}
                                {candidate.observedResult !== 'PENDING' && <><button className="is-official" type="button" disabled={busy} onClick={() => void mutate(`/api/admin/exams/${detail.id}/candidates/${candidate.id}/official-result`, { result: 'APPROVED' })}>Oficial: aprovado</button><button className="is-official" type="button" disabled={busy} onClick={() => void mutate(`/api/admin/exams/${detail.id}/candidates/${candidate.id}/official-result`, { result: 'FAILED' })}>Oficial: reprovado</button></>}
                                {candidate.attendanceStatus === 'PENDING' && candidate.observedResult === 'PENDING' && <button className="is-danger" type="button" disabled={busy} onClick={() => void mutate(`/api/admin/exams/${detail.id}/candidates/${candidate.id}`, undefined, 'DELETE')}>Remover</button>}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
