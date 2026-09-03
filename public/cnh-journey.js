const STORAGE_KEY = 'centro.cnhExplorer.v1';
const PUBLIC_JOURNEY_KEY = 'centro.publicJourney.v1';

const steps = [
  {
    id: 'start',
    short: 'Início',
    title: 'Começar o processo',
    summary: 'Inicie o requerimento e o curso teórico pelo App CNH do Brasil.',
    now: 'Abra seu processo e confira as orientações iniciais no App CNH do Brasil.',
    before: 'Você ainda não precisa ter concluído nenhuma etapa anterior.',
    after: 'Depois, será necessário abrir o RENACH e fazer o cadastro biométrico no Detran-SP.',
  },
  {
    id: 'registration',
    short: 'Cadastro',
    title: 'RENACH e biometria',
    summary: 'Abra o RENACH e realize o cadastro biométrico no Detran-SP.',
    now: 'Confirme a abertura do seu processo e conclua o cadastro biométrico exigido para seguir.',
    before: 'Tenha iniciado o requerimento da primeira habilitação.',
    after: 'Com o cadastro aberto, vêm as avaliações psicológica e de aptidão física e mental.',
  },
  {
    id: 'health',
    short: 'Exames',
    title: 'Avaliações de saúde',
    summary: 'Realize avaliação psicológica e exame de aptidão física e mental.',
    now: 'Conclua as avaliações exigidas para que o seu processo possa avançar para a etapa teórica.',
    before: 'Seu RENACH e cadastro biométrico precisam estar encaminhados.',
    after: 'Depois, valide o curso teórico e faça o exame teórico.',
  },
  {
    id: 'theory',
    short: 'Teoria',
    title: 'Curso e prova teórica',
    summary: 'Valide o curso teórico e realize o exame teórico.',
    now: 'Finalize a formação teórica e acompanhe a liberação para realizar a prova.',
    before: 'As etapas de cadastro e avaliações precisam estar regulares no processo.',
    after: 'Após a aprovação, você poderá emitir a LADV e iniciar a prática.',
  },
  {
    id: 'practice',
    short: 'Prática',
    title: 'Começar a dirigir',
    summary: 'Após aprovação na teoria, emita a LADV e inicie a prática.',
    now: 'Com a LADV emitida, comece sua preparação prática na categoria escolhida.',
    before: 'É necessário ter sido aprovado na etapa teórica e estar liberado para a prática.',
    after: 'Quando concluir a preparação exigida, vem o exame prático.',
  },
  {
    id: 'exam',
    short: 'Prova',
    title: 'Exame prático',
    summary: 'Conclua a prática mínima exigida e realize o exame prático.',
    now: 'Confira seu agendamento, prepare o que ainda precisa treinar e vá para a prova sabendo o que esperar.',
    before: 'A etapa prática e os demais requisitos aplicáveis precisam estar concluídos.',
    after: 'Depois da aprovação, o processo segue para a emissão da CNH.',
  },
  {
    id: 'license',
    short: 'CNH',
    title: 'CNH disponível',
    summary: 'Após aprovação e demais requisitos aplicáveis, acesse a CNH digital.',
    now: 'Com as etapas concluídas e o processo aprovado, acompanhe a disponibilização da sua CNH.',
    before: 'O exame prático e os demais requisitos do processo precisam estar concluídos.',
    after: 'A partir daqui, sua habilitação passa a ser o documento que acompanha sua vida como condutor.',
  },
];

const situations = [
  { id: 'not-started', label: 'Ainda não comecei', step: 0 },
  { id: 'started', label: 'Já comecei pelo app', step: 1 },
  { id: 'theory-done', label: 'Já passei na teoria', step: 4 },
  { id: 'practical', label: 'Estou na prática', step: 4 },
  { id: 'exam', label: 'Vou fazer a prova', step: 5 },
  { id: 'approved', label: 'Já fui aprovado', step: 6 },
];

const categories = [
  { id: 'A', label: 'A · Moto' },
  { id: 'B', label: 'B · Carro' },
  { id: 'AB', label: 'A+B · Moto e carro' },
];

