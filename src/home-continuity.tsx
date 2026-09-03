import { useEffect, useMemo, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  formatCompactCount,
  formatPercent,
  formatPeriod,
  trafficIntelligence,
} from './traffic-intelligence';
import './home-continuity.css';
import './home-context.css';

type PublicGoal = 'first-license' | 'addition' | 'licensed';
type PublicStage = 'not-started' | 'medical' | 'theory' | 'practical' | 'exam';
type Category = 'A' | 'B' | 'D';
type HomeIntent = 'first-license' | 'continue-license' | 'licensed' | 'city';

type StoredJourney = {
  goal: PublicGoal;
  category: Category;
  stage: PublicStage;
  intent?: HomeIntent;
  updatedAt?: string;
};

type DraftStep = 'intent' | 'category' | 'stage';

const STORAGE_KEY = 'centro.publicJourney.v1';
const STAGES: PublicStage[] = ['not-started', 'medical', 'theory', 'practical', 'exam'];

const stageLabels: Record<PublicStage, string> = {
  'not-started': 'Começando',
  medical: 'Cadastro e exames',
  theory: 'Teoria',
  practical: 'Prática',
  exam: 'Prova',
};

const intentLabels: Record<HomeIntent, string> = {
  'first-license': 'Tirar minha primeira CNH',
  'continue-license': 'Continuar minha habilitação',
  licensed: 'Voltar a dirigir',
  city: 'Entender o trânsito da cidade',
};

function readJourney(): StoredJourney | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredJourney>;
    if (!parsed.goal || !parsed.category || !parsed.stage) return null;
    const intent = parsed.intent ?? inferIntent(parsed as StoredJourney);
    return { ...parsed, intent } as StoredJourney;
  } catch {
    return null;
  }
}

function inferIntent(journey: StoredJourney): HomeIntent {
  if (journey.goal === 'licensed') return 'licensed';
  if (journey.goal === 'first-license' && journey.stage === 'not-started') return 'first-license';
  return 'continue-license';
}

function persistJourney(journey: StoredJourney) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...journey, updatedAt: new Date().toISOString() }));
  window.dispatchEvent(new CustomEvent('centro:public-journey-change'));
}

function clearJourney() {
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new CustomEvent('centro:public-journey-change'));
}

function continuationFor(journey: StoredJourney) {
  const intent = journey.intent ?? inferIntent(journey);

  if (intent === 'city') {
    return {
      kicker: 'SÃO JOSÉ DOS CAMPOS',
      title: 'O trânsito da cidade continua daqui.',
      copy: 'Veja dados locais, mobilidade e informações para entender melhor o que acontece nas ruas de São José.',
      href: '/transito',
      badge: 'Trânsito da cidade',
    };
  }

  if (intent === 'licensed' || journey.goal === 'licensed') {
    return {
      kicker: 'VOLTAR A DIRIGIR',
      title: 'Retome no seu ritmo.',
      copy: 'Comece pelas situações que você quer entender ou praticar melhor e avance sem precisar refazer uma jornada de primeira habilitação.',
      href: '/guias',
      badge: 'Já sou habilitado',
    };
  }

  const stageCopy: Record<PublicStage, { title: string; copy: string }> = {
    'not-started': {
      title: 'Comece pelo caminho completo da CNH.',
      copy: 'Veja como o processo começa, quais etapas vêm primeiro e o que você precisa entender antes de seguir.',
    },
    medical: {
      title: 'Seu próximo foco é a teoria.',
      copy: 'Você já saiu do ponto inicial. Continue entendendo o que falta para chegar à formação e à prova teórica.',
    },
    theory: {
      title: 'Depois da teoria, vem a prática.',
      copy: 'Acompanhe o que precisa acontecer antes de começar a dirigir e como se preparar para a etapa prática.',
    },
    practical: {
      title: 'Você está na etapa prática.',
      copy: 'Use o Centro para entender a preparação, a prova e o que ainda faz sentido treinar antes do exame.',
    },
    exam: {
      title: 'Agora é preparar a prova.',
      copy: 'Confira o que vem no exame, o que levar e como organizar os últimos passos antes da avaliação.',
    },
  };

  return {
    kicker: intent === 'first-license' ? 'SUA PRIMEIRA CNH' : 'SUA CNH',
    ...stageCopy[journey.stage],
    href: '/cnh',
    badge: `Categoria ${journey.category}`,
  };
}

