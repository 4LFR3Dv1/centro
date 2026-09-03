import { useMemo, useState } from 'react';
import { business, businessAddress } from './business';
import { buildWhatsappUrl, commercialProfile, type JourneyId } from './commercial';
import { officialGuidance } from './official-guidance';

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
    next: 'Entender por onde começar',
    recommendation: 'Veja o fluxo oficial atual e confirme com a Auto Escola Centro as condições para categorias A e B.',
  },
  {
    id: 'in-process',
    label: 'Já iniciei minha CNH',
    detail: 'Já concluí algumas etapas e preciso saber o que vem agora.',
    next: 'Identificar sua próxima etapa',
    recommendation: 'Partimos do ponto em que você está para evitar repetir etapas ou pedir informações que não servem mais para você.',
  },
  {
    id: 'theory-done',
    label: 'Já passei na prova teórica',
    detail: 'Estou pronto para organizar as aulas práticas.',
    next: 'Consultar prática e disponibilidade',
    recommendation: 'Após aprovação teórica e emissão da LADV, você pode iniciar a prática. Confirme condições e disponibilidade com a Auto Escola Centro.',
  },
  {
    id: 'practical-only',
    label: 'Quero mais aulas práticas',
    detail: 'Preciso treinar, ganhar confiança ou me preparar melhor.',
    next: 'Consultar treinamento prático',
    recommendation: 'Explique seu objetivo no WhatsApp para receber uma resposta já contextualizada sobre o atendimento disponível hoje.',
  },
  {
    id: 'addition',
    label: 'Quero adicionar categoria',
    detail: 'Já sou habilitado e quero ampliar minha CNH.',
    next: 'Escolher entre A, B ou D',
    recommendation: 'A Auto Escola Centro trabalha com categorias A, B e D. Informe sua categoria atual e a desejada para receber orientação objetiva.',
  },
  {
    id: 'licensed',
    label: 'Já tenho CNH, mas quero confiança',
    detail: 'Tenho habilitação, porém quero voltar a dirigir com mais segurança.',
    next: 'Consultar treinamento para habilitados',
    recommendation: 'Conte sua situação e objetivo antes da conversa começar para reduzir idas e vindas no atendimento.',
  },
];

const serviceIntents: Array<{
  code: string;
  title: string;
  copy: string;
  tag: string;
  journey: JourneyId;
}> = [
  {
    code: 'A',
    title: 'Categoria A',
    copy: 'Primeira habilitação ou adição de categoria para moto, conforme sua situação atual.',
    tag: 'Moto',
    journey: 'not-started',
  },
  {
    code: 'B',
    title: 'Categoria B',
    copy: 'Primeira habilitação ou adição de categoria para carro, com atendimento contextual ao seu processo.',
    tag: 'Carro',
    journey: 'theory-done',
  },
  {
    code: 'D',
    title: 'Categoria D',
    copy: 'Atendimento para condutores que buscam categoria D e precisam confirmar os requisitos e condições atuais.',
    tag: 'Ônibus',
    journey: 'addition',
  },
];

const stages = ['Início', 'Teoria', 'Prática', 'Exame', 'CNH'];

const commercialUnknowns = [
  ['Preços', commercialProfile.pricing],
  ['Frota', commercialProfile.fleet],
  ['Horários', commercialProfile.openingHours],
  ['Disponibilidade', commercialProfile.lessonAvailability],
  ['Pagamento', commercialProfile.paymentMethods],
] as const;

