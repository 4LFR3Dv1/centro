import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parse } from 'csv-parse/sync';

const CKAN = 'https://dadosabertos.sp.gov.br/api/3/action';
const DATASET_BASE = 'https://dadosabertos.sp.gov.br/dataset';
const OUTPUT = new URL('../src/generated/traffic-intelligence.json', import.meta.url);
const CITY = 'São José dos Campos';
const CITY_KEY = normalize(CITY);
const strict = process.argv.includes('--strict');

const definitions = [
  { key: 'practical', slug: 'exames-praticos-realizados', title: 'Exames práticos', kind: 'exam', history: 7 },
  { key: 'theory', slug: 'exames-teoricos-realizados', title: 'Exames teóricos', kind: 'exam', history: 7 },
  { key: 'fleet', slug: 'frota-ativa', title: 'Frota ativa', kind: 'fleet', history: 1 },
  { key: 'infractions', slug: 'infracoes-lavradas', title: 'Infrações lavradas pelo Detran-SP', kind: 'infractions', history: 1 },
];

const monthNames = [
  ['JANEIRO', '01'], ['FEVEREIRO', '02'], ['MARCO', '03'], ['ABRIL', '04'],
  ['MAIO', '05'], ['JUNHO', '06'], ['JULHO', '07'], ['AGOSTO', '08'],
  ['SETEMBRO', '09'], ['OUTUBRO', '10'], ['NOVEMBRO', '11'], ['DEZEMBRO', '12'],
];

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

function parsePeriod(name) {
  const normalized = normalize(name);
  const year = normalized.match(/20\d{2}/)?.[0];
  if (!year) return null;
  for (const [monthName, month] of monthNames) {
    if (normalized.includes(monthName)) return `${year}-${month}`;
  }
  return null;
}

function chooseDelimiter(text) {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const options = [';', ',', '\t'];
  return options
    .map((delimiter) => ({ delimiter, count: first.split(delimiter).length - 1 }))
    .sort((a, b) => b.count - a.count)[0]?.delimiter ?? ';';
}

function decodeCsv(buffer) {
  const utf8 = new TextDecoder('utf-8').decode(buffer);
  const replacements = (utf8.match(/�/g) ?? []).length;
  if (replacements <= 2) return utf8;
  try {
    return new TextDecoder('windows-1252').decode(buffer);
  } catch {
    return Buffer.from(buffer).toString('latin1');
  }
}

