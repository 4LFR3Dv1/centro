const RESOLVER_KEY = 'centro.cnhResolver.v1';
const LEGACY_KEY = 'centro.cnhExplorer.v1';
const PUBLIC_JOURNEY_KEY = 'centro.publicJourney.v1';
const OFFICIAL_GUIDANCE_URL = 'https://detran.sp.gov.br/cnhpaulista/';
const WHATSAPP_BASE = 'https://wa.me/5512981779745';

const steps = [
  {
    id: 'start',
    short: 'Começar',
    title: 'Comece seu processo',
    copy: 'Você pode iniciar sua primeira habilitação pelo App CNH do Brasil e seguir as orientações oficiais do Detran-SP.',
    selfTitle: 'Faça sozinho',
    selfCopy: 'Abra a orientação oficial, confira como iniciar o requerimento e siga o fluxo indicado para a primeira habilitação.',
    officialLabel: 'Abrir orientação oficial',
    confirmLabel: 'Já iniciei meu processo',
    help: 'Olá, preciso de ajuda para iniciar minha primeira habilitação.',
  },
  {
    id: 'registration',
    short: 'Cadastro',
    title: 'Faça o RENACH e a biometria',
    copy: 'Depois de iniciar o processo, o próximo passo é abrir o RENACH e concluir o cadastro biométrico exigido pelo Detran-SP.',
    selfTitle: 'Resolva o cadastro',
    selfCopy: 'Confira a orientação oficial do Detran-SP para saber como continuar o cadastro e a biometria do seu processo.',
    officialLabel: 'Ver como continuar no Detran-SP',
    confirmLabel: 'Já concluí cadastro e biometria',
    help: 'Olá, já iniciei minha CNH e preciso de ajuda com RENACH e biometria.',
  },
  {
    id: 'health',
    short: 'Exames',
    title: 'Faça as avaliações de saúde',
    copy: 'Conclua a avaliação psicológica e o exame de aptidão física e mental para liberar a continuação do processo.',
    selfTitle: 'Organize os exames',
    selfCopy: 'O Detran-SP informa atualmente R$ 90,00 para a avaliação psicológica e R$ 90,00 para o exame médico.',
    officialLabel: 'Ver orientação e valores oficiais',
    confirmLabel: 'Já concluí minhas avaliações',
    help: 'Olá, estou na etapa de avaliações da primeira habilitação e preciso de orientação.',
  },
  {
    id: 'theory',
    short: 'Teoria',
    title: 'Conclua o curso e faça a prova teórica',
    copy: 'Finalize a formação teórica, acompanhe a liberação do exame e faça a prova quando o processo estiver apto.',
    selfTitle: 'Prepare e faça a prova',
    selfCopy: 'O curso teórico pode ser feito pelo App CNH do Brasil. O Detran-SP informa atualmente taxa de R$ 52,83 para o exame teórico.',
    officialLabel: 'Ver orientação da etapa teórica',
    confirmLabel: 'Passei na prova teórica',
    help: 'Olá, estou na etapa teórica da primeira habilitação e preciso de ajuda para continuar.',
  },
  {
    id: 'practice',
    short: 'Prática',
    title: 'Comece sua preparação prática',
    copy: 'Depois da aprovação na teoria, emita a LADV e comece a prática na categoria que você vai habilitar.',
    selfTitle: 'Escolha como praticar',
    selfCopy: 'Para A e B, o Detran-SP informa atualmente mínimo de 2 horas. A prática pode ser feita em autoescola credenciada ou com instrutor autônomo autorizado.',
    officialLabel: 'Entender as opções oficiais',
    confirmLabel: 'Concluí minha preparação prática',
    help: 'Olá, já passei na teoria e quero ajuda com a etapa prática da minha primeira habilitação.',
  },
  {
    id: 'exam',
    short: 'Prova',
    title: 'Faça o exame prático',
    copy: 'Quando sua preparação estiver concluída, organize o exame prático e vá para a avaliação sabendo o que precisa levar e acompanhar.',
    selfTitle: 'Organize sua prova',
    selfCopy: 'O Detran-SP informa atualmente taxa de R$ 52,83 para o exame prático e permite que o cidadão faça o agendamento diretamente.',
    officialLabel: 'Ver orientação do exame prático',
    confirmLabel: 'Fui aprovado no exame prático',
    help: 'Olá, estou me preparando para o exame prático e preciso de ajuda.',
  },
  {
    id: 'license',
    short: 'CNH',
    title: 'Acompanhe a emissão da sua CNH',
    copy: 'Depois da aprovação, acompanhe os requisitos finais e a disponibilização da sua habilitação.',
    selfTitle: 'Finalize o processo',
    selfCopy: 'Para processos de primeira habilitação iniciados a partir de 17/06/2026, o Detran-SP informa exigência de exame toxicológico negativo e válido antes da emissão. A CNH digital pode ser acessada sem a taxa da versão física.',
    officialLabel: 'Ver requisitos finais no Detran-SP',
    confirmLabel: 'Minha CNH já está disponível',
    help: 'Olá, fui aprovado e preciso de ajuda para entender os passos finais da minha CNH.',
  },
];

