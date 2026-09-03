import { useEffect, useMemo, useState, type ReactNode } from 'react';
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
      title: 'Escolha o que você quer treinar',
      copy: 'Se você já tem CNH e quer voltar a dirigir com mais segurança, defina quais situações mais incomodam: trânsito, estacionamento, vias rápidas ou retomada de confiança.',
      premiumJourney: 'licensed' as JourneyId,
    };
  }

  if (journey.category === 'D' && journey.goal === 'first-license') {
    return {
      title: 'A categoria D exige habilitação anterior',
      copy: 'Ela não pode ser escolhida como primeira habilitação. Confira os requisitos para mudar ou adicionar a categoria de acordo com sua CNH atual.',
      premiumJourney: 'addition' as JourneyId,
    };
  }

  switch (journey.stage) {
    case 'not-started':
      return {
        title: 'Comece entendendo as etapas da CNH',
        copy: 'Veja quais exames, documentos e passos vêm primeiro antes de escolher aulas ou outros serviços.',
        premiumJourney: 'not-started' as JourneyId,
      };
    case 'medical':
      return {
        title: 'Agora, foque na etapa teórica',
        copy: 'Confira o andamento do seu processo e veja o que falta para concluir a formação e a prova teórica.',
        premiumJourney: 'in-process' as JourneyId,
      };
    case 'theory':
      return {
        title: 'Depois da teoria, vem a prática',
        copy: 'Após a aprovação, confirme a liberação necessária para começar as aulas práticas e organize seu treinamento.',
        premiumJourney: 'in-process' as JourneyId,
      };
    case 'practical':
      return {
        title: 'Hora de ganhar confiança ao volante',
        copy: 'O mínimo exigido por lei não diz quanto treino cada pessoa precisa. Considere sua experiência e escolha a preparação que faça sentido para você.',
        premiumJourney: 'theory-done' as JourneyId,
      };
    case 'exam':
      return {
        title: 'Prepare-se para a prova prática',
        copy: 'Confira o agendamento, o que levar e os pontos que você ainda quer treinar antes do exame.',
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
        <Link className="platform-brand" to="/" aria-label="Centro — trânsito e CNH em São José dos Campos">
          <span className="brand-mark" aria-hidden="true"><span /></span>
          <span className="brand-copy">
            <strong>CENTRO</strong>
            <small>Trânsito e CNH em São José dos Campos</small>
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
        <Route path="/auto-escola-centro" element={<SchoolPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>

      <footer className="platform-footer shell-width">
        <div>
          <strong>CENTRO</strong>
          <p>CNH, trânsito, mobilidade e orientação para São José dos Campos.</p>
        </div>
        <div className="footer-links">
          <Link to="/cnh">CNH</Link>
          <Link to="/transito">Trânsito</Link>
          <Link to="/ferramentas">Ferramentas</Link>
          <Link to="/auto-escola-centro">Auto Escola Centro</Link>
        </div>
        <small>São José dos Campos · SP</small>
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
          <p className="hero-lead">CNH, regras, dados, guias e ferramentas para quem dirige — ou está começando. E, quando você precisar de aulas ou atendimento, a Auto Escola Centro está por perto.</p>
          <div className="hero-actions">
            <Link className="primary-action" to="/ferramentas/minha-jornada">Descobrir meu próximo passo <span>→</span></Link>
            <Link className="text-action" to="/transito">Explorar trânsito</Link>
          </div>
        </div>

        <aside className="public-pulse" aria-label="Informações em destaque">
          <div className="pulse-head"><span className="status-dot" /> <span>Centro agora</span><small>03 SET 2026</small></div>
          <Link className="pulse-row" to="/cnh"><span>CNH</span><strong>2h</strong><small>prática mínima A/B</small></Link>
          <Link className="pulse-row" to="/transito"><span>Dados</span><strong>JUL/26</strong><small>últimos dados do Detran</small></Link>
          <Link className="pulse-row" to="/sao-jose-dos-campos"><span>SJC</span><strong>24h</strong><small>monitoramento municipal</small></Link>
          <div className="pulse-note">Informações acompanhadas de fonte e data de atualização.</div>
        </aside>
      </section>

      <section className="platform-section shell-width">
        <div className="platform-section-head"><div><p className="eyebrow">POR ONDE COMEÇAR</p><h2>Não é só sobre tirar CNH.</h2></div><p>Encontre respostas para dúvidas de habilitação, veja informações de trânsito e use ferramentas rápidas para entender o que fazer agora.</p></div>
        <div className="domain-grid">
          <DomainCard index="01" title="CNH" copy="Etapas, categorias, taxas oficiais e próximos passos." href="/cnh" />
          <DomainCard index="02" title="Trânsito" copy="Exames, frota, infrações e mobilidade em fontes oficiais." href="/transito" />
          <DomainCard index="03" title="Guias" copy="Respostas diretas para situações comuns de quem dirige ou está aprendendo." href="/guias" />
          <DomainCard index="04" title="Ferramentas" copy="Descubra sua etapa da CNH e organize o que precisa fazer." href="/ferramentas" />
        </div>
      </section>

      <section className="platform-section shell-width city-home-section">
        <div className="city-home-copy">
          <p className="eyebrow">SÃO JOSÉ DOS CAMPOS</p>
          <h2>Acompanhe a cidade de perto.</h2>
          <p>Veja informações de mobilidade, trânsito e segurança viária de São José dos Campos reunidas a partir de fontes oficiais.</p>
          <Link className="text-action" to="/sao-jose-dos-campos">Ver São José dos Campos</Link>
        </div>
        <div className="city-fact-grid">
          {cityFacts.map((fact) => <article className="city-fact-card" key={fact.label}><strong>{fact.value}</strong><span>{fact.label}</span><p>{fact.detail}</p></article>)}
        </div>
      </section>

      <section className="platform-section shell-width">
        <div className="platform-section-head"><div><p className="eyebrow">GUIAS</p><h2>Respostas para dúvidas reais.</h2></div><Link className="text-action" to="/guias">Ver todos</Link></div>
        <div className="guide-grid">{guideCards.slice(0, 3).map((guide) => <Link className="guide-card" to={guide.href} key={guide.title}><span>GUIA</span><h3>{guide.title}</h3><p>{guide.copy}</p><i>→</i></Link>)}</div>
      </section>

      <SchoolHelp />
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
      <PageIntro kicker="CNH · SÃO PAULO" title="Sua CNH, passo a passo." copy="Veja as etapas, taxas oficiais, categorias e o que fazer em cada momento do processo." />
      <section className="platform-section shell-width compact-section">
        <div className="fact-strip">{officialGuidance.publicFacts.slice(0, 4).map((fact) => <article key={fact.label}><small>{fact.label}</small><strong>{fact.value}</strong><p>{fact.detail}</p></article>)}</div>
      </section>
      <section className="platform-section shell-width">
        <div className="platform-section-head"><div><p className="eyebrow">PRIMEIRA HABILITAÇÃO</p><h2>Do início até a CNH.</h2></div><p>Informações do Detran-SP consultadas em {officialGuidance.checkedAt.split('-').reverse().join('/')}.</p></div>
        <div className="official-timeline">{officialGuidance.firstLicense.steps.map((step, index) => <article key={step}><span>{String(index + 1).padStart(2, '0')}</span><p>{step}</p></article>)}</div>
      </section>
      <section className="platform-section shell-width" id="categorias">
        <div className="platform-section-head"><div><p className="eyebrow">CATEGORIAS</p><h2>Qual categoria você procura?</h2></div><p>Entenda para que serve cada categoria e em quais situações ela pode ser solicitada.</p></div>
        <div className="category-grid"><CategoryCard code="A" title="Moto" copy="Para conduzir motocicletas, na primeira habilitação ou por adição." /><CategoryCard code="B" title="Carro" copy="Para automóveis, na primeira habilitação ou por adição." /><CategoryCard code="D" title="Passageiros" copy="Para determinados veículos de passageiros e com requisitos próprios." /></div>
        <div className="inline-tool-cta"><div><small>DESCUBRA EM 1 MINUTO</small><strong>Não sabe qual é seu próximo passo?</strong><p>Responda três perguntas e veja por onde continuar. Sem cadastro.</p></div><Link className="primary-action" to="/ferramentas/minha-jornada">Descobrir agora <span>→</span></Link></div>
      </section>
      <SchoolHelp />
    </>
  );
}

function CategoryCard({ code, title, copy }: { code: string; title: string; copy: string }) {
  return <article className="category-card"><strong>{code}</strong><div><h3>{title}</h3><p>{copy}</p></div></article>;
}

function TrafficHub() {
  return (
    <>
      <PageIntro kicker="TRÂNSITO · DADOS PÚBLICOS" title="Números para entender melhor o trânsito." copy="Consulte dados oficiais sobre exames, frota, infrações e mobilidade. Sempre com a origem e a data da informação." />
      <section className="platform-section shell-width compact-section">
        <div className="source-grid">{platformSources.filter((source) => source.id.startsWith('detran-') && source.id !== 'detran-guidance').map((source) => <SourceCard source={source} key={source.id} />)}</div>
      </section>
      <section className="platform-section shell-width">
        <div className="platform-section-head"><div><p className="eyebrow">COMO CONFERIR</p><h2>Saiba de onde vêm os números.</h2></div><p>Em cada informação, mostramos o órgão responsável, o período e quando a fonte foi consultada. Assim você pode conferir os dados por conta própria.</p></div>
        <div className="data-contract"><code>Fonte</code><span>·</span><code>Período</code><span>·</span><code>Atualização</code><span>·</span><code>Informação</code></div>
      </section>
      <SchoolHelp compact />
    </>
  );
}

function SourceCard({ source }: { source: (typeof platformSources)[number] }) {
  return <a className="source-card" href={source.url} target="_blank" rel="noreferrer"><div><span className={`source-state ${source.status}`}>{source.status === 'official' ? 'FONTE OFICIAL' : 'DADOS PÚBLICOS'}</span><small>{source.authority}</small></div><h3>{source.title}</h3><p>{source.scope}</p><footer><span>{source.freshness}</span><i>↗</i></footer></a>;
}

function GuidesHub() {
  return (
    <>
      <PageIntro kicker="GUIAS" title="Trânsito explicado sem complicação." copy="Respostas curtas para dúvidas comuns de quem está tirando CNH, mudando de categoria ou voltando a dirigir." />
      <section className="platform-section shell-width compact-section"><div className="guide-grid guide-grid--wide">{guideCards.map((guide) => <Link className="guide-card" to={guide.href} key={guide.title}><span>GUIA</span><h3>{guide.title}</h3><p>{guide.copy}</p><i>→</i></Link>)}</div></section>
      <section className="platform-section shell-width" id="categoria-d"><div className="guide-detail"><p className="eyebrow">CATEGORIA D</p><h2>Categoria D tem requisitos próprios.</h2><p>Ela depende do histórico do condutor e não funciona como uma primeira habilitação comum. A Auto Escola Centro trabalha com categoria D; antes de começar, confira se você atende aos requisitos exigidos pelos órgãos de trânsito.</p></div></section>
      <section className="platform-section shell-width" id="habilitados"><div className="guide-detail"><p className="eyebrow">HABILITADOS</p><h2>Ter CNH não significa se sentir seguro ao volante.</h2><p>Se você já é habilitado, mas evita dirigir ou se sente inseguro em algumas situações, aulas de treinamento podem ajudar a recuperar prática e confiança.</p></div></section>
      <section className="platform-section shell-width" id="exame-pratico"><div className="guide-detail"><p className="eyebrow">EXAME PRÁTICO</p><h2>Taxa, agendamento e preparação são coisas diferentes.</h2><p>Confira o que é cobrado pelo órgão de trânsito, como funciona o agendamento e quais serviços você pode contratar à parte para se preparar melhor.</p></div></section>
    </>
  );
}

function ToolsHub() {
  return (
    <>
      <PageIntro kicker="FERRAMENTAS" title="Respostas rápidas para dúvidas comuns." copy="Use as ferramentas do Centro para entender sua CNH, organizar custos e saber quais documentos procurar." />
      <section className="platform-section shell-width compact-section">
        <div className="tool-grid">
          <Link className="tool-card tool-card--active" to="/ferramentas/minha-jornada"><span>USE AGORA</span><h3>Meu próximo passo</h3><p>Informe o que você quer fazer, sua categoria e em que etapa está. Suas respostas ficam apenas neste aparelho.</p><i>Começar →</i></Link>
          <article className="tool-card"><span>EM BREVE</span><h3>Custos da CNH</h3><p>Veja as taxas oficiais separadas de aulas e outros serviços.</p></article>
          <article className="tool-card"><span>EM BREVE</span><h3>Documentos</h3><p>Veja o que você precisa separar para cada etapa do processo.</p></article>
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
  const whatsappUrl = buildWhatsappUrl(business.whatsappUrl, action.premiumJourney);

  return (
    <>
      <PageIntro kicker="SEM CADASTRO" title="Descubra seu próximo passo." copy="Responda três perguntas e veja o que faz sentido fazer agora." />
      <section className="platform-section shell-width compact-section">
        <div className="journey-tool">
          <div className="journey-form">
            <ToolQuestion label="1 · O que você quer fazer?"><div className="choice-row">{(['first-license','addition','licensed'] as PublicGoal[]).map((goal) => <button className={journey.goal === goal ? 'is-selected' : ''} type="button" key={goal} onClick={() => setJourney({ ...journey, goal })}>{goalLabels[goal]}</button>)}</div></ToolQuestion>
            <ToolQuestion label="2 · Qual categoria?"><div className="choice-row choice-row--small">{(['A','B','D'] as Category[]).map((category) => <button className={journey.category === category ? 'is-selected' : ''} type="button" key={category} onClick={() => setJourney({ ...journey, category })}>{category}</button>)}</div></ToolQuestion>
            <ToolQuestion label="3 · Em que ponto você está?"><div className="choice-column">{(Object.keys(stageLabels) as PublicStage[]).map((stage) => <button className={journey.stage === stage ? 'is-selected' : ''} type="button" key={stage} onClick={() => setJourney({ ...journey, stage })}>{stageLabels[stage]}</button>)}</div></ToolQuestion>
            <button className="reset-tool" type="button" onClick={() => setJourney(defaultJourney)}>Limpar respostas</button>
          </div>
          <aside className="journey-result" aria-live="polite">
            <p className="recommendation-kicker">SEU PRÓXIMO PASSO</p>
            <div className="journey-badges"><span>{goalLabels[journey.goal]}</span><span>Categoria {journey.category}</span></div>
            <h2>{action.title}</h2><p>{action.copy}</p>
            <div className="result-actions"><Link className="primary-action" to="/cnh">Ver detalhes <span>→</span></Link><a className="premium-text-link" href={whatsappUrl} target="_blank" rel="noreferrer">Falar com a Auto Escola Centro ↗</a></div>
            <small>Suas respostas ficam neste aparelho e não alteram seu cadastro no Detran.</small>
          </aside>
        </div>
      </section>
    </>
  );
}

function ToolQuestion({ label, children }: { label: string; children: ReactNode }) {
  return <fieldset className="tool-question"><legend>{label}</legend>{children}</fieldset>;
}

function SjcHub() {
  return (
    <>
      <PageIntro kicker="SÃO JOSÉ DOS CAMPOS" title="O trânsito da cidade, mais fácil de acompanhar." copy="Informações de mobilidade e trânsito de São José dos Campos reunidas a partir de órgãos públicos." />
      <section className="platform-section shell-width compact-section"><div className="city-fact-grid city-fact-grid--page">{cityFacts.map((fact) => <article className="city-fact-card" key={fact.label}><strong>{fact.value}</strong><span>{fact.label}</span><p>{fact.detail}</p></article>)}</div></section>
      <section className="platform-section shell-width"><div className="platform-section-head"><div><p className="eyebrow">ONDE CONSULTAMOS</p><h2>Fontes da cidade.</h2></div><p>Você pode abrir cada fonte e conferir a informação diretamente no site responsável.</p></div><div className="source-grid">{platformSources.filter((source) => source.id.startsWith('sjc-')).map((source) => <SourceCard source={source} key={source.id} />)}</div></section>
      <section className="platform-section shell-width"><div className="local-context-card"><div><p className="eyebrow">EM BREVE</p><h2>Mais dados sobre São José dos Campos.</h2><p>Estamos preparando informações locais sobre exames de direção, frota e infrações para facilitar a consulta por quem vive na cidade.</p></div><Link className="primary-action" to="/transito">Ver dados disponíveis <span>→</span></Link></div></section>
      <SchoolHelp />
    </>
  );
}

function SchoolPage() {
  const verifiedServices = commercialProfile.services.value as readonly string[];
  return (
    <>
      <PageIntro kicker="AUTO ESCOLA CENTRO" title="Aulas e atendimento em São José dos Campos." copy="Para quem quer tirar a primeira CNH, adicionar categoria ou voltar a dirigir com mais confiança." />
      <section className="platform-section shell-width compact-section">
        <div className="provider-profile">
          <div className="provider-identity"><span className="provider-badge">CENTRO · SÃO JOSÉ DOS CAMPOS</span><h2>{business.name}</h2><p>{businessAddress}</p><strong>{business.phoneDisplay}</strong><div className="provider-categories"><span>A</span><span>B</span><span>D</span></div></div>
          <div className="provider-services"><p className="eyebrow">SERVIÇOS</p>{verifiedServices.map((service) => <div key={service}><span>✓</span><strong>{service}</strong></div>)}<a className="primary-action" href={business.whatsappUrl} target="_blank" rel="noreferrer">Falar no WhatsApp <span>↗</span></a></div>
        </div>
      </section>
      <section className="platform-section shell-width"><div className="platform-section-head"><div><p className="eyebrow">ANTES DE IR</p><h2>Consulte as condições atuais.</h2></div><p>Algumas informações podem mudar com frequência. Confirme diretamente com a Auto Escola Centro antes de se deslocar.</p></div><div className="unknown-grid">{Object.entries(commercialProfile).filter(([key, field]) => key !== 'services' && field.state === 'unknown').map(([key, field]) => <article key={key}><span>CONSULTAR</span><strong>{humanizeCommercialKey(key)}</strong><p>{field.note}</p></article>)}</div></section>
    </>
  );
}

function humanizeCommercialKey(key: string) {
  const labels: Record<string, string> = { pricing: 'Preços', fleet: 'Frota', openingHours: 'Horários', lessonAvailability: 'Disponibilidade de aulas', paymentMethods: 'Formas de pagamento' };
  return labels[key] ?? key;
}

function SchoolHelp({ compact = false }: { compact?: boolean }) {
  return <section className={`premium-boundary shell-width ${compact ? 'is-compact' : ''}`}><div><p className="eyebrow">AUTO ESCOLA CENTRO</p><h2>Quer ajuda para aprender ou voltar a dirigir?</h2><p>A Auto Escola Centro atende categorias A, B e D em São José dos Campos, além de treinamento para motoristas habilitados.</p></div><Link className="premium-action" to="/auto-escola-centro"><span>Ver atendimento</span><i>↗</i></Link></section>;
}

function NotFound() {
  return <section className="page-intro shell-width not-found"><p className="eyebrow">404</p><h1>Essa página não existe.</h1><p>Volte para o início do Centro.</p><Link className="primary-action" to="/">Ir para o início <span>→</span></Link></section>;
}

export default function App() {
  return <Shell />;
}
