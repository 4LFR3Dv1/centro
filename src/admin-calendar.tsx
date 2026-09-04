import { FormEvent, useEffect, useMemo, useState } from 'react';
import FullCalendar, {
  type DateSelectInfo,
  type DatesSetInfo,
  type EventClickInfo,
  type EventDisplayInfo,
} from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/react/daygrid';
import interactionPlugin from '@fullcalendar/react/interaction';
import listPlugin from '@fullcalendar/react/list';
import timeGridPlugin from '@fullcalendar/react/timegrid';
import ptBrLocale from '@fullcalendar/react/locales/pt-br';
import { useNavigate } from 'react-router-dom';
import './admin-calendar.css';

type PhysicalCategory = 'A' | 'B' | 'D';
type EnrollmentCategory = PhysicalCategory | 'AB';
type LessonStatus = 'SCHEDULED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED';
type ExamSessionStatus = 'PLANNED' | 'CONFIRMED' | 'CLOSED' | 'CANCELLED';
type CalendarKindFilter = 'ALL' | 'LESSON' | 'EXAM';

type SchedulePolicy = {
  id: string | null;
  name: string;
  timezone: string;
  slotMinutes: number;
  lessonMinMinutes: number;
  lessonMaxMinutes: number;
  persisted: boolean;
};

type Instructor = { id: string; displayName: string; active: boolean; categories: PhysicalCategory[] };
type Vehicle = { id: string; plate: string; label: string; category: PhysicalCategory; active: boolean };
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

