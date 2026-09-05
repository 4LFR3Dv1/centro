import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './admin-operational-guidance.css';

type OperationalSeverity = 'BLOCKING' | 'ACTION_REQUIRED' | 'SCHEDULED' | 'WAITING' | 'COMPLETE';

type OperationalAction = {
  enrollmentId: string;
  serviceType: 'FIRST_LICENSE' | 'CATEGORY_ADDITION' | 'CATEGORY_CHANGE' | 'LICENSED_TRAINING';
  category: 'A' | 'B' | 'AB' | 'D';
  processStateCode: string;
  code: string;
  title: string;
  detail: string;
  severity: OperationalSeverity;
  actionLabel: string | null;
  href: string | null;
};

type OperationalContext = {
  studentId: string;
  primaryAction: OperationalAction | null;
  actions: OperationalAction[];
};

const serviceLabels: Record<OperationalAction['serviceType'], string> = {
  FIRST_LICENSE: 'Primeira habilitação',
  CATEGORY_ADDITION: 'Adição de categoria',
  CATEGORY_CHANGE: 'Mudança de categoria',
  LICENSED_TRAINING: 'Treinamento para habilitado',
};

const severityLabels: Record<OperationalSeverity, string> = {
  BLOCKING: 'BLOQUEIO',
  ACTION_REQUIRED: 'AÇÃO NECESSÁRIA',
  SCHEDULED: 'JÁ AGENDADO',
  WAITING: 'AGUARDANDO',
  COMPLETE: 'CONCLUÍDO',
};

async function loadOperationalContext(studentId: string): Promise<OperationalContext> {
  const response = await fetch(`/api/admin/process/students/${studentId}/operations`, {
    credentials: 'same-origin',
  });
  const body = await response.json().catch(() => ({})) as { operations?: OperationalContext; error?: string };
  if (!response.ok || !body.operations) throw new Error(body.error || 'Não foi possível derivar a próxima ação.');
  return body.operations;
}

export function AdminOperationalGuidance({ studentId }: { studentId: string }) {
  const navigate = useNavigate();
  const [context, setContext] = useState<OperationalContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setContext(await loadOperationalContext(studentId));
    } catch (candidate) {
      setError(candidate instanceof Error ? candidate.message : 'Não foi possível derivar a próxima ação.');
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ studentId?: string }>).detail;
      if (!detail?.studentId || detail.studentId === studentId) void load();
    };
    window.addEventListener('centro:process-changed', refresh);
    return () => window.removeEventListener('centro:process-changed', refresh);
  }, [load, studentId]);

  function follow(href: string) {
    if (href.endsWith('#processo')) {
      document.getElementById('processo')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    navigate(href);
  }

  if (loading) {
    return (
      <section className="admin-operational-guidance is-loading" aria-live="polite">
        <span>O QUE PRECISA ACONTECER AGORA</span>
        <strong>Derivando orientação operacional…</strong>
      </section>
    );
  }

  if (error) {
    return (
      <section className="admin-operational-guidance is-error" aria-live="polite">
        <span>ORIENTAÇÃO OPERACIONAL</span>
        <strong>Não foi possível derivar a próxima ação.</strong>
        <small>{error}</small>
      </section>
    );
  }

  const action = context?.primaryAction;
  if (!action) {
    return (
      <section className="admin-operational-guidance is-complete">
        <div>
          <span>O QUE PRECISA ACONTECER AGORA</span>
          <h2>Sem processo operacional aberto.</h2>
          <p>Não existe matrícula ativa ou pausada exigindo orientação neste momento.</p>
        </div>
      </section>
    );
  }

  return (
    <section className={`admin-operational-guidance severity-${action.severity.toLowerCase()}`} aria-labelledby="admin-operational-title">
      <div className="admin-operational-copy">
        <div className="admin-operational-kicker">
          <span>O QUE PRECISA ACONTECER AGORA</span>
          <strong>{severityLabels[action.severity]}</strong>
        </div>
        <h2 id="admin-operational-title">{action.title}</h2>
        <p>{action.detail}</p>
        <small>{serviceLabels[action.serviceType]} · Categoria {action.category} · Estado derivado {action.processStateCode}</small>
      </div>
      {action.href && action.actionLabel && (
        <button className="admin-primary" type="button" onClick={() => follow(action.href!)}>
          {action.actionLabel}
        </button>
      )}
    </section>
  );
}
