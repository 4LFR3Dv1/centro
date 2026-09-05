import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { OperationalCommandDialog, type OperationalCommand } from './admin-operational-execution';
import { ContextualLessonScheduler } from './contextual-lesson-scheduler';
import './admin-today.css';

type Severity = 'BLOCKING' | 'ACTION_REQUIRED' | 'SCHEDULED' | 'WAITING' | 'COMPLETE';
type Category = 'A' | 'B' | 'AB' | 'D';
type ServiceType = 'FIRST_LICENSE' | 'CATEGORY_ADDITION' | 'CATEGORY_CHANGE' | 'LICENSED_TRAINING';

type OperationalAction = {
  enrollmentId: string;
  serviceType: ServiceType;
  category: Category;
  processStateCode: string;
  code: string;
  title: string;
  detail: string;
  severity: Severity;
  primaryCommand: OperationalCommand | null;
  secondaryCommands: OperationalCommand[];
  actionLabel: string | null;
  href: string | null;
};

type AttentionItem = {
  studentId: string;
  studentPublicId: string;
  studentName: string;
  action: OperationalAction;
};

type HomeEvent = {
  id: string;
  kind: 'LESSON' | 'THEORY_EXAM' | 'PRACTICAL_EXAM';
  enrollmentId: string;
  studentId: string;
  studentPublicId: string;
  studentName: string;
  title: string;
  detail: string;
  category: Category | null;
  startsAt: string;
  endsAt: string | null;
  href: string;
};

type HomePayload = {
  version: 'ADMIN_HOME_V2';
  timezone: 'America/Sao_Paulo';
  generatedAt: string;
  summary: {
    activeNow: number;
    upcoming24h: number;
    blocking: number;
    actionRequired: number;
    waiting: number;
    scheduledProcesses: number;
    pendingFirstAccess: number;
  };
  now: HomeEvent[];
  upcoming: HomeEvent[];
  attention: {
    blocking: AttentionItem[];
    actionRequired: AttentionItem[];
    waiting: AttentionItem[];
  };
  pendingFirstAccess: Array<{
    studentId: string;
    studentPublicId: string;
    studentName: string;
  }>;
};

const severityLabel: Record<'BLOCKING' | 'ACTION_REQUIRED' | 'WAITING', string> = {
  BLOCKING: 'PRECISA RESOLVER',
  ACTION_REQUIRED: 'PRECISA DE AÇÃO',
  WAITING: 'AGUARDANDO',
};

const serviceLabels: Record<ServiceType, string> = {
  FIRST_LICENSE: 'Primeira habilitação',
  CATEGORY_ADDITION: 'Adição de categoria',
  CATEGORY_CHANGE: 'Mudança de categoria',
  LICENSED_TRAINING: 'Treinamento para habilitado',
};

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
  if (!response.ok) throw new Error(body.error || 'Não foi possível concluir esta ação.');
  return body;
}

function time(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: 'long',
  }).format(new Date(value));
}

function EventRow({ event, onOpen }: { event: HomeEvent; onOpen: () => void }) {
  return (
    <button className="admin-home-event" type="button" onClick={onOpen} aria-label={`Ver ${event.title} de ${event.studentName}`}>
      <time>{time(event.startsAt)}</time>
      <div><strong>{event.studentName}</strong><small>{event.studentPublicId}</small></div>
      <div><strong>{event.title}</strong><small>{event.detail}</small></div>
      <span>{event.kind === 'LESSON' ? 'AULA' : event.kind === 'THEORY_EXAM' ? 'TEORIA' : 'EXAME'}</span>
    </button>
  );
}