const milestoneKeys = [
  'processStarted',
  'registrationDone',
  'healthDone',
  'theoryPassed',
  'practiceDone',
  'examPassed',
  'licenseAvailable',
];

const correctionLabels = [
  'Ainda não concluí nenhuma etapa',
  'Já iniciei meu processo',
  'Já concluí cadastro e biometria',
  'Já concluí as avaliações de saúde',
  'Já passei na prova teórica',
  'Já concluí minha preparação prática',
  'Já fui aprovado no exame prático',
  'Minha CNH já está disponível',
];

const validCategories = ['A', 'B', 'AB'];

function emptyState() {
  return {
    category: null,
    milestones: Object.fromEntries(milestoneKeys.map((key) => [key, false])),
    updatedAt: null,
  };
}

function normalizeState(candidate) {
  const base = emptyState();
  const source = candidate && typeof candidate === 'object' ? candidate : {};
  const milestones = { ...base.milestones };
  for (const key of milestoneKeys) milestones[key] = Boolean(source.milestones?.[key]);

  // A primeira habilitação é linear. Se uma etapa posterior estiver concluída,
  // as anteriores também precisam estar concluídas no estado local.
  let reachedGap = false;
  for (const key of milestoneKeys) {
    if (reachedGap) milestones[key] = false;
    else if (!milestones[key]) reachedGap = true;
  }

  return {
    category: validCategories.includes(source.category) ? source.category : null,
    milestones,
    updatedAt: source.updatedAt || null,
  };
}

function applyCompletedIndex(state, completedIndex) {
  const next = normalizeState(state);
  milestoneKeys.forEach((key, index) => {
    next.milestones[key] = index <= completedIndex;
  });
  next.updatedAt = new Date().toISOString();
  return next;
}

function migrateState() {
  let state = emptyState();

  try {
    const journey = JSON.parse(localStorage.getItem(PUBLIC_JOURNEY_KEY) || 'null');
    if (journey?.goal === 'first-license') {
      if (journey.category === 'A' || journey.category === 'B') state.category = journey.category;
      const completedByStage = {
        'not-started': -1,
        medical: 0,
        theory: 2,
        practical: 3,
        exam: 4,
      };
      if (Object.prototype.hasOwnProperty.call(completedByStage, journey.stage)) {
        state = applyCompletedIndex(state, completedByStage[journey.stage]);
      }
    }
  } catch {
    // Continuamos com um estado vazio.
  }

  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null');
    if (legacy) {
      if (validCategories.includes(legacy.category)) state.category = legacy.category;
      if (Number.isInteger(legacy.currentStep)) {
        const completedIndex = Math.max(-1, Math.min(milestoneKeys.length - 1, Number(legacy.currentStep) - 1));
        const legacyState = applyCompletedIndex(state, completedIndex);
        const currentCompleted = completedCount(state) - 1;
        if (completedIndex > currentCompleted) state = legacyState;
      }
    }
  } catch {
    // O estado antigo é opcional.
  }

  return normalizeState(state);
}

