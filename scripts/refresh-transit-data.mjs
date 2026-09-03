import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OFFICIAL_TRANSPORT = 'https://www.sjc.sp.gov.br/servicos/mobilidade-urbana/transporte-coletivo/';
const OFFICIAL_LINE_GREEN = 'https://www.sjc.sp.gov.br/noticias/2022/agosto/31/sao-jose-retoma-chamamento-para-naming-rights-da-linha-verde/';
const BBOX = { south: -23.35, west: -46.02, north: -23.05, east: -45.75 };
const VIEWBOX = `${BBOX.west},${BBOX.north},${BBOX.east},${BBOX.south}`;
const GEOJSON_PATH = resolve('public/data/maps/sjc-transit.geojson');
const MANIFEST_PATH = resolve('public/data/maps/sjc-transit-manifest.json');
const SUMMARY_PATH = resolve('src/generated/transit-intelligence.json');
const strict = process.argv.includes('--strict');
const validateExisting = process.argv.includes('--validate-existing');

const stations = [
  ['Estação Terminal Sul', 'Estrada do Imperador, Campo dos Alemães', ['terminal sul', 'estacao sul']],
  ['Estação Eldorado', 'Estrada Velha Rio São Paulo, Eldorado', ['eldorado']],
  ['Estação Vale do Sol', 'Rua Abaré, Vale do Sol', ['vale do sol']],
  ['Estação Jardim Morumbi', 'Rua Francisco de Assis Dias, Jardim Morumbi', ['jardim morumbi', 'morumbi']],
  ['Estação Jardim Oriente', 'Rua Sumatra, Jardim Oriente', ['jardim oriente', 'oriente']],
  ['Estação Jardim América', 'Rua Arequipa, Jardim América', ['jardim america']],
  ['Estação Jardim Satélite', 'Rua Andaraí, Jardim Satélite', ['jardim satelite', 'satelite']],
  ['Estação Dutra', 'Avenida Andrômeda, Jardim Satélite', ['estacao dutra', 'dutra']],
  ['Estação Vila Sanches', 'Avenida Doutor Nelson D Avila, Vila Sanches', ['vila sanches']],
  ["Estação Nelson D'Ávila", "Praça Kennedy, Avenida Doutor Nelson D Avila", ['nelson d avila', 'nelson davila']],
  ['Estação Maurício Cury', 'Praça Maurício Cury, Centro', ['mauricio cury']],
  ['Estação Vila Bandeirantes', 'Terminal Rodoviário Frederico Ozanam, Jardim Paulista', ['vila bandeirantes', 'frederico ozanam', 'rodoviaria']],
  ['Estação Jardim Oswaldo Cruz', 'Avenida Deputado Benedito Matarazzo, Jardim Oswaldo Cruz', ['jardim oswaldo cruz', 'oswaldo cruz']],
];

