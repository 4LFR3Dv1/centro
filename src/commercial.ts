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
    note: 'Preços atuais ainda não foram reconciliados com a operação.',
  },
  fleet: {
    state: 'unknown',
    value: null,
    note: 'Modelos, transmissão e disponibilidade dos veículos ainda não foram confirmados.',
  },
  openingHours: {
    state: 'unknown',
    value: null,
    note: 'Horários comerciais atuais ainda não foram confirmados.',
  },
  lessonAvailability: {
    state: 'unknown',
    value: null,
    note: 'Não existe agenda operacional conectada ao site neste momento.',
  },
  paymentMethods: {
    state: 'unknown',
    value: null,
    note: 'Meios e condições de pagamento ainda não foram confirmados.',
  },
  services: {
    state: 'needs_review',
    value: ['Primeira habilitação', 'Adição de categoria', 'Treinamento para habilitados'],
    note: 'Intenções recuperadas do conteúdo institucional legado; confirmar catálogo comercial atual antes de publicar condições específicas.',
  },
} satisfies Record<string, CommercialField<unknown>>;

const whatsappMessages: Record<JourneyId, string> = {
  'not-started':
    'Olá! Vim pelo site da Auto Escola Centro. Quero começar minha primeira habilitação e gostaria de saber quais são as opções e condições atuais.',
  'in-process':
    'Olá! Vim pelo site da Auto Escola Centro. Já iniciei meu processo de CNH e gostaria de explicar quais etapas concluí para entender como vocês podem me atender a partir daqui.',
  'theory-done':
    'Olá! Vim pelo site da Auto Escola Centro. Já fui aprovado na prova teórica e quero informações sobre aulas práticas, condições atuais e disponibilidade.',
  'practical-only':
    'Olá! Vim pelo site da Auto Escola Centro. Estou procurando aulas práticas para treinar e ganhar confiança. Gostaria de saber como funciona o atendimento atualmente.',
  addition:
    'Olá! Vim pelo site da Auto Escola Centro. Quero informações sobre adição de categoria. Posso informar minha categoria atual e a categoria que desejo adicionar.',
  licensed:
    'Olá! Vim pelo site da Auto Escola Centro. Já tenho CNH e estou procurando treinamento para voltar a dirigir com mais confiança. Gostaria de saber como funciona.',
};

export function buildWhatsappUrl(baseUrl: string, journey: JourneyId) {
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}text=${encodeURIComponent(whatsappMessages[journey])}`;
}
