export type PlatformSource = {
  id: string;
  authority: string;
  title: string;
  scope: string;
  freshness: string;
  checkedAt: string;
  url: string;
  status: 'official' | 'source-ready';
};

export const platformSources: PlatformSource[] = [
  {
    id: 'detran-guidance',
    authority: 'Detran-SP',
    title: 'CNH Paulista',
    scope: 'Regras e fluxo atual da habilitação em São Paulo',
    freshness: 'Consultado em 03/09/2026',
    checkedAt: '2026-09-03',
    url: 'https://detran.sp.gov.br/cnhpaulista/',
    status: 'official',
  },
  {
    id: 'detran-practical',
    authority: 'Dados Abertos SP · Detran-SP',
    title: 'Exames práticos realizados',
    scope: 'Quantitativos por município, categoria e resultado',
    freshness: 'Recursos disponíveis até julho de 2026',
    checkedAt: '2026-09-03',
    url: 'https://dadosabertos.sp.gov.br/dataset/exames-praticos-realizados',
    status: 'source-ready',
  },
  {
    id: 'detran-theory',
    authority: 'Dados Abertos SP · Detran-SP',
    title: 'Exames teóricos realizados',
    scope: 'Quantitativos por município e resultado',
    freshness: 'Recursos disponíveis até julho de 2026',
    checkedAt: '2026-09-03',
    url: 'https://dadosabertos.sp.gov.br/dataset/exames-teoricos-realizados',
    status: 'source-ready',
  },
  {
    id: 'detran-fleet',
    authority: 'Dados Abertos SP · Detran-SP',
    title: 'Frota ativa',
    scope: 'Frota por município, tipo, modelo e características',
    freshness: 'Recursos disponíveis até julho de 2026',
    checkedAt: '2026-09-03',
    url: 'https://dadosabertos.sp.gov.br/dataset/frota-ativa',
    status: 'source-ready',
  },
  {
    id: 'detran-infractions',
    authority: 'Dados Abertos SP · Detran-SP',
    title: 'Infrações lavradas',
    scope: 'Quantitativos por município e enquadramento',
    freshness: 'Recursos disponíveis até julho de 2026',
    checkedAt: '2026-09-03',
    url: 'https://dadosabertos.sp.gov.br/dataset/infracoes-lavradas',
    status: 'source-ready',
  },
  {
    id: 'sjc-monitoring',
    authority: 'Prefeitura de São José dos Campos',
    title: 'Monitoramento do trânsito',
    scope: 'Operação municipal de monitoramento e resposta viária',
    freshness: 'Página institucional consultada em 03/09/2026',
    checkedAt: '2026-09-03',
    url: 'https://sjc.sp.gov.br/servicos/mobilidade-urbana/monitoramento-do-transito/',
    status: 'official',
  },
  {
    id: 'sjc-mobility',
    authority: 'Prefeitura de São José dos Campos',
    title: 'Mobilidade urbana em São José',
    scope: 'Segurança viária, mobilidade sustentável e infraestrutura',
    freshness: 'Atualização municipal de 10/06/2026',
    checkedAt: '2026-09-03',
    url: 'https://www.sjc.sp.gov.br/noticias/2026/junho/10/comob-apresenta-avancos-da-mobilidade-urbana-em-sao-jose/',
    status: 'official',
  },
];

export const cityFacts = [
  {
    value: '24h',
    label: 'monitoramento de trânsito',
    detail: 'A Divisão de Controle Operacional informa monitoramento contínuo da cidade.',
    sourceId: 'sjc-monitoring',
  },
  {
    value: '~1.200',
    label: 'câmeras no sistema municipal',
    detail: 'A Prefeitura informa cerca de 1.200 câmeras utilizadas no monitoramento urbano.',
    sourceId: 'sjc-monitoring',
  },
  {
    value: '299,89 km',
    label: 'malha cicloviária',
    detail: 'Extensão apresentada pelo Conselho de Mobilidade Urbana em junho de 2026.',
    sourceId: 'sjc-mobility',
  },
];

export const guideCards = [
  { title: 'Primeira habilitação', copy: 'Entenda o fluxo atual, as etapas e o que depende de você.', href: '/cnh' },
  { title: 'Categoria A', copy: 'Moto: processo, prática e pontos que merecem atenção.', href: '/cnh#categorias' },
  { title: 'Categoria B', copy: 'Carro: organize a jornada sem misturar taxa pública com serviço privado.', href: '/cnh#categorias' },
  { title: 'Categoria D', copy: 'Entenda quando a categoria D entra na sua trajetória de habilitação.', href: '/guias#categoria-d' },
  { title: 'Medo de dirigir', copy: 'Como separar habilitação, prática e reconstrução de confiança.', href: '/guias#habilitados' },
  { title: 'Exame prático', copy: 'O que é etapa oficial, o que é preparação e o que mudou em 2026.', href: '/guias#exame-pratico' },
];