const compact = (value = '') => String(value ?? '').replace(/\s+/g, ' ').trim();
const normalize = (value = '') => compact(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const digest = (value) => createHash('sha256').update(value).digest('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function inBounds(lon, lat) { return lon >= BBOX.west && lon <= BBOX.east && lat >= BBOX.south && lat <= BBOX.north; }

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'user-agent': 'Centro-Transito/0.6', ...(options.headers ?? {}) }, signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

async function previousStations() {
  try {
    const raw = JSON.parse(await readFile(GEOJSON_PATH, 'utf8'));
    return new Map(raw.features.filter((f) => f.properties?.kind === 'linha-verde-station').map((f) => [f.properties.name, f.geometry.coordinates]));
  } catch { return new Map(); }
}

async function osmStops() {
  const bbox = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
  const query = `[out:json][timeout:60];(node[highway=bus_stop](${bbox});node[public_transport=platform](${bbox});node[public_transport=station](${bbox});node[amenity=bus_station](${bbox});way[public_transport=platform](${bbox});way[public_transport=station](${bbox});way[amenity=bus_station](${bbox});relation[public_transport=station](${bbox});relation[amenity=bus_station](${bbox}););out tags center;`;
  const payload = await fetchJson(OVERPASS, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ data: query }) });
  const seen = new Set();
  const features = [];
  for (const element of payload.elements ?? []) {
    const lat = element.lat ?? element.center?.lat; const lon = element.lon ?? element.center?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inBounds(lon, lat)) continue;
    const key = `${Number(lat).toFixed(6)},${Number(lon).toFixed(6)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const terminal = element.tags?.amenity === 'bus_station' || element.tags?.public_transport === 'station';
    features.push({
      type: 'Feature',
      id: `osm-${element.type}-${element.id}`,
      properties: { kind: terminal ? 'transit-terminal' : 'transit-stop', name: compact(element.tags?.name || element.tags?.ref || (terminal ? 'Terminal de transporte' : 'Parada de ônibus')), ref: compact(element.tags?.ref || ''), osmId: element.id },
      geometry: { type: 'Point', coordinates: [lon, lat] },
    });
  }
  return features;
}

function findMappedStation(stopFeatures, aliases) {
  const normalizedAliases = aliases.map(normalize).filter(Boolean);
  return stopFeatures.find((feature) => {
    const candidate = normalize(feature.properties?.name || '');
    return candidate && normalizedAliases.some((alias) => candidate.includes(alias) || alias.includes(candidate));
  }) ?? null;
}

async function geocodeStation(name, address) {
  const queries = [`${name}, São José dos Campos, SP, Brasil`, `${address}, São José dos Campos, SP, Brasil`];
  for (const q of queries) {
    const params = new URLSearchParams({ q, format: 'jsonv2', limit: '3', countrycodes: 'br', 'accept-language': 'pt-BR', viewbox: VIEWBOX, bounded: '1' });
    const results = await fetchJson(`${NOMINATIM}?${params.toString()}`);
    for (const result of results) {
      const lon = Number(result.lon); const lat = Number(result.lat);
      if (Number.isFinite(lon) && Number.isFinite(lat) && inBounds(lon, lat)) return [lon, lat];
    }
    await sleep(1150);
  }
  return null;
}

async function resolveStations(stopFeatures) {
  const previous = await previousStations();
  const features = [];
  for (let index = 0; index < stations.length; index += 1) {
    const [name, address, aliases] = stations[index];
    let coordinates = previous.get(name) ?? null;
    let coordinateSource = coordinates ? 'persisted-geocode' : null;
    if (!coordinates) {
      const mapped = findMappedStation(stopFeatures, [name, ...aliases]);
      if (mapped) { coordinates = mapped.geometry.coordinates; coordinateSource = 'openstreetmap-transit-point'; }
    }
    if (!coordinates) {
      coordinates = await geocodeStation(name, address);
      if (coordinates) coordinateSource = 'nominatim';
    }
    if (!coordinates) throw new Error(`Could not resolve official Linha Verde station: ${name}`);
    features.push({
      type: 'Feature',
      properties: { kind: 'linha-verde-station', name, sequence: index + 1, officialNameSource: OFFICIAL_LINE_GREEN, coordinateSource },
      geometry: { type: 'Point', coordinates },
    });
  }
  return features;
}

function decodeHtml(value) {
  return value.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&aacute;/g, 'á').replace(/&atilde;/g, 'ã').replace(/&ccedil;/g, 'ç').replace(/&oacute;/g, 'ó').replace(/&#x27;|&#39;/g, "'");
}

async function officialRoutes() {
  const response = await fetch(OFFICIAL_TRANSPORT, { headers: { 'user-agent': 'Centro-Transito/0.6' }, signal: AbortSignal.timeout(45_000) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: official transport page`);
  const html = await response.text();
  const anchors = [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => decodeHtml(match[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const routes = [...new Set(anchors.filter((text) => /^\d{2,3}[A-Z]?\s+/.test(text) || /^LINHA VERDE\b/i.test(text)))];
  if (strict && routes.length < 50) throw new Error(`Official route directory unexpectedly small: ${routes.length}`);
  return routes;
}

function assertSnapshot(geojson, manifest, summary, raw) {
  if (geojson?.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) throw new Error('Invalid transit GeoJSON');
  const stationsFound = geojson.features.filter((f) => f.properties?.kind === 'linha-verde-station');
  const stops = geojson.features.filter((f) => f.properties?.kind === 'transit-stop' || f.properties?.kind === 'transit-terminal');
  if (stationsFound.length !== 13) throw new Error(`Expected 13 Linha Verde stations, got ${stationsFound.length}`);
  if (stops.length < 100) throw new Error(`Transit stop snapshot unexpectedly small: ${stops.length}`);
  if (manifest?.featureCount !== geojson.features.length) throw new Error('Transit featureCount mismatch');
  if (manifest?.sha256 !== digest(raw)) throw new Error('Transit digest mismatch');
  if (summary?.officialRouteDirectoryCount < 50) throw new Error('Official route directory count unexpectedly small');
  for (const feature of geojson.features) {
    const [lon, lat] = feature.geometry?.coordinates ?? [];
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !inBounds(lon, lat)) throw new Error('Transit point outside SJC bounds');
  }
  return { stations: stationsFound.length, stops: stops.length, routes: summary.officialRouteDirectoryCount };
}

async function validatePersisted() {
  const [rawGeo, rawManifest, rawSummary] = await Promise.all([readFile(GEOJSON_PATH, 'utf8'), readFile(MANIFEST_PATH, 'utf8'), readFile(SUMMARY_PATH, 'utf8')]);
  const result = assertSnapshot(JSON.parse(rawGeo), JSON.parse(rawManifest), JSON.parse(rawSummary), rawGeo);
  console.log(`Validated transit snapshot: ${result.stations} Linha Verde stations · ${result.stops} mapped stops/terminals · ${result.routes} official directory entries`);
}

async function main() {
  if (validateExisting) return validatePersisted();
  const stopFeatures = await osmStops();
  const [stationFeatures, routes] = await Promise.all([resolveStations(stopFeatures), officialRoutes()]);
  const geojson = { type: 'FeatureCollection', features: [...stopFeatures, ...stationFeatures] };
  const raw = `${JSON.stringify(geojson)}\n`;
  const summary = {
    version: 1,
    city: 'São José dos Campos',
    officialAuthority: 'Prefeitura de São José dos Campos · Mobilidade Urbana',
    officialTransportPage: OFFICIAL_TRANSPORT,
    officialLinhaVerdePage: OFFICIAL_LINE_GREEN,
    linhaVerde: { stationCount: 13, destinations: ['Centro', 'Rodoviária'], geometryStatus: 'stations-only' },
    mappedStopsAndTerminals: stopFeatures.length,
    officialRouteDirectoryCount: routes.length,
    officialRouteDirectory: routes,
    note: 'Linha Verde station names come from the Prefeitura. Coordinates are resolved from mapped transit points or bounded geocoding. The Centro does not draw an unverified street-level Linha Verde route geometry.',
  };
  const manifest = {
    schemaVersion: 1,
    area: 'São José dos Campos, SP, Brasil',
    source: { official: 'Prefeitura de São José dos Campos', mappedStops: 'OpenStreetMap via Overpass', stationCoordinates: 'OSM transit points / Nominatim / persisted geocode', licenseOSM: 'ODbL 1.0' },
    featureCount: geojson.features.length,
    linhaVerdeStations: stationFeatures.length,
    mappedStopsAndTerminals: stopFeatures.length,
    sha256: digest(raw),
    artifact: '/data/maps/sjc-transit.geojson',
  };
  assertSnapshot(geojson, manifest, summary, raw);
  await Promise.all([mkdir(dirname(GEOJSON_PATH), { recursive: true }), mkdir(dirname(SUMMARY_PATH), { recursive: true })]);
  await Promise.all([writeFile(GEOJSON_PATH, raw), writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`), writeFile(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`)]);
  console.log(`Materialized ${stationFeatures.length} Linha Verde stations + ${stopFeatures.length} mapped public-transport points; official directory entries=${routes.length}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
