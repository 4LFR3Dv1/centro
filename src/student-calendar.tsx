import { useEffect, useMemo, useState } from 'react';
import FullCalendar, { type DatesSetInfo, type EventClickInfo, type EventDisplayInfo } from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/react/daygrid';
import listPlugin from '@fullcalendar/react/list';
import timeGridPlugin from '@fullcalendar/react/timegrid';
import ptBrLocale from '@fullcalendar/react/locales/pt-br';
import { useNavigate } from 'react-router-dom';
import './student-calendar.css';

type LessonStatus = 'SCHEDULED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED';

type StudentLesson = {
  id: string;
  enrollmentId: string;
  category: 'A' | 'B' | 'D';
  startsAt: string;
  endsAt: string;
  status: LessonStatus;
  instructorName: string;
  vehicleLabel: string;
  notes: string | null;
};

type CalendarEvent = {
  id: string;
  kind: 'LESSON' | 'PRACTICAL_EXAM';
  startsAt: string;
  endsAt: string;
  title: string;
  subtitle: string;
  status: string;
  category: 'A' | 'B' | 'D';
  detailHref: string;
};

type CalendarPayload = { events: CalendarEvent[]; upcoming: StudentLesson[]; past: StudentLesson[] };

type VisibleRange = { from: string; to: string; title: string };

const statusLabels: Record<LessonStatus, string> = {
  SCHEDULED: 'Agendada',
  COMPLETED: 'Concluída',
  NO_SHOW: 'Falta registrada',
  CANCELLED: 'Cancelada',
};

async function studentApi<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin' });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || 'Não foi possível carregar sua agenda.');
  return body;
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }).format(new Date(value));
}