function HomeContinuity() {
  const [journey, setJourney] = useState<StoredJourney | null>(() => readJourney());
  const [draftIntent, setDraftIntent] = useState<HomeIntent | null>(null);
  const [draftCategory, setDraftCategory] = useState<Category | null>(null);
  const [step, setStep] = useState<DraftStep>('intent');

  useEffect(() => {
    const sync = () => setJourney(readJourney());
    window.addEventListener('storage', sync);
    window.addEventListener('centro:public-journey-change', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('centro:public-journey-change', sync);
    };
  }, []);

  const continuation = useMemo(() => journey ? continuationFor(journey) : null, [journey]);

  const resetDraft = () => {
    setDraftIntent(null);
    setDraftCategory(null);
    setStep('intent');
  };

  const commit = (next: StoredJourney) => {
    persistJourney(next);
    setJourney(next);
    resetDraft();
  };

  const chooseIntent = (intent: HomeIntent) => {
    setDraftIntent(intent);
    setDraftCategory(null);

    if (intent === 'city') {
      commit({ goal: 'first-license', category: 'B', stage: 'not-started', intent });
      return;
    }
    if (intent === 'licensed') {
      commit({ goal: 'licensed', category: 'B', stage: 'not-started', intent });
      return;
    }
    setStep('category');
  };

  const chooseCategory = (category: Category) => {
    setDraftCategory(category);
    if (draftIntent === 'first-license') {
      commit({ goal: 'first-license', category, stage: 'not-started', intent: 'first-license' });
      return;
    }
    setStep('stage');
  };

  const chooseStage = (stage: PublicStage) => {
    const category = draftCategory ?? 'B';
    const goal: PublicGoal = category === 'D' ? 'addition' : 'first-license';
    commit({ goal, category, stage, intent: 'continue-license' });
  };

  if (journey && continuation) {
    const intent = journey.intent ?? inferIntent(journey);
    const currentStage = STAGES.indexOf(journey.stage);
    const showProgress = intent === 'first-license' || intent === 'continue-license';

    return (
      <aside className="continuity-card continuity-card--resume" aria-live="polite">
        <div className="continuity-head">
          <span className="continuity-signal" aria-hidden="true" />
          <small>CONTINUE DE ONDE PAROU</small>
        </div>
        <div className="continuity-badges">
          <span>{continuation.badge}</span>
          {showProgress ? <span>{stageLabels[journey.stage]}</span> : null}
        </div>
        <p className="continuity-kicker">{continuation.kicker}</p>
        <h2>{continuation.title}</h2>
        <p className="continuity-copy">{continuation.copy}</p>

        {showProgress ? (
          <div className="continuity-progress" aria-label={`Etapa atual: ${stageLabels[journey.stage]}`}>
            {STAGES.map((stage, index) => (
              <span className={index <= currentStage ? 'is-complete' : ''} key={stage} title={stageLabels[stage]}>
                <i />
              </span>
            ))}
          </div>
        ) : null}

        <div className="continuity-actions">
          <a className="continuity-primary" href={continuation.href}>Continuar <span>→</span></a>
          <button type="button" onClick={() => { clearJourney(); setJourney(null); resetDraft(); }}>Mudar minha situação</button>
        </div>
        <small className="continuity-privacy">Esta continuidade fica apenas neste aparelho. Não cria cadastro e não altera seu processo no Detran.</small>
      </aside>
    );
  }

  return (
    <aside className="continuity-card" aria-live="polite">
      <div className="continuity-head">
        <span className="continuity-signal" aria-hidden="true" />
        <small>COMECE POR AQUI</small>
      </div>

      {step === 'intent' ? (
        <>
          <h2>O que você quer resolver hoje?</h2>
          <p className="continuity-copy">Escolha uma situação. O Centro organiza o próximo passo a partir daí.</p>
          <div className="continuity-options">
            {(Object.keys(intentLabels) as HomeIntent[]).map((intent) => (
              <button type="button" key={intent} onClick={() => chooseIntent(intent)}>
                <span>{intentLabels[intent]}</span><i>→</i>
              </button>
            ))}
          </div>
        </>
      ) : null}

      {step === 'category' ? (
        <>
          <button className="continuity-back" type="button" onClick={resetDraft}>← Voltar</button>
          <p className="continuity-kicker">{draftIntent === 'first-license' ? 'PRIMEIRA CNH' : 'SUA HABILITAÇÃO'}</p>
          <h2>Qual categoria você está buscando?</h2>
          <p className="continuity-copy">A categoria ajuda o Centro a mostrar uma orientação mais útil para o seu momento.</p>
          <div className="continuity-category-options">
            <button type="button" onClick={() => chooseCategory('A')}><strong>A</strong><span>Moto</span></button>
            <button type="button" onClick={() => chooseCategory('B')}><strong>B</strong><span>Carro</span></button>
            {draftIntent === 'continue-license' ? <button type="button" onClick={() => chooseCategory('D')}><strong>D</strong><span>Passageiros</span></button> : null}
          </div>
        </>
      ) : null}

      {step === 'stage' ? (
        <>
          <button className="continuity-back" type="button" onClick={() => setStep('category')}>← Voltar</button>
          <p className="continuity-kicker">CATEGORIA {draftCategory}</p>
          <h2>Em que ponto você está?</h2>
          <p className="continuity-copy">Escolha a situação mais próxima da sua. Você pode mudar isso depois.</p>
          <div className="continuity-stage-options">
            {STAGES.filter((stage) => stage !== 'not-started').map((stage) => (
              <button type="button" key={stage} onClick={() => chooseStage(stage)}>
                <span>{stageLabels[stage]}</span><i>→</i>
              </button>
            ))}
          </div>
        </>
      ) : null}

      <small className="continuity-privacy">Sem cadastro. A resposta fica neste aparelho e serve apenas para manter sua continuidade no Centro.</small>
    </aside>
  );
}

