import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { business } from './business';
import { buildWhatsappUrl } from './commercial';
import {
  featuredGuide,
  guideBySlug,
  guideCategories,
  guides,
  guidesInCategory,
  relatedGuides,
  type Guide,
} from './guides';
import './guides.css';

function GuidesHeader() {
  return (
    <header className="platform-topbar shell-width">
      <Link className="platform-brand" to="/" aria-label="Centro — trânsito e CNH em São José dos Campos">
        <span className="brand-mark" aria-hidden="true"><span /></span>
        <span className="brand-copy"><strong>CENTRO</strong><small>Trânsito e CNH em São José dos Campos</small></span>
      </Link>
      <nav className="platform-nav" aria-label="Navegação principal">
        <NavLink to="/cnh">CNH</NavLink>
        <NavLink to="/transito">Trânsito</NavLink>
        <NavLink to="/guias">Guias</NavLink>
        <NavLink to="/ferramentas">Ferramentas</NavLink>
        <NavLink to="/sao-jose-dos-campos">São José</NavLink>
      </nav>
      <Link className="student-access-link" to="/auto-escola-centro">Auto Escola Centro <span aria-hidden="true">↗</span></Link>
    </header>
  );
}

function GuidesFooter() {
  return (
    <footer className="platform-footer shell-width">
      <div><strong>CENTRO</strong><p>CNH, trânsito, mobilidade e orientação para São José dos Campos.</p></div>
      <div className="footer-links"><Link to="/cnh">CNH</Link><Link to="/transito">Trânsito</Link><Link to="/ferramentas">Ferramentas</Link><Link to="/auto-escola-centro">Auto Escola Centro</Link></div>
      <small>São José dos Campos · SP</small>
    </footer>
  );
}

function GuideCard({ guide, compact = false }: { guide: Guide; compact?: boolean }) {
  return (
    <Link className={`education-card ${compact ? 'education-card--compact' : ''}`} to={`/guias/${guide.slug}`}>
      <div className="education-card-meta"><span>{guide.category}</span><small>{guide.readTime}</small></div>
      <h3>{guide.title}</h3>
      <p>{guide.description}</p>
      <strong>Ler guia <span aria-hidden="true">→</span></strong>
    </Link>
  );
}

function GuidesIndex() {
  const [query, setQuery] = useState('');
  const normalized = query.trim().toLocaleLowerCase('pt-BR');
  const matches = useMemo(() => {
    if (!normalized) return [];
    return guides.filter((guide) => {
      const haystack = [guide.title, guide.description, guide.summary, guide.category, ...guide.keywords]
        .join(' ')
        .toLocaleLowerCase('pt-BR');
      return haystack.includes(normalized);
    });
  }, [normalized]);

  useEffect(() => { document.title = 'Guias — Centro'; }, []);

  return (
    <>
      <section className="guides-hero shell-width">
        <p className="eyebrow">GUIAS · EDUCAÇÃO</p>
        <h1>Entenda antes<br />de decidir.</h1>
        <p className="guides-hero-lead">CNH sem linguagem de balcão. O Centro explica o processo, mostra o que você pode resolver sozinho e aponta a fonte oficial quando é hora de agir.</p>
        <label className="guide-search">
          <span>O que você quer entender?</span>
          <div><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ex.: prova prática, categoria D, toxicológico…" /><span aria-hidden="true">⌕</span></div>
        </label>
      </section>

      {normalized ? (
        <section className="guides-results shell-width" aria-live="polite">
          <div className="guides-section-heading"><div><p className="eyebrow">RESULTADOS</p><h2>{matches.length ? `${matches.length} guia${matches.length === 1 ? '' : 's'} encontrado${matches.length === 1 ? '' : 's'}` : 'Nenhum guia encontrado'}</h2></div><button type="button" onClick={() => setQuery('')}>Limpar busca</button></div>
          {matches.length ? <div className="education-grid">{matches.map((guide) => <GuideCard guide={guide} key={guide.slug} />)}</div> : <p className="guide-empty">Tente uma palavra mais ampla, como “prova”, “categoria”, “app” ou “dirigir”.</p>}
        </section>
      ) : (
        <>
          <section className="guide-feature shell-width">
            <div className="guide-feature-copy"><p className="eyebrow">COMECE POR AQUI</p><h2>{featuredGuide.title}</h2><p>{featuredGuide.description}</p><Link className="primary-action" to={`/guias/${featuredGuide.slug}`}>Ler guia completo <span>→</span></Link></div>
            <div className="guide-feature-path" aria-label="Etapas resumidas da primeira habilitação"><span>01 · App e requerimento</span><span>02 · RENACH e biometria</span><span>03 · Avaliações</span><span>04 · Teoria</span><span>05 · Prática</span><span>06 · Exame</span><span>07 · CNH</span></div>
          </section>

          {guideCategories.map((category) => {
            const categoryGuides = guidesInCategory(category);
            return (
              <section className="guides-category shell-width" key={category}>
                <div className="guides-section-heading"><div><p className="eyebrow">{category.toUpperCase()}</p><h2>{category}</h2></div><p>{categoryDescription(category)}</p></div>
                <div className="education-grid">{categoryGuides.map((guide) => <GuideCard guide={guide} key={guide.slug} />)}</div>
              </section>
            );
          })}
        </>
      )}

      <section className="guide-resolver-bridge shell-width">
        <div><p className="eyebrow">JÁ ENTENDEU?</p><h2>Agora resolva sua próxima etapa.</h2><p>Os guias explicam. A área de CNH usa o que você já sabe para mostrar a próxima ação do processo.</p></div>
        <Link className="primary-action" to="/cnh">Ir para minha CNH <span>→</span></Link>
      </section>
    </>
  );
}

