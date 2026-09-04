import { FormEvent, useEffect, useMemo, useState } from 'react';
import './admin-calendar.css';

type PhysicalCategory = 'A' | 'B' | 'D';
type EnrollmentCategory = PhysicalCategory | 'AB';
type LessonStatus = 'SCHEDULED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED';

type SchedulePolicy = {
  id: string | null;
  name: string;
  timezone: string;
  slotMinutes: number;
  lessonMinMinutes: number;
  lessonMaxMinutes: number;
  persisted: boolean;
};

type Instructor = {
  id: string;
  displayName: string;
  active: boolean;
  categories: PhysicalCategory[];
};

type Vehicle = {
  id: string;
  plate: string;
  label: string;
  category: PhysicalCategory;
  active: boolean;
};

type Enrollment = {
  id: string;
  studentId: string;
  studentPublicId: string;
  studentName: string;
  serviceType: string;
  category: EnrollmentCategory;
};

type Lesson = {
  id: string;
  enrollmentId: string;
  studentId: string;
  studentPublicId: string;
  studentName: string;
  instructorId: string;
  instructorName: string;
  vehicleId: string;
  vehiclePlate: string;
  vehicleLabel: string;
  category: PhysicalCategory;
  startsAt: string;
  endsAt: string;
  status: LessonStatus;
  resolvedAt: string | null;
  notes: string | null;
};

type Options = {
  policy: SchedulePolicy;
  instructors: Instructor[];
  vehicles: Vehicle[];
  enrollments: Enrollment[];
};

type EditorState = {
  lessonId: string | null;
  enrollmentId: string;
  category: PhysicalCategory;
  instructorId: string;
  vehicleId: string;
  startsAtLocal: string;
  durationMinutes: number;
  notes: string;
};

const statusLabels: Record<LessonStatus, string> = {
  SCHEDULED: 'Agendada',
  COMPLETED: 'Concluída',
  NO_SHOW: 'Falta',
  CANCELLED: 'Cancelada',
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
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || 'Não foi possível concluir a operação da agenda.');
  return body;
}

