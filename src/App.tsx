import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { business, businessAddress } from './business';
import { buildWhatsappUrl, commercialProfile, type JourneyId } from './commercial';
import { officialGuidance } from './official-guidance';
import { cityFacts, guideCards, platformSources } from './platform-data';

type PublicGoal = 'first-license' | 'addition' | 'licensed';
type PublicStage = 'not-started' | 'medical' | 'theory' | 'practical' | 'exam';
type Category = 'A' | 'B' | 'D';

type PublicJourney = {
  goal: PublicGoal;
  category: Category;
  stage: PublicStage;
};

const defaultJourney: PublicJourney = {
  goal: 'first-license',
  category: 'B',
  stage: 'not-started',
};

const journeyStorageKey = 'centro.publicJourney.v1';

const stageLabels: Record<PublicStage, string> = {
  'not-started': 'Ainda não comecei',
  medical: 'Já fiz exames/cadastro',
  theory: 'Estou na etapa teórica',
  practical: 'Estou na etapa prática',
  exam: 'Estou me preparando para o exame',
};

const goalLabels: Record<PublicGoal, string> = {
  'first-license': 'Primeira habilitação',
  addition: 'Adição de categoria',
  licensed: 'Já sou habilitado',
};

function nextAction(journey: PublicJourney) {
  if (journey.goal === 'licensed') {
    return {
      title: 'Defina o tipo de treinamento que você precisa',
      copy: 'Para quem já tem CNH, a plataforma separa orientação pública de treinamento prático. Se quiser acompanhamento, a Auto Escola Centro atende habilitados.',
      premiumJourney: 'licensed' as JourneyId,
    };
  }

  if (journey.category === 'D' && journey.goal === 'first-license') {
    return {
      title: 'Categoria D não é uma primeira habilitação',
      copy: 'Use a jornada de adição/mudança de categoria e confirme os requisitos oficiais aplicáveis ao seu histórico de habilitação.',
      premiumJourney: 'addition' as JourneyId,
    };
  }

  switch (journey.stage) {
    case 'not-started':
      return {
        title: 'Comece pelo fluxo oficial da CNH',
        copy: 'Veja as etapas públicas, custos oficiais e requisitos antes de contratar qualquer serviço.',
        premiumJourney: 'not-started' as JourneyId,
      };
    case 'medical':
      return {
        title: 'Organize a etapa teórica',
        copy: 'Confirme o estado do seu processo e avance na formação teórica conforme o fluxo oficial atual.',
        premiumJourney: 'in-process' as JourneyId,
      };
    case 'theory':
      return {
        title: 'Conclua e valide a etapa teórica',
        copy: 'Depois da aprovação, confirme a autorização necessária para iniciar a prática.',
        premiumJourney: 'in-process' as JourneyId,
      };
    case 'practical':
      return {
        title: 'Planeje sua preparação prática',
        copy: 'A prática mínima oficial e a quantidade de treino que você realmente precisa não são a mesma coisa. Escolha com base na sua situação.',
        premiumJourney: 'theory-done' as JourneyId,
      };
    case 'exam':
      return {
        title: 'Prepare-se para o exame prático',
        copy: 'Revise requisitos oficiais, agendamento e pontos de preparação sem confundir taxa pública com serviço da autoescola.',
        premiumJourney: 'practical-only' as JourneyId,
      };
  }
}