function readState() {
  try {
    const saved = JSON.parse(localStorage.getItem(RESOLVER_KEY) || 'null');
    if (saved) return normalizeState(saved);
  } catch {
    // Migraremos abaixo.
  }
  return migrateState();
}

function completedCount(state) {
  let count = 0;
  for (const key of milestoneKeys) {
    if (!state.milestones[key]) break;
    count += 1;
  }
  return count;
}

function currentStepIndex(state) {
  return Math.min(completedCount(state), steps.length - 1);
}

function syncPublicJourney(state) {
  try {
    const current = currentStepIndex(state);
    const stage = current >= 5 ? 'exam' : current >= 4 ? 'practical' : current >= 3 ? 'theory' : current >= 1 ? 'medical' : 'not-started';
    const existing = JSON.parse(localStorage.getItem(PUBLIC_JOURNEY_KEY) || 'null');
    const knownCategory = state.category === 'A' || state.category === 'B'
      ? state.category
      : existing?.category === 'A' || existing?.category === 'B'
        ? existing.category
        : null;

    // A Home antiga exige categoria para reconhecer a continuidade. Não fabricamos
    // uma categoria apenas para satisfazer esse contrato; sincronizamos assim que
    // ela já for conhecida pelo visitante.
    if (!knownCategory) return;

    localStorage.setItem(PUBLIC_JOURNEY_KEY, JSON.stringify({
      ...(existing && typeof existing === 'object' ? existing : {}),
      goal: 'first-license',
      category: knownCategory,
      stage,
      intent: current === 0 ? 'first-license' : 'continue-license',
      updatedAt: new Date().toISOString(),
    }));
    window.dispatchEvent(new CustomEvent('centro:public-journey-change'));
  } catch {
    // A continuidade na Home é complementar; não bloqueia /cnh.
  }
}

function persistState(state) {
  const normalized = normalizeState({ ...state, updatedAt: new Date().toISOString() });
  localStorage.setItem(RESOLVER_KEY, JSON.stringify(normalized));
  syncPublicJourney(normalized);
  return normalized;
}

function whatsappUrl(step, category) {
  const categoryText = category ? ` Categoria ${category}.` : '';
  return `${WHATSAPP_BASE}?text=${encodeURIComponent(`${step.help}${categoryText}`)}`;
}

function categoryName(category) {
  if (category === 'A') return 'A · Moto';
  if (category === 'B') return 'B · Carro';
  if (category === 'AB') return 'A+B · Moto e carro';
  return '';
}

function renderPath(state, current) {
  return `
    <details class="cnh-resolver-path">
      <summary>Ver caminho completo até a CNH</summary>
      <ol>
        ${steps.map((step, index) => {
          const done = Boolean(state.milestones[milestoneKeys[index]]);
          const now = index === current && !state.milestones[milestoneKeys[index]];
          return `<li class="${done ? 'is-done' : now ? 'is-current' : ''}">
            <span>${done ? '✓' : String(index + 1).padStart(2, '0')}</span>
            <div><strong>${step.short}</strong><small>${done ? 'Concluída' : now ? 'Agora' : 'Depois'}</small></div>
          </li>`;
        }).join('')}
      </ol>
    </details>`;
}