function parseCsv(buffer) {
  const text = decodeCsv(buffer).replace(/^\uFEFF/, '');
  const delimiter = chooseDelimiter(text);
  const baseOptions = {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    delimiter,
    trim: true,
    bom: true,
  };

  try {
    return parse(text, { ...baseOptions, relax_quotes: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`CSV parser fallback without quote semantics: ${message}`);
    return parse(text, { ...baseOptions, quote: false });
  }
}

function getKeys(rows) {
  return Object.keys(rows[0] ?? {});
}

function findField(rows, patterns, reject = []) {
  const keys = getKeys(rows);
  for (const pattern of patterns) {
    const hit = keys.find((key) => {
      const candidate = normalize(key);
      return candidate.includes(pattern) && !reject.some((blocked) => candidate.includes(blocked));
    });
    if (hit) return hit;
  }
  return null;
}

function parseCount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const normalized = raw
    .replace(/\s/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');
  const number = Number(normalized.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(number) ? number : 0;
}

function detectQuantityField(rows, kind) {
  const patterns = kind === 'fleet'
    ? ['QUANTIDADE', 'QTDE', 'QTD', 'TOTAL', 'FROTA_ATIVA']
    : ['QUANTIDADE', 'QTDE', 'QTD', 'TOTAL'];
  return findField(rows, patterns);
}

function weightOf(row, quantityField) {
  return quantityField ? parseCount(row[quantityField]) : 1;
}

function looksLikeTargetCity(value) {
  const normalized = normalize(value);
  if (!normalized) return false;
  if (normalized.includes(CITY_KEY)) return true;
  return ['SAO', 'JOSE', 'CAMPOS'].every((token) => normalized.includes(token));
}

function filterCity(rows) {
  const keys = getKeys(rows);
  const likelyFields = keys.filter((key) => {
    const normalized = normalize(key);
    return normalized.includes('MUNICIPIO') || normalized.includes('CIDADE') || normalized.includes('LOCAL_DE_REALIZACAO') || normalized.includes('LOCAL_REALIZACAO');
  });

  for (const field of likelyFields) {
    const filtered = rows.filter((row) => looksLikeTargetCity(row[field]));
    if (filtered.length) return { rows: filtered, municipalityField: field };
  }

  const diagnostic = likelyFields.map((field) => {
    const samples = [...new Set(rows.slice(0, 500).map((row) => String(row[field] ?? '').trim()).filter(Boolean))].slice(0, 4);
    return `${field}=[${samples.join(' | ')}]`;
  }).join('; ');

  throw new Error(`no rows found for ${CITY}; candidate fields: ${diagnostic || 'none'}`);
}

function sumRows(rows, quantityField) {
  return rows.reduce((sum, row) => sum + weightOf(row, quantityField), 0);
}

function sumNumericField(rows, field) {
  if (!field) return 0;
  return rows.reduce((sum, row) => sum + parseCount(row[field]), 0);
}

function groupTop(rows, field, quantityField, limit = 8) {
  if (!field) return [];
  const grouped = new Map();
  for (const row of rows) {
    const raw = String(row[field] ?? '').trim();
    if (!raw) continue;
    const key = raw.replace(/\s+/g, ' ');
    grouped.set(key, (grouped.get(key) ?? 0) + weightOf(row, quantityField));
  }
  return [...grouped.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

function aggregateExam(cityRows) {
  const quantityField = detectQuantityField(cityRows, 'exam');
  const resultField = findField(cityRows, ['RESULTADO', 'SITUACAO']);
  const categoryField = findField(cityRows, ['CATEGORIA_DE_HABILITACAO', 'CATEGORIA_HABILITACAO', 'CATEGORIA'], ['CTB']);
  const approvedColumn = findField(cityRows, ['APROVADO'], ['REPROVADO']);
  const rejectedColumn = findField(cityRows, ['REPROVADO']);
  const absentColumn = findField(cityRows, ['FALTOSO', 'AUSENTE']);
  const cancelledColumn = findField(cityRows, ['CANCELADO']);

  let approved = 0;
  let rejected = 0;
  let absent = 0;
  let cancelled = 0;

  if (resultField) {
    for (const row of cityRows) {
      const result = normalize(row[resultField]);
      const weight = weightOf(row, quantityField);
      if (result.includes('REPROVADO')) rejected += weight;
      else if (result.includes('APROVADO')) approved += weight;
      else if (result.includes('FALTOSO') || result.includes('AUSENTE')) absent += weight;
      else if (result.includes('CANCELADO')) cancelled += weight;
    }
  } else {
    approved = sumNumericField(cityRows, approvedColumn);
    rejected = sumNumericField(cityRows, rejectedColumn);
    absent = sumNumericField(cityRows, absentColumn);
    cancelled = sumNumericField(cityRows, cancelledColumn);
  }

  const inferredTotal = approved + rejected + absent + cancelled;
  const total = Math.max(sumRows(cityRows, quantityField), inferredTotal);
  const decided = approved + rejected;

  return {
    total,
    approved,
    rejected,
    absent,
    cancelled,
    approvalRate: decided > 0 ? Number(((approved / decided) * 100).toFixed(1)) : null,
    categories: groupTop(cityRows, categoryField, quantityField, 8),
    schema: { quantityField, resultField, categoryField },
  };
}

function aggregateFleet(cityRows) {
  const quantityField = detectQuantityField(cityRows, 'fleet');
  const typeField = findField(cityRows, ['TIPO'], ['TIPO_PROPRIETARIO']);
  const fuelField = findField(cityRows, ['COMBUSTIVEL']);
  const speciesField = findField(cityRows, ['ESPECIE']);
  return {
    total: sumRows(cityRows, quantityField),
    topTypes: groupTop(cityRows, typeField, quantityField, 8),
    topFuels: groupTop(cityRows, fuelField, quantityField, 6),
    topSpecies: groupTop(cityRows, speciesField, quantityField, 6),
    schema: { quantityField, typeField, fuelField, speciesField },
  };
}

function aggregateInfractions(cityRows) {
  const quantityField = detectQuantityField(cityRows, 'infractions');
  const descriptionField = findField(cityRows, ['DESCRICAO_DO_ENQUADRAMENTO', 'DESCRICAO', 'ENQUADRAMENTO']);
  const codeField = findField(cityRows, ['CODIGO_DE_ENQUADRAMENTO', 'CODIGO_ENQUADRAMENTO']);
  return {
    total: sumRows(cityRows, quantityField),
    topDescriptions: groupTop(cityRows, descriptionField, quantityField, 10),
    topCodes: groupTop(cityRows, codeField, quantityField, 10),
    schema: { quantityField, descriptionField, codeField },
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'Centro-Transito/0.4 (+https://github.com/4LFR3Dv1/centro)' },
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.json();
}

async function fetchPackage(slug) {
  const payload = await fetchJson(`${CKAN}/package_show?id=${encodeURIComponent(slug)}`);
  if (!payload.success || !payload.result) throw new Error(`CKAN package_show failed for ${slug}`);
  return payload.result;
}

function csvResources(pkg) {
  return (pkg.resources ?? [])
    .filter((resource) => normalize(resource.format) === 'CSV' || String(resource.url ?? '').toLowerCase().includes('.csv'))
    .map((resource) => ({ ...resource, period: parsePeriod(resource.name ?? resource.description ?? '') }))
    .filter((resource) => resource.period)
    .sort((a, b) => b.period.localeCompare(a.period));
}

async function fetchResource(resource) {
  const response = await fetch(resource.url, {
    headers: { 'user-agent': 'Centro-Transito/0.4 (+https://github.com/4LFR3Dv1/centro)' },
    signal: AbortSignal.timeout(90000),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for resource ${resource.id}`);
  const buffer = await response.arrayBuffer();
  return {
    buffer,
    sha256: createHash('sha256').update(Buffer.from(buffer)).digest('hex'),
  };
}

async function buildSnapshot(definition, pkg, resource) {
  const { buffer, sha256 } = await fetchResource(resource);
  const parsed = parseCsv(buffer);
  const { rows: cityRows, municipalityField } = filterCity(parsed);
  const metrics = definition.kind === 'exam'
    ? aggregateExam(cityRows)
    : definition.kind === 'fleet'
      ? aggregateFleet(cityRows)
      : aggregateInfractions(cityRows);

  return {
    period: resource.period,
    rowCount: cityRows.length,
    municipalityField,
    sha256,
    resourceId: resource.id,
    resourceName: resource.name,
    resourcePage: `${DATASET_BASE}/${pkg.name}/resource/${resource.id}`,
    resourceUpdatedAt: resource.last_modified ?? resource.created ?? null,
    metrics,
  };
}

async function ingestDataset(definition) {
  const pkg = await fetchPackage(definition.slug);
  const resources = csvResources(pkg).slice(0, definition.history);
  if (!resources.length) throw new Error(`no dated CSV resources for ${definition.slug}`);

  const snapshots = [];
  for (const resource of resources.reverse()) {
    snapshots.push(await buildSnapshot(definition, pkg, resource));
  }

  return {
    status: 'ready',
    title: definition.title,
    dataset: definition.slug,
    datasetPage: `${DATASET_BASE}/${definition.slug}`,
    authority: 'Detran-SP · Dados Abertos SP',
    license: pkg.license_title ?? 'Creative Commons Attribution 4.0',
    catalogUpdatedAt: pkg.metadata_modified ?? null,
    latest: snapshots.at(-1),
    history: snapshots,
  };
}

async function loadPrevious() {
  try {
    return JSON.parse(await readFile(OUTPUT, 'utf8'));
  } catch {
    return { version: 1, city: CITY, cityKey: CITY_KEY, datasets: {} };
  }
}

const output = await loadPrevious();
output.version = 1;
output.city = CITY;
output.cityKey = CITY_KEY;
output.authority = 'Detran-SP · Portal de Dados Abertos do Estado de São Paulo';
output.datasetLicense = 'Creative Commons Attribution 4.0';
output.datasets ??= {};

const failures = [];
for (const definition of definitions) {
  process.stdout.write(`Centro data: ${definition.title}... `);
  try {
    output.datasets[definition.key] = await ingestDataset(definition);
    const latest = output.datasets[definition.key].latest;
    console.log(`${latest.period} · ${latest.rowCount} rows · total ${latest.metrics.total} ✓`);
    console.log(`  city field: ${latest.municipalityField}; schema: ${JSON.stringify(latest.metrics.schema)}`);
  } catch (error) {
    failures.push({ key: definition.key, error: error instanceof Error ? error.message : String(error) });
    console.log(`FAILED: ${failures.at(-1).error}`);
    if (!output.datasets[definition.key]) {
      output.datasets[definition.key] = {
        status: 'unavailable',
        title: definition.title,
        dataset: definition.slug,
        datasetPage: `${DATASET_BASE}/${definition.slug}`,
        authority: 'Detran-SP · Dados Abertos SP',
        latest: null,
        history: [],
      };
    }
  }
}

const readyPeriods = Object.values(output.datasets)
  .filter((dataset) => dataset?.status === 'ready' && dataset.latest?.period)
  .map((dataset) => dataset.latest.period)
  .sort();
output.latestPeriod = readyPeriods.at(-1) ?? null;
output.snapshotFingerprint = createHash('sha256')
  .update(Object.values(output.datasets).map((dataset) => dataset?.latest?.sha256 ?? 'missing').join('|'))
  .digest('hex');

await mkdir(dirname(OUTPUT.pathname), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

if (failures.length) {
  console.error(`Centro data: ${failures.length} dataset(s) failed.`);
  if (strict) process.exitCode = 1;
} else {
  console.log(`Centro data: ${CITY} materialized from ${definitions.length} official datasets.`);
}
