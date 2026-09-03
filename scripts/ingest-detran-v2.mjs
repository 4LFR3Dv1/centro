import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parse } from 'csv-parse/sync';

const CKAN = 'https://dadosabertos.sp.gov.br/api/3/action';
const DATASET_BASE = 'https://dadosabertos.sp.gov.br/dataset';
const OUTPUT = new URL('../src/generated/traffic-intelligence.json', import.meta.url);
const CITY = 'São José dos Campos';
const CITY_KEY = normalize(CITY);
// Código municipal usado nas bases federais/SIAFI e confirmado em documento oficial do Município.
const CITY_MUNICIPALITY_ID = '7099';
const strict = process.argv.includes('--strict');

const datasets = [
  ['practical', 'exames-praticos-realizados', 'Exames práticos', 'exam', 7],
  ['theory', 'exames-teoricos-realizados', 'Exames teóricos', 'exam', 7],
  ['fleet', 'frota-ativa', 'Frota ativa', 'fleet', 1],
  ['infractions', 'infracoes-lavradas', 'Infrações lavradas pelo Detran-SP', 'infractions', 1],
].map(([key, slug, title, kind, history]) => ({ key, slug, title, kind, history }));

const months = [
  ['JANEIRO','01'],['FEVEREIRO','02'],['MARCO','03'],['ABRIL','04'],['MAIO','05'],['JUNHO','06'],
  ['JULHO','07'],['AGOSTO','08'],['SETEMBRO','09'],['OUTUBRO','10'],['NOVEMBRO','11'],['DEZEMBRO','12'],
];

function normalize(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase();
}

function periodFrom(name) {
  const n = normalize(name);
  const year = n.match(/20\d{2}/)?.[0];
  if (!year) return null;
  const month = months.find(([label]) => n.includes(label))?.[1];
  return month ? `${year}-${month}` : null;
}

function decode(buffer) {
  const utf8 = new TextDecoder('utf-8').decode(buffer);
  if ((utf8.match(/�/g) ?? []).length <= 2) return utf8;
  try { return new TextDecoder('windows-1252').decode(buffer); }
  catch { return Buffer.from(buffer).toString('latin1'); }
}

function delimiterOf(text) {
  const header = text.split(/\r?\n/, 1)[0] ?? '';
  return [';', ',', '\t'].map((d) => [d, header.split(d).length])
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? ';';
}

function parseCsv(buffer) {
  const text = decode(buffer).replace(/^\uFEFF/, '');
  const base = { columns: true, skip_empty_lines: true, relax_column_count: true, delimiter: delimiterOf(text), trim: true, bom: true };
  try { return parse(text, { ...base, relax_quotes: true }); }
  catch (error) {
    console.warn(`CSV parser fallback: ${error instanceof Error ? error.message : String(error)}`);
    return parse(text, { ...base, quote: false });
  }
}

const keysOf = (rows) => Object.keys(rows[0] ?? {});

function field(rows, patterns, reject = []) {
  for (const pattern of patterns) {
    const found = keysOf(rows).find((key) => {
      const n = normalize(key);
      return n.includes(pattern) && !reject.some((blocked) => n.includes(blocked));
    });
    if (found) return found;
  }
  return null;
}

