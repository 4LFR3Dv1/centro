import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './student-process.css';

type MilestoneCode =
  | 'PROCESS_STARTED'
  | 'REGISTRATION_DONE'
  | 'HEALTH_DONE'
  | 'THEORY_PASSED'
  | 'PRACTICE_DONE'
  | 'PRACTICAL_EXAM_PASSED'
  | 'LICENSE_AVAILABLE';

type ProcessView = {
  modeled: boolean;
  modelId: 'FIRST_LICENSE_V1' | null;
  enrollment: {
    id: string;
    serviceType: 'FIRST_LICENSE' | 'CATEGORY_ADDITION' | 'CATEGORY_CHANGE' | 'LICENSED_TRAINING';
    category: 'A' | 'B' | 'AB' | 'D';
    status: string;
  };
  currentState: {
    code: MilestoneCode | 'COMPLETE' | 'UNMODELED_SERVICE';
    label: string;
    index: number;
    total: number;
    percent: number;
  };
  milestones: Array<{
    code: MilestoneCode;
    label: string;
    description: string;
    achieved: boolean;
    achievedAt: string | null;
    scheduledFor: string | null;
  }>;
  progress: {
    completedLessons: number;
    completedMinutes: number;
    noShows: number;
    scheduledLessons: number;
    nextLessonAt: string | null;
  };
  nextAction: {
    code: string;
    title: string;
    detail: string;
  } | null;
};

async function loadProcesses(): Promise<ProcessView[]> {
  const response = await fetch('/api/student/process', { credentials: 'same-origin' });
  const body = await response.json().catch(() => ({})) as { processes?: ProcessView[]; error?: string };
  if (!response.ok) throw new Error(body.error || 'Não foi possível carregar suas etapas.');
  return body.processes ?? [];
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function actionHref(code: string): string {
  if (code.includes('LESSON') || code === 'CONTINUE_PRACTICE') return '/aluno/agenda';
  if (code.includes('PRACTICAL_EXAM')) return '/aluno/exame';
  return '/aluno/processo';
}

function actionLabel(code: string): string {
  if (code.includes('LESSON') || code === 'CONTINUE_PRACTICE') return 'Ver minha agenda';
  if (code.includes('PRACTICAL_EXAM')) return 'Ver meu exame';
  return 'Ver esta etapa';
}

function stepState(process: ProcessView, code: MilestoneCode): 'DONE' | 'CURRENT' | 'UPCOMING' {
  const milestone = process.milestones.find((item) => item.code === code);
  if (milestone?.achieved) return 'DONE';
  if (process.currentState.code === code) return 'CURRENT';
  return 'UPCOMING';
}

function ProcessCard({ process, compact = false }: { process: ProcessView; compact?: boolean }) {
  const navigate = useNavigate();
  if (!process.modeled) {
    return (
      <section className="student-panel student-process-card">
        <p className="student-eyebrow">MINHAS ETAPAS</p>
        <h2>{process.currentState.label}</h2>
        <p>A escola ainda não oferece acompanhamento passo a passo para este tipo de matrícula. Fale com a equipe se precisar saber o que acontece em seguida.</p>
      </section>
    );
  }

  return (
    <section className="student-process-journey" aria-labelledby={`student-process-${process.enrollment.id}`}>
      <header className="student-process-summary">
        <div>
          <p className="student-eyebrow">MINHAS ETAPAS · CATEGORIA {process.enrollment.category}</p>
          <h1 id={`student-process-${process.enrollment.id}`}>{process.currentState.label}</h1>
          <p>{process.enrollment.status === 'ACTIVE' ? 'Sua habilitação está em andamento.' : 'Sua matrícula está pausada. A escola precisa reativá-la para continuar.'}</p>
        </div>
        <div className="student-process-score"><strong>{process.currentState.percent}%</strong><span>concluído</span></div>
      </header>

      <div className="student-process-meter" aria-label={`${process.currentState.percent}% concluído`}><span style={{ width: `${process.currentState.percent}%` }} /></div>

      {process.nextAction ? (
        <section className="student-process-action">
          <div><span>AGORA</span><strong>{process.nextAction.title}</strong><p>{process.nextAction.detail}</p></div>
          <button className="student-primary" type="button" onClick={() => navigate(actionHref(process.nextAction!.code))}>{actionLabel(process.nextAction.code)}</button>
        </section>
      ) : (
        <section className="student-process-action is-complete"><div><span>CONCLUÍDO</span><strong>Não há nenhuma etapa pendente.</strong><p>Todas as etapas acompanhadas pelo Centro foram concluídas.</p></div></section>
      )}

      {process.currentState.code === 'PRACTICE_DONE' && (
        <section className="student-process-practice-v2">
          <div><span>Aulas concluídas</span><strong>{process.progress.completedLessons}</strong></div>
          <div><span>Tempo registrado</span><strong>{process.progress.completedMinutes} min</strong></div>
          <div><span>Faltas</span><strong>{process.progress.noShows}</strong></div>
          <div><span>Próxima aula</span><strong>{process.progress.nextLessonAt ? dateTime(process.progress.nextLessonAt) : 'Ainda não marcada'}</strong></div>
        </section>
      )}

      {!compact && (
        <ol className="student-process-path-v2">
          {process.milestones.map((milestone, index) => {
            const state = stepState(process, milestone.code);
            return (
              <li key={milestone.code} className={`is-${state.toLowerCase()}`}>
                <div className="student-process-step-index">{state === 'DONE' ? '✓' : String(index + 1).padStart(2, '0')}</div>
                <div className="student-process-step-body">
                  <div><span>{state === 'DONE' ? 'CONCLUÍDO' : state === 'CURRENT' ? 'AGORA' : 'DEPOIS'}</span><strong>{milestone.label}</strong></div>
                  <p>{milestone.description}</p>
                  <small>{milestone.achievedAt ? `Concluído em ${dateTime(milestone.achievedAt)}` : milestone.scheduledFor ? `Marcado para ${dateTime(milestone.scheduledFor)}` : state === 'CURRENT' ? 'Esta é sua etapa atual' : 'Ainda não começou'}</small>
                  {state === 'CURRENT' && milestone.code === 'PRACTICE_DONE' && <button type="button" onClick={() => navigate('/aluno/agenda')}>Ver minha agenda →</button>}
                  {state === 'CURRENT' && milestone.code === 'PRACTICAL_EXAM_PASSED' && <button type="button" onClick={() => navigate('/aluno/exame')}>Ver meu exame →</button>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export function StudentProcess({ compact = false }: { compact?: boolean }) {
  const [processes, setProcesses] = useState<ProcessView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    void loadProcesses()
      .then((value) => { if (alive) setProcesses(value); })
      .catch((candidate) => { if (alive) setError(candidate instanceof Error ? candidate.message : 'Não foi possível carregar suas etapas.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  if (loading) return <section className="student-panel"><p aria-live="polite">Carregando suas etapas…</p></section>;
  if (error) return <section className="student-panel"><p className="student-error" role="alert">{error}</p></section>;
  if (processes.length === 0) return <section className="student-panel"><p className="student-eyebrow">MINHAS ETAPAS</p><h2>Nenhuma matrícula em andamento.</h2><p>Quando você tiver uma matrícula ativa ou pausada, suas etapas aparecerão aqui.</p></section>;

  return <div className="student-process-stack">{processes.map((process) => <ProcessCard key={process.enrollment.id} process={process} compact={compact} />)}</div>;
}