function readState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const situation = situations.find((item) => item.id === parsed.situation) || situations[0];
    return {
      situation: parsed.situation || situation.id,
      category: categories.some((item) => item.id === parsed.category) ? parsed.category : 'B',
      currentStep: Number.isInteger(parsed.currentStep) ? parsed.currentStep : situation.step,
      inspected: Number.isInteger(parsed.inspected) ? parsed.inspected : situation.step,
    };
  } catch {
    return { situation: 'not-started', category: 'B', currentStep: 0, inspected: 0 };
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

  const currentStep = Number.isInteger(state.currentStep) ? state.currentStep : 0;
  const stage = currentStep >= 5 ? 'exam' : currentStep >= 4 ? 'practical' : currentStep >= 3 ? 'theory' : currentStep >= 2 ? 'medical' : 'not-started';
  if (state.category === 'A' || state.category === 'B') {
    try {
      const existing = JSON.parse(localStorage.getItem(PUBLIC_JOURNEY_KEY) || '{}');
      localStorage.setItem(PUBLIC_JOURNEY_KEY, JSON.stringify({ ...existing, goal: 'first-license', category: state.category, stage }));
    } catch {
      localStorage.setItem(PUBLIC_JOURNEY_KEY, JSON.stringify({ goal: 'first-license', category: state.category, stage }));
    }
  }
}

function formatNumber(value) {
  return new Intl.NumberFormat('pt-BR').format(Number(value || 0));
}

