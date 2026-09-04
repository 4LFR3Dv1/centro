import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './admin-today.css';

type LessonStatus = 'SCHEDULED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED';

type TodayPayload = {
  timezone: 'America/Sao_Paulo';
  generatedAt: string;
  summary: {
    lessonsToday: number;
    scheduledRemaining: number;
    withoutNextLesson: number;
    pendingFirstAccess: number;
    withoutGuide: number;
    recentNoShows: number;
    upcomingExams: number;
  };
  lessons: Array<{
    id: string;
    enrollmentId: string;
    studentId: string;
    studentPublicId: string;
    studentName: string;
    instructorName: string;
    vehicleLabel: string;
    category: 'A' | 'B' | 'D';
    startsAt: string;
    endsAt: string;
    status: LessonStatus;
  }>;
  upcomingExams: Array<{
    enrollmentId: string;
    studentId: string;
    studentPublicId: string;
    studentName: string;
    code: 'THEORY_PASSED' | 'PRACTICAL_EXAM_PASSED';
    scheduledFor: string;
  }>;
  withoutNextLesson: Array<{
    enrollmentId: string;
    studentId: string;
    studentPublicId: string;
    studentName: string;
    serviceType: string;
    category: string;
    openedAt: string;
  }>;
  pendingFirstAccess: Array<{
    studentId: string;
    studentPublicId: string;
    studentName: string;
  }>;
  withoutGuide: Array<{
    enrollmentId: string;
    studentId: string;
    studentPublicId: string;
    studentName: string;
    serviceType: string;
    category: string;
    openedAt: string;
  }>;
  recentNoShows: Array<{
    lessonId: string;
    enrollmentId: string;
    studentId: string;
    studentPublicId: string;
    studentName: string;
    startsAt: string;
    instructorName: string;
  }>;
};

const lessonStatusLabel: Record<LessonStatus, string> = {
  SCHEDULED: 'Agendada',
  COMPLETED: 'Concluída',
  NO_SHOW: 'Falta',
  CANCELLED: 'Cancelada',
};

async function loadToday(): Promise<TodayPayload> {
  const response = await fetch('/api/admin/today', { credentials: 'same-origin' });
  const body = await response.json().catch(() => ({})) as TodayPayload & { error?: string };
  if (!response.ok) throw new Error(body.error || 'Não foi possível abrir o Hoje.');
  return body;
}

function time(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function todayLabel(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  }).format(new Date(value));
}

function Empty({ children }: { children: string }) {
  return <p className="admin-today-empty">{children}</p>;
}

