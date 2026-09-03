import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parse } from 'csv-parse/sync';

const CKAN = 'https://dadosabertos.sp.gov.br/api/3/action';
const DATASET = 'eventos-de-sinistro';
const DATASET_PAGE = `https://dadosabertos.sp.gov.br/dataset/${DATASET}`;
const CITY = 'São José dos Campos';
const CITY_KEY = normalize(CITY);
const CITY_IBGE = '3549904';
const CITY_SIAFI = '7099';
const BBOX = { south: -23.35, west: -46.02, north: -23.05, east: -45.75 };
const MONTHS_BACK = 12;
const GEOJSON_PATH = resolve('public/data/maps/sjc-sinistros.geojson');
const MANIFEST_PATH = resolve('public/data/maps/sjc-sinistros-manifest.json');
const SUMMARY_PATH = resolve('src/generated/safety-intelligence.json');
const strict = process.argv.includes('--strict');
const validateExisting = process.argv.includes('--validate-existing');

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

const digest = (value) => createHash('sha256').update(value).digest('hex');
const compact = (value = '') => String(value ?? '').replace(/\s+/g, ' ').trim();

function decode(buffer) {
  const utf8 = new TextDecoder('utf-8').decode(buffer);
  if ((utf8.match(/�/g) ?? []).length <= 2) return utf8;
  try { return new TextDecoder('windows-1252').decode(buffer); }
  catch { return Buffer.from(buffer).toString('latin1'); }
}

function delimiterOf(text) {
  const header = text.split(/\r?\n/, 1)[0] ?? '';
  return [';', ',', '\t'].map((d) => [d, header.split(d).length]).sort((a,b) => b[1]-a[1])[0]?.[0] ?? ';';
}

