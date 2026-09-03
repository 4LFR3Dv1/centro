import { useMemo, useState } from 'react';
import { business, businessAddress } from './business';

type JourneyId =
  | 'not-started'
  | 'in-process'
  | 'theory-done'
  | 'practical-only'
  | 'addition'
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
    label: 'Quero minha primeira CNH',
    detail: 'Ainda não comecei e quero entender o caminho.',
    next: 'Organizar sua primeira habilitação',
    recommendation: 'A Centro te orienta sobre o processo e ajuda a transformar a primeira CNH em um caminho claro.',
  },
  {
    id: 'in-process',
    label: 'Já iniciei minha CNH',
    detail: 'Já concluí algumas etapas e preciso saber o que vem agora.',
    next: 'Identificar sua próxima etapa',
    recommendation: 'Partimos do ponto em que você está para evitar informação e etapas que não servem mais para você.',
  },
  {
    id: 'theory-done',
    label: 'Já passei na prova teórica',
    detail: 'Estou pronto para organizar as aulas práticas.',
    next: 'Começar seu treino prático',
    recommendation: 'Organize sua prática com instrutores credenciados e treinamento no trânsito real de São José dos Campos.',
  },
  {
    id: 'practical-only',
    label: 'Quero mais aulas práticas',
    detail: 'Preciso ganhar confiança, treinar ou me preparar melhor.',
    next: 'Definir seu treino',
    recommendation: 'A Centro atende alunos em formação e também quem precisa reforçar habilidades específicas ao volante.',
  },
  {
    id: 'addition',
    label: 'Quero adicionar categoria',
    detail: 'Já sou habilitado e quero ampliar minha CNH.',
    next: 'Escolher a categoria desejada',
    recommendation: 'A Centro trabalha com adição de categorias A, B e D conforme a situação do condutor.',
  },
  {
    id: 'licensed',
    label: 'Já tenho CNH, mas quero confiança',
    detail: 'Tenho habilitação, porém sinto insegurança ou medo de dirigir.',
    next: 'Começar um treinamento para habilitados',
    recommendation: 'Treine no seu ritmo com profissionais acostumados a trabalhar insegurança, retomada e aperfeiçoamento.',
  },
];

const services = [
  {
    code: '01',
    title: 'Primeira habilitação',
    copy: 'Para quem vai conquistar a primeira CNH de carro, moto ou combinação das categorias permitidas.',
    tag: 'Começar',
  },
  {
    code: '02',
    title: 'Adição de categoria',
    copy: 'Para condutores habilitados que querem ampliar a categoria da carteira, incluindo A, B e D.',
    tag: 'Evoluir',
  },
  {
    code: '03',
    title: 'Treinamento para habilitados',
    copy: 'Aulas práticas para quem tem CNH, mas quer recuperar confiança, perder o medo ou aperfeiçoar a condução.',
    tag: 'Confiança',
  },
];

const stages = ['Entrada', 'Orientação', 'Treino', 'Exame', 'CNH'];

