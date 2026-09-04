import { useEffect, useState } from 'react';
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
  if (!response.ok) throw new Error(body.error || 'Não foi possível carregar seu processo.');
  return body.processes ?? [];
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function ProcessCard({ process, compact = false }: { process: ProcessView; compact?: boolean }) {
  if (!process.modeled) {
    return (
      <section className="student-panel student-process-card">
        <p className="student-eyebrow">PROCESSO</p>
        <h2>{process.currentState.label}</h2>
        <p>O Centro ainda não publica uma sequência para este tipo de serviço. Nenhuma etapa foi inventada para preencher essa lacuna.</p>
      </section>
    );
  }

  return (
    <section className="student-panel student-process-card" aria-labelledby={`student-process-${process.enrollment.id}`}>
      <div className="student-process-head">
        <div>
          <p className="student-eyebrow">SEU PROCESSO · {process.enrollment.category}</p>
          <h2 id={`student-process-${process.enrollment.id}`}>{process.currentState.label}</h2>
        </div>
        <strong>{process.currentState.percent}%</strong>
      </div>

      <div className="student-process-meter" aria-label={`${process.currentState.percent}% concluído`}>
        <span style={{ width: `${process.currentState.percent}%` }} />
      </div>

      {process.nextAction ? (
        <div className="student-process-next">
          <span>PRÓXIMA AÇÃO</span>
          <strong>{process.nextAction.title}</strong>
          <p>{process.nextAction.detail}</p>
        </div>
      ) : (
        <div className="student-process-next is-complete">
          <span>PROCESSO</span>
          <strong>Concluído.</strong>
          <p>Todos os marcos institucionais deste modelo foram confirmados.</p>
        </div>
      )}

      {process.currentState.code === 'PRACTICE_DONE' && (
        <div className="student-process-practice">
          <div><span>Aulas concluídas</span><strong>{process.progress.completedLessons}</strong></div>
          <div><span>Tempo registrado</span><strong>{process.progress.completedMinutes} min</strong></div>
          <div><span>Próxima aula</span><strong>{process.progress.nextLessonAt ? dateTime(process.progress.nextLessonAt) : 'Ainda não agendada'}</strong></div>
        </div>
      )}

      {!compact && (
        <ol className="student-process-path">
          {process.milestones.map((milestone) => {
            const current = process.currentState.code === milestone.code;
            return (
              <li key={milestone.code} className={`${milestone.achieved ? 'is-done' : ''} ${current ? 'is-current' : ''}`}>
                <span>{milestone.achieved ? '✓' : '•'}</span>
                <div>
                  <strong>{milestone.label}</strong>
                  <small>
                    {milestone.achievedAt
                      ? `Concluído em ${dateTime(milestone.achievedAt)}`
                      : milestone.scheduledFor
                        ? `Agendado para ${dateTime(milestone.scheduledFor)}`
                        : current
                          ? 'Etapa atual'
                          : 'Depois'}
                  </small>
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
    setLoading(true);
    setError('');
    void loadProcesses()
      .then((value) => { if (alive) setProcesses(value); })
      .catch((candidate) => { if (alive) setError(candidate instanceof Error ? candidate.message : 'Não foi possível carregar seu processo.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  if (loading) return <section className="student-panel"><p>Derivando seu processo…</p></section>;
  if (error) return <section className="student-panel"><p className="student-error" role="alert">{error}</p></section>;
  if (processes.length === 0) {
    return (
      <section className="student-panel student-process-card">
        <p className="student-eyebrow">PROCESSO</p>
        <h2>Nenhuma matrícula operacional.</h2>
        <p>O processo aparece somente quando existe uma matrícula ativa ou pausada vinculada ao seu acesso.</p>
      </section>
    );
  }

  return (
    <div className="student-process-stack">
      {processes.map((process) => <ProcessCard key={process.enrollment.id} process={process} compact={compact} />)}
    </div>
  );
}
