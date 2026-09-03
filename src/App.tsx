import { useMemo, useState } from 'react';

type JourneyId =
  | 'not-started'
  | 'in-process'
  | 'theory-done'
  | 'practical-only'
  | 'retry'
  | 'licensed';

type JourneyOption = {
  id: JourneyId;
  label: string;
  detail: string;
  next: string;
  recommendation: string;
};

const journeyOptions: JourneyOption[] = [
  {
    id: 'not-started',
    label: 'Ainda não comecei',
    detail: 'Quero entender o processo antes de decidir.',
    next: 'Organizar sua primeira habilitação',
    recommendation: 'Comece pelo diagnóstico e receba uma rota simples até a sua CNH.',
  },
  {
    id: 'in-process',
    label: 'Já iniciei minha CNH',
    detail: 'Já tenho etapas concluídas, mas não sei o que vem agora.',
    next: 'Identificar a próxima etapa',
    recommendation: 'Mapeamos o que você já concluiu e mostramos somente o que ainda importa.',
  },
  {
    id: 'theory-done',
    label: 'Já passei na prova teórica',
    detail: 'Estou pronto para começar ou organizar a prática.',
    next: 'Escolher seu treino prático',
    recommendation: 'Monte seu treino por experiência, transmissão e disponibilidade.',
  },
  {
    id: 'practical-only',
    label: 'Quero somente aulas práticas',
    detail: 'Preciso treinar, ganhar confiança ou me preparar para o exame.',
    next: 'Escolher intensidade de treino',
    recommendation: 'Você pode partir de um treino essencial e aumentar conforme sua evolução.',
  },
  {
    id: 'retry',
    label: 'Reprovei e quero me preparar',
    detail: 'Quero atacar os pontos que me fizeram perder o exame.',
    next: 'Montar treino focado',
    recommendation: 'Use aulas direcionadas para corrigir manobras, leitura de trânsito e confiança.',
  },
  {
    id: 'licensed',
    label: 'Já tenho CNH',
    detail: 'Quero voltar a dirigir ou adicionar uma categoria.',
    next: 'Definir seu objetivo',
    recommendation: 'Criamos um treino de retomada ou direcionamos para a categoria desejada.',
  },
];

const packages = [
  {
    hours: '2h',
    title: 'Essencial',
    copy: 'Para quem já tem alguma base e quer uma primeira leitura prática.',
    tag: 'Entrada',
  },
  {
    hours: '6h',
    title: 'Confiança',
    copy: 'Mais repetição, trânsito urbano e espaço para corrigir inseguranças.',
    tag: 'Recomendado',
  },
  {
    hours: '10h',
    title: 'São Paulo',
    copy: 'Treino mais amplo para ganhar repertório em situações reais da cidade.',
    tag: 'Imersão',
  },
];

const stages = ['Cadastro', 'Teoria', 'Prática', 'Exame', 'CNH'];