function contextualGuide(journey: StoredJourney | null) {
  if (!journey) {
    return {
      title: 'Como tirar a primeira CNH em 2026',
      copy: 'Veja a ordem atual do processo e o que pode ser resolvido diretamente pelo cidadão.',
      href: '/guias/primeira-habilitacao-2026',
    };
  }
  const intent = journey.intent ?? inferIntent(journey);
  if (intent === 'licensed') {
    return {
      title: 'Medo de dirigir',
      copy: 'Entenda como retomar a direção com progressão e sem transformar insegurança em pressa.',
      href: '/guias/medo-de-dirigir',
    };
  }
  if (journey.stage === 'practical' || journey.stage === 'exam') {
    return {
      title: 'Como funciona o exame prático',
      copy: 'Entenda o que acontece na prova, o que levar e como se preparar para o dia do exame.',
      href: '/guias/exame-pratico',
    };
  }
  if (intent === 'city') {
    return {
      title: 'Guias para quem dirige na cidade',
      copy: 'Use a biblioteca do Centro para tirar dúvidas sem interromper sua exploração dos dados de São José.',
      href: '/guias',
    };
  }
  return {
    title: 'Como tirar a primeira CNH em 2026',
    copy: 'Veja a ordem atual do processo e o que pode ser resolvido diretamente pelo cidadão.',
    href: '/guias/primeira-habilitacao-2026',
  };
}

function citySignal(journey: StoredJourney | null) {
  const practical = trafficIntelligence.datasets.practical.latest;
  const fleet = trafficIntelligence.datasets.fleet.latest;
  const infractions = trafficIntelligence.datasets.infractions.latest;
  const intent = journey ? (journey.intent ?? inferIntent(journey)) : null;

  if (journey?.stage === 'practical' || journey?.stage === 'exam') {
    return {
      label: 'PROVA PRÁTICA',
      value: formatPercent(practical?.metrics.approvalRate),
      copy: 'aprovação entre resultados decididos em São José',
    };
  }
  if (intent === 'city') {
    return {
      label: 'INFRAÇÕES',
      value: formatCompactCount(infractions?.metrics.total),
      copy: 'lavradas pelo Detran-SP no último período',
    };
  }
  return {
    label: 'FROTA',
    value: formatCompactCount(fleet?.metrics.total),
    copy: 'veículos ativos no último período',
  };
}