function number(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const n = Number(raw.replace(/\s/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function quantityField(rows, kind) {
  return field(rows, kind === 'fleet' ? ['QUANTIDADE','QTDE','QTD','TOTAL','FROTA_ATIVA'] : ['QUANTIDADE','QTDE','QTD','TOTAL']);
}
const weight = (row, q) => q ? number(row[q]) : 1;
const sum = (rows, q) => rows.reduce((total, row) => total + weight(row, q), 0);
const sumColumn = (rows, f) => f ? rows.reduce((total, row) => total + number(row[f]), 0) : 0;

function cityRows(rows) {
  const candidates = keysOf(rows).filter((key) => {
    const n = normalize(key);
    return n.includes('MUNICIPIO') || n.includes('CIDADE') || n.includes('LOCAL_DE_REALIZACAO') || n.includes('LOCAL_REALIZACAO');
  });

  // Prefer human-readable municipality fields.
  for (const f of candidates) {
    const selected = rows.filter((row) => {
      const n = normalize(row[f]);
      return n.includes(CITY_KEY) || ['SAO','JOSE','CAMPOS'].every((token) => n.includes(token));
    });
    if (selected.length) return { rows: selected, municipalityField: f, municipalitySelector: CITY };
  }

  // Some Detran datasets expose only ID_MUNICIPIO. 7099 is the official municipality code for São José dos Campos.
  for (const f of candidates.filter((key) => normalize(key).includes('ID_MUNICIPIO'))) {
    const selected = rows.filter((row) => String(row[f] ?? '').trim().replace(/^0+/, '') === CITY_MUNICIPALITY_ID);
    if (selected.length) return { rows: selected, municipalityField: f, municipalitySelector: CITY_MUNICIPALITY_ID };
  }

  const diagnostic = candidates.map((f) => `${f}=[${[...new Set(rows.slice(0, 500).map((r) => String(r[f] ?? '').trim()).filter(Boolean))].slice(0,4).join(' | ')}]`).join('; ');
  throw new Error(`no rows found for ${CITY}; candidate fields: ${diagnostic || 'none'}`);
}

function top(rows, f, q, limit = 8) {
  if (!f) return [];
  const grouped = new Map();
  for (const row of rows) {
    const label = String(row[f] ?? '').trim().replace(/\s+/g, ' ');
    if (!label) continue;
    grouped.set(label, (grouped.get(label) ?? 0) + weight(row, q));
  }
  return [...grouped.entries()].map(([label, value]) => ({ label, value })).sort((a,b) => b.value - a.value).slice(0, limit);
}

function examMetrics(rows) {
  const q = quantityField(rows, 'exam');
  const result = field(rows, ['RESULTADO','SITUACAO']);
  const category = field(rows, ['CATEGORIA_DE_HABILITACAO','CATEGORIA_HABILITACAO','CATEGORIA'], ['CTB']);
  const approvedField = field(rows, ['APROVADO'], ['REPROVADO']);
  const rejectedField = field(rows, ['REPROVADO']);
  const absentField = field(rows, ['FALTOSO','AUSENTE']);
  const cancelledField = field(rows, ['CANCELADO']);
  let approved = 0, rejected = 0, absent = 0, cancelled = 0;

  if (result) {
    for (const row of rows) {
      const n = normalize(row[result]);
      const w = weight(row, q);
      if (n.includes('REPROVADO')) rejected += w;
      else if (n.includes('APROVADO')) approved += w;
      else if (n.includes('FALTOSO') || n.includes('AUSENTE')) absent += w;
      else if (n.includes('CANCELADO')) cancelled += w;
    }
  } else {
    approved = sumColumn(rows, approvedField);
    rejected = sumColumn(rows, rejectedField);
    absent = sumColumn(rows, absentField);
    cancelled = sumColumn(rows, cancelledField);
  }

  const decided = approved + rejected;
  return {
    total: Math.max(sum(rows, q), approved + rejected + absent + cancelled),
    approved, rejected, absent, cancelled,
    approvalRate: decided ? Number((approved / decided * 100).toFixed(1)) : null,
    categories: top(rows, category, q, 8),
    schema: { quantityField: q, resultField: result, categoryField: category },
  };
}

function fleetMetrics(rows) {
  const q = quantityField(rows, 'fleet');
  const type = field(rows, ['TIPO'], ['TIPO_PROPRIETARIO']);
  const fuel = field(rows, ['COMBUSTIVEL']);
  const species = field(rows, ['ESPECIE']);
  return { total: sum(rows, q), topTypes: top(rows, type, q), topFuels: top(rows, fuel, q, 6), topSpecies: top(rows, species, q, 6), schema: { quantityField: q, typeField: type, fuelField: fuel, speciesField: species } };
}

function infractionMetrics(rows) {
  const q = quantityField(rows, 'infractions');
  const description = field(rows, ['DESCRICAO_DO_ENQUADRAMENTO','DESCRICAO_INFRACAO','DESCRICAO','ENQUADRAMENTO']);
  const code = field(rows, ['CODIGO_DE_ENQUADRAMENTO','CODIGO_ENQUADRAMENTO','CODIGO_INFRACAO']);
  return { total: sum(rows, q), topDescriptions: top(rows, description, q, 10), topCodes: top(rows, code, q, 10), schema: { quantityField: q, descriptionField: description, codeField: code } };
}

async function json(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'Centro-Transito/0.4' }, signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

async function packageFor(slug) {
  const payload = await json(`${CKAN}/package_show?id=${encodeURIComponent(slug)}`);
  if (!payload.success || !payload.result) throw new Error(`CKAN package_show failed: ${slug}`);
  return payload.result;
}

function resourcesOf(pkg) {
  return (pkg.resources ?? []).filter((r) => normalize(r.format) === 'CSV' || String(r.url ?? '').toLowerCase().includes('.csv'))
    .map((r) => ({ ...r, period: periodFrom(r.name ?? r.description ?? '') })).filter((r) => r.period)
    .sort((a,b) => b.period.localeCompare(a.period));
}

async function resourceBytes(resource) {
  const response = await fetch(resource.url, { headers: { 'user-agent': 'Centro-Transito/0.4' }, signal: AbortSignal.timeout(90000) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${resource.id}`);
  const buffer = await response.arrayBuffer();
  return { buffer, sha256: createHash('sha256').update(Buffer.from(buffer)).digest('hex') };
}

async function snapshot(definition, pkg, resource) {
  const { buffer, sha256 } = await resourceBytes(resource);
  const allRows = parseCsv(buffer);
  const selected = cityRows(allRows);
  const metrics = definition.kind === 'exam' ? examMetrics(selected.rows) : definition.kind === 'fleet' ? fleetMetrics(selected.rows) : infractionMetrics(selected.rows);
  if (!Number.isFinite(metrics.total) || metrics.total <= 0) throw new Error(`invalid zero total for ${definition.slug} ${resource.period}`);
  return {
    period: resource.period, rowCount: selected.rows.length,
    municipalityField: selected.municipalityField, municipalitySelector: selected.municipalitySelector,
    sha256, resourceId: resource.id, resourceName: resource.name,
    resourcePage: `${DATASET_BASE}/${pkg.name}/resource/${resource.id}`,
    resourceUpdatedAt: resource.last_modified ?? resource.created ?? null, metrics,
  };
}

async function ingest(definition) {
  const pkg = await packageFor(definition.slug);
  const resources = resourcesOf(pkg).slice(0, definition.history).reverse();
  if (!resources.length) throw new Error(`no dated CSV resources: ${definition.slug}`);
  const history = [];
  for (const resource of resources) history.push(await snapshot(definition, pkg, resource));
  return {
    status: 'ready', title: definition.title, dataset: definition.slug,
    datasetPage: `${DATASET_BASE}/${definition.slug}`, authority: 'Detran-SP · Dados Abertos SP',
    license: pkg.license_title ?? 'Creative Commons Attribution 4.0', catalogUpdatedAt: pkg.metadata_modified ?? null,
    latest: history.at(-1), history,
  };
}

async function previous() {
  try { return JSON.parse(await readFile(OUTPUT, 'utf8')); }
  catch { return { version: 1, city: CITY, cityKey: CITY_KEY, datasets: {} }; }
}

const output = await previous();
Object.assign(output, { version: 1, city: CITY, cityKey: CITY_KEY, authority: 'Detran-SP · Portal de Dados Abertos do Estado de São Paulo', datasetLicense: 'Creative Commons Attribution 4.0' });
output.datasets ??= {};
const failures = [];

for (const definition of datasets) {
  process.stdout.write(`Centro data: ${definition.title}... `);
  try {
    output.datasets[definition.key] = await ingest(definition);
    const latest = output.datasets[definition.key].latest;
    console.log(`${latest.period} · ${latest.rowCount} rows · total ${latest.metrics.total} ✓`);
    console.log(`  city: ${latest.municipalityField}=${latest.municipalitySelector}; schema: ${JSON.stringify(latest.metrics.schema)}`);
    if (definition.kind === 'exam') console.log(`  approved=${latest.metrics.approved}; rejected=${latest.metrics.rejected}; rate=${latest.metrics.approvalRate}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push({ key: definition.key, error: message });
    console.log(`FAILED: ${message}`);
    if (!output.datasets[definition.key]) output.datasets[definition.key] = { status: 'unavailable', title: definition.title, dataset: definition.slug, datasetPage: `${DATASET_BASE}/${definition.slug}`, authority: 'Detran-SP · Dados Abertos SP', latest: null, history: [] };
  }
}

const readyPeriods = Object.values(output.datasets).filter((d) => d?.status === 'ready' && d.latest?.period).map((d) => d.latest.period).sort();
output.latestPeriod = readyPeriods.at(-1) ?? null;
output.snapshotFingerprint = createHash('sha256').update(Object.values(output.datasets).map((d) => d?.latest?.sha256 ?? 'missing').join('|')).digest('hex');
await mkdir(dirname(OUTPUT.pathname), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

if (failures.length) {
  console.error(`Centro data: ${failures.length} dataset(s) failed.`);
  if (strict) process.exitCode = 1;
} else {
  console.log(`Centro data: ${CITY} materialized from ${datasets.length} official datasets.`);
}