function renderCorrection(state) {
  const count = completedCount(state);
  return `
    <details class="cnh-resolver-correction">
      <summary>Corrigir minha situação</summary>
      <form data-correction-form>
        <label>
          <span>Qual foi a última coisa que você concluiu?</span>
          <select name="completed">
            ${correctionLabels.map((label, index) => `<option value="${index - 1}" ${index === count ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </label>
        <label>
          <span>Categoria, se você já souber</span>
          <select name="category">
            <option value="" ${!state.category ? 'selected' : ''}>Ainda não preciso informar</option>
            <option value="A" ${state.category === 'A' ? 'selected' : ''}>A · Moto</option>
            <option value="B" ${state.category === 'B' ? 'selected' : ''}>B · Carro</option>
            <option value="AB" ${state.category === 'AB' ? 'selected' : ''}>A+B · Moto e carro</option>
          </select>
        </label>
        <button type="submit">Atualizar minha situação</button>
      </form>
    </details>`;
}

function renderCategoryChoice(state) {
  if (state.category) return '';
  return `
    <div class="cnh-resolver-category" aria-labelledby="cnh-category-title">
      <p class="cnh-resolver-eyebrow">ANTES DE CONTINUAR</p>
      <h3 id="cnh-category-title">O que você vai praticar?</h3>
      <p>A categoria só é necessária agora porque ela muda a orientação da etapa prática.</p>
      <div role="group" aria-label="Categoria da primeira habilitação">
        <button type="button" data-category="A"><strong>A</strong><span>Moto</span></button>
        <button type="button" data-category="B"><strong>B</strong><span>Carro</span></button>
        <button type="button" data-category="AB"><strong>A+B</strong><span>Moto e carro</span></button>
      </div>
    </div>`;
}

function renderComplete(state, checkedText) {
  return `
    <div class="cnh-resolver-context">
      <div><span>SUA CNH</span><strong>Primeira habilitação${state.category ? ` · ${categoryName(state.category)}` : ''}</strong></div>
      ${renderCorrection(state)}
    </div>
    <article class="cnh-resolver-action cnh-resolver-action--complete" aria-live="polite">
      <p class="cnh-resolver-eyebrow">PROCESSO CONCLUÍDO</p>
      <h3>Sua CNH está disponível.</h3>
      <p>Você marcou todas as etapas desta jornada como concluídas. A partir daqui, o Centro continua útil para entender trânsito, mobilidade e sua vida como condutor.</p>
      <div class="cnh-resolver-actions">
        <a class="cnh-resolver-primary" href="${OFFICIAL_GUIDANCE_URL}" target="_blank" rel="noreferrer">Consultar orientação oficial ↗</a>
        <a class="cnh-resolver-secondary" href="/transito">Explorar o trânsito da cidade →</a>
      </div>
      <small>${checkedText}</small>
    </article>
    ${renderPath(state, steps.length)}`;
}

function enhanceTimeline(timeline) {
  if (!timeline || timeline.dataset.centroResolverEnhanced === 'true') return;
  const section = timeline.closest('section');
  if (!section || section.dataset.centroResolverEnhanced === 'true') return;

  timeline.dataset.centroResolverEnhanced = 'true';
  section.dataset.centroResolverEnhanced = 'true';
  section.classList.remove('cnh-explorer-section');
  section.classList.add('cnh-resolver-section');

  const heading = section.querySelector('.platform-section-head h2');
  const sideCopy = section.querySelector('.platform-section-head > p');
  const checkedText = sideCopy?.textContent?.trim() || 'Informações do Detran-SP consultadas em 03/09/2026.';
  if (heading) heading.textContent = 'O que você precisa resolver agora?';
  if (sideCopy) sideCopy.textContent = 'O Centro mostra o caminho que você pode fazer sozinho. Se preferir ajuda, a Auto Escola Centro entra como alternativa.';

  const root = document.createElement('div');
  root.className = 'cnh-resolver';
  root.setAttribute('aria-live', 'polite');
  timeline.replaceWith(root);

  let state = readState();

  const render = () => {
    state = normalizeState(state);
    const done = completedCount(state);
    if (done >= steps.length) {
      root.innerHTML = renderComplete(state, checkedText);
      bind();
      return;
    }

    const index = currentStepIndex(state);
    const step = steps[index];
    const needsCategory = step.id === 'practice' && !state.category;
    const progress = Math.round((done / steps.length) * 100);

    root.innerHTML = `
      <div class="cnh-resolver-context">
        <div>
          <span>SUA CNH</span>
          <strong>Primeira habilitação${state.category ? ` · ${categoryName(state.category)}` : ''}</strong>
          <small>Etapa ${index + 1} de ${steps.length}</small>
        </div>
        ${renderCorrection(state)}
      </div>

      <div class="cnh-resolver-progress" aria-label="${done} de ${steps.length} etapas concluídas">
        <span style="width:${progress}%"></span>
      </div>

      <div class="cnh-resolver-layout">
        <article class="cnh-resolver-action" aria-labelledby="cnh-resolver-title">
          <p class="cnh-resolver-eyebrow">FAÇA ISSO AGORA</p>
          <h3 id="cnh-resolver-title">${step.title}</h3>
          <p class="cnh-resolver-lead">${step.copy}</p>

          ${needsCategory ? renderCategoryChoice(state) : `
            <section class="cnh-resolver-self" aria-labelledby="cnh-self-title">
              <p class="cnh-resolver-eyebrow">${step.selfTitle.toUpperCase()}</p>
              <h4 id="cnh-self-title">Você pode resolver esta etapa por conta própria.</h4>
              <p>${step.selfCopy}</p>
              <a class="cnh-resolver-primary" href="${OFFICIAL_GUIDANCE_URL}" target="_blank" rel="noreferrer">${step.officialLabel} ↗</a>
            </section>

            <div class="cnh-resolver-confirm">
              <div><span>Quando terminar</span><p>Conte ao Centro apenas o que aconteceu de verdade. A próxima orientação aparece automaticamente.</p></div>
              <button type="button" data-complete-step="${index}">${step.confirmLabel}</button>
            </div>`}

          <small class="cnh-resolver-source">${checkedText}</small>
        </article>

        <aside class="cnh-resolver-help">
          <p class="cnh-resolver-eyebrow">PREFERE AJUDA?</p>
          <h3>A Auto Escola Centro pode acompanhar você.</h3>
          <p>Você não precisa contratar a escola para usar o Centro. Mas, se não quiser fazer esta etapa sozinho ou estiver com dificuldade para avançar, peça ajuda.</p>
          <a href="${whatsappUrl(step, state.category)}" target="_blank" rel="noreferrer">Quero ajuda nesta etapa →</a>
          <small>Auto Escola Centro · São José dos Campos${state.category ? ` · ${categoryName(state.category)}` : ''}</small>
        </aside>
      </div>

      ${renderPath(state, index)}
    `;

    bind();
  };

  const bind = () => {
    root.querySelectorAll('[data-category]').forEach((button) => {
      button.addEventListener('click', () => {
        const category = button.dataset.category;
        if (!validCategories.includes(category)) return;
        state = persistState({ ...state, category });
        render();
        root.querySelector('#cnh-resolver-title')?.focus?.({ preventScroll: true });
      });
    });

    root.querySelector('[data-complete-step]')?.addEventListener('click', (event) => {
      const index = Number(event.currentTarget.dataset.completeStep);
      if (!Number.isInteger(index) || index !== currentStepIndex(state)) return;
      state = applyCompletedIndex(state, index);
      state = persistState(state);
      render();
      root.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });

    root.querySelector('[data-correction-form]')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const completed = Number(form.get('completed'));
      const category = String(form.get('category') || '');
      state = applyCompletedIndex(state, Number.isFinite(completed) ? completed : -1);
      state.category = validCategories.includes(category) ? category : null;
      state = persistState(state);
      render();
      root.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  };

  state = persistState(state);
  render();
}

function scan() {
  if (location.pathname !== '/cnh') return;
  document.querySelectorAll('.official-timeline').forEach(enhanceTimeline);
}

new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('popstate', scan);
scan();
