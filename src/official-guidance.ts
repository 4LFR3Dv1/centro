export const officialGuidance = {
  authority: 'Detran-SP',
  checkedAt: '2026-09-03',
  sourceUrl: 'https://detran.sp.gov.br/cnhpaulista/',
  firstLicense: {
    title: 'Primeira habilitação em São Paulo',
    summary:
      'O processo atual é híbrido entre o App CNH do Brasil e os serviços digitais do Detran-SP.',
    steps: [
      'Iniciar o requerimento e o curso teórico pelo App CNH do Brasil.',
      'Abrir o RENACH e realizar o cadastro biométrico no Detran-SP.',
      'Realizar avaliação psicológica e exame de aptidão física e mental.',
      'Validar o curso teórico e realizar o exame teórico.',
      'Após aprovação, emitir a LADV e iniciar a prática.',
      'Concluir a prática mínima exigida e realizar o exame prático.',
      'Após aprovação e demais requisitos aplicáveis, acessar a CNH digital.',
    ],
  },
  publicFacts: [
    {
      label: 'Prática mínima A/B',
      value: '2 horas',
      detail: 'Para primeira habilitação e adição de categoria, conforme orientação atual do Detran-SP.',
    },
    {
      label: 'Avaliação psicológica',
      value: 'R$ 90,00',
      detail: 'Valor público informado pelo Detran-SP.',
    },
    {
      label: 'Exame médico',
      value: 'R$ 90,00',
      detail: 'Valor público informado pelo Detran-SP.',
    },
    {
      label: 'Exame teórico',
      value: 'R$ 52,83',
      detail: 'Taxa pública informada pelo Detran-SP.',
    },
    {
      label: 'Exame prático',
      value: 'R$ 52,83',
      detail: 'Taxa pública informada pelo Detran-SP.',
    },
    {
      label: 'CNH física',
      value: 'R$ 137,79',
      detail: 'Opcional; a versão digital pode ser emitida sem essa taxa.',
    },
  ],
  alerts: [
    'A prática pode ser realizada em autoescola credenciada ou com instrutor autônomo autorizado.',
    'O exame prático pode ser agendado diretamente pelo cidadão no Detran-SP.',
    'Para processos de primeira habilitação iniciados a partir de 17/06/2026, o Detran-SP informa exigência de exame toxicológico negativo e válido para emissão da CNH.',
  ],
} as const;