function parseCsv(buffer) {
  const text = decode(buffer).replace(/^\uFEFF/, '');
  const base = { columns: true, skip_empty_lines: true, relax_column_count: true, delimiter: delimiterOf(text), trim: true, bom: true };
  try { return parse(text, { ...base, relax_quotes: true }); }
  catch { return parse(text, { ...base, quote: false }); }
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

function numeric(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const parsed = Number(raw.replace(/\s/g, '').replace(',', '.').replace(/[^0-9+.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function coordinate(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const parsed = Number(raw.replace(',', '.').replace(/[^0-9+.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function cityRows(rows) {
  const candidates = keysOf(rows).filter((key) => {
    const n = normalize(key);
    return n.includes('MUNICIPIO') || n.includes('CIDADE') || n.includes('CODIGO_IBGE') || n.includes('COD_IBGE');
  });
  for (const key of candidates) {
    const selected = rows.filter((row) => normalize(row[key]).includes(CITY_KEY));
    if (selected.length) return { rows: selected, field: key, selector: CITY };
  }
  for (const key of candidates) {
    const selected = rows.filter((row) => {
      const raw = String(row[key] ?? '').trim().replace(/^0+/, '');
      return raw === CITY_IBGE || raw === CITY_SIAFI;
    });
    if (selected.length) return { rows: selected, field: key, selector: String(selected[0]?.[key] ?? '').trim() };
  }
  throw new Error(`No rows found for ${CITY}. Candidate municipality fields: ${candidates.join(', ') || 'none'}`);
}

function top(rows, key, limit = 8) {
  if (!key) return [];
  const grouped = new Map();
  for (const row of rows) {
    const label = compact(row[key]);
    if (!label || normalize(label) === 'NAO_DISPONIVEL') continue;
    grouped.set(label, (grouped.get(label) ?? 0) + 1);
  }
  return [...grouped.entries()].map(([label,value]) => ({ label, value })).sort((a,b) => b.value-a.value).slice(0, limit);
}

function inBounds(lon, lat) {
  return lon >= BBOX.west && lon <= BBOX.east && lat >= BBOX.south && lat <= BBOX.north;
}

async function json(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'Centro-Transito/0.5' }, signal: AbortSignal.timeout(45_000) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

async function packageFor() {
  const payload = await json(`${CKAN}/package_show?id=${encodeURIComponent(DATASET)}`);
  if (!payload.success || !payload.result) throw new Error(`CKAN package_show failed: ${DATASET}`);
  return payload.result;
}

function resourcesOf(pkg) {
  return (pkg.resources ?? [])
    .filter((resource) => normalize(resource.format) === 'CSV' || String(resource.url ?? '').toLowerCase().includes('.csv'))
    .map((resource) => ({ ...resource, period: periodFrom(resource.name ?? resource.description ?? '') }))
    .filter((resource) => resource.period)
    .sort((a,b) => b.period.localeCompare(a.period))
    .slice(0, MONTHS_BACK)
    .reverse();
}

async function resourceBytes(resource) {
  const response = await fetch(resource.url, { headers: { 'user-agent': 'Centro-Transito/0.5' }, signal: AbortSignal.timeout(90_000) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${resource.id}`);
  const buffer = await response.arrayBuffer();
  return { buffer, sha256: createHash('sha256').update(Buffer.from(buffer)).digest('hex') };
}

function schemaFor(rows) {
  return {
    id: field(rows, ['ID_SINISTRO']),
    latitude: field(rows, ['LATITUDE']),
    longitude: field(rows, ['LONGITUDE']),
    type: field(rows, ['TP_SINISTRO_PRIMARIO','TIPO_DE_SINISTRO_PRIMARIO','TIPO_SINISTRO_PRIMARIO']),
    date: field(rows, ['DATA_SINISTRO','DATA_DO_SINISTRO']),
    hour: field(rows, ['HORA_SINISTRO','HORA_DO_SINISTRO']),
    turn: field(rows, ['TURNO']),
    roadType: field(rows, ['TIPO_VIA','CIRCUNSCRICAO']),
    street: field(rows, ['LOGRADOURO']),
    fatal: field(rows, ['QTD_GRAVIDADE_FATAL']),
    serious: field(rows, ['QTD_GRAVIDADE_GRAVE']),
    pedestrian: field(rows, ['QTD_PEDESTRE']),
    bicycle: field(rows, ['QTD_BICICLETA']),
    motorcycle: field(rows, ['QTD_MOTOCICLETA']),
    automobile: field(rows, ['QTD_AUTOMOVEL']),
    bus: field(rows, ['QTD_ONIBUS']),
    truck: field(rows, ['QTD_CAMINHAO']),
  };
}

function featureFrom(row, schema, period, resourceId) {
  const lat = coordinate(schema.latitude ? row[schema.latitude] : null);
  const lon = coordinate(schema.longitude ? row[schema.longitude] : null);
  if (lat === null || lon === null || !inBounds(lon, lat)) return null;
  const fatalVictims = numeric(schema.fatal ? row[schema.fatal] : 0);
  const seriousVictims = numeric(schema.serious ? row[schema.serious] : 0);
  return {
    type: 'Feature',
    id: compact(schema.id ? row[schema.id] : '') || undefined,
    properties: {
      period,
      date: compact(schema.date ? row[schema.date] : ''),
      hour: compact(schema.hour ? row[schema.hour] : ''),
      type: compact(schema.type ? row[schema.type] : ''),
      turn: compact(schema.turn ? row[schema.turn] : ''),
      roadType: compact(schema.roadType ? row[schema.roadType] : ''),
      street: compact(schema.street ? row[schema.street] : ''),
      fatal: fatalVictims > 0,
      fatalVictims,
      seriousVictims,
      pedestrian: numeric(schema.pedestrian ? row[schema.pedestrian] : 0),
      bicycle: numeric(schema.bicycle ? row[schema.bicycle] : 0),
      motorcycle: numeric(schema.motorcycle ? row[schema.motorcycle] : 0),
      automobile: numeric(schema.automobile ? row[schema.automobile] : 0),
      bus: numeric(schema.bus ? row[schema.bus] : 0),
      truck: numeric(schema.truck ? row[schema.truck] : 0),
      resourceId,
    },
    geometry: { type: 'Point', coordinates: [lon, lat] },
  };
}

function vehicleTotals(rows, schema) {
  const items = [
    ['Motocicletas', schema.motorcycle],
    ['Automóveis', schema.automobile],
    ['Pedestres', schema.pedestrian],
    ['Bicicletas', schema.bicycle],
    ['Caminhões', schema.truck],
    ['Ônibus', schema.bus],
  ].map(([label,key]) => ({ label, value: key ? rows.reduce((sum,row) => sum + numeric(row[key]), 0) : 0 }));
  return items.filter((item) => item.value > 0).sort((a,b) => b.value-a.value);
}

async function buildSnapshot() {
  const pkg = await packageFor();
  const resources = resourcesOf(pkg);
  if (!resources.length) throw new Error('No dated CSV resources found for Eventos de Sinistro');

  const features = [];
  const periods = [];
  const resourcesUsed = [];
  const allSelectedRows = [];
  let totalEvents = 0;
  let fatalEvents = 0;
  let fatalVictims = 0;
  let seriousVictims = 0;
  let municipalityField = null;
  let municipalitySelector = null;
  let latestSchema = null;

  for (const resource of resources) {
    const { buffer, sha256 } = await resourceBytes(resource);
    const rows = parseCsv(buffer);
    const selected = cityRows(rows);
    const schema = schemaFor(selected.rows);
    if (!schema.latitude || !schema.longitude || !schema.type || !schema.fatal) {
      throw new Error(`Required Infosiga fields missing in ${resource.name}; schema=${JSON.stringify(schema)}; fields=${keysOf(selected.rows).join(',')}`);
    }

    municipalityField ??= selected.field;
    municipalitySelector ??= selected.selector;
    latestSchema = schema;
    totalEvents += selected.rows.length;
    allSelectedRows.push(...selected.rows);

    let geocoded = 0;
    let periodFatalEvents = 0;
    let periodFatalVictims = 0;
    for (const row of selected.rows) {
      const fatalities = numeric(row[schema.fatal]);
      if (fatalities > 0) periodFatalEvents += 1;
      periodFatalVictims += fatalities;
      seriousVictims += numeric(schema.serious ? row[schema.serious] : 0);
      const feature = featureFrom(row, schema, resource.period, resource.id);
      if (feature) { features.push(feature); geocoded += 1; }
    }
    fatalEvents += periodFatalEvents;
    fatalVictims += periodFatalVictims;
    periods.push({ period: resource.period, total: selected.rows.length, geocoded, fatalEvents: periodFatalEvents, fatalVictims: periodFatalVictims });
    resourcesUsed.push({
      period: resource.period,
      id: resource.id,
      name: resource.name,
      sha256,
      updatedAt: resource.last_modified ?? resource.created ?? null,
      page: `${DATASET_PAGE}/resource/${resource.id}`,
    });
  }

  const geojson = { type: 'FeatureCollection', features };
  const canonicalGeoJson = `${JSON.stringify(geojson)}\n`;
  const sha256 = digest(canonicalGeoJson);
  const latestPeriod = periods.at(-1)?.period ?? null;

  const summary = {
    version: 2,
    city: CITY,
    authority: 'Detran-SP · Infosiga · Dados Abertos SP',
    dataset: DATASET,
    datasetPage: DATASET_PAGE,
    license: pkg.license_title ?? 'Creative Commons Attribution 4.0',
    latestPeriod,
    range: { from: periods[0]?.period ?? null, to: latestPeriod, months: periods.length },
    metrics: {
      total: totalEvents,
      geocoded: features.length,
      geocodedRate: totalEvents ? Number((features.length / totalEvents * 100).toFixed(1)) : null,
      fatalEvents,
      fatalVictims,
      seriousVictims,
      topTypes: top(allSelectedRows, latestSchema.type, 8),
      topTurns: top(allSelectedRows, latestSchema.turn, 6),
      topRoadTypes: top(allSelectedRows, latestSchema.roadType, 6),
      involved: vehicleTotals(allSelectedRows, latestSchema),
    },
    periods,
    schema: { municipalityField, municipalitySelector, ...latestSchema },
    snapshotFingerprint: digest(resourcesUsed.map((resource) => resource.sha256).join('|')),
    mapArtifact: '/data/maps/sjc-sinistros.geojson',
    mapManifest: '/data/maps/sjc-sinistros-manifest.json',
  };

  const manifest = {
    schemaVersion: 2,
    area: `${CITY}, SP, Brasil`,
    bbox: [BBOX.south, BBOX.west, BBOX.north, BBOX.east],
    source: { name: 'Detran-SP · Infosiga', dataset: DATASET, license: summary.license },
    range: summary.range,
    eventCount: totalEvents,
    featureCount: features.length,
    geocodedRate: summary.metrics.geocodedRate,
    sha256,
    resources: resourcesUsed,
    artifact: '/data/maps/sjc-sinistros.geojson',
  };

  return { geojson, canonicalGeoJson, manifest, summary };
}

function assertSnapshot(geojson, manifest, summary, rawGeoJson) {
  if (geojson?.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) throw new Error('Invalid safety GeoJSON');
  if (geojson.features.length < 20) throw new Error(`Unexpectedly small geocoded safety snapshot: ${geojson.features.length}`);
  if (manifest?.schemaVersion !== 2 || summary?.version !== 2) throw new Error('Unexpected safety snapshot schema version');
  if (manifest.featureCount !== geojson.features.length) throw new Error('Safety manifest featureCount mismatch');
  if (manifest.eventCount !== summary?.metrics?.total) throw new Error('Safety summary eventCount mismatch');
  if (manifest.sha256 !== digest(rawGeoJson)) throw new Error('Safety snapshot digest mismatch');
  if (!summary?.metrics?.topTypes?.length) throw new Error('Safety snapshot has no event type breakdown');
  if (!summary?.metrics?.involved?.length) throw new Error('Safety snapshot has no road-user breakdown');
  if (!summary?.range?.months || summary.range.months < 1) throw new Error('Safety snapshot has no period range');
  for (const feature of geojson.features) {
    const [lon, lat] = feature?.geometry?.coordinates ?? [];
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !inBounds(lon, lat)) throw new Error('Safety point outside São José bounding box');
    if (!feature?.properties?.type) throw new Error('Geocoded safety point without event type');
  }
  return { features: geojson.features.length, total: summary.metrics.total, latestPeriod: summary.latestPeriod };
}

async function validatePersisted() {
  const [rawGeoJson, rawManifest, rawSummary] = await Promise.all([
    readFile(GEOJSON_PATH, 'utf8'), readFile(MANIFEST_PATH, 'utf8'), readFile(SUMMARY_PATH, 'utf8'),
  ]);
  const result = assertSnapshot(JSON.parse(rawGeoJson), JSON.parse(rawManifest), JSON.parse(rawSummary), rawGeoJson);
  console.log(`Validated ${result.features}/${result.total} geocoded sinistros through ${result.latestPeriod}`);
}

async function main() {
  if (validateExisting) { await validatePersisted(); return; }
  const snapshot = await buildSnapshot();
  if (strict && snapshot.summary.metrics.geocodedRate !== null && snapshot.summary.metrics.geocodedRate < 20) {
    throw new Error(`Unexpectedly low geocoding rate: ${snapshot.summary.metrics.geocodedRate}%`);
  }
  await Promise.all([mkdir(dirname(GEOJSON_PATH), { recursive: true }), mkdir(dirname(SUMMARY_PATH), { recursive: true })]);
  await writeFile(GEOJSON_PATH, snapshot.canonicalGeoJson);
  await writeFile(MANIFEST_PATH, `${JSON.stringify(snapshot.manifest, null, 2)}\n`);
  await writeFile(SUMMARY_PATH, `${JSON.stringify(snapshot.summary, null, 2)}\n`);
  console.log(`Materialized ${snapshot.summary.metrics.geocoded}/${snapshot.summary.metrics.total} geocoded sinistros (${snapshot.summary.range.from} → ${snapshot.summary.range.to})`);
  console.log(`Fatal events=${snapshot.summary.metrics.fatalEvents}; fatal victims=${snapshot.summary.metrics.fatalVictims}; top type=${snapshot.summary.metrics.topTypes[0]?.label ?? 'n/a'}`);
}

main().catch((error) => { console.error(error instanceof Error ? error.stack : error); process.exitCode = 1; });
