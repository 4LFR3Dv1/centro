import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';

type PhysicalCategory = 'A' | 'B' | 'D';
type EnrollmentCategory = PhysicalCategory | 'AB';

type ScheduleOptions = {
  policy: {
    slotMinutes: number;
    lessonMinMinutes: number;
    lessonMaxMinutes: number;
  };
  instructors: Array<{ id: string; displayName: string; active: boolean; categories: PhysicalCategory[] }>;
  vehicles: Array<{ id: string; plate: string; label: string; category: PhysicalCategory; active: boolean }>;
  enrollments: Array<{ id: string; studentId: string; studentName: string; category: EnrollmentCategory }>;
};

type ContextualLessonSchedulerProps = {
  studentId: string;
  studentName?: string;
  enrollmentId: string;
  enrollmentCategory: EnrollmentCategory;
  onClose: () => void;
  onScheduled: () => void;
};

async function scheduleApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || 'Não foi possível agendar a aula.');
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

function nextSlot(slotMinutes: number): string {
  const date = new Date(Date.now() + 60 * 60_000);
  const slotMs = slotMinutes * 60_000;
  date.setTime(Math.ceil(date.getTime() / slotMs) * slotMs);
  date.setSeconds(0, 0);
  return localInput(date);
}

export function ContextualLessonScheduler({
  studentId,
  studentName,
  enrollmentId,
  enrollmentCategory,
  onClose,
  onScheduled,
}: ContextualLessonSchedulerProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const [options, setOptions] = useState<ScheduleOptions | null>(null);
  const [category, setCategory] = useState<PhysicalCategory | ''>(enrollmentCategory === 'AB' ? '' : enrollmentCategory);
  const [instructorId, setInstructorId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [startsAtLocal, setStartsAtLocal] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const allowedCategories = useMemo<PhysicalCategory[]>(
    () => enrollmentCategory === 'AB' ? ['A', 'B'] : [enrollmentCategory],
    [enrollmentCategory],
  );
  const instructors = useMemo(
    () => category ? options?.instructors.filter((item) => item.active && item.categories.includes(category)) ?? [] : [],
    [options, category],
  );
  const vehicles = useMemo(
    () => category ? options?.vehicles.filter((item) => item.active && item.category === category) ?? [] : [],
    [options, category],
  );

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    void scheduleApi<ScheduleOptions>('/api/admin/schedule/options')
      .then((value) => {
        if (!alive) return;
        if (!value.enrollments.some((enrollment) => enrollment.id === enrollmentId && enrollment.studentId === studentId)) {
          throw new Error('Esta matrícula não está disponível para agendamento.');
        }
        setOptions(value);
        setStartsAtLocal(nextSlot(value.policy.slotMinutes));
        setDurationMinutes(Math.max(value.policy.lessonMinMinutes, Math.min(60, value.policy.lessonMaxMinutes)));
      })
      .catch((candidate) => {
        if (alive) setError(candidate instanceof Error ? candidate.message : 'Não foi possível abrir o agendamento.');
      });
    return () => { alive = false; };
  }, [enrollmentId, studentId]);

  useEffect(() => {
    setInstructorId(instructors[0]?.id ?? '');
    setVehicleId(vehicles[0]?.id ?? '');
  }, [category, instructors.map((item) => item.id).join('|'), vehicles.map((item) => item.id).join('|')]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!options || !category || !startsAtLocal) return;
    const startsAt = new Date(startsAtLocal);
    if (!Number.isFinite(startsAt.getTime())) {
      setError('Informe uma data e hora válidas.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      await scheduleApi('/api/admin/schedule/lessons', {
        method: 'POST',
        body: JSON.stringify({
          enrollmentId,
          studentId,
          instructorId,
          vehicleId,
          category,
          startsAt: startsAt.toISOString(),
          endsAt: new Date(startsAt.getTime() + durationMinutes * 60_000).toISOString(),
          notes: notes || null,
        }),
      });
      window.dispatchEvent(new CustomEvent('centro:process-changed', { detail: { studentId, enrollmentId } }));
      onScheduled();
    } catch (candidate) {
      setError(candidate instanceof Error ? candidate.message : 'Não foi possível agendar a aula. Revise os dados e tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-ops-modal-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="admin-ops-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="contextual-lesson-title"
        tabIndex={-1}
      >
        <div className="admin-card-title">
          <div>
            <span>AGENDAR AULA</span>
            <h2 id="contextual-lesson-title">{studentName ? `Agendar aula de ${studentName}` : 'Agendar aula prática'}</h2>
          </div>
          <button className="admin-ops-close" type="button" onClick={onClose} aria-label="Fechar agendamento">×</button>
        </div>

        <p>O aluno e a matrícula já estão selecionados. Revise apenas o que precisa ser decidido para esta aula.</p>

        <form className="admin-ops-form" onSubmit={submit}>
          {allowedCategories.length > 1 && (
            <label>
              Categoria desta aula
              <select value={category} onChange={(event) => setCategory(event.target.value as PhysicalCategory | '')} required>
                <option value="">Escolha A ou B</option>
                {allowedCategories.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
              <small>A matrícula permite as duas categorias; escolha qual será treinada agora.</small>
            </label>
          )}

          <div className="admin-ops-form-grid">
            <label>Data e hora<input type="datetime-local" value={startsAtLocal} onChange={(event) => setStartsAtLocal(event.target.value)} required /></label>
            <label>
              Duração
              <select value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))} disabled={!options}>
                {options && Array.from(
                  { length: Math.floor((options.policy.lessonMaxMinutes - options.policy.lessonMinMinutes) / options.policy.slotMinutes) + 1 },
                  (_, index) => options.policy.lessonMinMinutes + index * options.policy.slotMinutes,
                ).filter((minutes) => minutes <= options.policy.lessonMaxMinutes).map((minutes) => <option key={minutes} value={minutes}>{minutes} min</option>)}
              </select>
            </label>
          </div>

          <div className="admin-ops-form-grid">
            <label>
              Instrutor
              <select value={instructorId} onChange={(event) => setInstructorId(event.target.value)} disabled={!category} required>
                <option value="">Selecione</option>
                {instructors.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}
              </select>
            </label>
            <label>
              Veículo
              <select value={vehicleId} onChange={(event) => setVehicleId(event.target.value)} disabled={!category} required>
                <option value="">Selecione</option>
                {vehicles.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.plate}</option>)}
              </select>
            </label>
          </div>

          <label>Observação opcional<textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>

          {enrollmentCategory === 'AB' && !category && (
            <p className="admin-ops-warning" role="status">Escolha A ou B para o Centro mostrar os instrutores e veículos compatíveis.</p>
          )}
          {options && category && (!instructors.length || !vehicles.length) && (
            <p className="admin-ops-warning" role="status">Antes de agendar a categoria {category}, é preciso ter instrutor autorizado e veículo ativo disponíveis.</p>
          )}
          {error && <p className="admin-error" role="alert">{error}</p>}

          <div className="admin-ops-form-actions">
            <button className="admin-secondary" type="button" onClick={onClose}>Cancelar</button>
            <button className="admin-primary" type="submit" disabled={busy || !options || !category || !startsAtLocal || !instructorId || !vehicleId}>
              {busy ? 'Agendando…' : 'Agendar aula'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