function Shell() {
  const location = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [location.pathname]);

  return (
    <main className="platform-shell">
      <header className="platform-topbar shell-width">
        <Link className="platform-brand" to="/" aria-label="Centro — plataforma pública de trânsito">
          <span className="brand-mark" aria-hidden="true"><span /></span>
          <span className="brand-copy">
            <strong>CENTRO</strong>
            <small>Plataforma pública de trânsito</small>
          </span>
        </Link>

        <nav className="platform-nav" aria-label="Navegação principal">
          <NavLink to="/cnh">CNH</NavLink>
          <NavLink to="/transito">Trânsito</NavLink>
          <NavLink to="/guias">Guias</NavLink>
          <NavLink to="/ferramentas">Ferramentas</NavLink>
          <NavLink to="/sao-jose-dos-campos">São José</NavLink>
        </nav>

        <Link className="student-access-link" to="/auto-escola-centro">
          Auto Escola Centro <span aria-hidden="true">↗</span>
        </Link>
      </header>

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/cnh" element={<CnhHub />} />
        <Route path="/transito" element={<TrafficHub />} />
        <Route path="/guias" element={<GuidesHub />} />
        <Route path="/ferramentas" element={<ToolsHub />} />
        <Route path="/ferramentas/minha-jornada" element={<JourneyTool />} />
        <Route path="/sao-jose-dos-campos" element={<SjcHub />} />
        <Route path="/auto-escola-centro" element={<ProviderPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>

      <footer className="platform-footer shell-width">
        <div>
          <strong>CENTRO</strong>
          <p>Informação pública, ferramentas e contexto de trânsito para decisões mais claras.</p>
        </div>
        <div className="footer-links">
          <Link to="/cnh">CNH</Link>
          <Link to="/transito">Trânsito</Link>
          <Link to="/ferramentas">Ferramentas</Link>
          <Link to="/auto-escola-centro">Auto Escola Centro</Link>
        </div>
        <small>R3B · PUBLIC TRAFFIC PLATFORM</small>
      </footer>
    </main>
  );
}

function Home() {
  return (
    <>
      <section className="platform-hero shell-width">
        <div className="platform-hero-copy">
          <p className="eyebrow">CENTRO · TRÂNSITO · SÃO JOSÉ DOS CAMPOS</p>
          <h1>O trânsito,<br /><em>em um só lugar.</em></h1>
          <p className="hero-lead">CNH, regras, dados, guias e ferramentas para quem dirige — ou está começando. Informação pública primeiro; serviço premium quando você quiser ajuda.</p>
          <div className="hero-actions">
            <Link className="primary-action" to="/ferramentas/minha-jornada">Entender minha jornada <span>→</span></Link>
            <Link className="text-action" to="/transito">Explorar trânsito</Link>
          </div>
        </div>

        <aside className="public-pulse" aria-label="Resumo público atual">
          <div className="pulse-head"><span className="status-dot" /> <span>Centro agora</span><small>03 SET 2026</small></div>
          <Link className="pulse-row" to="/cnh"><span>CNH</span><strong>2h</strong><small>prática mínima A/B</small></Link>
          <Link className="pulse-row" to="/transito"><span>Dados</span><strong>JUL/26</strong><small>bases Detran disponíveis</small></Link>
          <Link className="pulse-row" to="/sao-jose-dos-campos"><span>SJC</span><strong>24h</strong><small>monitoramento municipal</small></Link>
          <div className="pulse-note">Cada fato público mantém autoridade, data de consulta e fonte.</div>
        </aside>
      </section>

      <section className="platform-section shell-width">
        <div className="platform-section-head"><div><p className="eyebrow">EXPLORE</p><h2>Não é só sobre tirar CNH.</h2></div><p>Centro organiza trânsito em superfícies simples: entender regras, consultar contexto, usar ferramentas e decidir quando ajuda profissional faz sentido.</p></div>
        <div className="domain-grid">
          <DomainCard index="01" title="CNH" copy="Fluxo oficial, categorias, custos públicos e próximos passos." href="/cnh" />
          <DomainCard index="02" title="Trânsito" copy="Bases oficiais de exames, frota, infrações e mobilidade." href="/transito" />
          <DomainCard index="03" title="Guias" copy="Explicações curtas para situações que costumam gerar dúvida." href="/guias" />
          <DomainCard index="04" title="Ferramentas" copy="Descubra sua etapa e organize decisões sem criar uma conta." href="/ferramentas" />
        </div>
      </section>

      <section className="platform-section shell-width city-home-section">
        <div className="city-home-copy">
          <p className="eyebrow">SÃO JOSÉ DOS CAMPOS</p>
          <h2>A cidade também é parte da plataforma.</h2>
          <p>Começamos localmente: contexto de mobilidade, fontes oficiais e dados públicos que ajudam a entender o trânsito onde a Auto Escola Centro realmente opera.</p>
          <Link className="text-action" to="/sao-jose-dos-campos">Explorar São José dos Campos</Link>
        </div>
        <div className="city-fact-grid">
          {cityFacts.map((fact) => <article className="city-fact-card" key={fact.label}><strong>{fact.value}</strong><span>{fact.label}</span><p>{fact.detail}</p></article>)}
        </div>
      </section>

      <section className="platform-section shell-width">
        <div className="platform-section-head"><div><p className="eyebrow">GUIAS</p><h2>Respostas para decisões reais.</h2></div><Link className="text-action" to="/guias">Ver todos</Link></div>
        <div className="guide-grid">{guideCards.slice(0, 3).map((guide) => <Link className="guide-card" to={guide.href} key={guide.title}><span>GUIA</span><h3>{guide.title}</h3><p>{guide.copy}</p><i>→</i></Link>)}</div>
      </section>

      <PremiumBoundary />
    </>
  );
}