function HomeContextNow() {
  const [journey, setJourney] = useState<StoredJourney | null>(() => readJourney());

  useEffect(() => {
    const sync = () => setJourney(readJourney());
    window.addEventListener('storage', sync);
    window.addEventListener('centro:public-journey-change', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('centro:public-journey-change', sync);
    };
  }, []);

  const continuation = journey ? continuationFor(journey) : {
    kicker: 'COMECE AQUI',
    title: 'Resolva sua CNH sem depender de alguém para explicar o caminho.',
    copy: 'O Centro mostra o que você consegue fazer sozinho, os canais oficiais e quando vale pedir ajuda.',
    href: '/cnh',
    badge: 'Primeira visita',
  };
  const signal = citySignal(journey);
  const guide = contextualGuide(journey);

  return (
    <div className="home-context-inner">
      <div className="home-context-head">
        <div>
          <p className="eyebrow">AGORA PARA VOCÊ</p>
          <h2>O que vale a pena fazer agora.</h2>
        </div>
        <p>A navegação mostra tudo o que existe no Centro. Aqui aparecem apenas o próximo passo, um sinal da cidade e uma leitura útil para o seu momento.</p>
      </div>

      <div className="home-context-grid">
        <article className="home-context-card home-context-card--primary">
          <span>{continuation.kicker}</span>
          <h3>{continuation.title}</h3>
          <p>{continuation.copy}</p>
          <a href={continuation.href}>Continuar <i>→</i></a>
        </article>

        <a className="home-context-card home-context-card--signal" href="/transito">
          <span>SÃO JOSÉ AGORA · {trafficIntelligence.latestPeriod ? formatPeriod(trafficIntelligence.latestPeriod) : 'atualizando'}</span>
          <small>{signal.label}</small>
          <strong>{signal.value}</strong>
          <p>{signal.copy}</p>
          <i>Ver dados →</i>
        </a>

        <a className="home-context-card home-context-card--guide" href={guide.href}>
          <span>PARA ENTENDER</span>
          <h3>{guide.title}</h3>
          <p>{guide.copy}</p>
          <i>Ler guia →</i>
        </a>
      </div>
    </div>
  );
}

type MountState = {
  hero: HTMLElement;
  replacedSection: HTMLElement | null;
  continuityHost: HTMLElement;
  contextHost: HTMLElement;
  continuityRoot: Root;
  contextRoot: Root;
};

let active: MountState | null = null;

function cleanup() {
  if (!active) return;
  try { active.continuityRoot.unmount(); } catch { /* already detached */ }
  try { active.contextRoot.unmount(); } catch { /* already detached */ }
  active.replacedSection?.classList.remove('home-domain-section--replaced');
  active.continuityHost.remove();
  active.contextHost.remove();
  active = null;
}

function mount() {
  if (location.pathname !== '/') {
    cleanup();
    return;
  }

  const hero = document.querySelector<HTMLElement>('.platform-hero');
  if (!hero) return;
  if (active?.hero === hero && document.contains(active.continuityHost)) return;
  cleanup();

  hero.classList.add('has-home-continuity');
  const lead = hero.querySelector<HTMLElement>('.hero-lead');
  if (lead) lead.textContent = 'Comece pelo que você precisa agora. O Centro organiza o caminho a partir daí.';

  const continuityHost = document.createElement('div');
  continuityHost.className = 'home-continuity-host';
  hero.append(continuityHost);

  const sections = Array.from(document.querySelectorAll<HTMLElement>('section.platform-section.shell-width'));
  const firstSection = sections[0] ?? null;
  if (firstSection) firstSection.classList.add('home-domain-section--replaced');

  const contextHost = document.createElement('section');
  contextHost.className = 'platform-section shell-width home-context-section';
  if (firstSection?.parentElement) firstSection.insertAdjacentElement('afterend', contextHost);
  else hero.insertAdjacentElement('afterend', contextHost);

  const continuityRoot = createRoot(continuityHost);
  const contextRoot = createRoot(contextHost);
  continuityRoot.render(<HomeContinuity />);
  contextRoot.render(<HomeContextNow />);

  active = { hero, replacedSection: firstSection, continuityHost, contextHost, continuityRoot, contextRoot };
}

new MutationObserver(mount).observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('popstate', mount);
mount();
