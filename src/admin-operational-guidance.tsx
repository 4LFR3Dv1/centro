import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { OperationalCommandDialog, type OperationalCommand } from './admin-operational-execution';
import { GuidedStateCard, type GuidedStateKind } from './guided-state';
import './admin-operational-guidance.css';

type OperationalSeverity = 'BLOCKING' | 'ACTION_REQUIRED' | 'SCHEDULED' | 'WAITING' | 'COMPLETE';
type PhysicalCategory = 'A' | 'B' | 'D';

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

type ScheduleOptions = {
  policy: {
    slotMinutes: number;
    lessonMinMinutes: number;
    lessonMaxMinutes: number;
  };
  instructors: Array<{ id: string; displayName: string; active: boolean; categories: PhysicalCategory[] }>;
  vehicles: Array<{ id: string; plate: string; label: string; category: PhysicalCategory; active: boolean }>;
  enrollments: Array<{ id: string; studentId: string; studentName: string; category: 'A' | 'B' | 'AB' | 'D' }>;
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

async function scheduleApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || 'Não foi possível agendar a aula.');
  return body;
}

function localInput(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  const hour = String(value.getHours()).padStart(2, '0');
  const minute = String(value.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function nextSlot(slotMinutes: number): string {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  const slotMs = slotMinutes * 60_000;
  date.setTime(Math.ceil(date.getTime() / slotMs) * slotMs);
  date.setSeconds(0, 0);
  return localInput(date);
}

function QuickLessonScheduler({ studentId, action, onClose, onScheduled }: {
  studentId: string;
  action: OperationalAction;
  onClose: () => void;
  onScheduled: () => void;
}) {
  const [options, setOptions] = useState<ScheduleOptions | null>(null);
  const [category, setCategory] = useState<PhysicalCategory>(action.category === 'AB' ? 'B' : action.category as PhysicalCategory);
  const [instructorId, setInstructorId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [startsAtLocal, setStartsAtLocal] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const allowedCategories = useMemo<PhysicalCategory[]>(
    () => action.category === 'AB' ? ['A', 'B'] : [action.category as PhysicalCategory],
    [action.category],
  );
  const instructors = useMemo(
    () => options?.instructors.filter((item) => item.active && item.categories.includes(category)) ?? [],
    [options, category],
  );
  const vehicles = useMemo(
    () => options?.vehicles.filter((item) => item.active && item.category === category) ?? [],
    [options, category],
  );

  useEffect(() => {
    let alive = true;
    void scheduleApi<ScheduleOptions>('/api/admin/schedule/options')
      .then((value) => {
        if (!alive) return;
        if (!value.enrollments.some((enrollment) => enrollment.id === action.enrollmentId && enrollment.studentId === studentId)) {
          throw new Error('Esta matrícula não está disponível para agendamento.');
        }
        setOptions(value);
        setStartsAtLocal(nextSlot(value.policy.slotMinutes));
        setDurationMinutes(Math.max(value.policy.lessonMinMinutes, Math.min(60, value.policy.lessonMaxMinutes)));
      })
      .catch((candidate) => { if (alive) setError(candidate instanceof Error ? candidate.message : 'Não foi possível abrir o agendamento.'); });
    return () => { alive = false; };
  }, [action.enrollmentId, studentId]);

  useEffect(() => {
    setInstructorId(instructors[0]?.id ?? '');
    setVehicleId(vehicles[0]?.id ?? '');
  }, [category, instructors.map((item) => item.id).join('|'), vehicles.map((item) => item.id).join('|')]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!options || !startsAtLocal) return;
    const startsAt = new Date(startsAtLocal);
    if (!Number.isFinite(startsAt.getTime())) {
      setError('Informe uma data e hora válidas.');
      return;
    }
    const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
    setBusy(true);
    setError('');
    try {
      await scheduleApi('/api/admin/schedule/lessons', {
        method: 'POST',
        body: JSON.stringify({
          enrollmentId: action.enrollmentId,
          studentId,
          instructorId,
          vehicleId,
          category,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          notes: notes || null,
        }),
      });
      window.dispatchEvent(new CustomEvent('centro:process-changed', { detail: { studentId, enrollmentId: action.enrollmentId } }));
      onScheduled();
    } catch (candidate) {
      setError(candidate instanceof Error ? candidate.message : 'Não foi possível agendar a aula. Revise os dados e tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-ops-modal-backdrop" role="presentation">
      <section className="admin-ops-modal" role="dialog" aria-modal="true" aria-labelledby="admin-ops-schedule-title">
        <div className="admin-card-title">
          <div><span>PRÓXIMO PASSO</span><h2 id="admin-ops-schedule-title">Agendar aula prática</h2></div>
          <button className="admin-ops-close" type="button" onClick={onClose} aria-label="Fechar agendamento">×</button>
        </div>
        <p>Escolha um horário, um instrutor e um veículo. O Centro impede conflitos de agenda e combinações incompatíveis.</p>
        <form className="admin-ops-form" onSubmit={submit}>
          {allowedCategories.length > 1 && (
            <label>Categoria
              <select value={category} onChange={(event) => setCategory(event.target.value as PhysicalCategory)}>
                {allowedCategories.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
          )}
          <div className="admin-ops-form-grid">
            <label>Data e hora<input type="datetime-local" value={startsAtLocal} onChange={(event) => setStartsAtLocal(event.target.value)} required /></label>
            <label>Duração
              <select value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))} disabled={!options}>
                {options && Array.from(
                  { length: Math.floor((options.policy.lessonMaxMinutes - options.policy.lessonMinMinutes) / options.policy.slotMinutes) + 1 },
                  (_, index) => options.policy.lessonMinMinutes + index * options.policy.slotMinutes,
                ).filter((minutes) => minutes <= options.policy.lessonMaxMinutes).map((minutes) => <option key={minutes} value={minutes}>{minutes} min</option>)}
              </select>
            </label>
          </div>
          <div className="admin-ops-form-grid">
            <label>Instrutor<select value={instructorId} onChange={(event) => setInstructorId(event.target.value)}><option value="">Selecione</option>{instructors.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
            <label>Veículo<select value={vehicleId} onChange={(event) => setVehicleId(event.target.value)}><option value="">Selecione</option>{vehicles.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.plate}</option>)}</select></label>
          </div>
          <label>Observação opcional<textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
          {options && (!instructors.length || !vehicles.length) && (
            <p className="admin-ops-warning" role="status">Antes de agendar a categoria {category}, é preciso ter instrutor autorizado e veículo ativo disponíveis.</p>
          )}
          {error && <p className="admin-error" role="alert">{error}</p>}
          <div className="admin-ops-form-actions">
            <button className="admin-secondary" type="button" onClick={onClose}>Cancelar</button>
            <button className="admin-primary" type="submit" disabled={busy || !options || !startsAtLocal || !instructorId || !vehicleId}>{busy ? 'Agendando…' : 'Agendar aula'}</button>
          </div>
        </form>
      </section>
    </div>
  );
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
        <QuickLessonScheduler studentId={studentId} action={action} onClose={() => setSchedulerOpen(false)} onScheduled={() => { setSchedulerOpen(false); void load(); }} />
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
