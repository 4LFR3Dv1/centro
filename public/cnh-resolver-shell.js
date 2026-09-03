function simplifyCnhSurface() {
  if (location.pathname !== '/cnh') return;

  const resolverSection = document.querySelector('[data-centro-resolver-enhanced="true"]');
  if (!resolverSection) return;

  const intro = document.querySelector('.page-intro');
  if (intro && intro.dataset.cnhResolverCopy !== 'true') {
    intro.dataset.cnhResolverCopy = 'true';
    const title = intro.querySelector('h1');
    const copy = intro.querySelector(':scope > p:last-child');
    if (title) title.textContent = 'Resolva sua CNH, uma etapa por vez.';
    if (copy) copy.textContent = 'O Centro mostra o que você pode fazer sozinho agora e mantém a Auto Escola Centro como alternativa quando você quiser ou precisar de ajuda.';
  }

  const factSection = resolverSection.previousElementSibling;
  if (factSection?.classList.contains('compact-section') && factSection.querySelector('.fact-strip')) {
    factSection.hidden = true;
    factSection.setAttribute('aria-hidden', 'true');
  }

  const categories = document.getElementById('categorias');
  if (categories) {
    categories.hidden = true;
    categories.setAttribute('aria-hidden', 'true');
    const schoolHelp = categories.nextElementSibling;
    if (schoolHelp?.classList.contains('premium-boundary')) {
      schoolHelp.hidden = true;
      schoolHelp.setAttribute('aria-hidden', 'true');
    }
  }
}

new MutationObserver(simplifyCnhSurface).observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('popstate', simplifyCnhSurface);
simplifyCnhSurface();