type ExamSession = {
  id: string;
  category: PhysicalCategory;
  locationLabel: string;
  startsAt: string;
  endsAt: string;
  instructorId: string;
  instructorName: string;
  vehicleId: string;
  vehicleLabel: string;
  vehiclePlate: string;
  status: ExamSessionStatus;
  notes: string | null;
  candidateCount: number;
  pendingCount: number;
  approvedCount: number;
  failedCount: number;
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

type VisibleRange = { from: string; to: string; title: string };

const DAY_MS = 24 * 60 * 60 * 1000;
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

function localInput(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  const hour = String(value.getHours()).padStart(2, '0');
  const minute = String(value.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function humanDate(value: Date | string): string {
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
}

function humanTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function allowedCategories(enrollment?: Enrollment): PhysicalCategory[] {
  if (!enrollment) return ['B'];
  if (enrollment.category === 'AB') return ['A', 'B'];
  return [enrollment.category];
}

function durationMinutes(lesson: Lesson): number {
  return Math.round((new Date(lesson.endsAt).getTime() - new Date(lesson.startsAt).getTime()) / 60000);
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

async function fetchLessonsInRange(from: string, to: string): Promise<Lesson[]> {
  const fromDate = new Date(from);
  const toDate = new Date(to);
  const byId = new Map<string, Lesson>();
  let cursor = fromDate.getTime();
  while (cursor < toDate.getTime()) {
    const chunkEnd = Math.min(toDate.getTime(), cursor + 31 * DAY_MS);
    const params = new URLSearchParams({ from: new Date(cursor).toISOString(), to: new Date(chunkEnd).toISOString() });
    const payload = await scheduleApi<{ lessons: Lesson[] }>(`/api/admin/schedule/lessons?${params}`);
    for (const lesson of payload.lessons) byId.set(lesson.id, lesson);
    cursor = chunkEnd;
  }
  return [...byId.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

function LessonEditor({ editor, options, busy, error, onChange, onCancel, onSubmit }: {
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
    onChange({ ...editor, enrollmentId: value, category: nextCategory, instructorId: nextInstructor?.id ?? '', vehicleId: nextVehicle?.id ?? '' });
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
          <div><p className="admin-eyebrow">AGENDA</p><h2 id="calendar-editor-title">{editor.lessonId ? 'Remarcar aula' : 'Nova aula'}</h2></div>
          <button type="button" className="calendar-close" onClick={onCancel} aria-label="Fechar">×</button>
        </div>
        <div className="calendar-editor-form">
          <label>Aluno / matrícula
            <select value={editor.enrollmentId} onChange={(event) => chooseEnrollment(event.target.value)} disabled={Boolean(editor.lessonId)}>
              {options.enrollments.map((item) => <option key={item.id} value={item.id}>{item.studentName} · {item.studentPublicId} · {item.category}</option>)}
            </select>
          </label>
          <div className="calendar-editor-grid">
            <label>Categoria
              <select value={editor.category} onChange={(event) => chooseCategory(event.target.value as PhysicalCategory)}>
                {categories.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            </label>
            <label>Início<input type="datetime-local" step={options.policy.slotMinutes * 60} value={editor.startsAtLocal} onChange={(event) => onChange({ ...editor, startsAtLocal: event.target.value })} /></label>
            <label>Duração
              <select value={editor.durationMinutes} onChange={(event) => onChange({ ...editor, durationMinutes: Number(event.target.value) })}>
                {Array.from({ length: Math.floor((options.policy.lessonMaxMinutes - options.policy.lessonMinMinutes) / options.policy.slotMinutes) + 1 }, (_, index) => options.policy.lessonMinMinutes + index * options.policy.slotMinutes)
                  .filter((minutes) => minutes <= options.policy.lessonMaxMinutes)
                  .map((minutes) => <option key={minutes} value={minutes}>{minutes} min</option>)}
              </select>
            </label>
          </div>
          <div className="calendar-editor-grid">
            <label>Instrutor<select value={editor.instructorId} onChange={(event) => onChange({ ...editor, instructorId: event.target.value })}><option value="">Selecione</option>{instructors.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
            <label>Veículo<select value={editor.vehicleId} onChange={(event) => onChange({ ...editor, vehicleId: event.target.value })}><option value="">Selecione</option>{vehicles.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.plate}</option>)}</select></label>
          </div>
          <label>Observação<textarea rows={3} value={editor.notes} onChange={(event) => onChange({ ...editor, notes: event.target.value })} /></label>
          {(!instructors.length || !vehicles.length) && <p className="calendar-inline-warning">Cadastre um instrutor autorizado e um veículo da categoria {editor.category} antes de agendar.</p>}
          {error && <p className="admin-error" role="alert">{error}</p>}
          <div className="calendar-editor-actions">
            <button type="button" className="admin-secondary" onClick={onCancel}>Cancelar</button>
            <button type="button" className="admin-primary" disabled={busy || !editor.enrollmentId || !editor.instructorId || !editor.vehicleId || !editor.startsAtLocal} onClick={onSubmit}>{busy ? 'Salvando…' : editor.lessonId ? 'Confirmar remarcação' : 'Agendar aula'}</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function LessonInspector({ lesson, busy, onClose, onReschedule, onResolve }: {
  lesson: Lesson;
  busy: boolean;
  onClose: () => void;
  onReschedule: () => void;
  onResolve: (status: 'COMPLETED' | 'NO_SHOW' | 'CANCELLED') => void;
}) {
  return (
    <div className="calendar-editor-backdrop" role="presentation">
      <section className="calendar-editor calendar-inspector" role="dialog" aria-modal="true" aria-labelledby="calendar-inspector-title">
        <div className="calendar-editor-head">
          <div><p className="admin-eyebrow">AULA · {statusLabels[lesson.status].toUpperCase()}</p><h2 id="calendar-inspector-title">{lesson.studentName}</h2></div>
          <button type="button" className="calendar-close" onClick={onClose} aria-label="Fechar">×</button>
        </div>
        <div className="calendar-inspector-time"><strong>{humanTime(lesson.startsAt)} — {humanTime(lesson.endsAt)}</strong><span>{humanDate(lesson.startsAt)}</span></div>
        <dl className="calendar-inspector-grid">
          <div><dt>Aluno</dt><dd>{lesson.studentPublicId}</dd></div>
          <div><dt>Categoria</dt><dd>{lesson.category}</dd></div>
          <div><dt>Instrutor</dt><dd>{lesson.instructorName}</dd></div>
          <div><dt>Veículo</dt><dd>{lesson.vehicleLabel} · {lesson.vehiclePlate}</dd></div>
        </dl>
        {lesson.notes && <p className="calendar-inspector-note">{lesson.notes}</p>}
        {lesson.status === 'SCHEDULED' && <div className="calendar-inspector-actions">
          <button type="button" className="admin-secondary" onClick={onReschedule} disabled={busy}>Remarcar</button>
          <button type="button" className="admin-secondary" onClick={() => onResolve('COMPLETED')} disabled={busy}>Concluir</button>
          <button type="button" className="admin-secondary" onClick={() => onResolve('NO_SHOW')} disabled={busy}>Falta</button>
          <button type="button" className="admin-secondary" onClick={() => onResolve('CANCELLED')} disabled={busy}>Cancelar</button>
        </div>}
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
    setBusy(true); setError(''); setMessage('');
    try { await operation(); setMessage(success); await onChanged(); }
    catch (candidate) { setError(candidate instanceof Error ? candidate.message : 'Não foi possível salvar o recurso.'); }
    finally { setBusy(false); }
  }
  function submitInstructor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const categories = ['A', 'B', 'D'].filter((category) => form.get(`category-${category}`) === 'on');
    void run(() => scheduleApi('/api/admin/schedule/instructors', { method: 'POST', body: JSON.stringify({ displayName: String(form.get('displayName') || ''), categories }) }), 'Instrutor cadastrado.');
    event.currentTarget.reset();
  }
  function submitVehicle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    void run(() => scheduleApi('/api/admin/schedule/vehicles', { method: 'POST', body: JSON.stringify({ plate: String(form.get('plate') || ''), label: String(form.get('label') || ''), category: String(form.get('category') || 'B') }) }), 'Veículo cadastrado.');
    event.currentTarget.reset();
  }
  function submitPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    void run(() => scheduleApi('/api/admin/schedule/policy', { method: 'POST', body: JSON.stringify({ name: String(form.get('name') || 'Política da escola'), timezone: 'America/Sao_Paulo', slotMinutes: Number(form.get('slotMinutes')), lessonMinMinutes: Number(form.get('lessonMinMinutes')), lessonMaxMinutes: Number(form.get('lessonMaxMinutes')) }) }), 'Política de agenda ativada.');
  }
  return <section className="calendar-resources">
    <button className="calendar-resources-toggle" type="button" onClick={() => setOpen((value) => !value)}><span>Recursos da agenda</span><small>{options.instructors.filter((item) => item.active).length} instrutor(es) · {options.vehicles.filter((item) => item.active).length} veículo(s)</small><strong>{open ? '−' : '+'}</strong></button>
    {open && <div className="calendar-resources-body">
      <div className="calendar-resource-column"><div className="calendar-resource-title"><strong>Instrutores</strong><span>Quem pode operar cada categoria.</span></div><div className="calendar-resource-list">{options.instructors.map((item) => <div key={item.id}><strong>{item.displayName}</strong><small>{item.categories.join(' · ') || 'Sem categoria'}</small></div>)}</div><form className="calendar-resource-form" onSubmit={submitInstructor}><input name="displayName" placeholder="Nome do instrutor" required /><div className="calendar-checks">{(['A', 'B', 'D'] as PhysicalCategory[]).map((category) => <label key={category}><input type="checkbox" name={`category-${category}`} /> {category}</label>)}</div><button className="admin-secondary" type="submit" disabled={busy}>Adicionar instrutor</button></form></div>
      <div className="calendar-resource-column"><div className="calendar-resource-title"><strong>Veículos</strong><span>Categoria física é única por veículo.</span></div><div className="calendar-resource-list">{options.vehicles.map((item) => <div key={item.id}><strong>{item.label}</strong><small>{item.plate} · {item.category}</small></div>)}</div><form className="calendar-resource-form" onSubmit={submitVehicle}><input name="label" placeholder="Ex.: Onix 01" required /><input name="plate" placeholder="Placa" required /><select name="category" defaultValue="B"><option value="A">A</option><option value="B">B</option><option value="D">D</option></select><button className="admin-secondary" type="submit" disabled={busy}>Adicionar veículo</button></form></div>
      <div className="calendar-resource-column"><div className="calendar-resource-title"><strong>Política</strong><span>{options.policy.persisted ? options.policy.name : 'Usando política padrão não persistida'}</span></div><form className="calendar-resource-form" onSubmit={submitPolicy}><input name="name" defaultValue={options.policy.persisted ? options.policy.name : 'Política da escola'} required /><label>Slot (min)<input name="slotMinutes" type="number" min="5" max="120" defaultValue={options.policy.slotMinutes} required /></label><label>Mínimo (min)<input name="lessonMinMinutes" type="number" min="10" max="240" defaultValue={options.policy.lessonMinMinutes} required /></label><label>Máximo (min)<input name="lessonMaxMinutes" type="number" min="10" max="480" defaultValue={options.policy.lessonMaxMinutes} required /></label><button className="admin-secondary" type="submit" disabled={busy}>Ativar nova política</button></form></div>
    </div>}
    {message && <p className="calendar-resource-message">{message}</p>}{error && <p className="admin-error" role="alert">{error}</p>}
  </section>;
}

function calendarEventContent(info: EventDisplayInfo) {
  const kind = String(info.event.extendedProps.kind || 'LESSON');
  const subtitle = String(info.event.extendedProps.subtitle || '');
  return <span className={`calendar-event-card calendar-event-card--${kind === 'EXAM' ? 'exam' : 'lesson'}`}>{info.timeText && <span className="calendar-event-card__time">{info.timeText}</span>}<span className="calendar-event-card__body"><strong>{info.event.title}</strong>{subtitle && <small>{subtitle}</small>}</span></span>;
}

export function AdminCalendar() {
  const navigate = useNavigate();
  const [options, setOptions] = useState<Options | null>(null);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [exams, setExams] = useState<ExamSession[]>([]);
  const [range, setRange] = useState<VisibleRange | null>(null);
  const [instructorFilter, setInstructorFilter] = useState('');
  const [vehicleFilter, setVehicleFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'' | PhysicalCategory>('');
  const [kindFilter, setKindFilter] = useState<CalendarKindFilter>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorBusy, setEditorBusy] = useState(false);
  const [editorError, setEditorError] = useState('');
  const [focusedLessonId, setFocusedLessonId] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState('');
  const initialView = useMemo(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches ? 'timeGridDay' : 'timeGridWeek', []);
  const focusedLesson = lessons.find((lesson) => lesson.id === focusedLessonId) ?? null;

  async function reloadOptions() { setOptions(await scheduleApi<Options>('/api/admin/schedule/options')); }
  async function loadVisibleRange(from: string, to: string) {
    setLoading(true); setError('');
    try {
      const [nextLessons, examPayload] = await Promise.all([fetchLessonsInRange(from, to), scheduleApi<{ sessions: ExamSession[] }>(`/api/admin/exams?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)]);
      setLessons(nextLessons); setExams(examPayload.sessions);
    } catch (candidate) { setError(candidate instanceof Error ? candidate.message : 'Não foi possível carregar a agenda operacional.'); }
    finally { setLoading(false); }
  }
  async function reloadData() { if (range) await loadVisibleRange(range.from, range.to); }

  useEffect(() => {
    let alive = true;
    void scheduleApi<Options>('/api/admin/schedule/options').then((value) => { if (alive) setOptions(value); }).catch((candidate) => { if (alive) setError(candidate instanceof Error ? candidate.message : 'Não foi possível carregar recursos da agenda.'); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  useEffect(() => { if (range) void loadVisibleRange(range.from, range.to); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [range?.from, range?.to]);

  const visibleLessons = useMemo(() => lessons.filter((lesson) => kindFilter !== 'EXAM' && (!instructorFilter || lesson.instructorId === instructorFilter) && (!vehicleFilter || lesson.vehicleId === vehicleFilter) && (!categoryFilter || lesson.category === categoryFilter)), [lessons, kindFilter, instructorFilter, vehicleFilter, categoryFilter]);
  const visibleExams = useMemo(() => exams.filter((exam) => kindFilter !== 'LESSON' && (!instructorFilter || exam.instructorId === instructorFilter) && (!vehicleFilter || exam.vehicleId === vehicleFilter) && (!categoryFilter || exam.category === categoryFilter)), [exams, kindFilter, instructorFilter, vehicleFilter, categoryFilter]);
  const events = useMemo(() => [
    ...visibleLessons.map((lesson) => ({ id: `lesson:${lesson.id}`, title: lesson.studentName, start: lesson.startsAt, end: lesson.endsAt, startEditable: lesson.status === 'SCHEDULED', durationEditable: lesson.status === 'SCHEDULED', classNames: ['centro-calendar-event', 'centro-calendar-event--lesson', `is-${lesson.status.toLowerCase()}`], extendedProps: { kind: 'LESSON', lessonId: lesson.id, subtitle: `${lesson.studentPublicId} · ${lesson.instructorName} · ${lesson.vehicleLabel}` } })),
    ...visibleExams.map((exam) => ({ id: `exam:${exam.id}`, title: `Exame ${exam.category} · ${exam.candidateCount} aluno${exam.candidateCount === 1 ? '' : 's'}`, start: exam.startsAt, end: exam.endsAt, startEditable: false, durationEditable: false, classNames: ['centro-calendar-event', 'centro-calendar-event--exam', `is-${exam.status.toLowerCase()}`], extendedProps: { kind: 'EXAM', examId: exam.id, subtitle: `${exam.locationLabel} · ${exam.instructorName} · ${exam.vehicleLabel}` } })),
  ], [visibleLessons, visibleExams]);

  function openCreate(anchor?: Date) { if (!options) return; setFocusedLessonId(null); setEditorError(''); const draft = emptyEditor(options, ymd(anchor ?? new Date())); if (anchor) draft.startsAtLocal = localInput(anchor); setEditor(draft); }
  function openCreateFromSelection(selection: DateSelectInfo) {
    if (!options) return; const draft = emptyEditor(options, ymd(selection.start));
    if (selection.allDay) draft.startsAtLocal = `${selection.startStr.slice(0, 10)}T08:00`;
    else { draft.startsAtLocal = localInput(selection.start); const selectedMinutes = Math.round((selection.end.getTime() - selection.start.getTime()) / 60000); const snapped = Math.round(selectedMinutes / options.policy.slotMinutes) * options.policy.slotMinutes; draft.durationMinutes = Math.max(options.policy.lessonMinMinutes, Math.min(options.policy.lessonMaxMinutes, snapped || options.policy.lessonMinMinutes)); }
    setFocusedLessonId(null); setEditorError(''); setEditor(draft);
  }
  function openReschedule(lesson: Lesson) { setFocusedLessonId(null); setEditorError(''); setEditor({ lessonId: lesson.id, enrollmentId: lesson.enrollmentId, category: lesson.category, instructorId: lesson.instructorId, vehicleId: lesson.vehicleId, startsAtLocal: localInput(new Date(lesson.startsAt)), durationMinutes: durationMinutes(lesson), notes: lesson.notes ?? '' }); }
  async function saveEditor() {
    if (!editor || !options) return; const enrollment = options.enrollments.find((item) => item.id === editor.enrollmentId); if (!enrollment) { setEditorError('Selecione uma matrícula ativa.'); return; }
    const startsAt = new Date(editor.startsAtLocal); const endsAt = new Date(startsAt.getTime() + editor.durationMinutes * 60000); setEditorBusy(true); setEditorError('');
    try {
      if (editor.lessonId) await scheduleApi<void>(`/api/admin/schedule/lessons/${editor.lessonId}/reschedule`, { method: 'POST', body: JSON.stringify({ instructorId: editor.instructorId, vehicleId: editor.vehicleId, category: editor.category, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), notes: editor.notes || null }) });
      else await scheduleApi('/api/admin/schedule/lessons', { method: 'POST', body: JSON.stringify({ enrollmentId: enrollment.id, studentId: enrollment.studentId, instructorId: editor.instructorId, vehicleId: editor.vehicleId, category: editor.category, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), notes: editor.notes || null }) });
      setEditor(null); await reloadData();
    } catch (candidate) { setEditorError(candidate instanceof Error ? candidate.message : 'Não foi possível salvar a aula.'); }
    finally { setEditorBusy(false); }
  }
  async function resolveLesson(lesson: Lesson, status: 'COMPLETED' | 'NO_SHOW' | 'CANCELLED') {
    const label = status === 'COMPLETED' ? 'concluir' : status === 'NO_SHOW' ? 'marcar falta' : 'cancelar'; if (!window.confirm(`Confirmar: ${label} a aula de ${lesson.studentName}?`)) return;
    setActionBusy(lesson.id); setError('');
    try { await scheduleApi<void>(`/api/admin/schedule/lessons/${lesson.id}/resolve`, { method: 'POST', body: JSON.stringify({ status }) }); setFocusedLessonId(null); await reloadData(); }
    catch (candidate) { setError(candidate instanceof Error ? candidate.message : 'Não foi possível resolver a aula.'); }
    finally { setActionBusy(''); }
  }
  async function moveLessonFromCalendar(lessonId: string, startsAt: Date | null, endsAt: Date | null, revert: () => void) {
    const lesson = lessons.find((item) => item.id === lessonId); if (!lesson || lesson.status !== 'SCHEDULED' || !startsAt) { revert(); return; }
    const end = endsAt ?? new Date(startsAt.getTime() + durationMinutes(lesson) * 60000); setError('');
    try { await scheduleApi<void>(`/api/admin/schedule/lessons/${lesson.id}/reschedule`, { method: 'POST', body: JSON.stringify({ instructorId: lesson.instructorId, vehicleId: lesson.vehicleId, category: lesson.category, startsAt: startsAt.toISOString(), endsAt: end.toISOString(), notes: lesson.notes }) }); await reloadData(); }
    catch (candidate) { revert(); setError(candidate instanceof Error ? candidate.message : 'O kernel rejeitou a nova posição da aula.'); }
  }
  function syncRange(info: DatesSetInfo) { const next = { from: info.start.toISOString(), to: info.end.toISOString(), title: info.view.title }; setRange((current) => current?.from === next.from && current.to === next.to ? current : next); }
  function handleEventClick(info: EventClickInfo) { if (String(info.event.extendedProps.kind || 'LESSON') === 'EXAM') { navigate('/admin/exames'); return; } const lessonId = String(info.event.extendedProps.lessonId || ''); if (lessonId) setFocusedLessonId(lessonId); }

  if (!options) return <section className="admin-work-card"><p className="admin-empty">{error || 'Abrindo agenda…'}</p></section>;
  const canSchedule = options.enrollments.length > 0 && options.instructors.some((item) => item.active) && options.vehicles.some((item) => item.active);

  return <section className="admin-calendar" aria-labelledby="calendar-title">
    <div className="calendar-hero"><div><p className="admin-eyebrow">AGENDA OPERACIONAL</p><h1 id="calendar-title">Calendário</h1><p>Aulas e listas de exame compartilham a mesma superfície. Mover uma aula solicita uma remarcação ao kernel; conflitos continuam sendo rejeitados antes da gravação.</p></div><button className="admin-primary" type="button" onClick={() => openCreate()} disabled={!canSchedule}>Nova aula</button></div>
    <div className="calendar-context-bar"><div className="calendar-filters">
      <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as CalendarKindFilter)} aria-label="Filtrar tipo de evento"><option value="ALL">Aulas + exames</option><option value="LESSON">Somente aulas</option><option value="EXAM">Somente exames</option></select>
      <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as '' | PhysicalCategory)} aria-label="Filtrar categoria"><option value="">Todas as categorias</option><option value="A">Categoria A</option><option value="B">Categoria B</option><option value="D">Categoria D</option></select>
      <select value={instructorFilter} onChange={(event) => setInstructorFilter(event.target.value)} aria-label="Filtrar por instrutor"><option value="">Todos os instrutores</option>{options.instructors.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select>
      <select value={vehicleFilter} onChange={(event) => setVehicleFilter(event.target.value)} aria-label="Filtrar por veículo"><option value="">Todos os veículos</option>{options.vehicles.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
    </div><div className="calendar-legend" aria-label="Legenda da agenda"><span><i className="calendar-legend-dot calendar-legend-dot--lesson" /> Aula</span><span><i className="calendar-legend-dot calendar-legend-dot--exam" /> Exame</span><small>{options.policy.timezone} · slots de {options.policy.slotMinutes} min</small></div></div>
    {error && <p className="admin-error" role="alert">{error}</p>}
    {!canSchedule && <div className="calendar-empty-callout"><strong>A agenda ainda precisa de recursos.</strong><span>Cadastre ao menos um instrutor e um veículo. Uma matrícula ativa também é necessária para criar aulas.</span></div>}
    <div className="calendar-surface">{loading && <div className="calendar-loading">Atualizando agenda…</div>}<FullCalendar
      plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
      locale={ptBrLocale}
      initialView={initialView}
      headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek' }}
      height="auto"
      timeZone={options.policy.timezone}
      nowIndicator
      selectable={canSchedule}
      selectMirror
      editable
      events={events}
      datesSet={syncRange}
      select={openCreateFromSelection}
      eventClick={handleEventClick}
      eventContent={calendarEventContent}
      eventDidMount={(info) => { const subtitle = String(info.event.extendedProps.subtitle || ''); info.el.setAttribute('title', subtitle ? `${info.event.title} — ${subtitle}` : info.event.title); }}
      eventDrop={(info) => void moveLessonFromCalendar(String(info.event.extendedProps.lessonId || ''), info.event.start, info.event.end, info.revert)}
      eventResize={(info) => void moveLessonFromCalendar(String(info.event.extendedProps.lessonId || ''), info.event.start, info.event.end, info.revert)}
    /></div>
    <div className="calendar-footnote"><span>{range?.title || 'Agenda'}</span><span>{visibleLessons.length} aula(s) · {visibleExams.length} lista(s) de exame</span></div>
    <ResourceSetup options={options} onChanged={async () => { await reloadOptions(); }} />
    {focusedLesson && <LessonInspector lesson={focusedLesson} busy={actionBusy === focusedLesson.id} onClose={() => setFocusedLessonId(null)} onReschedule={() => openReschedule(focusedLesson)} onResolve={(status) => void resolveLesson(focusedLesson, status)} />}
    {editor && <LessonEditor editor={editor} options={options} busy={editorBusy} error={editorError} onChange={setEditor} onCancel={() => setEditor(null)} onSubmit={() => void saveEditor()} />}
  </section>;
}