export default function App() {
  const [journey, setJourney] = useState<JourneyId>('theory-done');
  const selected = useMemo(
    () => journeyOptions.find((option) => option.id === journey) ?? journeyOptions[0],
    [journey],
  );

  const configuredWhatsapp = import.meta.env.VITE_WHATSAPP_URL as string | undefined;
  const contactHref = configuredWhatsapp || business.whatsappUrl;

  return (
    <main className="site-shell">
      <header className="topbar shell-width">
        <a className="brand" href="#top" aria-label={`${business.name} — início`}>
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          <span className="brand-copy">
            <strong>CENTRO</strong>
            <small>Auto Escola · São José dos Campos</small>
          </span>
        </a>

        <nav className="desktop-nav" aria-label="Navegação principal">
          <a href="#caminho">Seu caminho</a>
          <a href="#servicos">Serviços</a>
          <a href="#cidade">Onde estamos</a>
        </nav>

        <a className="quiet-action" href={contactHref} target="_blank" rel="noreferrer">
          WhatsApp <span aria-hidden="true">↗</span>
        </a>
      </header>

      <section className="hero shell-width" id="top">
        <div className="hero-copy">
          <p className="eyebrow">AUTO ESCOLA CENTRO · SÃO JOSÉ DOS CAMPOS</p>
          <h1>
            Sua CNH,
            <br />
            <em>com caminho claro.</em>
          </h1>
          <p className="hero-lead">
            {business.yearsLabel}, a Auto Escola Centro ajuda pessoas de São José dos Campos a conquistar a primeira habilitação, adicionar categoria e voltar a dirigir com confiança.
          </p>
          <div className="hero-actions">
            <a className="primary-action" href="#caminho">
              Descobrir meu próximo passo <span aria-hidden="true">→</span>
            </a>
            <a className="text-action" href={contactHref} target="_blank" rel="noreferrer">
              Falar no WhatsApp
            </a>
          </div>
        </div>

        <aside className="hero-system" aria-label="Resumo da jornada na Auto Escola Centro">
          <div className="system-head">
            <span className="status-dot" />
            <span>Seu caminho até dirigir</span>
            <small>Centro / SJC</small>
          </div>
          <div className="route-stack" aria-label="Etapas da jornada">
            {stages.map((stage, index) => (
              <div className={`route-step ${index < 2 ? 'is-complete' : index === 2 ? 'is-active' : ''}`} key={stage}>
                <span className="route-mark">{index < 2 ? '✓' : index + 1}</span>
                <div>
                  <strong>{stage}</strong>
                  <small>{index === 2 ? 'Próxima ação' : index < 2 ? 'Organizado' : 'Depois'}</small>
                </div>
              </div>
            ))}
          </div>
          <div className="system-note">
            <span>Centro</span>
            <p>Formação e treinamento prático com experiência no trânsito real da cidade.</p>
          </div>
        </aside>
      </section>

      <section className="journey-section shell-width" id="caminho">
        <div className="section-heading">
          <div>
            <p className="eyebrow">01 · SEU CAMINHO</p>
            <h2>O que você precisa agora?</h2>
          </div>
          <p>
            Em vez de jogar uma lista de serviços em você, a Centro começa pela sua situação e aponta a próxima ação.
          </p>
        </div>

        <div className="journey-surface">
          <div className="journey-options" role="list" aria-label="Situações possíveis da jornada">
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
                <small>Sua situação</small>
                <strong>{selected.label}</strong>
              </span>
              <span>
                <small>Atendimento</small>
                <strong>Com contexto</strong>
              </span>
            </div>
            <a className="primary-action primary-action--full" href={contactHref} target="_blank" rel="noreferrer">
              Conversar com a Centro <span aria-hidden="true">→</span>
            </a>
          </aside>
        </div>
      </section>

      <section className="training-section shell-width" id="servicos">
        <div className="section-heading section-heading--compact">
          <div>
            <p className="eyebrow">02 · SERVIÇOS</p>
            <h2>Da primeira CNH à confiança de dirigir sozinho.</h2>
          </div>
          <p>
            A oferta real da Centro organizada pelo objetivo do aluno — sem repetir dezenas de palavras-chave para explicar a mesma coisa.
          </p>
        </div>

        <div className="package-grid">
          {services.map((item, index) => (
            <article className={`package-card ${index === 0 ? 'is-featured' : ''}`} key={item.code}>
              <div className="package-topline">
                <span>{item.tag}</span>
                <small>{item.code}</small>
              </div>
              <strong className="package-hours">{item.code}</strong>
              <h3>{item.title}</h3>
              <p>{item.copy}</p>
              <div className="package-footer">
                <span>São José dos Campos</span>
                <a href={contactHref} target="_blank" rel="noreferrer">Consultar <span aria-hidden="true">↗</span></a>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="capacity-section shell-width">
        <div className="capacity-card">
          <div className="capacity-copy">
            <p className="eyebrow">03 · ATENDIMENTO</p>
            <h2>Fale direto com quem pode organizar seu próximo passo.</h2>
            <p>
              Valores, documentação, disponibilidade e detalhes da sua categoria são confirmados no atendimento da Centro.
            </p>
          </div>
          <div className="capacity-slots" aria-label="Canais de atendimento">
            <a href={contactHref} target="_blank" rel="noreferrer" className="capacity-slot">
              <span className="slot-index">01</span>
              <div>
                <strong>WhatsApp</strong>
                <small>{business.phoneDisplay}</small>
              </div>
              <span className="slot-arrow" aria-hidden="true">→</span>
            </a>
            <a href={`tel:${business.phoneE164}`} className="capacity-slot">
              <span className="slot-index">02</span>
              <div>
                <strong>Telefone</strong>
                <small>{business.phoneDisplay}</small>
              </div>
              <span className="slot-arrow" aria-hidden="true">→</span>
            </a>
            <a href={business.mapsUrl} target="_blank" rel="noreferrer" className="capacity-slot">
              <span className="slot-index">03</span>
              <div>
                <strong>Visitar</strong>
                <small>Avenida São José, 1.009 · Centro</small>
              </div>
              <span className="slot-arrow" aria-hidden="true">→</span>
            </a>
          </div>
        </div>
      </section>

      <section className="city-section shell-width" id="cidade">
        <div className="city-copy">
          <p className="eyebrow">04 · SÃO JOSÉ DOS CAMPOS</p>
          <h2>Aprenda no trânsito que você vai dirigir de verdade.</h2>
          <p>
            A Centro prepara seus alunos com prática no trânsito do dia a dia, trabalhando leitura de fluxo, conversões, estacionamento e tomada de decisão em ambiente urbano real.
          </p>
          <div className="city-points">
            <span>Primeira CNH</span>
            <span>Categoria A</span>
            <span>Categoria B</span>
            <span>Categoria D</span>
            <span>Habilitados</span>
          </div>
        </div>

        <a className="city-visual" aria-label={`Abrir localização da ${business.name} no mapa`} href={business.mapsUrl} target="_blank" rel="noreferrer">
          <div className="city-grid" />
          <div className="route-line route-line--one" />
          <div className="route-line route-line--two" />
          <span className="map-node map-node--start"><i />Centro</span>
          <span className="map-node map-node--mid"><i />Treino</span>
          <span className="map-node map-node--end"><i />Centro</span>
          <div className="map-caption">
            <span>ENDEREÇO</span>
            <strong>Avenida São José, 1.009</strong>
          </div>
        </a>
      </section>

      <section className="contact-section shell-width" id="contato">
        <div>
          <p className="eyebrow">AUTO ESCOLA CENTRO</p>
          <h2>Primeira CNH, nova categoria ou confiança para voltar a dirigir.</h2>
          <p>{businessAddress}</p>
        </div>
        <a className="contact-action" href={contactHref} target="_blank" rel="noreferrer">
          <span>{business.phoneDisplay}</span>
          <span aria-hidden="true">↗</span>
        </a>
      </section>

      <footer className="footer shell-width">
        <span>{business.name} · {business.city}</span>
        <span>{business.address.street} · {business.phoneDisplay}</span>
      </footer>
    </main>
  );
}