function categoryDescription(category: Guide['category']) {
  switch (category) {
    case 'Começando a CNH': return 'Do primeiro acesso até os custos e avaliações que aparecem antes das provas.';
    case 'Provas e preparação': return 'Teoria, prática e exame explicados sem transformar requisito mínimo em recomendação pessoal.';
    case 'Categorias': return 'Entenda para que serve cada categoria e quando seu histórico de habilitação começa a importar.';
    case 'Depois da CNH': return 'Documento digital, retomada de prática e situações de quem já é habilitado.';
  }
}

function GuideArticle() {
  const { slug } = useParams();
  const guide = slug ? guideBySlug.get(slug) : undefined;

  useEffect(() => {
    document.title = guide ? `${guide.title} — Centro` : 'Guia não encontrado — Centro';
  }, [guide]);

  if (!guide) {
    return <section className="guide-not-found shell-width"><p className="eyebrow">GUIAS</p><h1>Esse guia não existe.</h1><p>Volte para a biblioteca e escolha outro assunto.</p><Link className="primary-action" to="/guias">Ver todos os guias <span>→</span></Link></section>;
  }

  const related = relatedGuides(guide.related);
  const assistanceUrl = guide.assistance ? buildWhatsappUrl(business.whatsappUrl, guide.assistance.journey) : null;

  return (
    <article className="guide-article shell-width">
      <nav className="guide-breadcrumb" aria-label="Caminho"><Link to="/guias">Guias</Link><span>›</span><span>{guide.category}</span></nav>
      <header className="guide-article-header">
        <p className="eyebrow">{guide.category}</p>
        <h1>{guide.title}</h1>
        <p>{guide.description}</p>
        <div className="guide-article-meta"><span>{guide.readTime} de leitura</span><span>Revisado em {formatDate(guide.checkedAt)}</span></div>
      </header>

      <div className="guide-article-layout">
        <main className="guide-article-body">
          <aside className="guide-summary"><strong>Em resumo</strong><p>{guide.summary}</p></aside>
          {guide.sections.map((section) => (
            <section className="guide-content-section" key={section.title}>
              <h2>{section.title}</h2>
              {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              {section.bullets?.length ? <ul>{section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul> : null}
              {section.note ? <div className="guide-note">{section.note}</div> : null}
            </section>
          ))}

          {guide.officialLinks.length ? (
            <section className="guide-official-links">
              <p className="eyebrow">FAÇA NO CANAL OFICIAL</p>
              <h2>Links para continuar sozinho</h2>
              <div>{guide.officialLinks.map((link) => <a href={link.href} target="_blank" rel="noreferrer" key={link.href}><span><small>{link.authority}</small><strong>{link.label}</strong></span><i>↗</i></a>)}</div>
            </section>
          ) : null}

          {guide.assistance && assistanceUrl ? (
            <section className="guide-assistance">
              <div><p className="eyebrow">SE PREFERIR AJUDA</p><h2>{guide.assistance.title}</h2><p>{guide.assistance.copy}</p></div>
              <a href={assistanceUrl} target="_blank" rel="noreferrer">Falar com a Auto Escola Centro <span>↗</span></a>
            </section>
          ) : null}
        </main>

        <aside className="guide-article-side">
          <div className="guide-side-box"><span>Este guia explica</span>{guide.sections.map((section) => <a href={`#${sectionId(section.title)}`} key={section.title} onClick={(event) => scrollToSection(event, section.title)}>{section.title}</a>)}</div>
          <div className="guide-side-box guide-side-box--source"><span>Critério editorial</span><p>Informação pública primeiro. Serviços privados aparecem separados e apenas quando podem ajudar.</p></div>
        </aside>
      </div>

      {related.length ? (
        <section className="guide-related">
          <div className="guides-section-heading"><div><p className="eyebrow">CONTINUE LENDO</p><h2>Guias relacionados</h2></div></div>
          <div className="education-grid education-grid--related">{related.map((item) => <GuideCard guide={item} compact key={item.slug} />)}</div>
        </section>
      ) : null}

      <section className="guide-resolver-bridge guide-resolver-bridge--article">
        <div><p className="eyebrow">QUER AGIR AGORA?</p><h2>Veja sua próxima etapa na CNH.</h2><p>O Centro usa a área de CNH para transformar informação em próxima ação.</p></div>
        <Link className="primary-action" to="/cnh">Continuar minha CNH <span>→</span></Link>
      </section>
    </article>
  );
}

function sectionId(title: string) {
  return title.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function scrollToSection(event: React.MouseEvent<HTMLAnchorElement>, title: string) {
  event.preventDefault();
  const headings = Array.from(document.querySelectorAll<HTMLElement>('.guide-content-section h2'));
  const target = headings.find((heading) => heading.textContent === title);
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function formatDate(value: string) {
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

export default function GuidesApp() {
  const location = useLocation();
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [location.pathname]);

  return (
    <main className="platform-shell guides-shell">
      <GuidesHeader />
      <Routes>
        <Route path="/guias" element={<GuidesIndex />} />
        <Route path="/guias/:slug" element={<GuideArticle />} />
      </Routes>
      <GuidesFooter />
    </main>
  );
}
