import { useEffect, useMemo, useState } from 'react';
import { AdminOperationalGuidance } from './admin-operational-guidance';
import './admin-process.css';

type EnrollmentRef = {
  id: string;
  serviceType: 'FIRST_LICENSE' | 'CATEGORY_ADDITION' | 'CATEGORY_CHANGE' | 'LICENSED_TRAINING';
  category: 'A' | 'B' | 'AB' | 'D';
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
};

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
  enrollment: EnrollmentRef & { studentId: string; openedAt: string };
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
    source: 'DERIVED_ENROLLMENT' | 'INSTITUTIONAL_MILESTONE';
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
    milestoneCode: MilestoneCode | null;
  } | null;
};

const serviceLabels: Record<EnrollmentRef['serviceType'], string> = {
  FIRST_LICENSE: 'Primeira habilitação',
  CATEGORY_ADDITION: 'Adição de categoria',
  CATEGORY_CHANGE: 'Mudança de categoria',
  LICENSED_TRAINING: 'Treinamento para habilitado',
};

const ownerDomainMilestones = new Set<MilestoneCode>(['THEORY_PASSED', 'PRACTICAL_EXAM_PASSED']);

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || 'Não foi possível atualizar o processo.');
  return body;
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function latestReversible(process: ProcessView) {
  return [...process.milestones]
    .reverse()
    .find((milestone) => milestone.code !== 'PROCESS_STARTED'
      && milestone.achieved
      && !ownerDomainMilestones.has(milestone.code)) ?? null;
}

export function AdminProcessPanel({ enrollments }: { enrollments: EnrollmentRef[] }) {
  const operational = useMemo(
    () => enrollments.filter((enrollment) => enrollment.status === 'ACTIVE' || enrollment.status === 'PAUSED'),
    [enrollments],
  );
  const [processes, setProcesses] = useState<ProcessView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  async function load() {
    if (operational.length === 0) {
      setProcesses([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const values = await Promise.all(
        operational.map((enrollment) => api<{ process: ProcessView }>(`/api/admin/process/enrollments/${enrollment.id}`)),
      );
      setProcesses(values.map((value) => value.process));
    } catch (candidate) {
      setError(candidate instanceof Error ? candidate.message : 'Não foi possível carregar o processo.');
    } finally {
      setLoading(false);
    }
  }

  const operationalKey = operational.map((enrollment) => `${enrollment.id}:${enrollment.status}`).join('|');

  useEffect(() => {
    void load();
    // IDs/statuses are the authority-changing inputs; the parent workspace is immutable during this view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operationalKey]);

  useEffect(() => {
    const refresh = () => { void load(); };
    window.addEventListener('centro:process-changed', refresh);
    return () => window.removeEventListener('centro:process-changed', refresh);
    // The event explicitly signals that a primitive observed by ProcessResolver changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operationalKey]);

  async function revoke(process: ProcessView, code: MilestoneCode) {
    const key = `${process.enrollment.id}:revoke:${code}`;
    setBusy(key);
    setError('');
    try {
      const result = await api<{ process: ProcessView }>(
        `/api/admin/process/enrollments/${process.enrollment.id}/milestones/${code}/revoke`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      setProcesses((current) => current.map((item) => item.enrollment.id === process.enrollment.id ? result.process : item));
      window.dispatchEvent(new CustomEvent('centro:process-changed', {
        detail: { studentId: result.process.enrollment.studentId, enrollmentId: result.process.enrollment.id },
      }));
    } catch (candidate) {
      setError(candidate instanceof Error ? candidate.message : 'Não foi possível atualizar o processo.');
    } finally {
      setBusy('');
    }
  }

  if (loading) return <div className="admin-detail-card"><p className="admin-empty">Derivando processo…</p></div>;
  if (operational.length === 0) {
    return (
      <div className="admin-detail-card">
        <div className="admin-card-title"><span>PROCESSO</span><strong>Sem matrícula aberta</strong></div>
        <p>Não existe processo operacional enquanto não houver matrícula ativa ou pausada.</p>
      </div>
    );
  }

  return (
    <div className="admin-process-stack">
      {error && <p className="admin-error" role="alert">{error}</p>}
      {processes.map((process) => {
        const reversible = latestReversible(process);
        const currentCode = process.currentState.code;

        return (
          <div className="admin-detail-card admin-process-card" key={process.enrollment.id}>
            <div className="admin-card-title">
              <span>PROCESSO · {serviceLabels[process.enrollment.serviceType]} · {process.enrollment.category}</span>
              <strong>{process.modeled ? `${process.currentState.percent}%` : 'Não modelado'}</strong>
            </div>

            {!process.modeled ? (
              <p>O Centro não fabrica uma sequência para este tipo de serviço. Um modelo próprio precisa ser admitido antes de projetar etapas.</p>
            ) : (
              <>
                <div className="admin-process-current">
                  <div>
                    <small>ESTADO ATUAL DERIVADO</small>
                    <h3>{process.currentState.label}</h3>
                  </div>
                  <div className="admin-process-meter" aria-label={`${process.currentState.percent}% concluído`}>
                    <span style={{ width: `${process.currentState.percent}%` }} />
                  </div>
                </div>

                <ol className="admin-process-milestones">
                  {process.milestones.map((milestone) => {
                    const isCurrent = currentCode === milestone.code;
                    return (
                      <li key={milestone.code} className={`${milestone.achieved ? 'is-done' : ''} ${isCurrent ? 'is-current' : ''}`}>
                        <span>{milestone.achieved ? '✓' : '•'}</span>
                        <div>
                          <strong>{milestone.label}</strong>
                          <small>
                            {milestone.achievedAt
                              ? `Concluído em ${dateTime(milestone.achievedAt)}`
                              : milestone.scheduledFor
                                ? `Agendado para ${dateTime(milestone.scheduledFor)}`
                                : milestone.description}
                          </small>
                        </div>
                      </li>
                    );
                  })}
                </ol>

                {currentCode === 'PRACTICE_DONE' && (
                  <div className="admin-process-evidence">
                    <div><span>Aulas concluídas</span><strong>{process.progress.completedLessons}</strong></div>
                    <div><span>Minutos registrados</span><strong>{process.progress.completedMinutes}</strong></div>
                    <div><span>Faltas</span><strong>{process.progress.noShows}</strong></div>
                    <div><span>Próxima aula</span><strong>{process.progress.nextLessonAt ? dateTime(process.progress.nextLessonAt) : 'Sem aula futura'}</strong></div>
                  </div>
                )}

                <AdminOperationalGuidance
                  studentId={process.enrollment.studentId}
                  enrollmentId={process.enrollment.id}
                  embedded
                />

                {reversible && (
                  <div className="admin-process-actions admin-process-correction-actions">
                    <button
                      className="admin-secondary"
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => void revoke(process, reversible.code)}
                    >
                      {busy ? 'Revertendo…' : `Reverter “${reversible.label}”`}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