export default function App() {
  const [journey, setJourney] = useState<JourneyId>('theory-done');
  const selected = useMemo(
    () => journeyOptions.find((option) => option.id === journey) ?? journeyOptions[0],
    [journey],
  );

  const configuredWhatsapp = import.meta.env.VITE_WHATSAPP_URL as string | undefined;
  const contactHref = configuredWhatsapp || '#contato';

  return (
    <main className="site-shell">
      <header className="topbar shell-width">
        <a className="brand" href="#top" aria-label="Auto Escola Centro — início">
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          <span className="brand-copy">
            <strong>CENTRO</strong>
            <small>Auto Escola · São Paulo</small>
          </span>
        </a>

        <nav className="desktop-nav" aria-label="Navegação principal">
          <a href="#caminho">Seu caminho</a>
          <a href="#treinos">Treinos</a>
          <a href="#cidade">Onde aprender</a>
        </nav>

        <a className="quiet-action" href={contactHref}>
          Falar com a Centro <span aria-hidden="true">↗</span>
        </a>
      </header>

      <section className="hero shell-width" id="top">
        <div className="hero-copy">
          <p className="eyebrow">AUTO ESCOLA CENTRO · SÃO PAULO</p>
          <h1>
            Sua CNH,
            <br />
            <em>sem enrolação.</em>
          </h1>
          <p className="hero-lead">
            Comece do zero ou continue exatamente de onde parou. Descubra seu próximo passo,
            escolha como quer treinar e chegue no atendimento já com contexto.
          </p>
          <div className="hero-actions">
            <a className="primary-action" href="#caminho">
              Descobrir meu próximo passo <span aria-hidden="true">→</span>
            </a>
            <a className="text-action" href="#treinos">
              Ver opções de treino
            </a>
          </div>
        </div>

        <aside className="hero-system" aria-label="Resumo do sistema Centro">
          <div className="system-head">
            <span className="status-dot" />
            <span>Seu caminho até dirigir</span>
            <small>Centro / R1</small>
          </div>
          <div className="route-stack" aria-label="Etapas da CNH">
            {stages.map((stage, index) => (
              <div className={`route-step ${index < 2 ? 'is-complete' : index === 2 ? 'is-active' : ''}`} key={stage}>
                <span className="route-mark">{index < 2 ? '✓' : index + 1}</span>
                <div>
                  <strong>{stage}</strong>
                  <small>{index === 2 ? 'Próxima ação' : index < 2 ? 'Concluído' : 'Depois'}</small>
                </div>
              </div>
            ))}
          </div>
          <div className="system-note">
            <span>Agora</span>
            <p>Organize suas aulas práticas sem precisar entender toda a burocracia antes.</p>
          </div>
        </aside>
      </section>

      <section className="journey-section shell-width" id="caminho">
        <div className="section-heading">
          <div>
            <p className="eyebrow">01 · SEU CAMINHO</p>
            <h2>Onde você está agora?</h2>
          </div>
          <p>
            O site começa pela sua situação real. Você não precisa escolher um “serviço” antes de
            entender o que falta.
          </p>
        </div>

        <div className="journey-surface">
          <div className="journey-options" role="list" aria-label="Etapas possíveis da jornada">
            {journeyOptions.map((option) => {
              const active = option.id === journey;
              return (
                <button
                  className={`journey-option ${active ? 'is-active' : ''}`}
                  key={option.id}
                  onClick={() => setJourney(option.id)}
                  type="button"
                  aria-pressed={active}
                >
                  <span className="option-radio" aria-hidden="true">
                    <span />
                  </span>
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.detail}</small>
                  </span>
                </button>
              );
            })}
          </div>

          <aside className="recommendation-card" aria-live="polite">
            <p className="recommendation-kicker">PRÓXIMO PASSO</p>
            <h3>{selected.next}</h3>
            <p>{selected.recommendation}</p>
            <div className="recommendation-meta">
              <span>
                <small>Estado informado</small>
                <strong>{selected.label}</strong>
              </span>
              <span>
                <small>Atendimento</small>
                <strong>Com contexto</strong>
              </span>
            </div>
            <a className="primary-action primary-action--full" href="#treinos">
              Continuar <span aria-hidden="true">→</span>
            </a>
          </aside>
        </div>
      </section>

      <section className="training-section shell-width" id="treinos">
        <div className="section-heading section-heading--compact">
          <div>
            <p className="eyebrow">02 · TREINO</p>
            <h2>Escolha a intensidade. Não um pacote confuso.</h2>
          </div>
          <p>
            As cargas abaixo estruturam a decisão. Valores, frota e disponibilidade entram quando
            forem conectados à operação real da Auto Escola Centro.
          </p>
        </div>

        <div className="package-grid">
          {packages.map((item, index) => (
            <article className={`package-card ${index === 1 ? 'is-featured' : ''}`} key={item.hours}>
              <div className="package-topline">
                <span>{item.tag}</span>
                <small>{String(index + 1).padStart(2, '0')}</small>
              </div>
              <strong className="package-hours">{item.hours}</strong>
              <h3>{item.title}</h3>
              <p>{item.copy}</p>
              <div className="package-footer">
                <span>Manual ou automático</span>
                <a href={contactHref}>Consultar <span aria-hidden="true">↗</span></a>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="capacity-section shell-width">
        <div className="capacity-card">
          <div className="capacity-copy">
            <p className="eyebrow">03 · CAPACIDADE</p>
            <h2>Encontre um horário que cabe na sua rotina.</h2>
            <p>
              A agenda real entra aqui. Até lá, a interface já separa disponibilidade por período e
              deixa claro que o próximo passo é reservar, não “pedir informações”.
            </p>
          </div>
          <div className="capacity-slots" aria-label="Períodos de aula">
            {['Manhã', 'Tarde', 'Noite'].map((period, index) => (
              <a href={contactHref} className="capacity-slot" key={period}>
                <span className="slot-index">0{index + 1}</span>
                <div>
                  <strong>{period}</strong>
                  <small>Consultar disponibilidade</small>
                </div>
                <span className="slot-arrow" aria-hidden="true">→</span>
              </a>
            ))}
          </div>
        </div>
      </section>

      <section className="city-section shell-width" id="cidade">
        <div className="city-copy">
          <p className="eyebrow">04 · SÃO PAULO</p>
          <h2>Aprenda a dirigir onde São Paulo acontece.</h2>
          <p>
            Centro, cruzamentos, conversões, fluxo real e decisões reais. O mapa vira parte do
            produto quando conectarmos localização, rotas e contexto urbano.
          </p>
          <div className="city-points">
            <span>Trânsito urbano</span>
            <span>Conversões</span>
            <span>Estacionamento</span>
            <span>Leitura de fluxo</span>
          </div>
        </div>

        <div className="city-visual" aria-label="Representação abstrata de uma rota no Centro de São Paulo">
          <div className="city-grid" />
          <div className="route-line route-line--one" />
          <div className="route-line route-line--two" />
          <span className="map-node map-node--start"><i />Centro</span>
          <span className="map-node map-node--mid"><i />Prática</span>
          <span className="map-node map-node--end"><i />Confiança</span>
          <div className="map-caption">
            <span>AMBIENTE DE TREINO</span>
            <strong>São Paulo · Centro</strong>
          </div>
        </div>
      </section>

      <section className="contact-section shell-width" id="contato">
        <div>
          <p className="eyebrow">PRONTO PARA COMEÇAR?</p>
          <h2>Chegue no atendimento já sabendo o que você precisa.</h2>
        </div>
        <a className="contact-action" href={contactHref}>
          <span>Falar com a Auto Escola Centro</span>
          <span aria-hidden="true">↗</span>
        </a>
      </section>

      <footer className="footer shell-width">
        <span>Auto Escola Centro · São Paulo</span>
        <span>CENTRO-R1 · PUBLIC SURFACE</span>
      </footer>
    </main>
  );
}