export function AdminToday() {
  const navigate = useNavigate();
  const [payload, setPayload] = useState<TodayPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    void loadToday()
      .then((value) => { if (alive) setPayload(value); })
      .catch((candidate) => { if (alive) setError(candidate instanceof Error ? candidate.message : 'Não foi possível abrir o Hoje.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  if (loading) {
    return <section className="admin-work-card"><p className="admin-empty">Derivando operação de hoje…</p></section>;
  }

  if (error || !payload) {
    return (
      <section className="admin-work-card">
        <p className="admin-error" role="alert">{error || 'Hoje indisponível.'}</p>
        <button className="admin-secondary" type="button" onClick={() => window.location.reload()}>Tentar novamente</button>
      </section>
    );
  }

  const attentionTotal = payload.summary.withoutNextLesson
    + payload.summary.pendingFirstAccess
    + payload.summary.withoutGuide
    + payload.summary.recentNoShows;

  return (
    <section className="admin-today" aria-labelledby="admin-today-title">
      <header className="admin-today-hero">
        <div>
          <p className="admin-eyebrow">HOJE · {todayLabel(payload.generatedAt).toUpperCase()}</p>
          <h1 id="admin-today-title">O que precisa acontecer agora.</h1>
          <p>Uma projeção operacional sobre aulas, processos, acessos e guias já existentes. Nenhum estado paralelo é criado aqui.</p>
        </div>
        <button className="admin-primary" type="button" onClick={() => navigate('/admin/agenda')}>Abrir agenda</button>
      </header>

      <div className="admin-today-metrics" aria-label="Resumo operacional">
        <div><span>Aulas hoje</span><strong>{payload.summary.lessonsToday}</strong><small>{payload.summary.scheduledRemaining} ainda agendada(s)</small></div>
        <div><span>Sem próxima aula</span><strong>{payload.summary.withoutNextLesson}</strong><small>matrícula(s) ativa(s)</small></div>
        <div><span>Próximas provas</span><strong>{payload.summary.upcomingExams}</strong><small>nos próximos 7 dias</small></div>
        <div><span>Pendências</span><strong>{attentionTotal}</strong><small>acesso, guia ou falta</small></div>
      </div>

      <div className="admin-today-grid">
        <section className="admin-detail-card admin-today-agenda">
          <div className="admin-card-title"><span>AGENDA DE HOJE</span><strong>{payload.lessons.length}</strong></div>
          {payload.lessons.length === 0 ? <Empty>Nenhuma aula ocupa o calendário de hoje.</Empty> : (
            <div className="admin-today-timeline">
              {payload.lessons.map((lesson) => (
                <button key={lesson.id} type="button" onClick={() => navigate('/admin/agenda')}>
                  <time>{time(lesson.startsAt)}</time>
                  <span className="admin-today-lesson-main">
                    <strong>{lesson.studentName}</strong>
                    <small>{lesson.studentPublicId} · Categoria {lesson.category}</small>
                  </span>
                  <span className="admin-today-resource">
                    <strong>{lesson.instructorName}</strong>
                    <small>{lesson.vehicleLabel}</small>
                  </span>
                  <span className={`admin-today-status is-${lesson.status.toLowerCase()}`}>{lessonStatusLabel[lesson.status]}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="admin-detail-card admin-today-exams">
          <div className="admin-card-title"><span>PRÓXIMAS PROVAS</span><strong>7 dias</strong></div>
          {payload.upcomingExams.length === 0 ? <Empty>Nenhuma prova teórica ou prática agendada.</Empty> : (
            <div className="admin-today-list">
              {payload.upcomingExams.map((exam) => (
                <button key={`${exam.enrollmentId}:${exam.code}`} type="button" onClick={() => navigate(`/admin/alunos/${exam.studentId}`)}>
                  <div><strong>{exam.studentName}</strong><small>{exam.studentPublicId}</small></div>
                  <div><strong>{exam.code === 'THEORY_PASSED' ? 'Prova teórica' : 'Exame prático'}</strong><small>{dateTime(exam.scheduledFor)}</small></div>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="admin-today-attention" aria-labelledby="admin-attention-title">
        <div className="admin-section-head">
          <div><p className="admin-eyebrow">ATENÇÃO</p><h2 id="admin-attention-title">Pendências derivadas.</h2></div>
          <p>São sinais produzidos pelos fatos atuais; resolva a causa no workspace do aluno ou na agenda.</p>
        </div>

        <div className="admin-today-attention-grid">
          <div className="admin-detail-card">
            <div className="admin-card-title"><span>SEM PRÓXIMA AULA</span><strong>{payload.withoutNextLesson.length}</strong></div>
            {payload.withoutNextLesson.length === 0 ? <Empty>Todas as matrículas ativas têm aula futura.</Empty> : payload.withoutNextLesson.map((item) => (
              <button className="admin-today-attention-row" key={item.enrollmentId} type="button" onClick={() => navigate(`/admin/alunos/${item.studentId}`)}>
                <strong>{item.studentName}</strong><span>{item.studentPublicId} · {item.category}</span>
              </button>
            ))}
          </div>

          <div className="admin-detail-card">
            <div className="admin-card-title"><span>PRIMEIRO ACESSO</span><strong>{payload.pendingFirstAccess.length}</strong></div>
            {payload.pendingFirstAccess.length === 0 ? <Empty>Nenhum aluno aguardando troca da senha inicial.</Empty> : payload.pendingFirstAccess.map((item) => (
              <button className="admin-today-attention-row" key={item.studentId} type="button" onClick={() => navigate(`/admin/alunos/${item.studentId}`)}>
                <strong>{item.studentName}</strong><span>{item.studentPublicId} · acesso ainda não ativado pelo aluno</span>
              </button>
            ))}
          </div>

          <div className="admin-detail-card">
            <div className="admin-card-title"><span>GUIA AINDA NÃO GERADO</span><strong>{payload.withoutGuide.length}</strong></div>
            {payload.withoutGuide.length === 0 ? <Empty>Todas as matrículas ativas têm ao menos uma versão de guia.</Empty> : payload.withoutGuide.map((item) => (
              <button className="admin-today-attention-row" key={item.enrollmentId} type="button" onClick={() => navigate(`/admin/alunos/${item.studentId}`)}>
                <strong>{item.studentName}</strong><span>{item.studentPublicId} · {item.category}</span>
              </button>
            ))}
          </div>

          <div className="admin-detail-card">
            <div className="admin-card-title"><span>FALTAS RECENTES</span><strong>{payload.recentNoShows.length}</strong></div>
            {payload.recentNoShows.length === 0 ? <Empty>Nenhuma falta registrada nos últimos 7 dias.</Empty> : payload.recentNoShows.map((item) => (
              <button className="admin-today-attention-row" key={item.lessonId} type="button" onClick={() => navigate(`/admin/alunos/${item.studentId}`)}>
                <strong>{item.studentName}</strong><span>{dateTime(item.startsAt)} · {item.instructorName}</span>
              </button>
            ))}
          </div>
        </div>
      </section>
    </section>
  );
}
