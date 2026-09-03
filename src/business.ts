export const business = {
  name: 'Auto Escola Centro',
  shortName: 'Centro',
  city: 'São José dos Campos',
  state: 'SP',
  address: {
    street: 'Avenida São José, 1.009',
    district: 'Centro',
    city: 'São José dos Campos',
    state: 'SP',
  },
  phoneDisplay: '(12) 9 8177-9745',
  phoneE164: '+5512981779745',
  whatsappUrl: 'https://wa.me/5512981779745',
  mapsUrl:
    'https://www.google.com/maps/search/?api=1&query=Avenida%20S%C3%A3o%20Jos%C3%A9%2C%201009%2C%20Centro%2C%20S%C3%A3o%20Jos%C3%A9%20dos%20Campos%2C%20SP',
  yearsLabel: 'há mais de 20 anos',
  services: [
    'Primeira habilitação',
    'Categoria A — moto',
    'Categoria B — carro',
    'Adição de categoria',
    'Categoria D — ônibus',
    'Treinamento para habilitados',
    'Aperfeiçoamento para motoristas habilitados',
  ],
} as const;

export const businessAddress = `${business.address.street} · ${business.address.district} · ${business.address.city} — ${business.address.state}`;