function timeLabel(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function eventContent(info: EventDisplayInfo) {
  const kind = String(info.event.extendedProps.kind || 'LESSON');
  const subtitle = String(info.event.extendedProps.subtitle || '');
  return (
    <span className={`student-calendar-card student-calendar-card--${kind === 'PRACTICAL_EXAM' ? 'exam' : 'lesson'}`}>
      {info.timeText && <span className="student-calendar-card__time">{info.timeText}</span>}
      <span className="student-calendar-card__body"><strong>{info.event.title}</strong>{subtitle && <small>{subtitle}</small>}</span>
    </span>
  );
}

export function StudentCalendar() {
  const navigate = useNavigate();
  const [payload, setPayload] = useState<CalendarPayload>({ events: [], upcoming: [], past: [] });
  const [range, setRange] = useState<VisibleRange | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const initialView = useMemo(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches ? 'listWeek' : 'dayGridMonth', []);

  useEffect(() => {
    if (!range) return;
    let alive = true;
    setLoading(true); setError('');
    const params = new URLSearchParams({ from: range.from, to: range.to });
    void studentApi<CalendarPayload>(`/api/student/calendar?${params}`)
      .then((value) => { if (alive) setPayload(value); })
      .catch((candidate) => { if (alive) setError(candidate instanceof Error ? candidate.message : 'Não foi possível carregar sua agenda.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [range?.from, range?.to]);

  const events = useMemo(() => payload.events.map((event) => ({
    id: event.id,
    title: event.title,
    start: event.startsAt,
    end: event.endsAt,
    editable: false,
    classNames: [event.kind === 'PRACTICAL_EXAM' ? 'student-calendar-domain--exam' : 'student-calendar-domain--lesson', `is-${event.status.toLowerCase()}`],
    extendedProps: { kind: event.kind, subtitle: event.subtitle, detailHref: event.detailHref },
  })), [payload.events]);

  function syncRange(info: DatesSetInfo) {
    const next = { from: info.start.toISOString(), to: info.end.toISOString(), title: info.view.title };
    setRange((current) => current?.from === next.from && current.to === next.to ? current : next);
  }

  function openEvent(info: EventClickInfo) {
    const href = String(info.event.extendedProps.detailHref || '');
    if (href) navigate(href);
  }

  return (
    <div className="student-calendar-page-v2">
      <section className="student-calendar-hero-v2">
        <p className="student-eyebrow">MINHA AGENDA</p>
        <h1>Seus próximos compromissos.</h1>
        <p>Aulas e exame prático aparecem na mesma linha do tempo. Esta agenda é somente leitura: qualquer mudança vem da operação da escola.</p>
      </section>

      {error && <p className="student-error" role="alert">{error}</p>}
      <section className="student-calendar-shell">
        {loading && <div className="student-calendar-loading-overlay">Atualizando agenda…</div>}
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin]}
          locale={ptBrLocale}
          initialView={initialView}
          views={{ dayGridMonth: { className: 'student-calendar-view--month', eventContent } }}
          headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek' }}
          height="auto"
          timeZone="America/Sao_Paulo"
          nowIndicator
          editable={false}
          selectable={false}
          events={events}
          datesSet={syncRange}
          eventClick={openEvent}
          eventContent={eventContent}
          eventDidMount={(info) => {
            const subtitle = String(info.event.extendedProps.subtitle || '');
            info.el.setAttribute('title', subtitle ? `${info.event.title} — ${subtitle}` : info.event.title);
          }}
          toolbarClass="student-calendar-toolbar"
          headerToolbarClass="student-calendar-toolbar--header"
          toolbarSectionClass="student-calendar-toolbar__section"
          toolbarTitleClass="student-calendar-toolbar__title"
          buttonGroupClass="student-calendar-button-group"
          buttonClass={(info) => `student-calendar-button${info.isSelected ? ' is-selected' : ''}${info.isDisabled ? ' is-disabled' : ''}`}
          viewClass="student-calendar-view"
          tableClass="student-calendar-table"
          tableHeaderClass="student-calendar-table__header"
          tableBodyClass="student-calendar-table__body"
          dayHeaderRowClass="student-calendar-day-header-row"
          dayHeaderClass="student-calendar-day-header"
          dayHeaderDividerClass="student-calendar-divider"
          dayRowClass="student-calendar-day-row"
          dayCellClass={(info) => `student-calendar-day-cell${info.isToday ? ' is-today' : ''}${info.isOther ? ' is-other' : ''}`}
          dayCellTopClass="student-calendar-day-cell__top"
          dayCellTopInnerClass="student-calendar-day-cell__number"
          dayCellInnerClass="student-calendar-day-cell__inner"
          dayCellBottomClass="student-calendar-day-cell__bottom"
          dayLaneClass={(info) => `student-calendar-day-lane${info.isToday ? ' is-today' : ''}`}
          slotLaneClass={(info) => `student-calendar-slot-lane${info.isMajor ? ' is-major' : ''}`}
          slotHeaderClass="student-calendar-slot-header"
          slotHeaderDividerClass="student-calendar-divider"
          allDayHeaderClass="student-calendar-all-day-header"
          rowEventClass="student-calendar-event student-calendar-event--row"
          rowEventInnerClass="student-calendar-event__inner"
          rowEventTimeClass="student-calendar-event__time"
          rowEventTitleClass="student-calendar-event__title"
          columnEventClass="student-calendar-event student-calendar-event--column"
          columnEventInnerClass="student-calendar-event__inner"
          columnEventTimeClass="student-calendar-event__time"
          columnEventTitleClass="student-calendar-event__title"
          listItemEventClass="student-calendar-list-event"
          listItemEventInnerClass="student-calendar-list-event__inner"
          listItemEventTimeClass="student-calendar-list-event__time"
          listItemEventTitleClass="student-calendar-list-event__title"
          listDayClass="student-calendar-list-day"
          listDayHeaderClass="student-calendar-list-day__header"
          listDayHeaderInnerClass="student-calendar-list-day__header-inner"
          noEventsClass="student-calendar-no-events"
          noEventsInnerClass="student-calendar-no-events__inner"
          noEventsContent="Nenhum compromisso neste período."
          highlightClass="student-calendar-highlight"
          nowIndicatorHeaderClass="student-calendar-now-indicator__header"
          nowIndicatorLineClass="student-calendar-now-indicator__line"
          nowIndicatorDotClass="student-calendar-now-indicator__dot"
        />
      </section>
      <div className="student-calendar-caption"><span>{range?.title || 'Agenda'}</span><span>Aula · Exame prático</span></div>
    </div>
  );
}

export function StudentLessonDetail({ lessonId }: { lessonId: string }) {
  const navigate = useNavigate();
  const [lesson, setLesson] = useState<StudentLesson | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    void studentApi<{ lesson: StudentLesson }>(`/api/student/lessons/${lessonId}`)
      .then((value) => { if (alive) setLesson(value.lesson); })
      .catch((candidate) => { if (alive) setError(candidate instanceof Error ? candidate.message : 'Não foi possível abrir a aula.'); });
    return () => { alive = false; };
  }, [lessonId]);

  if (error) return <section className="student-panel"><p className="student-error" role="alert">{error}</p><button className="student-secondary" type="button" onClick={() => navigate('/aluno/agenda')}>Voltar</button></section>;
  if (!lesson) return <section className="student-panel"><p>Abrindo aula…</p></section>;

  return (
    <section className="student-panel student-lesson-detail" aria-labelledby="student-lesson-detail-title">
      <button className="student-back" type="button" onClick={() => navigate('/aluno/agenda')}>← Minha agenda</button>
      <p className="student-eyebrow">AULA · CATEGORIA {lesson.category}</p>
      <h1 id="student-lesson-detail-title">{dateLabel(lesson.startsAt)}</h1>
      <p className="student-lesson-time">{timeLabel(lesson.startsAt)} — {timeLabel(lesson.endsAt)}</p>
      <div className="student-lesson-facts">
        <div><span>Status</span><strong>{statusLabels[lesson.status]}</strong></div>
        <div><span>Instrutor</span><strong>{lesson.instructorName}</strong></div>
        <div><span>Veículo</span><strong>{lesson.vehicleLabel}</strong></div>
        <div><span>Categoria</span><strong>{lesson.category}</strong></div>
      </div>
      {lesson.notes && <div className="student-lesson-note"><span>Observação da escola</span><p>{lesson.notes}</p></div>}
      <p className="student-lesson-source">Este horário é uma projeção do mesmo registro operacional usado pela escola.</p>
    </section>
  );
}