export default function App() {
  const [journey, setJourney] = useState<JourneyId>('theory-done');
  const selected = useMemo(
    () => journeyOptions.find((option) => option.id === journey) ?? journeyOptions[0],
    [journey],
  );

  const configuredWhatsapp = import.meta.env.VITE_WHATSAPP_URL as string | undefined;
  const whatsappBase = configuredWhatsapp || business.whatsappUrl;
  const contactHref = buildWhatsappUrl(whatsappBase, journey);

  return (
    <main className="site-shell">
      <header className="topbar shell-width">
        <a className="brand" href="#top" aria-label={`${business.name} — início`}>
          <span className="brand-mark" aria-hidden="true"><span /></span>
          <span className="brand-copy">
            <strong>CENTRO</strong>
            <small>Auto Escola · São José dos Campos</small>
          </span>
        </a>

        <nav className="desktop-nav" aria-label="Navegação principal">
          <a href="#caminho">Seu caminho</a>
          <a href="#categorias">Categorias</a>
          <a href="#guia">CNH atual</a>
          <a href="#cidade">Localização</a>
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
            <em>sem começar do zero.</em>
          </h1>
          <p className="hero-lead">
            Diga em que ponto você está. O site separa regra oficial do Detran-SP das condições comerciais da Auto Escola Centro e prepara seu atendimento com contexto.
          </p>
          <div className="hero-actions">
            <a className="primary-action" href="#caminho">
              Descobrir meu próximo passo <span aria-hidden="true">→</span>
            </a>
            <a className="text-action" href="#guia">Ver processo atual</a>
          </div>
        </div>

        <aside className="hero-system" aria-label="Resumo da jornada de habilitação">
          <div className="system-head">
            <span className="status-dot" />
            <span>Processo atual de habilitação</span>
            <small>Detran-SP / 2026</small>
          </div>
          <div className="route-stack" aria-label="Etapas da jornada">
            {stages.map((stage, index) => (
              <div className={`route-step ${index < 2 ? 'is-complete' : index === 2 ? 'is-active' : ''}`} key={stage}>
                <span className="route-mark">{index < 2 ? '✓' : index + 1}</span>
                <div>
                  <strong>{stage}</strong>
                  <small>{index === 2 ? 'Treino + LADV' : index < 2 ? 'Etapa anterior' : 'Depois'}</small>
                </div>
              </div>
            ))}
          </div>
          <div className="system-note">
            <span>REGRA ≠ OFERTA</span>
            <p>Taxas e requisitos públicos vêm do Detran-SP. Preço, frota, horário e agenda vêm da operação da Auto Escola Centro.</p>
          </div>
        </aside>
      </section>

      <section className="journey-section shell-width" id="caminho">
        <div className="section-heading">
          <div>
            <p className="eyebrow">01 · SEU ESTADO</p>
            <h2>O que você precisa agora?</h2>
          </div>
          <p>Escolha sua situação real. A recomendação e a mensagem enviada ao WhatsApp mudam junto com você.</p>
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
                  <span className="option-radio" aria-hidden="true"><span /></span>
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
                <small>WhatsApp</small>
                <strong>Mensagem contextual</strong>
              </span>
            </div>
            <a className="primary-action primary-action--full" href={contactHref} target="_blank" rel="noreferrer">
              Continuar no WhatsApp <span aria-hidden="true">→</span>
            </a>
          </aside>
        </div>
      </section>

      <section className="training-section shell-width" id="categorias">
        <div className="section-heading section-heading--compact">
          <div>
            <p className="eyebrow">02 · CATEGORIAS CONFIRMADAS</p>
            <h2>A, B e D. Sem catálogo inventado.</h2>
          </div>
          <p>A Auto Escola Centro trabalha com categorias A, B e D. Preços e condições permanecem sob consulta até serem reconciliados com a operação.</p>
        </div>

        <div className="package-grid">
          {serviceIntents.map((item) => (
            <article className="package-card" key={item.code}>
              <div className="package-topline">
                <span>{item.tag}</span>
                <small>VERIFICADO</small>
              </div>
              <strong className="package-hours">{item.code}</strong>
              <h3>{item.title}</h3>
              <p>{item.copy}</p>
              <div className="package-footer">
                <span>Condições atuais sob consulta</span>
                <button
                  className="inline-link"
                  type="button"
                  onClick={() => setJourney(item.journey)}
                >
                  Preparar atendimento →
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="guidance-section shell-width" id="guia">
        <div className="section-heading">
          <div>
            <p className="eyebrow">03 · ORIENTAÇÃO OFICIAL</p>
            <h2>O que é regra pública fica separado do que a escola vende.</h2>
          </div>
          <p>Snapshot conferido em {officialGuidance.checkedAt.split('-').reverse().join('/')} com base no Detran-SP. Use como orientação geral; o portal oficial continua sendo a fonte normativa.</p>
        </div>

        <div className="guidance-grid">
          <article className="guidance-flow">
            <span className="knowledge-badge knowledge-badge--verified">DET​​RAN-SP · VERIFICADO</span>
            <h3>{officialGuidance.firstLicense.title}</h3>
            <p>{officialGuidance.firstLicense.summary}</p>
            <ol>
              {officialGuidance.firstLicense.steps.map((step) => <li key={step}>{step}</li>)}
            </ol>
            <a href={officialGuidance.sourceUrl} target="_blank" rel="noreferrer">Abrir fonte oficial ↗</a>
          </article>

          <div className="fact-grid">
            {officialGuidance.publicFacts.map((fact) => (
              <article className="fact-card" key={fact.label}>
                <span>{fact.label}</span>
                <strong>{fact.value}</strong>
                <small>{fact.detail}</small>
              </article>
            ))}
          </div>
        </div>

        <div className="official-alerts">
          {officialGuidance.alerts.map((alert) => <p key={alert}>{alert}</p>)}
        </div>
      </section>

      <section className="commercial-section shell-width" id="atendimento">
        <div className="commercial-card">
          <div className="commercial-copy">
            <p className="eyebrow">04 · CONDIÇÕES COMERCIAIS</p>
            <h2>O que ainda não sabemos não vira promessa.</h2>
            <p>Esses campos já existem no estado comercial, mas continuam `unknown` até a Auto Escola Centro confirmar a operação atual.</p>
          </div>
          <div className="commercial-state-list">
            {commercialUnknowns.map(([label, field]) => (
              <div className="commercial-state-row" key={label}>
                <span>{label}</span>
                <strong>Consultar</strong>
                <small>{field.note}</small>
              </div>
            ))}
          </div>
          <a className="primary-action" href={contactHref} target="_blank" rel="noreferrer">
            Perguntar com meu contexto <span aria-hidden="true">→</span>
          </a>
        </div>
      </section>

      <section className="city-section shell-width" id="cidade">
        <div className="city-copy">
          <p className="eyebrow">05 · SÃO JOSÉ DOS CAMPOS</p>
          <h2>Auto Escola Centro, no Centro.</h2>
          <p>{businessAddress}. O endereço e o telefone agora vêm de uma única fonte canônica no produto.</p>
          <div className="city-points">
            <span>Categoria A</span>
            <span>Categoria B</span>
            <span>Categoria D</span>
            <span>Primeira CNH</span>
            <span>Habilitados</span>
          </div>
        </div>

        <a className="city-visual" aria-label={`Abrir localização da ${business.name} no mapa`} href={business.mapsUrl} target="_blank" rel="noreferrer">
          <div className="city-grid" />
          <div className="route-line route-line--one" />
          <div className="route-line route-line--two" />
          <span className="map-node map-node--start"><i />Centro</span>
          <span className="map-node map-node--mid"><i />1.009</span>
          <span className="map-node map-node--end"><i />SJC</span>
          <div className="map-caption">
            <span>ENDEREÇO</span>
            <strong>Avenida São José, 1.009</strong>
          </div>
        </a>
      </section>

      <section className="contact-section shell-width" id="contato">
        <div>
          <p className="eyebrow">AUTO ESCOLA CENTRO</p>
          <h2>Chegue no atendimento já dizendo o que você precisa.</h2>
          <p>{businessAddress}</p>
        </div>
        <a className="contact-action" href={contactHref} target="_blank" rel="noreferrer">
          <span>{business.phoneDisplay}</span>
          <span aria-hidden="true">↗</span>
        </a>
      </section>

      <footer className="footer shell-width">
        <span>{business.name} · {business.city}</span>
        <span>CENTRO-R3A · COMMERCIAL FOUNDATION</span>
      </footer>
    </main>
  );
}
