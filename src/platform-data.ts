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
    scope: 'Regras e etapas atuais da habilitação em São Paulo',
    freshness: 'Consultado em 03/09/2026',
    checkedAt: '2026-09-03',
    url: 'https://detran.sp.gov.br/cnhpaulista/',
    status: 'official',
  },
  {
    id: 'detran-practical',
    authority: 'Dados Abertos SP · Detran-SP',
    title: 'Exames práticos realizados',
    scope: 'Quantidade de exames por município, categoria e resultado',
    freshness: 'Dados disponíveis até julho de 2026',
    checkedAt: '2026-09-03',
    url: 'https://dadosabertos.sp.gov.br/dataset/exames-praticos-realizados',
    status: 'source-ready',
  },
  {
    id: 'detran-theory',
    authority: 'Dados Abertos SP · Detran-SP',
    title: 'Exames teóricos realizados',
    scope: 'Quantidade de exames por município e resultado',
    freshness: 'Dados disponíveis até julho de 2026',
    checkedAt: '2026-09-03',
    url: 'https://dadosabertos.sp.gov.br/dataset/exames-teoricos-realizados',
    status: 'source-ready',
  },
  {
    id: 'detran-fleet',
    authority: 'Dados Abertos SP · Detran-SP',
    title: 'Frota ativa',
    scope: 'Veículos por município, tipo, modelo e características',
    freshness: 'Dados disponíveis até julho de 2026',
    checkedAt: '2026-09-03',
    url: 'https://dadosabertos.sp.gov.br/dataset/frota-ativa',
    status: 'source-ready',
  },
  {
    id: 'detran-infractions',
    authority: 'Dados Abertos SP · Detran-SP',
    title: 'Infrações lavradas',
    scope: 'Quantidade de infrações por município e enquadramento',
    freshness: 'Dados disponíveis até julho de 2026',
    checkedAt: '2026-09-03',
    url: 'https://dadosabertos.sp.gov.br/dataset/infracoes-lavradas',
    status: 'source-ready',
  },
  {
    id: 'sjc-monitoring',
    authority: 'Prefeitura de São José dos Campos',
    title: 'Monitoramento do trânsito',
    scope: 'Monitoramento e resposta ao trânsito da cidade',
    freshness: 'Página consultada em 03/09/2026',
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
    detail: 'A Prefeitura informa monitoramento contínuo do trânsito da cidade.',
    sourceId: 'sjc-monitoring',
  },
  {
    value: '~1.200',
    label: 'câmeras no sistema municipal',
    detail: 'Cerca de 1.200 câmeras são utilizadas no monitoramento urbano, segundo a Prefeitura.',
    sourceId: 'sjc-monitoring',
  },
  {
    value: '299,89 km',
    label: 'malha cicloviária',
    detail: 'Extensão informada pelo Conselho de Mobilidade Urbana em junho de 2026.',
    sourceId: 'sjc-mobility',
  },
];

export const guideCards = [
  { title: 'Primeira habilitação', copy: 'Entenda o processo completo e o que você consegue resolver por conta própria.', href: '/guias/primeira-habilitacao-2026' },
  { title: 'Categoria A', copy: 'Moto: prática, processo e o que muda quando sua habilitação envolve categoria A.', href: '/guias/categoria-a' },
  { title: 'Categoria B', copy: 'Carro: prática, exame e as regras atuais que valem para categoria B.', href: '/guias/categoria-b' },
  { title: 'Categoria D', copy: 'Por que categoria D exige habilitação anterior e requisitos próprios.', href: '/guias/categoria-d' },
  { title: 'Medo de dirigir', copy: 'Como retomar prática e confiança gradualmente depois de já estar habilitado.', href: '/guias/medo-de-dirigir' },
  { title: 'Exame prático', copy: 'Agendamento, taxa, carro automático, baliza e preparação para a prova.', href: '/guias/exame-pratico' },
];