function DomainCard({ index, title, copy, href }: { index: string; title: string; copy: string; href: string }) {
  return <Link className="domain-card" to={href}><span>{index}</span><h3>{title}</h3><p>{copy}</p><i>→</i></Link>;
}

function PageIntro({ kicker, title, copy }: { kicker: string; title: string; copy: string }) {
  return <section className="page-intro shell-width"><p className="eyebrow">{kicker}</p><h1>{title}</h1><p>{copy}</p></section>;
}

function CnhHub() {
  return (
    <>
      <PageIntro kicker="CNH · SÃO PAULO" title="Entenda o processo antes de pagar por ele." copy="Centro separa regra pública, taxa oficial e serviço privado para você saber exatamente o que está decidindo." />
      <section className="platform-section shell-width compact-section">
        <div className="fact-strip">{officialGuidance.publicFacts.slice(0, 4).map((fact) => <article key={fact.label}><small>{fact.label}</small><strong>{fact.value}</strong><p>{fact.detail}</p></article>)}</div>
      </section>
      <section className="platform-section shell-width">
        <div className="platform-section-head"><div><p className="eyebrow">FLUXO OFICIAL</p><h2>Primeira habilitação, passo a passo.</h2></div><p>Snapshot de orientação do Detran-SP consultado em {officialGuidance.checkedAt.split('-').reverse().join('/')}.</p></div>
        <div className="official-timeline">{officialGuidance.firstLicense.steps.map((step, index) => <article key={step}><span>{String(index + 1).padStart(2, '0')}</span><p>{step}</p></article>)}</div>
      </section>
      <section className="platform-section shell-width" id="categorias">
        <div className="platform-section-head"><div><p className="eyebrow">CATEGORIAS</p><h2>A, B e D sem linguagem de balcão.</h2></div><p>A plataforma explica o significado da categoria; a Auto Escola Centro entra apenas quando você quiser contratar atendimento prático.</p></div>
        <div className="category-grid"><CategoryCard code="A" title="Moto" copy="Primeira habilitação ou adição, conforme sua situação." /><CategoryCard code="B" title="Carro" copy="Primeira habilitação ou adição, conforme sua situação." /><CategoryCard code="D" title="Passageiros" copy="Categoria profissional que depende de requisitos e histórico de habilitação." /></div>
        <div className="inline-tool-cta"><div><small>FERRAMENTA PÚBLICA</small><strong>Não sabe em que etapa está?</strong><p>Monte sua jornada localmente no navegador, sem cadastro.</p></div><Link className="primary-action" to="/ferramentas/minha-jornada">Descobrir agora <span>→</span></Link></div>
      </section>
      <PremiumBoundary />
    </>
  );
}

function CategoryCard({ code, title, copy }: { code: string; title: string; copy: string }) {
  return <article className="category-card"><strong>{code}</strong><div><h3>{title}</h3><p>{copy}</p></div></article>;
}

