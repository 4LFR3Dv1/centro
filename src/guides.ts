import type { JourneyId } from './commercial';

export type GuideCategory = 'Começando a CNH' | 'Provas e preparação' | 'Categorias' | 'Depois da CNH';

export type GuideSection = {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
  note?: string;
};

export type GuideLink = {
  label: string;
  href: string;
  authority: string;
};

export type Guide = {
  slug: string;
  title: string;
  description: string;
  category: GuideCategory;
  summary: string;
  readTime: string;
  checkedAt: string;
  keywords: string[];
  sections: GuideSection[];
  officialLinks: GuideLink[];
  related: string[];
  assistance?: {
    title: string;
    copy: string;
    journey: JourneyId;
  };
};

const DETRAN_CNH = 'https://detran.sp.gov.br/cnhpaulista/';
const CNH_APP = 'https://www.gov.br/pt-br/servicos/obter-carteira-digital-de-transito';
const CNH_DIGITAL = 'https://www.gov.br/pt-br/servicos/emitir-a-carteira-nacional-de-habilitacao-digital-cnh-e';
const DETRAN_SERVICES = 'https://transferenciadigital.detran.sp.gov.br/DetranWeb/';
const DETRAN_ADICAO = 'https://gestaoconteudo.detran.sp.gov.br/wps/portal/portaldetran/cidadao/habilitacao/fichaservico/adicaoCategoria';

export const guideCategories: GuideCategory[] = [
  'Começando a CNH',
  'Provas e preparação',
  'Categorias',
  'Depois da CNH',
];

