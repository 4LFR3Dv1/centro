export type KnowledgeState = 'verified' | 'unknown' | 'needs_review';

export type CommercialField<T> = {
  state: KnowledgeState;
  value: T | null;
  note: string;
};

export type JourneyId =
  | 'not-started'
  | 'in-process'
  | 'theory-done'
  | 'practical-only'
  | 'addition'
  | 'licensed';

export const commercialProfile = {
  pricing: {
    state: 'unknown',
    value: null,
    note: 'Consulte os valores atuais diretamente com a Auto Escola Centro.',
  },
  fleet: {
    state: 'unknown',
    value: null,
    note: 'Consulte quais veículos estão disponíveis para a categoria que você procura.',
  },
  openingHours: {
    state: 'unknown',
    value: null,
    note: 'Consulte os horários atuais de atendimento antes de ir até a unidade.',
  },
  lessonAvailability: {
    state: 'unknown',
    value: null,
    note: 'Consulte os dias e horários disponíveis para aulas.',
  },
  paymentMethods: {
    state: 'unknown',
    value: null,
    note: 'Consulte as formas e condições de pagamento disponíveis.',
  },
  services: {
    state: 'verified',
    value: [
      'Primeira habilitação',
      'Categoria A',
      'Categoria B',
      'Categoria D',
      'Adição de categoria',
      'Treinamento para habilitados',
    ],
    note: 'Categorias A, B e D, primeira habilitação, adição de categoria e treinamento para habilitados.',
  },
} satisfies Record<string, CommercialField<unknown>>;

const whatsappMessages: Record<JourneyId, string> = {
  'not-started':
    'Olá! Vim pelo site da Auto Escola Centro. Quero começar minha primeira habilitação e gostaria de saber quais são as opções e condições atuais para categorias A e/ou B.',
  'in-process':
    'Olá! Vim pelo site da Auto Escola Centro. Já iniciei meu processo de CNH e gostaria de explicar quais etapas concluí para entender como vocês podem me atender a partir daqui.',
  'theory-done':
    'Olá! Vim pelo site da Auto Escola Centro. Já fui aprovado na prova teórica e quero informações sobre aulas práticas, condições atuais e disponibilidade.',
  'practical-only':
    'Olá! Vim pelo site da Auto Escola Centro. Estou procurando aulas práticas para treinar e ganhar confiança. Gostaria de saber como funciona o atendimento atualmente.',
  addition:
    'Olá! Vim pelo site da Auto Escola Centro. Quero fazer adição de categoria. Minha categoria atual é ___ e quero adicionar ___. Gostaria de saber as condições atuais para A, B ou D.',
  licensed:
    'Olá! Vim pelo site da Auto Escola Centro. Já tenho CNH e estou procurando treinamento para voltar a dirigir com mais confiança. Gostaria de saber como funciona.',
};

export function buildWhatsappUrl(baseUrl: string, journey: JourneyId) {
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}text=${encodeURIComponent(whatsappMessages[journey])}`;
}
