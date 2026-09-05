import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { OperationalCommandDialog, type OperationalCommand } from './admin-operational-execution';
import { ContextualLessonScheduler } from './contextual-lesson-scheduler';
import { GuidedStateCard, type GuidedStateKind } from './guided-state';
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
  primaryCommand: OperationalCommand | null;
  secondaryCommands: OperationalCommand[];
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

const guidedKindBySeverity: Record<OperationalSeverity, GuidedStateKind> = {
  BLOCKING: 'BLOCKED',
  ACTION_REQUIRED: 'READY',
  SCHEDULED: 'WAITING',
  WAITING: 'WAITING',
  COMPLETE: 'DONE',
};

async function loadOperationalContext(studentId: string): Promise<OperationalContext> {
  const response = await fetch(`/api/admin/process/students/${studentId}/operations`, {
    credentials: 'same-origin',
  });
  const body = await response.json().catch(() => ({})) as { operations?: OperationalContext; error?: string };
  if (!response.ok || !body.operations) throw new Error(body.error || 'Não foi possível verificar o próximo passo.');
  return body.operations;
}

type AdminOperationalGuidanceProps = {
  studentId: string;
  enrollmentId?: string;
  embedded?: boolean;
};

export function AdminOperationalGuidance({ studentId, enrollmentId, embedded = false }: AdminOperationalGuidanceProps) {
  const navigate = useNavigate();
  const [context, setContext] = useState<OperationalContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const [activeCommand, setActiveCommand] = useState<OperationalCommand | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      setContext(await loadOperationalContext(studentId));
    } catch (candidate) {
      setError(candidate instanceof Error ? candidate.message : 'Não foi possível verificar o próximo passo.');
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

  function execute(command: OperationalCommand) {
    if (command.kind === 'OPEN_URL') { follow(command.href); return; }
    if (command.kind === 'SCHEDULE_LESSON') { setSchedulerOpen(true); return; }
    setActiveCommand(command);
  }

  if (loading) {
    return (
      <GuidedStateCard
        compact={embedded}
        className={embedded ? 'admin-process-command' : 'admin-operational-guidance'}
        state={{ kind: 'WAITING', eyebrow: 'PRÓXIMO PASSO', title: 'Verificando o próximo passo…' }}
      />
    );
  }

  if (error) {
    return (
      <GuidedStateCard
        compact={embedded}
        className={embedded ? 'admin-process-command' : 'admin-operational-guidance'}
        state={{
          kind: 'BLOCKED',
          eyebrow: 'PRÓXIMO PASSO',
          title: 'Não foi possível verificar o próximo passo agora.',
          detail: error,
          primaryAction: { label: 'Tentar novamente', onClick: () => void load() },
        }}
      />
    );
  }

  const action = enrollmentId
    ? context?.actions.find((candidate) => candidate.enrollmentId === enrollmentId) ?? null
    : context?.primaryAction ?? null;

  if (!action) {
    return embedded
      ? null
      : (
        <GuidedStateCard
          className="admin-operational-guidance"
          state={{
            kind: 'DONE',
            eyebrow: 'PRÓXIMO PASSO',
            title: 'Nenhuma etapa precisa de atenção agora.',
            detail: 'Quando alguma situação mudar, o próximo passo aparecerá aqui.',
          }}
        />
      );
  }

  const execution = (
    <>
      {schedulerOpen && (
        <ContextualLessonScheduler
          studentId={studentId}
          enrollmentId={action.enrollmentId}
          enrollmentCategory={action.category}
          onClose={() => setSchedulerOpen(false)}
          onScheduled={() => { setSchedulerOpen(false); void load(); }}
        />
      )}

      {activeCommand && (
        <OperationalCommandDialog
          studentId={studentId}
          action={action}
          command={activeCommand}
          onClose={() => setActiveCommand(null)}
          onChanged={() => { setActiveCommand(null); void load(); }}
        />
      )}
    </>
  );

  const secondaryActions = action.secondaryCommands.map((command) => ({
    label: command.label,
    onClick: () => execute(command),
  }));

  const consequence = action.severity === 'SCHEDULED' || action.severity === 'WAITING'
    ? 'Se nada mudar, não é necessário fazer outra ação agora.'
    : action.severity === 'ACTION_REQUIRED'
      ? 'Depois desta ação, o Centro verifica automaticamente qual é o próximo passo.'
      : undefined;

  return (
    <>
      <GuidedStateCard
        compact={embedded}
        className={embedded ? 'admin-process-command' : 'admin-operational-guidance'}
        state={{
          kind: guidedKindBySeverity[action.severity],
          eyebrow: 'PRÓXIMO PASSO',
          title: action.title,
          detail: action.detail,
          consequence,
          primaryAction: action.primaryCommand ? { label: action.primaryCommand.label, onClick: () => execute(action.primaryCommand!) } : null,
          secondaryActions,
        }}
        footer={!embedded ? <small>{serviceLabels[action.serviceType]} · Categoria {action.category}</small> : undefined}
      />
      {execution}
    </>
  );
}
