import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './student-home.css';

type PrimaryActionKind = 'SECURITY' | 'LESSON' | 'EXAM' | 'PROCESS';

type HomeView = {
  process: null | {
    currentState: { label: string; percent: number };
    enrollment: { category: string };
  };
  primaryAction: null | {
    code: string;
    title: string;
    detail: string;
    href: string;
    dueAt: string | null;
    kind: PrimaryActionKind;
  };
  nextLesson: null | {
    id: string;
    category: string;
    startsAt: string;
    endsAt: string;
    instructorName: string;
    vehicleLabel: string;
  };
  nextExam: null | {
    candidateId: string;
    category: string;
    locationLabel: string;
    officialScheduledFor: string;
    instructorName: string;
    vehicleLabel: string;
    officialResult: string;
  };
  lessonSummary: { completed: number; scheduled: number; noShows: number; cancelled: number };
};

type StudentIdentity = { fullName: string; publicId: string };

async function loadHome(): Promise<HomeView> {
  const response = await fetch('/api/student/home', { credentials: 'same-origin' });
  const body = await response.json().catch(() => ({})) as HomeView & { error?: string };
  if (!response.ok) throw new Error(body.error || 'Não foi possível carregar seu início.');
  return body;
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

function primaryActionLabel(kind: PrimaryActionKind): string {
  if (kind === 'SECURITY') return 'Resolver meu acesso';
  if (kind === 'LESSON') return 'Ver minha aula';
  if (kind === 'EXAM') return 'Ver minha prova';
  return 'Ver próximo passo';
}

export function StudentHome({ student }: { student: StudentIdentity }) {
  const navigate = useNavigate();
  const [home, setHome] = useState<HomeView | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    void loadHome()
      .then((value) => { if (alive) setHome(value); })
      .catch((candidate) => { if (alive) setError(candidate instanceof Error ? candidate.message : 'Não foi possível carregar seu início.'); });
    return () => { alive = false; };
  }, []);

  if (error) return <section className="student-panel"><p className="student-error" role="alert">{error}</p></section>;
  if (!home) return <section className="student-panel"><p aria-live="polite">Preparando sua área…</p></section>;

  const lessonHref = home.nextLesson ? `/aluno/agenda/${home.nextLesson.id}` : null;
  const examHref = home.nextExam ? `/aluno/exame/${home.nextExam.candidateId}` : null;
  const lessonIsPrimary = Boolean(lessonHref && home.primaryAction?.href === lessonHref);
  const examIsPrimary = Boolean(examHref && home.primaryAction?.href === examHref);

  return (
    <div className="student-home-v2">
      <section className="student-home-welcome">
        <div>
          <p className="student-eyebrow">CENTRO · SUA JORNADA</p>
          <h1>Olá, {student.fullName.split(' ')[0]}.</h1>
          <p className="student-home-id">{student.publicId}</p>
        </div>
        {home.process && (
          <div className="student-home-progress" aria-label={`${home.process.currentState.percent}% concluído`}>
            <strong>{home.process.currentState.percent}%</strong>
            <span>{home.process.currentState.label}</span>
            <div><i style={{ width: `${home.process.currentState.percent}%` }} /></div>
          </div>
        )}
      </section>

      <section className="student-home-primary">
        <p className="student-eyebrow">AGORA</p>
        {home.primaryAction ? (
          <>
            <h2>{home.primaryAction.title}</h2>
            {home.primaryAction.dueAt && <strong className="student-home-due">{dateTime(home.primaryAction.dueAt)}</strong>}
            <p>{home.primaryAction.detail}</p>
            <button className="student-primary" type="button" onClick={() => navigate(home.primaryAction!.href)}>{primaryActionLabel(home.primaryAction.kind)}</button>
          </>
        ) : (
          <><h2>Você não precisa fazer nada agora.</h2><p>Quando houver um próximo passo para você, ele aparecerá aqui.</p></>
        )}
      </section>

      <div className="student-home-facts">
        <section className="student-home-fact">
          <span>AULAS CONCLUÍDAS</span><strong>{home.lessonSummary.completed}</strong>
        </section>
        <section className="student-home-fact">
          <span>AULAS FUTURAS</span><strong>{home.lessonSummary.scheduled}</strong>
        </section>
        <section className="student-home-fact">
          <span>FALTAS</span><strong>{home.lessonSummary.noShows}</strong>
        </section>
      </div>

      <section className="student-home-grid-card">
        <div>
          <p className="student-eyebrow">PRÓXIMA AULA</p>
          {home.nextLesson ? (
            <>
              <h3>{dateTime(home.nextLesson.startsAt)}</h3>
              <p>Categoria {home.nextLesson.category} · {home.nextLesson.instructorName} · {home.nextLesson.vehicleLabel}</p>
              {lessonIsPrimary
                ? <small>Esta aula já é o seu próximo passo acima.</small>
                : <button type="button" onClick={() => navigate(lessonHref!)}>Ver minha aula →</button>}
            </>
          ) : <><h3>Nenhuma aula marcada.</h3><p>Quando a escola marcar um horário, ele aparecerá aqui e na sua agenda.</p></>}
        </div>
        <div>
          <p className="student-eyebrow">EXAME PRÁTICO</p>
          {home.nextExam ? (
            <>
              <h3>{dateTime(home.nextExam.officialScheduledFor)}</h3>
              <p>{home.nextExam.locationLabel} · Categoria {home.nextExam.category}</p>
              {examIsPrimary
                ? <small>Este exame já é o seu próximo passo acima.</small>
                : <button type="button" onClick={() => navigate(examHref!)}>Ver meu exame →</button>}
            </>
          ) : <><h3>Ainda não está marcado.</h3><p>Quando a escola marcar seu exame, ele aparecerá aqui.</p></>}
        </div>
      </section>
    </div>
  );
}