function formatPercent(value) {
  return Number.isFinite(Number(value)) ? `${Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—';
}

function formatPeriod(period) {
  if (!period) return '';
  const [year, month] = period.split('-').map(Number);
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
}

async function loadTrafficData() {
  try {
    const response = await fetch('/data/traffic-intelligence.json', { cache: 'no-store' });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function practiceNote(category) {
  if (category === 'AB') {
    return 'Na combinação A+B, sua preparação reúne moto e carro. O Centro separa a orientação por etapa para você acompanhar cada parte com clareza.';
  }
  return `Para a categoria ${category}, o Detran-SP informa atualmente prática mínima de 2 horas. O mínimo legal não determina quanto treino cada pessoa realmente precisa.`;
}

function cityExamMarkup(data, category) {
  const snapshot = data?.datasets?.practical?.latest;
  const metrics = snapshot?.metrics;
  if (!snapshot || !metrics) return '';

  const wanted = category === 'AB' ? ['A', 'B'] : [category];
  const categoryCount = (metrics.categories || [])
    .filter((item) => wanted.includes(String(item.label).toUpperCase()))
    .reduce((sum, item) => sum + Number(item.value || 0), 0);

  return `
    <aside class="cnh-city-data" aria-label="Dados de exames práticos em São José dos Campos">
      <div class="cnh-city-data__head">
        <span>São José dos Campos</span>
        <small>${formatPeriod(snapshot.period)} · Detran-SP</small>
      </div>
      <div class="cnh-city-data__grid">
        <div><strong>${formatNumber(metrics.total)}</strong><span>exames práticos</span></div>
        <div><strong>${formatPercent(metrics.approvalRate)}</strong><span>aprovação entre resultados decididos</span></div>
        ${categoryCount ? `<div><strong>${formatNumber(categoryCount)}</strong><span>exames na categoria ${category}</span></div>` : ''}
      </div>
      <a href="/transito">Ver os dados da cidade →</a>
    </aside>`;
}

function enhanceTimeline(timeline) {
  if (!timeline || timeline.dataset.centroJourneyEnhanced === 'true') return;

  const section = timeline.closest('section');
  if (!section) return;

  timeline.dataset.centroJourneyEnhanced = 'true';
  section.classList.add('cnh-explorer-section');

  const heading = section.querySelector('.platform-section-head h2');
  const sideCopy = section.querySelector('.platform-section-head > p');
  const checkedText = sideCopy?.textContent?.trim() || 'Informações do Detran-SP.';
  if (heading) heading.textContent = 'Onde você está na sua CNH?';
  if (sideCopy) sideCopy.textContent = 'Escolha sua situação. O Centro mostra o que já passou, o que fazer agora e o que vem depois.';

  const controls = document.createElement('div');
  controls.className = 'cnh-explorer-controls';
  timeline.before(controls);

  const trackIntro = document.createElement('div');
  trackIntro.className = 'cnh-track-intro';
  trackIntro.innerHTML = '<strong>Etapas da sua CNH</strong><span>Selecione uma etapa para ver os detalhes. A etapa atual também fica marcada em texto.</span>';
  timeline.before(trackIntro);

  const detail = document.createElement('div');
  detail.className = 'cnh-explorer-detail';
  detail.setAttribute('role', 'region');
  detail.setAttribute('aria-live', 'polite');
  detail.setAttribute('aria-atomic', 'true');
  timeline.after(detail);

  let state = readState();
  let trafficData = null;
  let focusAfterRender = null;

  const restoreFocus = () => {
    if (!focusAfterRender) return;
    const target = section.querySelector(focusAfterRender);
    focusAfterRender = null;
    if (target instanceof HTMLElement) target.focus({ preventScroll: true });
  };

  const render = () => {
    const currentStep = Math.max(0, Math.min(steps.length - 1, Number(state.currentStep) || 0));
    const inspectedIndex = Math.max(0, Math.min(steps.length - 1, Number(state.inspected) || currentStep));
    const inspected = steps[inspectedIndex];

    controls.innerHTML = `
      <div class="cnh-control-group" aria-labelledby="cnh-situation-label">
        <span id="cnh-situation-label">Onde você está agora?</span>
        <div class="cnh-choice-row" role="group" aria-labelledby="cnh-situation-label">
          ${situations.map((item) => {
            const active = item.id === state.situation && item.step === currentStep;
            return `<button type="button" class="cnh-choice ${active ? 'is-active' : ''}" data-situation="${item.id}" aria-pressed="${active}">${item.label}</button>`;
          }).join('')}
        </div>
      </div>
      <div class="cnh-control-group cnh-control-group--category" aria-labelledby="cnh-category-label">
        <span id="cnh-category-label">Qual CNH você quer tirar?</span>
        <div class="cnh-choice-row" role="group" aria-labelledby="cnh-category-label">
          ${categories.map((item) => `<button type="button" class="cnh-choice ${item.id === state.category ? 'is-active' : ''}" data-category="${item.id}" aria-pressed="${item.id === state.category}">${item.label}</button>`).join('')}
        </div>
      </div>`;

    timeline.classList.add('cnh-explorer-track');
    timeline.setAttribute('role', 'navigation');
    timeline.setAttribute('aria-label', 'Etapas da primeira habilitação');
    timeline.innerHTML = steps.map((step, index) => {
      const stateClass = index < currentStep ? 'is-complete' : index === currentStep ? 'is-current' : 'is-future';
      const inspectedClass = index === inspectedIndex ? 'is-inspected' : '';
      const statusLabel = index < currentStep ? 'Concluída' : index === currentStep ? 'Você está aqui' : 'Depois';
      return `
        <button type="button" class="cnh-step ${stateClass} ${inspectedClass}" data-step="${index}"
          aria-label="Etapa ${index + 1} de ${steps.length}: ${step.title}. ${statusLabel}."
          aria-current="${index === currentStep ? 'step' : 'false'}"
          aria-pressed="${index === inspectedIndex}">
          <span class="cnh-step__top"><span class="cnh-step__number">${String(index + 1).padStart(2, '0')}</span><span class="cnh-step__status">${statusLabel}</span></span>
          <span class="cnh-step__label">${step.short}</span>
          <span class="cnh-step__title">${step.title}</span>
        </button>`;
    }).join('');

    const relation = inspectedIndex < currentStep ? 'Etapa concluída' : inspectedIndex === currentStep ? 'Você está aqui' : 'Vem depois';
    const practiceExtra = inspected.id === 'practice' ? `<div class="cnh-detail-note"><strong>Sobre a prática</strong><p>${practiceNote(state.category)}</p></div>` : '';
    const cityData = inspected.id === 'exam' ? cityExamMarkup(trafficData, state.category) : '';
    const schoolHelp = inspected.id === 'practice' || inspected.id === 'exam'
      ? `<div class="cnh-school-help"><span>Quer ajuda nesta etapa?</span><strong>Auto Escola Centro · categorias A, B e D</strong><a href="/auto-escola-centro">Ver aulas e atendimento →</a></div>`
      : '';
    const hasSide = Boolean(cityData || schoolHelp);
    detail.classList.toggle('is-single', !hasSide);
    detail.setAttribute('aria-labelledby', `cnh-detail-title-${inspectedIndex}`);

    detail.innerHTML = `
      <div class="cnh-detail-main">
        <div class="cnh-detail-kicker"><span>ETAPA ${String(inspectedIndex + 1).padStart(2, '0')}</span><em>${relation}</em></div>
        <h3 id="cnh-detail-title-${inspectedIndex}">${inspected.title}</h3>
        <p class="cnh-detail-summary">${inspected.summary}</p>
        <div class="cnh-detail-grid" aria-label="Antes, agora e depois desta etapa">
          <article><small>ANTES</small><p>${inspected.before}</p></article>
          <article class="is-now"><small>AGORA</small><p>${inspected.now}</p></article>
          <article><small>DEPOIS</small><p>${inspected.after}</p></article>
        </div>
        ${practiceExtra}
        <div class="cnh-detail-actions">
          ${inspectedIndex !== currentStep ? `<button type="button" class="cnh-mark-current" data-mark-current="${inspectedIndex}">Marcar como minha etapa atual</button>` : ''}
          <a href="/ferramentas/minha-jornada">Ver meu próximo passo completo →</a>
        </div>
        <small class="cnh-source-note">${checkedText}</small>
      </div>
      ${hasSide ? `<div class="cnh-detail-side">${cityData}${schoolHelp}</div>` : ''}`;

    controls.querySelectorAll('[data-situation]').forEach((button) => {
      button.addEventListener('click', () => {
        const next = situations.find((item) => item.id === button.dataset.situation);
        if (!next) return;
        state = { ...state, situation: next.id, currentStep: next.step, inspected: next.step };
        saveState(state);
        focusAfterRender = `[data-situation="${next.id}"]`;
        render();
      });
    });

    controls.querySelectorAll('[data-category]').forEach((button) => {
      button.addEventListener('click', () => {
        state = { ...state, category: button.dataset.category };
        saveState(state);
        focusAfterRender = `[data-category="${button.dataset.category}"]`;
        render();
      });
    });

    timeline.querySelectorAll('[data-step]').forEach((button) => {
      button.addEventListener('click', () => {
        state = { ...state, inspected: Number(button.dataset.step) };
        saveState(state);
        focusAfterRender = `[data-step="${button.dataset.step}"]`;
        render();
      });

      button.addEventListener('keydown', (event) => {
        const current = Number(button.dataset.step);
        let next = null;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = Math.min(steps.length - 1, current + 1);
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = Math.max(0, current - 1);
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = steps.length - 1;
        if (next === null || next === current) return;
        event.preventDefault();
        state = { ...state, inspected: next };
        saveState(state);
        focusAfterRender = `[data-step="${next}"]`;
        render();
      });
    });

    detail.querySelector('[data-mark-current]')?.addEventListener('click', (event) => {
      const targetStep = Number(event.currentTarget.dataset.markCurrent);
      state = { ...state, situation: 'custom', currentStep: targetStep, inspected: targetStep };
      saveState(state);
      focusAfterRender = `[data-step="${targetStep}"]`;
      render();
    });

    restoreFocus();
  };

  render();
  loadTrafficData().then((data) => {
    trafficData = data;
    if (document.contains(section)) render();
  });
}

function scan() {
  document.querySelectorAll('.official-timeline').forEach(enhanceTimeline);
}

const observer = new MutationObserver(scan);
observer.observe(document.documentElement, { childList: true, subtree: true });
scan();