export const guides: Guide[] = [
  {
    slug: 'primeira-habilitacao-2026',
    title: 'Como tirar a primeira CNH em 2026',
    description: 'Do início pelo app até a emissão: entenda a ordem das etapas e o que você consegue resolver por conta própria.',
    category: 'Começando a CNH',
    summary: 'Em São Paulo, a primeira habilitação combina o App CNH do Brasil com etapas do Detran-SP. Você pode acompanhar e resolver boa parte do caminho sem depender de uma autoescola para organizar o processo.',
    readTime: '6 min',
    checkedAt: '2026-09-03',
    keywords: ['primeira cnh', 'primeira habilitação', 'passo a passo', 'renach', 'prova', 'app'],
    sections: [
      {
        title: 'A ordem do processo',
        bullets: [
          'Iniciar o requerimento e o curso teórico pelo App CNH do Brasil.',
          'Abrir o RENACH e fazer o cadastro biométrico no Detran-SP.',
          'Realizar avaliação psicológica e exame de aptidão física e mental.',
          'Validar a formação teórica e realizar o exame teórico.',
          'Depois da aprovação, emitir a LADV e começar a prática.',
          'Concluir a prática exigida e realizar o exame prático.',
          'Cumprir os requisitos finais aplicáveis e acessar a CNH digital.',
        ],
      },
      {
        title: 'O que você consegue fazer sozinho',
        paragraphs: [
          'O Centro trata o processo como uma sequência de tarefas públicas. Sempre que houver um serviço oficial disponível diretamente ao cidadão, o guia aponta esse caminho primeiro.',
          'A autoescola deixa de ser a porta obrigatória para entender o processo. Ela passa a ser uma opção de assistência quando você prefere acompanhamento ou precisa de ajuda em uma etapa específica.',
        ],
      },
      {
        title: 'Atenção ao toxicológico',
        paragraphs: [
          'Para processos de primeira habilitação iniciados a partir de 17/06/2026, o Detran-SP informa que é necessário resultado toxicológico negativo e válido para a emissão da CNH.',
          'O resultado tem validade de 90 dias. Por isso, a orientação oficial é não realizar o exame cedo demais em relação ao fim do processo.',
        ],
      },
    ],
    officialLinks: [
      { label: 'Primeira habilitação no Detran-SP', href: DETRAN_CNH, authority: 'Detran-SP' },
      { label: 'Instalar CNH do Brasil', href: CNH_APP, authority: 'Gov.br · Senatran' },
    ],
    related: ['app-cnh-do-brasil', 'renach-e-biometria', 'custos-da-primeira-cnh', 'toxicológico-primeira-habilitacao'],
    assistance: {
      title: 'Quer alguém acompanhando o processo?',
      copy: 'A Auto Escola Centro pode orientar sua primeira habilitação e assumir as etapas em que você prefere não seguir sozinho.',
      journey: 'not-started',
    },
  },
  {
    slug: 'app-cnh-do-brasil',
    title: 'Como começar pelo App CNH do Brasil',
    description: 'O que é o app oficial, o que você precisa para acessar e onde ele entra na primeira habilitação.',
    category: 'Começando a CNH',
    summary: 'O CNH do Brasil é o aplicativo oficial da Senatran. Além dos documentos digitais, ele é usado no fluxo atual da primeira habilitação.',
    readTime: '4 min',
    checkedAt: '2026-09-03',
    keywords: ['cnh do brasil', 'app', 'gov.br', 'começar cnh'],
    sections: [
      {
        title: 'Antes de abrir',
        bullets: [
          'Tenha uma conta Gov.br.',
          'Use um celular compatível com a versão atual do aplicativo.',
          'Baixe o app pelos canais oficiais indicados pelo Gov.br.',
        ],
      },
      {
        title: 'Na primeira habilitação',
        paragraphs: [
          'A orientação atual do Detran-SP coloca o início do requerimento e a formação teórica dentro do fluxo do App CNH do Brasil.',
          'Depois dessa parte digital, o processo continua com cadastro no Detran-SP, biometria, avaliações e provas.',
        ],
      },
      {
        title: 'Evite links desconhecidos',
        paragraphs: [
          'Para instalar ou acessar serviços relacionados à CNH, prefira Gov.br, Senatran e Detran-SP. O Centro aponta para esses canais e não pede senha da sua conta Gov.br.',
        ],
      },
    ],
    officialLinks: [{ label: 'Instalar CNH do Brasil', href: CNH_APP, authority: 'Gov.br · Senatran' }],
    related: ['primeira-habilitacao-2026', 'renach-e-biometria', 'cnh-digital-e-fisica'],
  },
  {
    slug: 'renach-e-biometria',
    title: 'RENACH e biometria: o que acontece nessa etapa',
    description: 'Entenda por que o cadastro existe, quando ele entra no processo e o que vem depois.',
    category: 'Começando a CNH',
    summary: 'Depois do início digital, o processo precisa ser vinculado ao registro do candidato e às informações biométricas mantidas pelo órgão de trânsito.',
    readTime: '4 min',
    checkedAt: '2026-09-03',
    keywords: ['renach', 'biometria', 'cadastro', 'detran'],
    sections: [
      {
        title: 'O que é essa etapa',
        paragraphs: [
          'O RENACH é o registro usado para organizar o processo de habilitação. A biometria vincula sua identidade ao processo e aos atendimentos seguintes.',
          'No fluxo atual da primeira habilitação em São Paulo, essa etapa vem depois do início pelo App CNH do Brasil e antes das avaliações de saúde.',
        ],
      },
      {
        title: 'O que fazer',
        paragraphs: [
          'Consulte o serviço oficial do Detran-SP para saber como abrir o cadastro e onde a coleta deve ser realizada. Não presuma que um endereço antigo ou uma unidade específica continua atendendo sem confirmar.',
        ],
      },
      {
        title: 'Depois disso',
        paragraphs: ['Com cadastro e biometria regularizados, o caminho segue para avaliação psicológica e exame de aptidão física e mental.'],
      },
    ],
    officialLinks: [{ label: 'Ver fluxo atual da CNH', href: DETRAN_CNH, authority: 'Detran-SP' }],
    related: ['exames-medico-e-psicologico', 'primeira-habilitacao-2026'],
    assistance: {
      title: 'Travou no cadastro?',
      copy: 'Se você não quer organizar essa etapa sozinho, a Auto Escola Centro pode orientar como continuar.',
      journey: 'in-process',
    },
  },
  {
    slug: 'exames-medico-e-psicologico',
    title: 'Exame médico e avaliação psicológica',
    description: 'Para que servem as avaliações, quanto o Detran-SP informa atualmente e em que ponto do processo elas aparecem.',
    category: 'Começando a CNH',
    summary: 'As avaliações verificam condições necessárias para seguir no processo. O Detran-SP informa atualmente R$ 90,00 para a avaliação psicológica e R$ 90,00 para o exame médico.',
    readTime: '4 min',
    checkedAt: '2026-09-03',
    keywords: ['exame médico', 'psicológico', '90 reais', 'avaliações'],
    sections: [
      {
        title: 'Quanto custa',
        bullets: ['Avaliação psicológica: R$ 90,00.', 'Exame de aptidão física e mental: R$ 90,00.'],
        note: 'Valores públicos informados pelo Detran-SP na data de revisão deste guia.',
      },
      {
        title: 'Quando entram',
        paragraphs: ['No fluxo atual, as avaliações vêm depois do cadastro/biometria e antes da conclusão da etapa teórica e do exame teórico.'],
      },
      {
        title: 'Não confunda taxa pública com pacote de serviço',
        paragraphs: ['Os valores oficiais das avaliações são uma coisa; aulas, acompanhamento e outros serviços privados são outra. O Centro mantém essa separação para facilitar comparação e decisão.'],
      },
    ],
    officialLinks: [{ label: 'Conferir valores e fluxo no Detran-SP', href: DETRAN_CNH, authority: 'Detran-SP' }],
    related: ['custos-da-primeira-cnh', 'curso-e-prova-teorica', 'renach-e-biometria'],
  },
  {
    slug: 'custos-da-primeira-cnh',
    title: 'Quanto custa a parte pública da primeira CNH',
    description: 'Separe taxas do Detran de aulas e serviços privados para entender o que você realmente está pagando.',
    category: 'Começando a CNH',
    summary: 'O Centro separa custos públicos conhecidos de valores comerciais. Isso evita tratar uma taxa oficial como se fosse preço da autoescola — e vice-versa.',
    readTime: '4 min',
    checkedAt: '2026-09-03',
    keywords: ['preço cnh', 'custos', 'taxas', 'quanto custa'],
    sections: [
      {
        title: 'Valores públicos atualmente informados',
        bullets: [
          'Avaliação psicológica: R$ 90,00.',
          'Exame médico: R$ 90,00.',
          'Exame teórico: R$ 52,83.',
          'Exame prático: R$ 52,83.',
          'CNH física: R$ 137,79, quando a versão impressa for escolhida.',
        ],
      },
      {
        title: 'O que não está nessa conta',
        paragraphs: [
          'Aulas, locação ou disponibilização de veículo, treinamento adicional e outros serviços privados têm preço próprio. O valor também pode variar conforme a opção escolhida pelo cidadão.',
          'O exame toxicológico, quando aplicável, tem valor consultado junto a laboratório credenciado e não entra na tabela acima.',
        ],
      },
      {
        title: 'Use a conta como referência, não orçamento final',
        paragraphs: ['Regras e preços podem mudar. Antes de pagar, confira a etapa no canal oficial e confirme qualquer serviço privado diretamente com o prestador.'],
      },
    ],
    officialLinks: [{ label: 'Valores atuais da CNH Paulista', href: DETRAN_CNH, authority: 'Detran-SP' }],
    related: ['primeira-habilitacao-2026', 'exames-medico-e-psicologico', 'exame-pratico'],
  },
  {
    slug: 'curso-e-prova-teorica',
    title: 'Curso e prova teórica: como funciona',
    description: 'Entenda o papel da formação teórica, da validação e do exame antes de começar a prática.',
    category: 'Provas e preparação',
    summary: 'A formação teórica prepara o candidato para as regras de circulação e segurança. Depois da etapa exigida, o exame teórico verifica o conhecimento necessário para continuar.',
    readTime: '5 min',
    checkedAt: '2026-09-03',
    keywords: ['prova teórica', 'curso teórico', 'questões', 'teoria'],
    sections: [
      {
        title: 'Onde essa etapa entra',
        paragraphs: ['No fluxo atual da primeira habilitação, o curso começa no ecossistema CNH do Brasil. Depois de cadastro e avaliações regulares, a formação é validada e o candidato realiza o exame teórico.'],
      },
      {
        title: 'Taxa do exame',
        paragraphs: ['O Detran-SP informa atualmente taxa pública de R$ 52,83 para o exame teórico.'],
      },
      {
        title: 'Como estudar melhor',
        bullets: [
          'Entenda a lógica das regras em vez de apenas memorizar respostas.',
          'Dê atenção especial a sinalização, circulação, segurança e situações de risco.',
          'Use simulados como diagnóstico: revise o motivo dos erros, não apenas a alternativa correta.',
        ],
      },
    ],
    officialLinks: [{ label: 'Ver fluxo e novidades da prova', href: DETRAN_CNH, authority: 'Detran-SP' }],
    related: ['aulas-praticas', 'exame-pratico', 'primeira-habilitacao-2026'],
    assistance: {
      title: 'Quer ajuda para organizar a continuação?',
      copy: 'A Auto Escola Centro pode orientar a transição da teoria para a prática e o que falta no seu processo.',
      journey: 'in-process',
    },
  },
  {
    slug: 'aulas-praticas',
    title: 'Aulas práticas: mínimo legal e treino necessário',
    description: 'Entenda a diferença entre a carga mínima atual e a quantidade de treino que faz sentido para você.',
    category: 'Provas e preparação',
    summary: 'Para A e B, o Detran-SP informa atualmente prática mínima de 2 horas. Esse número é um requisito mínimo; não mede automaticamente a preparação de cada pessoa.',
    readTime: '5 min',
    checkedAt: '2026-09-03',
    keywords: ['aulas práticas', '2 horas', 'instrutor', 'autoescola', 'prática'],
    sections: [
      {
        title: 'O mínimo atual',
        paragraphs: ['A orientação atual do Detran-SP informa mínimo de 2 horas de prática para categorias A e B na primeira habilitação e na adição de categoria.'],
      },
      {
        title: 'Mínimo não é recomendação individual',
        paragraphs: [
          'Duas pessoas podem cumprir a mesma exigência e chegar à prova com níveis muito diferentes de domínio. Experiência prévia, ansiedade, coordenação e frequência de treino influenciam a preparação.',
          'Use o mínimo como requisito regulatório. Para decidir se precisa de mais treino, observe se você consegue executar as tarefas básicas com consistência e segurança.',
        ],
      },
      {
        title: 'Onde praticar',
        paragraphs: ['O Detran-SP informa que a prática pode ser realizada em autoescola credenciada ou com instrutor autônomo autorizado. Compare disponibilidade, formato de acompanhamento e quanto suporte você deseja.'],
      },
    ],
    officialLinks: [{ label: 'Conferir regra atual da prática', href: DETRAN_CNH, authority: 'Detran-SP' }],
    related: ['categoria-a', 'categoria-b', 'exame-pratico'],
    assistance: {
      title: 'Quer fazer a prática com a Auto Escola Centro?',
      copy: 'A Auto Escola Centro oferece aulas e treinamento nas categorias A, B e D. Confirme disponibilidade e condições atuais diretamente no atendimento.',
      journey: 'theory-done',
    },
  },
  {
    slug: 'exame-pratico',
    title: 'Como funciona o exame prático em 2026',
    description: 'Agendamento, taxa, carro automático, baliza e o que mudou no exame de direção em São Paulo.',
    category: 'Provas e preparação',
    summary: 'O exame prático mudou em São Paulo. O Detran-SP informa agendamento direto pelo cidadão, taxa de R$ 52,83, possibilidade de veículo automático e fim da obrigatoriedade da baliza.',
    readTime: '6 min',
    checkedAt: '2026-09-03',
    keywords: ['exame prático', 'baliza', 'carro automático', 'agendamento', 'prova direção'],
    sections: [
      {
        title: 'O que mudou',
        bullets: [
          'O exame pode ser feito com veículo automático.',
          'A baliza deixou de ser obrigatória no modelo atual informado pelo Detran-SP.',
          'O cidadão pode realizar diretamente o agendamento do exame, conforme disponibilidade.',
          'O Detran-SP informa taxa pública de R$ 52,83.',
        ],
      },
      {
        title: 'Veículo para a prova',
        paragraphs: ['A orientação atual informa possibilidade de utilizar veículo próprio ou de terceiros, desde que devidamente identificado e em conformidade com as regras aplicáveis. Confirme as exigências antes do exame.'],
      },
      {
        title: 'Como pensar a preparação',
        paragraphs: ['A prova não deve ser o primeiro momento em que você tenta executar algo sob pressão. Antes de agendar, revise os pontos em que ainda perde consistência e pratique a condução de forma segura.'],
      },
    ],
    officialLinks: [
      { label: 'Novidades do exame prático', href: DETRAN_CNH, authority: 'Detran-SP' },
      { label: 'Serviços e agendamento', href: DETRAN_SERVICES, authority: 'Detran-SP' },
    ],
    related: ['aulas-praticas', 'se-reprovar-no-exame', 'categoria-b'],
    assistance: {
      title: 'Quer treinar antes da prova?',
      copy: 'Se você não se sente pronto para o exame, a Auto Escola Centro pode ajudar com treinamento prático antes da tentativa.',
      journey: 'practical-only',
    },
  },
  {
    slug: 'se-reprovar-no-exame',
    title: 'O que fazer se você reprovar no exame prático',
    description: 'Reprovar uma tentativa não significa que você precisa transformar o processo inteiro em um problema maior.',
    category: 'Provas e preparação',
    summary: 'O passo seguinte é entender o que aconteceu, corrigir a dificuldade e consultar a próxima possibilidade de exame. Evite simplesmente repetir a tentativa sem trabalhar o motivo da reprovação.',
    readTime: '4 min',
    checkedAt: '2026-09-03',
    keywords: ['reprovação', 'reprovei', 'exame prático', 'nova prova'],
    sections: [
      {
        title: 'Primeiro: identifique o problema',
        paragraphs: ['Separe erro técnico, decisão ruim, desconhecimento do procedimento e nervosismo. A solução muda conforme a causa.'],
      },
      {
        title: 'Depois: consulte nova tentativa',
        paragraphs: ['Use os serviços oficiais do Detran-SP para verificar nova disponibilidade e os requisitos de agendamento. Taxas e procedimentos devem ser conferidos no momento da nova tentativa.'],
      },
      {
        title: 'Treinar de novo pode fazer sentido',
        paragraphs: ['Se a reprovação revelou dificuldade real de condução, uma nova tentativa imediata pode apenas repetir o problema. Treine especificamente os pontos que falharam antes de reagendar.'],
      },
    ],
    officialLinks: [{ label: 'Acessar serviços do Detran-SP', href: DETRAN_SERVICES, authority: 'Detran-SP' }],
    related: ['exame-pratico', 'aulas-praticas'],
    assistance: {
      title: 'Quer trabalhar o ponto que causou a reprovação?',
      copy: 'A Auto Escola Centro pode oferecer treinamento prático direcionado antes da próxima tentativa.',
      journey: 'practical-only',
    },
  },
  {
    slug: 'categoria-a',
    title: 'Categoria A: habilitação para moto',
    description: 'O que muda quando sua habilitação envolve motocicleta e como a prática entra no processo.',
    category: 'Categorias',
    summary: 'A categoria A é a habilitação usada para condução de veículos motorizados de duas ou três rodas abrangidos por essa categoria, como motocicletas.',
    readTime: '4 min',
    checkedAt: '2026-09-03',
    keywords: ['categoria a', 'moto', 'motocicleta', 'habilitação moto'],
    sections: [
      {
        title: 'Primeira habilitação ou adição',
        paragraphs: ['A categoria A pode fazer parte da primeira habilitação ou ser adicionada depois a uma CNH compatível. O caminho muda conforme seu histórico, então confirme qual processo se aplica ao seu caso.'],
      },
      {
        title: 'Na prática',
        paragraphs: ['O Detran-SP informa atualmente mínimo de 2 horas práticas para A no fluxo aplicável. A quantidade de treino necessária para se sentir seguro pode ser maior.'],
      },
      {
        title: 'O foco do treino',
        paragraphs: ['Controle do veículo, equilíbrio, leitura do ambiente e tomada de decisão precisam funcionar juntos. Não trate a prática apenas como memorização do percurso da prova.'],
      },
    ],
    officialLinks: [{ label: 'Conferir regras atuais da CNH', href: DETRAN_CNH, authority: 'Detran-SP' }],
    related: ['aulas-praticas', 'primeira-habilitacao-2026', 'categoria-b'],
    assistance: {
      title: 'Quer aulas de categoria A?',
      copy: 'A Auto Escola Centro atende categoria A em São José dos Campos. Confirme horários e disponibilidade atuais.',
      journey: 'theory-done',
    },
  },
  {
    slug: 'categoria-b',
    title: 'Categoria B: habilitação para carro',
    description: 'Como funciona a categoria mais comum para automóveis e o que observar antes da prova prática.',
    category: 'Categorias',
    summary: 'A categoria B é a referência para condução dos automóveis abrangidos por seus limites legais. Ela pode ser obtida na primeira habilitação ou combinada com A.',
    readTime: '4 min',
    checkedAt: '2026-09-03',
    keywords: ['categoria b', 'carro', 'automóvel', 'habilitação carro'],
    sections: [
      {
        title: 'Onde ela entra',
        paragraphs: ['Na primeira habilitação, B segue o fluxo geral de cadastro, avaliações, teoria, prática e exame. Também pode existir em processos de adição conforme a habilitação atual do condutor.'],
      },
      {
        title: 'Prática e exame',
        paragraphs: ['O mínimo prático atualmente informado pelo Detran-SP para B é de 2 horas. No exame, o modelo atual permite veículo automático e não exige baliza como etapa obrigatória.'],
      },
      {
        title: 'Treine condução, não apenas prova',
        paragraphs: ['Domínio de espaço, observação, velocidade adequada, sinalização e decisões seguras importam fora do exame. Use a preparação para construir uma base que continue útil depois da aprovação.'],
      },
    ],
    officialLinks: [{ label: 'Conferir regras atuais da CNH', href: DETRAN_CNH, authority: 'Detran-SP' }],
    related: ['aulas-praticas', 'exame-pratico', 'categoria-a'],
    assistance: {
      title: 'Quer aulas de categoria B?',
      copy: 'A Auto Escola Centro atende categoria B em São José dos Campos. Confirme horários e disponibilidade atuais.',
      journey: 'theory-done',
    },
  },
  {
    slug: 'categoria-d',
    title: 'Categoria D: por que ela tem requisitos próprios',
    description: 'Entenda por que D não funciona como primeira habilitação comum e o que verificar antes de iniciar o processo.',
    category: 'Categorias',
    summary: 'A categoria D é voltada a determinados veículos de transporte de passageiros e exige habilitação anterior e condições próprias. Não deve ser tratada como uma opção de primeira CNH.',
    readTime: '5 min',
    checkedAt: '2026-09-03',
    keywords: ['categoria d', 'ônibus', 'passageiros', 'mudança categoria'],
    sections: [
      {
        title: 'Não é primeira habilitação',
        paragraphs: ['Antes de pensar em aulas ou prova, verifique se sua CNH atual e seu histórico permitem iniciar a mudança para D. Os requisitos envolvem habilitação anterior e outras condições legais.'],
      },
      {
        title: 'Por que conferir antes de pagar',
        paragraphs: ['A elegibilidade vem antes do treinamento. Se houver bloqueio, requisito pendente ou condição incompatível, contratar aulas antes de confirmar o processo pode gerar custo e atraso desnecessários.'],
      },
      {
        title: 'Toxicológico e outras exigências',
        paragraphs: ['Categorias profissionais podem envolver exame toxicológico e requisitos adicionais. Confirme o serviço atual do Detran-SP para sua situação específica antes de iniciar.'],
      },
    ],
    officialLinks: [{ label: 'Acessar serviços de habilitação', href: DETRAN_SERVICES, authority: 'Detran-SP' }],
    related: ['adicao-e-mudanca-de-categoria', 'categoria-b'],
    assistance: {
      title: 'Quer verificar categoria D com a Auto Escola Centro?',
      copy: 'A Auto Escola Centro atende categoria D. O atendimento pode ajudar a conferir sua situação antes de organizar treinamento e prova.',
      journey: 'addition',
    },
  },
  {
    slug: 'adicao-e-mudanca-de-categoria',
    title: 'Adicionar ou mudar categoria da CNH',
    description: 'Primeiro confirme o que sua habilitação atual permite; depois organize exames, prática e prova quando aplicáveis.',
    category: 'Categorias',
    summary: 'Adição e mudança de categoria não são a mesma coisa que primeira habilitação. O processo parte de uma CNH já existente e das condições atuais do condutor.',
    readTime: '5 min',
    checkedAt: '2026-09-03',
    keywords: ['adição categoria', 'mudança categoria', 'adicionar moto', 'categoria d'],
    sections: [
      {
        title: 'Comece pela sua CNH atual',
        paragraphs: ['Verifique se a habilitação está regular e qual movimento de categoria você pretende fazer. Algumas combinações são adição; outras são mudança e possuem requisitos diferentes.'],
      },
      {
        title: 'O serviço é solicitado pelo próprio motorista',
        paragraphs: ['O Detran-SP mantém serviço oficial para adição de categoria e informa as condições aplicáveis. Use a página oficial como referência antes de contratar qualquer serviço complementar.'],
      },
      {
        title: 'Depois da elegibilidade',
        paragraphs: ['Dependendo do caso, o processo pode envolver exames, prática e exame de direção. Categorias C, D e E também podem trazer exigências toxicológicas específicas.'],
      },
    ],
    officialLinks: [{ label: 'Serviço oficial de adição de categoria', href: DETRAN_ADICAO, authority: 'Detran-SP' }],
    related: ['categoria-a', 'categoria-d', 'aulas-praticas'],
    assistance: {
      title: 'Quer ajuda para organizar sua adição ou mudança?',
      copy: 'A Auto Escola Centro atende adição de categoria e categorias A, B e D. Confirme qual processo se aplica ao seu caso.',
      journey: 'addition',
    },
  },
  {
    slug: 'toxicológico-primeira-habilitacao',
    title: 'Toxicológico na primeira habilitação: quando é exigido',
    description: 'A regra mudou em 2026. Veja quem precisa do resultado, quando ele deve estar válido e por que não fazer cedo demais.',
    category: 'Provas e preparação',
    summary: 'Para processos de primeira habilitação iniciados a partir de 17/06/2026, o Detran-SP informa exigência de exame toxicológico com resultado negativo e válido para emissão da CNH.',
    readTime: '4 min',
    checkedAt: '2026-09-03',
    keywords: ['toxicológico', '17/06/2026', 'primeira habilitação', '90 dias'],
    sections: [
      {
        title: 'Quem entra na regra',
        paragraphs: ['A orientação publicada pelo Detran-SP se aplica aos processos de primeira habilitação iniciados a partir de 17 de junho de 2026.'],
      },
      {
        title: 'Validade importa',
        paragraphs: ['O resultado informado pelo Detran-SP tem validade de 90 dias e precisa continuar válido no momento da emissão da CNH. Por isso, fazer o exame muito cedo pode obrigar uma nova realização.'],
      },
      {
        title: 'Quanto custa',
        paragraphs: ['O Detran-SP orienta consultar o valor diretamente em laboratório credenciado. O Centro não transforma esse custo variável em uma taxa pública fixa.'],
      },
    ],
    officialLinks: [{ label: 'Conferir regra do toxicológico', href: DETRAN_CNH, authority: 'Detran-SP' }],
    related: ['primeira-habilitacao-2026', 'custos-da-primeira-cnh'],
  },
  {
    slug: 'cnh-digital-e-fisica',
    title: 'CNH digital e física: o que é obrigatório',
    description: 'A versão digital pode ser suficiente. Entenda validade, emissão e quando existe a taxa da CNH impressa.',
    category: 'Depois da CNH',
    summary: 'O Detran-SP informa CNH 100% digital e fim da obrigatoriedade de expedir a versão física. A versão digital pode ser acessada pelo app CNH do Brasil.',
    readTime: '4 min',
    checkedAt: '2026-09-03',
    keywords: ['cnh digital', 'cnh física', '137,79', 'documento'],
    sections: [
      {
        title: 'A digital tem validade',
        paragraphs: ['A CNH digital é um documento oficial e pode ser acessada no aplicativo CNH do Brasil. O Gov.br informa a mesma validade jurídica da versão física.'],
      },
      {
        title: 'A física é opcional no fluxo atual',
        paragraphs: ['O Detran-SP informa que, se o cidadão escolher ficar somente com a CNH digital, não precisa pagar a taxa de R$ 137,79 da emissão física.'],
      },
      {
        title: 'Depois da aprovação',
        paragraphs: ['A emissão depende do cumprimento de todos os requisitos aplicáveis ao processo. Em primeira habilitação iniciada a partir de 17/06/2026, isso inclui o resultado toxicológico negativo e válido.'],
      },
    ],
    officialLinks: [
      { label: 'Emitir e acessar CNH digital', href: CNH_DIGITAL, authority: 'Gov.br · Senatran' },
      { label: 'Ver regra atual em São Paulo', href: DETRAN_CNH, authority: 'Detran-SP' },
    ],
    related: ['app-cnh-do-brasil', 'toxicológico-primeira-habilitacao'],
  },
  {
    slug: 'medo-de-dirigir',
    title: 'Medo de dirigir: como voltar sem se pressionar',
    description: 'Para quem tem CNH, mas evita dirigir ou perdeu confiança: um caminho prático para reconstruir familiaridade.',
    category: 'Depois da CNH',
    summary: 'Ter habilitação não significa se sentir confortável em todas as situações. Retomar aos poucos e praticar em contextos graduais costuma ser mais útil do que tentar enfrentar tudo de uma vez.',
    readTime: '5 min',
    checkedAt: '2026-09-03',
    keywords: ['medo de dirigir', 'insegurança', 'confiança', 'treinamento habilitado'],
    sections: [
      {
        title: 'Comece identificando o que incomoda',
        bullets: ['Trânsito intenso.', 'Estacionamento.', 'Subidas e controle do carro.', 'Vias rápidas.', 'Dirigir sozinho.', 'Retomar depois de muito tempo parado.'],
      },
      {
        title: 'Reduza a dificuldade por etapas',
        paragraphs: ['Escolha situações simples e previsíveis, em condições seguras, e aumente a complexidade conforme a condução volta a ficar familiar. O objetivo é recuperar domínio, não provar algo em uma única saída.'],
      },
      {
        title: 'Quando procurar ajuda',
        paragraphs: ['Se a insegurança impede qualquer tentativa ou se você quer acompanhamento durante a retomada, treinamento para habilitados pode oferecer um ambiente mais estruturado. Se houver sofrimento intenso ou persistente, apoio profissional de saúde também pode ser apropriado.'],
      },
    ],
    officialLinks: [],
    related: ['voltar-a-dirigir', 'categoria-b'],
    assistance: {
      title: 'Quer retomar com acompanhamento?',
      copy: 'A Auto Escola Centro oferece treinamento para motoristas habilitados. Você pode explicar quais situações quer praticar antes de marcar.',
      journey: 'licensed',
    },
  },
  {
    slug: 'voltar-a-dirigir',
    title: 'Como voltar a dirigir depois de muito tempo',
    description: 'Um checklist simples para retomar prática, atualizar hábitos e voltar ao trânsito com mais previsibilidade.',
    category: 'Depois da CNH',
    summary: 'Antes de simplesmente sair dirigindo, confira documento, veículo e quais habilidades ficaram enferrujadas. A retomada pode ser planejada em níveis de dificuldade.',
    readTime: '5 min',
    checkedAt: '2026-09-03',
    keywords: ['voltar a dirigir', 'tempo sem dirigir', 'treinamento habilitados'],
    sections: [
      {
        title: 'Antes de dirigir',
        bullets: ['Confirme se sua habilitação está válida e sem bloqueios.', 'Confira as condições básicas do veículo.', 'Revise comandos e ajustes antes de entrar em uma situação de trânsito mais complexa.'],
      },
      {
        title: 'Retome por dificuldade',
        paragraphs: ['Comece em ambiente que permita recuperar coordenação e leitura do veículo. Depois evolua para rotas conhecidas, trânsito moderado e situações mais exigentes.'],
      },
      {
        title: 'Treinamento é uma opção, não punição',
        paragraphs: ['Você não precisa esperar estar em crise para fazer algumas aulas. Treino dirigido pode ser uma forma eficiente de recuperar habilidades específicas sem transformar toda a retomada em tentativa e erro.'],
      },
    ],
    officialLinks: [{ label: 'Consultar dados da habilitação', href: 'https://www.gov.br/pt-br/servicos/consultar-online-dados-de-sua-habilitacao-de-transito', authority: 'Gov.br · Senatran' }],
    related: ['medo-de-dirigir', 'cnh-digital-e-fisica'],
    assistance: {
      title: 'Quer voltar a dirigir com acompanhamento?',
      copy: 'A Auto Escola Centro oferece treinamento para habilitados em São José dos Campos.',
      journey: 'licensed',
    },
  },
];

export const guideBySlug = new Map(guides.map((guide) => [guide.slug, guide]));

export const featuredGuide = guides.find((guide) => guide.slug === 'primeira-habilitacao-2026')!;

export function guidesInCategory(category: GuideCategory) {
  return guides.filter((guide) => guide.category === category);
}

export function relatedGuides(slugs: string[]) {
  return slugs.map((slug) => guideBySlug.get(slug)).filter((guide): guide is Guide => Boolean(guide));
}