function ymd(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function todayYmd(): string {
  return ymd(new Date());
}

function localInput(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  const hour = String(value.getHours()).padStart(2, '0');
  const minute = String(value.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function rangeFor(anchor: string, mode: 'day' | 'week'): { from: Date; to: Date } {
  const base = new Date(`${anchor}T00:00:00`);
  const from = new Date(base);
  if (mode === 'week') {
    const weekday = from.getDay();
    const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
    from.setDate(from.getDate() + mondayOffset);
  }
  const to = new Date(from);
  to.setDate(to.getDate() + (mode === 'week' ? 7 : 1));
  return { from, to };
}

function humanDate(value: Date | string): string {
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }).format(new Date(value));
}

function humanTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function durationMinutes(lesson: Lesson): number {
  return Math.round((new Date(lesson.endsAt).getTime() - new Date(lesson.startsAt).getTime()) / 60000);
}

function allowedCategories(enrollment?: Enrollment): PhysicalCategory[] {
  if (!enrollment) return ['B'];
  if (enrollment.category === 'AB') return ['A', 'B'];
  return [enrollment.category];
}

function nextSlot(policy: SchedulePolicy, anchor: string): string {
  const now = new Date();
  const target = ymd(now) === anchor ? new Date(now) : new Date(`${anchor}T08:00:00`);
  const slotMs = policy.slotMinutes * 60000;
  target.setTime(Math.ceil(target.getTime() / slotMs) * slotMs);
  target.setSeconds(0, 0);
  return localInput(target);
}

function emptyEditor(options: Options, anchor: string): EditorState {
  const enrollment = options.enrollments[0];
  const category = allowedCategories(enrollment)[0];
  const instructor = options.instructors.find((item) => item.active && item.categories.includes(category));
  const vehicle = options.vehicles.find((item) => item.active && item.category === category);
  return {
    lessonId: null,
    enrollmentId: enrollment?.id ?? '',
    category,
    instructorId: instructor?.id ?? '',
    vehicleId: vehicle?.id ?? '',
    startsAtLocal: nextSlot(options.policy, anchor),
    durationMinutes: Math.max(options.policy.lessonMinMinutes, Math.min(60, options.policy.lessonMaxMinutes)),
    notes: '',
  };
}

function LessonEditor({
  editor,
  options,
  busy,
  error,
  onChange,
  onCancel,
  onSubmit,
}: {
  editor: EditorState;
  options: Options;
  busy: boolean;
  error: string;
  onChange: (next: EditorState) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const enrollment = options.enrollments.find((item) => item.id === editor.enrollmentId);
  const categories = allowedCategories(enrollment);
  const instructors = options.instructors.filter((item) => item.active && item.categories.includes(editor.category));
  const vehicles = options.vehicles.filter((item) => item.active && item.category === editor.category);

  function chooseEnrollment(value: string) {
    const nextEnrollment = options.enrollments.find((item) => item.id === value);
    const nextCategory = allowedCategories(nextEnrollment)[0];
    const nextInstructor = options.instructors.find((item) => item.active && item.categories.includes(nextCategory));
    const nextVehicle = options.vehicles.find((item) => item.active && item.category === nextCategory);
    onChange({
      ...editor,
      enrollmentId: value,
      category: nextCategory,
      instructorId: nextInstructor?.id ?? '',
      vehicleId: nextVehicle?.id ?? '',
    });
  }

  function chooseCategory(value: PhysicalCategory) {
    const nextInstructor = options.instructors.find((item) => item.active && item.categories.includes(value));
    const nextVehicle = options.vehicles.find((item) => item.active && item.category === value);
    onChange({ ...editor, category: value, instructorId: nextInstructor?.id ?? '', vehicleId: nextVehicle?.id ?? '' });
  }

  return (
    <div className="calendar-editor-backdrop" role="presentation">
      <section className="calendar-editor" role="dialog" aria-modal="true" aria-labelledby="calendar-editor-title">
        <div className="calendar-editor-head">
          <div>
            <p className="admin-eyebrow">AGENDA</p>
            <h2 id="calendar-editor-title">{editor.lessonId ? 'Remarcar aula' : 'Nova aula'}</h2>
          </div>
          <button type="button" className="calendar-close" onClick={onCancel} aria-label="Fechar">×</button>
        </div>

        <div className="calendar-editor-form">
          <label>
            Aluno / matrícula
            <select value={editor.enrollmentId} onChange={(event) => chooseEnrollment(event.target.value)} disabled={Boolean(editor.lessonId)}>
              {options.enrollments.map((item) => (
                <option key={item.id} value={item.id}>{item.studentName} · {item.studentPublicId} · {item.category}</option>
              ))}
            </select>
          </label>

          <div className="calendar-editor-grid">
            <label>
              Categoria
              <select value={editor.category} onChange={(event) => chooseCategory(event.target.value as PhysicalCategory)}>
                {categories.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            </label>
            <label>
              Início
              <input type="datetime-local" step={options.policy.slotMinutes * 60} value={editor.startsAtLocal} onChange={(event) => onChange({ ...editor, startsAtLocal: event.target.value })} />
            </label>
            <label>
              Duração
              <select value={editor.durationMinutes} onChange={(event) => onChange({ ...editor, durationMinutes: Number(event.target.value) })}>
                {Array.from({ length: Math.floor((options.policy.lessonMaxMinutes - options.policy.lessonMinMinutes) / options.policy.slotMinutes) + 1 }, (_, index) => options.policy.lessonMinMinutes + index * options.policy.slotMinutes)
                  .filter((minutes) => minutes <= options.policy.lessonMaxMinutes)
                  .map((minutes) => <option key={minutes} value={minutes}>{minutes} min</option>)}
              </select>
            </label>
          </div>

          <div className="calendar-editor-grid">
            <label>
              Instrutor
              <select value={editor.instructorId} onChange={(event) => onChange({ ...editor, instructorId: event.target.value })}>
                <option value="">Selecione</option>
                {instructors.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}
              </select>
            </label>
            <label>
              Veículo
              <select value={editor.vehicleId} onChange={(event) => onChange({ ...editor, vehicleId: event.target.value })}>
                <option value="">Selecione</option>
                {vehicles.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.plate}</option>)}
              </select>
            </label>
          </div>

          <label>
            Observação
            <textarea rows={3} value={editor.notes} onChange={(event) => onChange({ ...editor, notes: event.target.value })} />
          </label>

          {(!instructors.length || !vehicles.length) && (
            <p className="calendar-inline-warning">Cadastre um instrutor autorizado e um veículo da categoria {editor.category} antes de agendar.</p>
          )}
          {error && <p className="admin-error" role="alert">{error}</p>}

          <div className="calendar-editor-actions">
            <button type="button" className="admin-secondary" onClick={onCancel}>Cancelar</button>
            <button
              type="button"
              className="admin-primary"
              disabled={busy || !editor.enrollmentId || !editor.instructorId || !editor.vehicleId || !editor.startsAtLocal}
              onClick={onSubmit}
            >
              {busy ? 'Salvando…' : editor.lessonId ? 'Confirmar remarcação' : 'Agendar aula'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function ResourceSetup({ options, onChanged }: { options: Options; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function run(operation: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await operation();
      setMessage(success);
      await onChanged();
    } catch (candidate) {
      setError(candidate instanceof Error ? candidate.message : 'Não foi possível salvar o recurso.');
    } finally {
      setBusy(false);
    }
  }

  function submitInstructor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const categories = ['A', 'B', 'D'].filter((category) => form.get(`category-${category}`) === 'on');
    void run(
      () => scheduleApi('/api/admin/schedule/instructors', {
        method: 'POST',
        body: JSON.stringify({ displayName: String(form.get('displayName') || ''), categories }),
      }),
      'Instrutor cadastrado.',
    );
    event.currentTarget.reset();
  }

  function submitVehicle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(
      () => scheduleApi('/api/admin/schedule/vehicles', {
        method: 'POST',
        body: JSON.stringify({
          plate: String(form.get('plate') || ''),
          label: String(form.get('label') || ''),
          category: String(form.get('category') || 'B'),
        }),
      }),
      'Veículo cadastrado.',
    );
    event.currentTarget.reset();
  }

  function submitPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(
      () => scheduleApi('/api/admin/schedule/policy', {
        method: 'POST',
        body: JSON.stringify({
          name: String(form.get('name') || 'Política da escola'),
          timezone: 'America/Sao_Paulo',
          slotMinutes: Number(form.get('slotMinutes')),
          lessonMinMinutes: Number(form.get('lessonMinMinutes')),
          lessonMaxMinutes: Number(form.get('lessonMaxMinutes')),
        }),
      }),
      'Política de agenda ativada.',
    );
  }

  return (
    <section className="calendar-resources">
      <button className="calendar-resources-toggle" type="button" onClick={() => setOpen((value) => !value)}>
        <span>Recursos da agenda</span>
        <small>{options.instructors.filter((item) => item.active).length} instrutor(es) · {options.vehicles.filter((item) => item.active).length} veículo(s)</small>
        <strong>{open ? '−' : '+'}</strong>
      </button>
      {open && (
        <div className="calendar-resources-body">
          <div className="calendar-resource-column">
            <div className="calendar-resource-title"><strong>Instrutores</strong><span>Quem pode ministrar cada categoria.</span></div>
            <div className="calendar-resource-list">
              {options.instructors.map((item) => <div key={item.id}><strong>{item.displayName}</strong><small>{item.categories.join(' · ') || 'Sem categoria'}</small></div>)}
            </div>
            <form className="calendar-resource-form" onSubmit={submitInstructor}>
              <input name="displayName" placeholder="Nome do instrutor" required />
              <div className="calendar-checks">
                {(['A', 'B', 'D'] as PhysicalCategory[]).map((category) => <label key={category}><input type="checkbox" name={`category-${category}`} /> {category}</label>)}
              </div>
              <button className="admin-secondary" type="submit" disabled={busy}>Adicionar instrutor</button>
            </form>
          </div>

          <div className="calendar-resource-column">
            <div className="calendar-resource-title"><strong>Veículos</strong><span>Categoria física é única por veículo.</span></div>
            <div className="calendar-resource-list">
              {options.vehicles.map((item) => <div key={item.id}><strong>{item.label}</strong><small>{item.plate} · {item.category}</small></div>)}
            </div>
            <form className="calendar-resource-form" onSubmit={submitVehicle}>
              <input name="label" placeholder="Ex.: Onix 01" required />
              <input name="plate" placeholder="Placa" required />
              <select name="category" defaultValue="B"><option value="A">A</option><option value="B">B</option><option value="D">D</option></select>
              <button className="admin-secondary" type="submit" disabled={busy}>Adicionar veículo</button>
            </form>
          </div>

          <div className="calendar-resource-column">
            <div className="calendar-resource-title"><strong>Política</strong><span>{options.policy.persisted ? options.policy.name : 'Usando política padrão não persistida'}</span></div>
            <form className="calendar-resource-form" onSubmit={submitPolicy}>
              <input name="name" defaultValue={options.policy.persisted ? options.policy.name : 'Política da escola'} required />
              <label>Slot (min)<input name="slotMinutes" type="number" min="5" max="120" defaultValue={options.policy.slotMinutes} required /></label>
              <label>Mínimo (min)<input name="lessonMinMinutes" type="number" min="10" max="240" defaultValue={options.policy.lessonMinMinutes} required /></label>
              <label>Máximo (min)<input name="lessonMaxMinutes" type="number" min="10" max="480" defaultValue={options.policy.lessonMaxMinutes} required /></label>
              <button className="admin-secondary" type="submit" disabled={busy}>Ativar nova política</button>
            </form>
          </div>
        </div>
      )}
      {message && <p className="calendar-resource-message">{message}</p>}
      {error && <p className="admin-error" role="alert">{error}</p>}
    </section>
  );
}

export function AdminCalendar() {
  const [mode, setMode] = useState<'day' | 'week'>('day');
  const [anchor, setAnchor] = useState(todayYmd());
  const [options, setOptions] = useState<Options | null>(null);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [instructorFilter, setInstructorFilter] = useState('');
  const [vehicleFilter, setVehicleFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorBusy, setEditorBusy] = useState(false);
  const [editorError, setEditorError] = useState('');
  const [actionBusy, setActionBusy] = useState('');

  const range = useMemo(() => rangeFor(anchor, mode), [anchor, mode]);

  async function reloadOptions() {
    const value = await scheduleApi<Options>('/api/admin/schedule/options');
    setOptions(value);
  }

  useEffect(() => {
    let alive = true;
    void scheduleApi<Options>('/api/admin/schedule/options')
      .then((value) => { if (alive) setOptions(value); })
      .catch((candidate) => { if (alive) setError(candidate instanceof Error ? candidate.message : 'Não foi possível carregar recursos da agenda.'); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ from: range.from.toISOString(), to: range.to.toISOString() });
    if (instructorFilter) params.set('instructorId', instructorFilter);
    if (vehicleFilter) params.set('vehicleId', vehicleFilter);
    void scheduleApi<{ lessons: Lesson[] }>(`/api/admin/schedule/lessons?${params}`)
      .then((value) => { if (alive) setLessons(value.lessons); })
      .catch((candidate) => { if (alive) setError(candidate instanceof Error ? candidate.message : 'Não foi possível carregar a agenda.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [range.from.getTime(), range.to.getTime(), instructorFilter, vehicleFilter]);

  async function reloadLessons() {
    const params = new URLSearchParams({ from: range.from.toISOString(), to: range.to.toISOString() });
    if (instructorFilter) params.set('instructorId', instructorFilter);
    if (vehicleFilter) params.set('vehicleId', vehicleFilter);
    const value = await scheduleApi<{ lessons: Lesson[] }>(`/api/admin/schedule/lessons?${params}`);
    setLessons(value.lessons);
  }

  function shift(direction: -1 | 1) {
    const date = new Date(`${anchor}T12:00:00`);
    date.setDate(date.getDate() + direction * (mode === 'week' ? 7 : 1));
    setAnchor(ymd(date));
  }

  function openCreate() {
    if (!options) return;
    setEditorError('');
    setEditor(emptyEditor(options, anchor));
  }

  function openReschedule(lesson: Lesson) {
    setEditorError('');
    setEditor({
      lessonId: lesson.id,
      enrollmentId: lesson.enrollmentId,
      category: lesson.category,
      instructorId: lesson.instructorId,
      vehicleId: lesson.vehicleId,
      startsAtLocal: localInput(new Date(lesson.startsAt)),
      durationMinutes: durationMinutes(lesson),
      notes: lesson.notes ?? '',
    });
  }

  async function saveEditor() {
    if (!editor || !options) return;
    const enrollment = options.enrollments.find((item) => item.id === editor.enrollmentId);
    if (!enrollment) {
      setEditorError('Selecione uma matrícula ativa.');
      return;
    }
    const startsAt = new Date(editor.startsAtLocal);
    const endsAt = new Date(startsAt.getTime() + editor.durationMinutes * 60000);
    setEditorBusy(true);
    setEditorError('');
    try {
      if (editor.lessonId) {
        await scheduleApi<void>(`/api/admin/schedule/lessons/${editor.lessonId}/reschedule`, {
          method: 'POST',
          body: JSON.stringify({
            instructorId: editor.instructorId,
            vehicleId: editor.vehicleId,
            category: editor.category,
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            notes: editor.notes || null,
          }),
        });
      } else {
        await scheduleApi('/api/admin/schedule/lessons', {
          method: 'POST',
          body: JSON.stringify({
            enrollmentId: enrollment.id,
            studentId: enrollment.studentId,
            instructorId: editor.instructorId,
            vehicleId: editor.vehicleId,
            category: editor.category,
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            notes: editor.notes || null,
          }),
        });
      }
      setEditor(null);
      await reloadLessons();
    } catch (candidate) {
      setEditorError(candidate instanceof Error ? candidate.message : 'Não foi possível salvar a aula.');
    } finally {
      setEditorBusy(false);
    }
  }

  async function resolve(lesson: Lesson, status: 'COMPLETED' | 'NO_SHOW' | 'CANCELLED') {
    const label = status === 'COMPLETED' ? 'concluir' : status === 'NO_SHOW' ? 'marcar falta' : 'cancelar';
    if (!window.confirm(`Confirmar: ${label} a aula de ${lesson.studentName}?`)) return;
    setActionBusy(lesson.id);
    setError('');
    try {
      await scheduleApi<void>(`/api/admin/schedule/lessons/${lesson.id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
      await reloadLessons();
    } catch (candidate) {
      setError(candidate instanceof Error ? candidate.message : 'Não foi possível resolver a aula.');
    } finally {
      setActionBusy('');
    }
  }

  const groups = useMemo(() => {
    const map = new Map<string, Lesson[]>();
    for (const lesson of lessons) {
      const key = ymd(new Date(lesson.startsAt));
      map.set(key, [...(map.get(key) ?? []), lesson]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [lessons]);

  if (!options) {
    return <section className="admin-work-card"><p className="admin-empty">{error || 'Abrindo agenda…'}</p></section>;
  }

  const canSchedule = options.enrollments.length > 0 && options.instructors.some((item) => item.active) && options.vehicles.some((item) => item.active);

  return (
    <section className="admin-calendar" aria-labelledby="calendar-title">
      <div className="calendar-hero">
        <div>
          <p className="admin-eyebrow">AGENDA DA ESCOLA</p>
          <h1 id="calendar-title">Aulas</h1>
          <p>Aluno, instrutor e veículo compartilham a mesma agenda. Conflitos são rejeitados pelo kernel antes da gravação.</p>
        </div>
        <button className="admin-primary" type="button" onClick={openCreate} disabled={!canSchedule}>Nova aula</button>
      </div>

      <div className="calendar-toolbar">
        <div className="calendar-nav">
          <button type="button" onClick={() => shift(-1)}>←</button>
          <button type="button" onClick={() => setAnchor(todayYmd())}>Hoje</button>
          <button type="button" onClick={() => shift(1)}>→</button>
          <input type="date" value={anchor} onChange={(event) => setAnchor(event.target.value)} />
        </div>
        <div className="calendar-view-toggle">
          <button type="button" className={mode === 'day' ? 'is-active' : ''} onClick={() => setMode('day')}>Dia</button>
          <button type="button" className={mode === 'week' ? 'is-active' : ''} onClick={() => setMode('week')}>Semana</button>
        </div>
        <div className="calendar-filters">
          <select value={instructorFilter} onChange={(event) => setInstructorFilter(event.target.value)} aria-label="Filtrar por instrutor">
            <option value="">Todos os instrutores</option>
            {options.instructors.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}
          </select>
          <select value={vehicleFilter} onChange={(event) => setVehicleFilter(event.target.value)} aria-label="Filtrar por veículo">
            <option value="">Todos os veículos</option>
            {options.vehicles.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </div>
      </div>

      <div className="calendar-period">
        <strong>{mode === 'day' ? humanDate(range.from) : `${humanDate(range.from)} — ${humanDate(new Date(range.to.getTime() - 86400000))}`}</strong>
        <span>{options.policy.timezone} · slots de {options.policy.slotMinutes} min · aulas de {options.policy.lessonMinMinutes}–{options.policy.lessonMaxMinutes} min</span>
      </div>

      {error && <p className="admin-error" role="alert">{error}</p>}
      {!canSchedule && (
        <div className="calendar-empty-callout">
          <strong>A agenda ainda precisa de recursos.</strong>
          <span>Cadastre ao menos um instrutor e um veículo. Uma matrícula ativa também é necessária para criar aulas.</span>
        </div>
      )}

      <div className="calendar-board">
        {loading ? (
          <p className="admin-empty">Carregando aulas…</p>
        ) : lessons.length === 0 ? (
          <div className="calendar-empty-callout">
            <strong>Nenhuma aula neste período.</strong>
            <span>Use “Nova aula” para materializar o primeiro horário.</span>
          </div>
        ) : groups.map(([day, dayLessons]) => (
          <section className="calendar-day" key={day}>
            <header><strong>{humanDate(new Date(`${day}T12:00:00`))}</strong><span>{dayLessons.length} aula(s)</span></header>
            <div className="calendar-lessons">
              {dayLessons.map((lesson) => (
                <article className={`calendar-lesson calendar-lesson-${lesson.status.toLowerCase()}`} key={lesson.id}>
                  <div className="calendar-lesson-time">
                    <strong>{humanTime(lesson.startsAt)}</strong>
                    <span>{humanTime(lesson.endsAt)}</span>
                  </div>
                  <div className="calendar-lesson-student">
                    <strong>{lesson.studentName}</strong>
                    <span>{lesson.studentPublicId} · Categoria {lesson.category}</span>
                    {lesson.notes && <small>{lesson.notes}</small>}
                  </div>
                  <div className="calendar-lesson-resource">
                    <strong>{lesson.instructorName}</strong>
                    <span>{lesson.vehicleLabel} · {lesson.vehiclePlate}</span>
                  </div>
                  <div className="calendar-lesson-state">
                    <span className={`admin-state admin-state-${lesson.status === 'SCHEDULED' ? 'pending' : lesson.status === 'COMPLETED' ? 'ok' : 'neutral'}`}>{statusLabels[lesson.status]}</span>
                    {lesson.status === 'SCHEDULED' && (
                      <div className="calendar-lesson-actions">
                        <button type="button" onClick={() => openReschedule(lesson)} disabled={actionBusy === lesson.id}>Remarcar</button>
                        <button type="button" onClick={() => void resolve(lesson, 'COMPLETED')} disabled={actionBusy === lesson.id}>Concluir</button>
                        <button type="button" onClick={() => void resolve(lesson, 'NO_SHOW')} disabled={actionBusy === lesson.id}>Falta</button>
                        <button type="button" onClick={() => void resolve(lesson, 'CANCELLED')} disabled={actionBusy === lesson.id}>Cancelar</button>
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>

      <ResourceSetup options={options} onChanged={async () => { await reloadOptions(); }} />

      {editor && (
        <LessonEditor
          editor={editor}
          options={options}
          busy={editorBusy}
          error={editorError}
          onChange={setEditor}
          onCancel={() => setEditor(null)}
          onSubmit={() => void saveEditor()}
        />
      )}
    </section>
  );
}