export function AdminToday() {
  const navigate = useNavigate();
  const [payload, setPayload] = useState<HomePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeItem, setActiveItem] = useState<AttentionItem | null>(null);
  const [activeCommand, setActiveCommand] = useState<OperationalCommand | null>(null);
  const [lessonItem, setLessonItem] = useState<AttentionItem | null>(null);

  const load = useCallback(async () => {
    setError('');
    try { setPayload(await api<HomePayload>('/api/admin/home')); }
    catch (candidate) { setError(candidate instanceof Error ? candidate.message : 'Não foi possível carregar o resumo de hoje.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    setLoading(true); void load();
    const interval = window.setInterval(() => { void load(); }, 60_000);
    const refresh = () => { void load(); };
    window.addEventListener('centro:process-changed', refresh);
    return () => { window.clearInterval(interval); window.removeEventListener('centro:process-changed', refresh); };
  }, [load]);

  function execute(item: AttentionItem, command: OperationalCommand | null) {
    if (!command) return navigate(`/admin/alunos/${item.studentId}`);
    if (command.kind === 'OPEN_URL') return navigate(command.href);
    if (command.kind === 'SCHEDULE_LESSON') { setLessonItem(item); return; }
    setActiveItem(item); setActiveCommand(command);
  }

  if (loading) return <section className="admin-work-card"><p className="admin-empty" aria-live="polite">Preparando o resumo de hoje…</p></section>;
  if (error || !payload) return <section className="admin-work-card"><p className="admin-error" role="alert">{error || 'Não foi possível carregar o resumo de hoje.'}</p><button className="admin-secondary" type="button" onClick={() => void load()}>Tentar novamente</button></section>;

  const attention = [...payload.attention.blocking, ...payload.attention.actionRequired, ...payload.attention.waiting];

  return (
    <section className="admin-home" aria-labelledby="admin-home-title">
      <header className="admin-home-hero">
        <div><p className="admin-eyebrow">CENTRO · HOJE · {dateLabel(payload.generatedAt).toUpperCase()}</p><h1 id="admin-home-title">Agora.</h1><p>Veja o que está acontecendo, o que vem em seguida e quais alunos precisam da equipe.</p></div>
        <div className="admin-home-clock"><strong>{time(payload.generatedAt)}</strong><span>Horário de São Paulo</span></div>
      </header>

      <div className="admin-home-metrics" aria-label="Resumo de hoje">
        <div><span>Agora</span><strong>{payload.summary.activeNow}</strong><small>em andamento</small></div>
        <div><span>Próximas 24h</span><strong>{payload.summary.upcoming24h}</strong><small>aulas e provas</small></div>
        <div className="is-blocking"><span>Precisa resolver</span><strong>{payload.summary.blocking}</strong><small>impedem o próximo passo</small></div>
        <div><span>Precisa de ação</span><strong>{payload.summary.actionRequired}</strong><small>podem ser resolvidos agora</small></div>
        <div><span>Aguardando</span><strong>{payload.summary.waiting}</strong><small>nenhuma ação agora</small></div>
      </div>

      <section className="admin-home-now">
        <div className="admin-section-head"><div><p className="admin-eyebrow">AGORA</p><h2>Acontecendo neste momento</h2></div><button className="admin-secondary" type="button" onClick={() => navigate('/admin/agenda')}>Ver agenda</button></div>
        <div className="admin-detail-card admin-home-list">{payload.now.length === 0 ? <p className="admin-home-empty">Nenhuma aula ou prova acontecendo agora.</p> : payload.now.map((event) => <EventRow key={`${event.kind}:${event.id}`} event={event} onOpen={() => navigate(event.href)} />)}</div>
      </section>

      <section className="admin-home-upcoming">
        <div className="admin-section-head"><div><p className="admin-eyebrow">EM SEGUIDA</p><h2>Próximas 24 horas</h2></div></div>
        <div className="admin-detail-card admin-home-list">{payload.upcoming.length === 0 ? <p className="admin-home-empty">Nenhuma aula ou prova marcada para as próximas 24 horas.</p> : payload.upcoming.slice(0, 12).map((event) => <EventRow key={`${event.kind}:${event.id}`} event={event} onOpen={() => navigate(event.href)} />)}</div>
      </section>

      <section className="admin-home-attention">
        <div className="admin-section-head"><div><p className="admin-eyebrow">ALUNOS QUE PRECISAM DE ATENÇÃO</p><h2>O que a equipe pode resolver</h2></div><p>Comece pelos itens que precisam ser resolvidos. Os itens em espera não exigem ação agora.</p></div>
        <div className="admin-home-attention-summary"><strong>{payload.summary.blocking} precisam resolver</strong><strong>{payload.summary.actionRequired} precisam de ação</strong><strong>{payload.summary.waiting} aguardando</strong></div>
        <div className="admin-detail-card admin-home-list">
          {attention.length === 0 ? <p className="admin-home-empty">Nenhum aluno precisa de atenção agora.</p> : attention.slice(0, 24).map((item) => (
            <article className={`admin-home-action severity-${item.action.severity.toLowerCase()}`} key={`${item.studentId}:${item.action.enrollmentId}:${item.action.code}`}>
              <div className="admin-home-action-kicker"><span>{severityLabel[item.action.severity as 'BLOCKING' | 'ACTION_REQUIRED' | 'WAITING']}</span><small>{item.studentPublicId}</small></div>
              <div className="admin-home-action-main"><strong>{item.studentName}</strong><h3>{item.action.title}</h3><p>{item.action.detail}</p><small>{serviceLabels[item.action.serviceType]} · Categoria {item.action.category}</small></div>
              <div className="admin-home-action-controls">
                {item.action.secondaryCommands.slice(0, 1).map((command, index) => <button className="admin-secondary" key={`${command.kind}:${index}`} type="button" onClick={() => execute(item, command)}>{command.label}</button>)}
                <button className="admin-primary" type="button" onClick={() => execute(item, item.action.primaryCommand)}>{item.action.primaryCommand?.label ?? 'Ver aluno'}</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="admin-home-access">
        <div className="admin-section-head"><div><p className="admin-eyebrow">PRIMEIRO ACESSO</p><h2>{payload.summary.pendingFirstAccess} aluno(s) ainda não ativaram o acesso</h2></div><p>{payload.summary.pendingFirstAccess > 0 ? 'Abra o aluno para reenviar, copiar ou imprimir o QR de primeiro acesso.' : 'Todos os alunos com matrícula ativa já concluíram o primeiro acesso.'}</p></div>
        {payload.pendingFirstAccess.length > 0 && <div className="admin-home-access-strip">{payload.pendingFirstAccess.slice(0, 8).map((item) => <button key={item.studentId} type="button" onClick={() => navigate(`/admin/alunos/${item.studentId}`)} aria-label={`Ver acesso de ${item.studentName}`}><strong>{item.studentName}</strong><span>{item.studentPublicId}</span></button>)}</div>}
      </section>

      {lessonItem && (
        <ContextualLessonScheduler
          studentId={lessonItem.studentId}
          studentName={lessonItem.studentName}
          enrollmentId={lessonItem.action.enrollmentId}
          enrollmentCategory={lessonItem.action.category}
          onClose={() => setLessonItem(null)}
          onScheduled={() => { setLessonItem(null); void load(); }}
        />
      )}
      {activeItem && activeCommand && <OperationalCommandDialog studentId={activeItem.studentId} action={activeItem.action} command={activeCommand} onClose={() => { setActiveItem(null); setActiveCommand(null); }} onChanged={() => { setActiveItem(null); setActiveCommand(null); void load(); }} />}
    </section>
  );
}
