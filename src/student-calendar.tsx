import { useEffect, useState } from 'react';
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

type CalendarPayload = {
  upcoming: StudentLesson[];
  past: StudentLesson[];
};

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
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  }).format(new Date(value));
}

function timeLabel(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function LessonRow({ lesson, onOpen }: { lesson: StudentLesson; onOpen: () => void }) {
  return (
    <button className="student-calendar-row" type="button" onClick={onOpen}>
      <span className="student-calendar-date">
        <strong>{dateLabel(lesson.startsAt)}</strong>
        <small>{timeLabel(lesson.startsAt)} — {timeLabel(lesson.endsAt)}</small>
      </span>
      <span className="student-calendar-class">
        <strong>Aula categoria {lesson.category}</strong>
        <small>{lesson.instructorName} · {lesson.vehicleLabel}</small>
      </span>
      <span className={`student-calendar-status student-calendar-status-${lesson.status.toLowerCase()}`}>
        {statusLabels[lesson.status]}
      </span>
      <span className="student-calendar-arrow">→</span>
    </button>
  );
}

export function StudentCalendar() {
  const navigate = useNavigate();
  const [calendar, setCalendar] = useState<CalendarPayload | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setError('');
    void studentApi<CalendarPayload>('/api/student/calendar')
      .then((value) => { if (alive) setCalendar(value); })
      .catch((candidate) => { if (alive) setError(candidate instanceof Error ? candidate.message : 'Não foi possível carregar sua agenda.'); });
    return () => { alive = false; };
  }, []);

  if (error) return <section className="student-panel"><p className="student-error" role="alert">{error}</p></section>;
  if (!calendar) return <section className="student-panel"><p className="student-calendar-loading">Carregando sua agenda…</p></section>;

  return (
    <div className="student-calendar-page">
      <section className="student-calendar-hero">
        <p className="student-eyebrow">MINHA AGENDA</p>
        <h1>Suas aulas.</h1>
        <p>Os horários abaixo são os mesmos registrados pela escola. Você não precisa confirmar ou replicar nenhum agendamento.</p>
      </section>

      <section className="student-panel student-calendar-section" aria-labelledby="upcoming-lessons-title">
        <div className="student-panel-head">
          <div>
            <p className="student-eyebrow">PRÓXIMAS</p>
            <h2 id="upcoming-lessons-title">Aulas futuras</h2>
          </div>
          <span>{calendar.upcoming.length}</span>
        </div>
        <div className="student-calendar-list">
          {calendar.upcoming.length === 0 ? (
            <div className="student-calendar-empty">
              <strong>Nenhuma aula futura agendada.</strong>
              <span>Quando a escola materializar um horário, ele aparecerá aqui automaticamente.</span>
            </div>
          ) : calendar.upcoming.map((lesson) => (
            <LessonRow key={lesson.id} lesson={lesson} onOpen={() => navigate(`/aluno/agenda/${lesson.id}`)} />
          ))}
        </div>
      </section>

      <section className="student-panel student-calendar-section" aria-labelledby="past-lessons-title">
        <div className="student-panel-head">
          <div>
            <p className="student-eyebrow">HISTÓRICO</p>
            <h2 id="past-lessons-title">Aulas passadas</h2>
          </div>
          <span>{calendar.past.length}</span>
        </div>
        <div className="student-calendar-list">
          {calendar.past.length === 0 ? (
            <div className="student-calendar-empty">
              <strong>Ainda não há histórico de aulas.</strong>
              <span>Aulas concluídas, faltas, cancelamentos e horários passados aparecem nesta seção.</span>
            </div>
          ) : calendar.past.map((lesson) => (
            <LessonRow key={lesson.id} lesson={lesson} onOpen={() => navigate(`/aluno/agenda/${lesson.id}`)} />
          ))}
        </div>
      </section>
    </div>
  );
}

export function StudentLessonDetail({ lessonId }: { lessonId: string }) {
  const navigate = useNavigate();
  const [lesson, setLesson] = useState<StudentLesson | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setError('');
    void studentApi<{ lesson: StudentLesson }>(`/api/student/lessons/${lessonId}`)
      .then((value) => { if (alive) setLesson(value.lesson); })
      .catch((candidate) => { if (alive) setError(candidate instanceof Error ? candidate.message : 'Não foi possível abrir a aula.'); });
    return () => { alive = false; };
  }, [lessonId]);

  if (error) {
    return (
      <section className="student-panel student-lesson-detail">
        <p className="student-error" role="alert">{error}</p>
        <button className="student-secondary" type="button" onClick={() => navigate('/aluno/agenda')}>Voltar para agenda</button>
      </section>
    );
  }
  if (!lesson) return <section className="student-panel"><p className="student-calendar-loading">Abrindo aula…</p></section>;

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

      {lesson.notes && (
        <div className="student-lesson-note">
          <span>Observação da escola</span>
          <p>{lesson.notes}</p>
        </div>
      )}

      <p className="student-lesson-source">Este horário é uma projeção do registro operacional da escola. Alterações feitas pela equipe aparecem aqui no mesmo estado institucional.</p>
    </section>
  );
}