function TrafficHub() {
  return (
    <>
      <PageIntro kicker="TRÂNSITO · DADOS PÚBLICOS" title="Dados com fonte, não números soltos." copy="R3B estabelece o catálogo e a provenance das bases. A ingestão histórica e os indicadores municipais entram no próximo regime de inteligência." />
      <section className="platform-section shell-width compact-section">
        <div className="source-grid">{platformSources.filter((source) => source.id.startsWith('detran-') && source.id !== 'detran-guidance').map((source) => <SourceCard source={source} key={source.id} />)}</div>
      </section>
      <section className="platform-section shell-width">
        <div className="platform-section-head"><div><p className="eyebrow">REGRA DE DADOS</p><h2>Todo indicador precisa saber de onde veio.</h2></div><p>Fonte, período e data de consulta são parte do dado. Se uma base ainda não foi ingerida, o Centro mostra a fonte disponível — não fabrica uma estatística.</p></div>
        <div className="data-contract"><code>source</code><span>→</span><code>period</code><span>→</span><code>observation</code><span>→</span><code>public fact</code></div>
      </section>
      <PremiumBoundary compact />
    </>
  );
}

function SourceCard({ source }: { source: (typeof platformSources)[number] }) {
  return <a className="source-card" href={source.url} target="_blank" rel="noreferrer"><div><span className={`source-state ${source.status}`}>{source.status === 'official' ? 'OFICIAL' : 'FONTE PRONTA'}</span><small>{source.authority}</small></div><h3>{source.title}</h3><p>{source.scope}</p><footer><span>{source.freshness}</span><i>↗</i></footer></a>;
}

function GuidesHub() {
  return (
    <>
      <PageIntro kicker="GUIAS" title="Trânsito explicado para quem precisa decidir." copy="Conteúdo curto, acionável e separado por situação — sem transformar a plataforma em um blog genérico." />
      <section className="platform-section shell-width compact-section"><div className="guide-grid guide-grid--wide">{guideCards.map((guide) => <Link className="guide-card" to={guide.href} key={guide.title}><span>GUIA</span><h3>{guide.title}</h3><p>{guide.copy}</p><i>→</i></Link>)}</div></section>
      <section className="platform-section shell-width" id="categoria-d"><div className="guide-detail"><p className="eyebrow">CATEGORIA D</p><h2>Não trate D como se fosse apenas “mais uma opção”.</h2><p>Categoria D depende do histórico do condutor e de requisitos próprios. No Centro, ela aparece como uma trajetória de habilitação, não como um produto de prateleira. A Auto Escola Centro trabalha com categoria D, mas requisitos oficiais continuam sendo determinados pelos órgãos competentes.</p></div></section>
      <section className="platform-section shell-width" id="habilitados"><div className="guide-detail"><p className="eyebrow">HABILITADOS</p><h2>Ter CNH e estar confortável dirigindo são estados diferentes.</h2><p>Quem já é habilitado pode usar a plataforma para separar questões regulatórias de necessidade prática. Treinamento para recuperar confiança é serviço, não etapa obrigatória da CNH.</p></div></section>
      <section className="platform-section shell-width" id="exame-pratico"><div className="guide-detail"><p className="eyebrow">EXAME PRÁTICO</p><h2>Taxa, agendamento e preparação não são a mesma coisa.</h2><p>O Centro mantém a taxa pública e o fluxo oficial em uma camada; contratação de aulas, veículo ou preparação fica na camada do provedor.</p></div></section>
    </>
  );
}

function ToolsHub() {
  return (
    <>
      <PageIntro kicker="FERRAMENTAS" title="Use o Centro sem criar uma conta." copy="Ferramentas públicas devem responder uma pergunta e sair do caminho. A primeira já está ativa: sua jornada da CNH." />
      <section className="platform-section shell-width compact-section">
        <div className="tool-grid">
          <Link className="tool-card tool-card--active" to="/ferramentas/minha-jornada"><span>ATIVA</span><h3>Minha jornada CNH</h3><p>Informe objetivo, categoria e etapa atual. O estado fica salvo somente neste navegador.</p><i>Começar →</i></Link>
          <article className="tool-card"><span>EM PREPARAÇÃO</span><h3>Custos oficiais</h3><p>Separar taxas públicas de serviços contratados em uma visão simples.</p></article>
          <article className="tool-card"><span>EM PREPARAÇÃO</span><h3>Checklist de documentos</h3><p>Checklist contextual por etapa, sem substituir a fonte oficial.</p></article>
        </div>
      </section>
    </>
  );
}

