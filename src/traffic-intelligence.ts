import rawTrafficIntelligence from './generated/traffic-intelligence.json';

export type MetricItem = {
  label: string;
  value: number;
};

export type ExamMetrics = {
  total: number;
  approved: number;
  rejected: number;
  absent: number;
  cancelled: number;
  approvalRate: number | null;
  categories: MetricItem[];
};

export type FleetMetrics = {
  total: number;
  topTypes: MetricItem[];
  topFuels: MetricItem[];
  topSpecies: MetricItem[];
};

export type InfractionMetrics = {
  total: number;
  topDescriptions: MetricItem[];
  topCodes: MetricItem[];
};

export type TrafficSnapshot<TMetrics = ExamMetrics | FleetMetrics | InfractionMetrics> = {
  period: string;
  rowCount: number;
  municipalityField: string;
  sha256: string;
  resourceId: string;
  resourceName: string;
  resourcePage: string;
  resourceUpdatedAt: string | null;
  metrics: TMetrics;
};

export type TrafficDataset<TMetrics = ExamMetrics | FleetMetrics | InfractionMetrics> = {
  status: 'ready' | 'unavailable';
  title: string;
  dataset: string;
  datasetPage: string;
  authority: string;
  license?: string;
  catalogUpdatedAt?: string | null;
  latest: TrafficSnapshot<TMetrics> | null;
  history: TrafficSnapshot<TMetrics>[];
};

export type TrafficIntelligence = {
  version: number;
  city: string;
  cityKey: string;
  authority: string;
  datasetLicense: string;
  latestPeriod: string | null;
  snapshotFingerprint: string | null;
  datasets: {
    practical: TrafficDataset<ExamMetrics>;
    theory: TrafficDataset<ExamMetrics>;
    fleet: TrafficDataset<FleetMetrics>;
    infractions: TrafficDataset<InfractionMetrics>;
  };
};

export const trafficIntelligence = rawTrafficIntelligence as unknown as TrafficIntelligence;

const numberFormatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const compactFormatter = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

export function formatCount(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return numberFormatter.format(value);
}

export function formatCompactCount(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return compactFormatter.format(value);
}

export function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

export function formatPeriod(period: string | null | undefined) {
  if (!period) return 'período indisponível';
  const [year, month] = period.split('-').map(Number);
  if (!year || !month) return period;
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 1)));
}

export function latestReadyPeriod() {
  return formatPeriod(trafficIntelligence.latestPeriod);
}