function JourneyTool() {
  const [journey, setJourney] = useState<PublicJourney>(() => {
    try {
      const stored = localStorage.getItem(journeyStorageKey);
      return stored ? { ...defaultJourney, ...JSON.parse(stored) } : defaultJourney;
    } catch {
      return defaultJourney;
    }
  });

  useEffect(() => {
    localStorage.setItem(journeyStorageKey, JSON.stringify(journey));
  }, [journey]);

  const action = useMemo(() => nextAction(journey), [journey]);
  const premiumUrl = buildWhatsappUrl(business.whatsappUrl, action.premiumJourney);

  return (
    <>
      <PageIntro kicker="FERRAMENTA · SEM CADASTRO" title="Onde você está na sua jornada?" copy="Responda três coisas. O Centro organiza o próximo passo e guarda a resposta somente neste dispositivo." />
      <section className="platform-section shell-width compact-section">
        <div className="journey-tool">
          <div className="journey-form">
            <ToolQuestion label="1 · Objetivo"><div className="choice-row">{(['first-license','addition','licensed'] as PublicGoal[]).map((goal) => <button className={journey.goal === goal ? 'is-selected' : ''} type="button" key={goal} onClick={() => setJourney({ ...journey, goal })}>{goalLabels[goal]}</button>)}</div></ToolQuestion>
            <ToolQuestion label="2 · Categoria"><div className="choice-row choice-row--small">{(['A','B','D'] as Category[]).map((category) => <button className={journey.category === category ? 'is-selected' : ''} type="button" key={category} onClick={() => setJourney({ ...journey, category })}>{category}</button>)}</div></ToolQuestion>
            <ToolQuestion label="3 · Etapa atual"><div className="choice-column">{(Object.keys(stageLabels) as PublicStage[]).map((stage) => <button className={journey.stage === stage ? 'is-selected' : ''} type="button" key={stage} onClick={() => setJourney({ ...journey, stage })}>{stageLabels[stage]}</button>)}</div></ToolQuestion>
            <button className="reset-tool" type="button" onClick={() => setJourney(defaultJourney)}>Limpar respostas</button>
          </div>
          <aside className="journey-result" aria-live="polite">
            <p className="recommendation-kicker">SEU CHECKPOINT</p>
            <div className="journey-badges"><span>{goalLabels[journey.goal]}</span><span>Categoria {journey.category}</span></div>
            <h2>{action.title}</h2><p>{action.copy}</p>
            <div className="result-actions"><Link className="primary-action" to="/cnh">Ver orientação oficial <span>→</span></Link><a className="premium-text-link" href={premiumUrl} target="_blank" rel="noreferrer">Quero ajuda da Auto Escola Centro ↗</a></div>
            <small>Seu checkpoint é autodeclarado e não cria registro de aluno.</small>
          </aside>
        </div>
      </section>
    </>
  );
}

function ToolQuestion({ label, children }: { label: string; children: React.ReactNode }) {
  return <fieldset className="tool-question"><legend>{label}</legend>{children}</fieldset>;
}

function SjcHub() {
  return (
    <>
      <PageIntro kicker="SÃO JOSÉ DOS CAMPOS" title="Trânsito local com contexto público." copy="A primeira superfície territorial do Centro combina mobilidade municipal e bases estaduais que podem ser recortadas por município." />
      <section className="platform-section shell-width compact-section"><div className="city-fact-grid city-fact-grid--page">{cityFacts.map((fact) => <article className="city-fact-card" key={fact.label}><strong>{fact.value}</strong><span>{fact.label}</span><p>{fact.detail}</p></article>)}</div></section>
      <section className="platform-section shell-width"><div className="platform-section-head"><div><p className="eyebrow">FONTES LOCAIS</p><h2>O que já pode alimentar a plataforma.</h2></div><p>R3B publica o catálogo de fontes; R3C fará ingestão, recorte municipal e séries históricas.</p></div><div className="source-grid">{platformSources.filter((source) => source.id.startsWith('sjc-')).map((source) => <SourceCard source={source} key={source.id} />)}</div></section>
      <section className="platform-section shell-width"><div className="local-context-card"><div><p className="eyebrow">PRÓXIMO REGIME</p><h2>Exames, frota e infrações de São José.</h2><p>As bases do Detran-SP já têm dimensão municipal. O próximo passo é ingerir snapshots e publicar indicadores com período e provenance.</p></div><Link className="primary-action" to="/transito">Ver bases disponíveis <span>→</span></Link></div></section>
      <PremiumBoundary />
    </>
  );
}

function ProviderPage() {
  const verifiedServices = commercialProfile.services.value as readonly string[];
  return (
    <>
      <PageIntro kicker="PROVEDOR PREMIUM" title="Auto Escola Centro." copy="A plataforma pública não exige matrícula. Quando você quiser aulas, categoria, treinamento ou atendimento humano, a Auto Escola Centro entra como provedor premium em São José dos Campos." />
      <section className="platform-section shell-width compact-section">
        <div className="provider-profile">
          <div className="provider-identity"><span className="provider-badge">VERIFICADO NO CENTRO</span><h2>{business.name}</h2><p>{businessAddress}</p><strong>{business.phoneDisplay}</strong><div className="provider-categories"><span>A</span><span>B</span><span>D</span></div></div>
          <div className="provider-services"><p className="eyebrow">ATENDIMENTO CONFIRMADO</p>{verifiedServices.map((service) => <div key={service}><span>✓</span><strong>{service}</strong></div>)}<a className="primary-action" href={business.whatsappUrl} target="_blank" rel="noreferrer">Falar no WhatsApp <span>↗</span></a></div>
        </div>
      </section>
      <section className="platform-section shell-width"><div className="platform-section-head"><div><p className="eyebrow">TRANSPARÊNCIA</p><h2>O que ainda não publicamos.</h2></div><p>Preço, frota, horário, disponibilidade e meios de pagamento continuam desconhecidos no estado canônico. O Centro prefere mostrar ausência de dado internamente a inventar informação publicamente.</p></div><div className="unknown-grid">{Object.entries(commercialProfile).filter(([key, field]) => key !== 'services' && field.state === 'unknown').map(([key, field]) => <article key={key}><span>CONSULTAR</span><strong>{humanizeCommercialKey(key)}</strong><p>{field.note}</p></article>)}</div></section>
    </>
  );
}

function humanizeCommercialKey(key: string) {
  const labels: Record<string, string> = { pricing: 'Preços', fleet: 'Frota', openingHours: 'Horários', lessonAvailability: 'Disponibilidade', paymentMethods: 'Meios de pagamento' };
  return labels[key] ?? key;
}

function PremiumBoundary({ compact = false }: { compact?: boolean }) {
  return <section className={`premium-boundary shell-width ${compact ? 'is-compact' : ''}`}><div><p className="eyebrow">CAMADA PREMIUM</p><h2>Informação primeiro. Ajuda prática quando fizer sentido.</h2><p>A Auto Escola Centro trabalha com categorias A, B e D em São José dos Campos, além de treinamento para habilitados.</p></div><Link className="premium-action" to="/auto-escola-centro"><span>Conhecer atendimento</span><i>↗</i></Link></section>;
}

function NotFound() {
  return <section className="page-intro shell-width not-found"><p className="eyebrow">404</p><h1>Essa rota ainda não existe.</h1><p>Volte para a plataforma pública do Centro.</p><Link className="primary-action" to="/">Ir para o início <span>→</span></Link></section>;
}

export default function App() {
  return <Shell />;
}
