import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OFFICIAL_TRANSPORT = 'https://www.sjc.sp.gov.br/servicos/mobilidade-urbana/transporte-coletivo/';
const OFFICIAL_LINE_GREEN = 'https://www.sjc.sp.gov.br/media/neim2fef/edital-de-chamamento_naming-rights.pdf';
const BBOX = { south: -23.35, west: -46.02, north: -23.05, east: -45.75 };
const VIEWBOX = `${BBOX.west},${BBOX.north},${BBOX.east},${BBOX.south}`;
const COORDINATE_REVISION = 2;
const GEOJSON_PATH = resolve('public/data/maps/sjc-transit.geojson');
const MANIFEST_PATH = resolve('public/data/maps/sjc-transit-manifest.json');
const SUMMARY_PATH = resolve('src/generated/transit-intelligence.json');
const strict = process.argv.includes('--strict');
const validateExisting = process.argv.includes('--validate-existing');

const STATIONS = [
  { name: 'Estação Terminal Sul', aliases: ['estacao sul', 'terminal sul'], queries: ['Rua Carlos Nunes de Paula, 1721, Jardim Colonial', 'Estrada do Imperador, Campo dos Alemães'] },
  { name: 'Estação Eldorado', aliases: ['eldorado'], queries: ['Estrada Velha Rio São Paulo, Eldorado', 'Estrada Velha RJ-SP, Eldorado'] },
  { name: 'Estação Vale do Sol', aliases: ['vale do sol'], queries: ['Rua Abaré, Jardim Vale do Sol', 'Residencial Morada do Sol'] },
  { name: 'Estação Jardim Morumbi', aliases: ['jardim morumbi', 'morumbi'], queries: ['Rua Francisco de Assis Dias, 1148, Cidade Morumbi', 'Rua Francisco de Assis Dias, Jardim Morumbi'] },
  { name: 'Estação Jardim Oriente', aliases: ['jardim oriente', 'oriente'], queries: ['Rua Mar Del Plata, 715, Jardim América', 'Rua Sumatra, Jardim Oriente'] },
  { name: 'Estação Jardim América', aliases: ['jardim america'], queries: ['Rua Kiyoshi Enomoto, 158, Jardim San Marino', 'Rua Arequipa, Jardim América'] },
  { name: 'Estação Jardim Satélite', aliases: ['jardim satelite', 'satelite'], queries: ['Avenida Doutor Sebastião Henrique da Cunha Pontes, 189, Palmeiras de São José', 'Rua Andaraí, Jardim Satélite'] },
  { name: 'Estação Dutra', aliases: ['estacao dutra', 'dutra'], queries: ['Avenida Andrômeda, 100, Jardim Satélite', 'Avenida Andrômeda, Jardim Satélite'] },
  { name: 'Estação Vila Sanches', aliases: ['vila sanches'], queries: ['Avenida Doutor Nelson D Avila, 1941, Vila Sanches', 'Avenida Doutor Nelson D Avila, 1880, Vila Sanches'] },
  { name: "Estação Nelson D'Ávila", aliases: ['nelson d avila', 'nelson davila'], queries: ['Avenida Doutor Nelson D Avila, 560, Jardim São Dimas', 'Praça Kennedy, Avenida Doutor Nelson D Avila'] },
  { name: 'Estação Praça Maurício Cury', aliases: ['mauricio cury'], queries: ['Avenida Doutor João Guilhermino, 46, Centro', 'Praça Maurício Cury, Centro'] },
  { name: 'Estação Vila Bandeirantes', aliases: ['vila bandeirantes', 'frederico ozanam', 'rodoviaria'], queries: ['Rua Antônio Porfírio da Silva, 150, Jardim Paulista', 'Terminal Rodoviário Frederico Ozanam, Jardim Paulista'] },
  { name: 'Estação Osvaldo Cruz', aliases: ['osvaldo cruz', 'oswaldo cruz'], queries: ['Avenida Deputado Benedito Matarazzo, 9403, Jardim Oswaldo Cruz', 'Avenida Deputado Benedito Matarazzo, Jardim Oswaldo Cruz'] },
];

const compact = (value = '') => String(value ?? '').replace(/\s+/g, ' ').trim();
const normalize = (value = '') => compact(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const digest = (value) => createHash('sha256').update(value).digest('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const inBounds = (lon, lat) => lon >= BBOX.west && lon <= BBOX.east && lat >= BBOX.south && lat <= BBOX.north;

function distanceMeters(a, b) {
  const rad = (value) => value * Math.PI / 180;
  const [lon1, lat1] = a; const [lon2, lat2] = b;
  const dLat = rad(lat2 - lat1); const dLon = rad(lon2 - lon1);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'user-agent': 'Centro-Transito/0.6', ...(options.headers ?? {}) }, signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

async function previousStations() {
  try {
    const raw = JSON.parse(await readFile(GEOJSON_PATH, 'utf8'));
    return new Map(raw.features
      .filter((feature) => feature.properties?.kind === 'linha-verde-station' && feature.properties?.coordinateRevision === COORDINATE_REVISION)
      .map((feature) => [feature.properties.name, feature.geometry.coordinates]));
  } catch { return new Map(); }
}

async function osmStops() {
  const bbox = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
  const query = `[out:json][timeout:60];(node[highway=bus_stop](${bbox});node[public_transport=platform](${bbox});node[public_transport=station](${bbox});node[amenity=bus_station](${bbox});way[public_transport=platform](${bbox});way[public_transport=station](${bbox});way[amenity=bus_station](${bbox});relation[public_transport=station](${bbox});relation[amenity=bus_station](${bbox}););out tags center;`;
  const payload = await fetchJson(OVERPASS, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ data: query }) });
  const seen = new Set(); const features = [];
  for (const element of payload.elements ?? []) {
    const lat = element.lat ?? element.center?.lat; const lon = element.lon ?? element.center?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inBounds(lon, lat)) continue;
    const key = `${Number(lat).toFixed(6)},${Number(lon).toFixed(6)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const terminal = element.tags?.amenity === 'bus_station' || element.tags?.public_transport === 'station';
    features.push({ type: 'Feature', id: `osm-${element.type}-${element.id}`, properties: {
      kind: terminal ? 'transit-terminal' : 'transit-stop',
      name: compact(element.tags?.name || element.tags?.ref || (terminal ? 'Terminal de transporte' : 'Parada de ônibus')),
      ref: compact(element.tags?.ref || ''), osmId: element.id,
    }, geometry: { type: 'Point', coordinates: [lon, lat] } });
  }
  return features;
}

function strictMappedStation(stopFeatures, station) {
  const aliases = [station.name, ...station.aliases].map(normalize).filter(Boolean);
  return stopFeatures.find((feature) => {
    const candidate = normalize(feature.properties?.name || '');
    return candidate.includes('linha verde') && aliases.some((alias) => candidate.includes(alias));
  }) ?? null;
}

async function boundedGeocode(queries) {
  for (const query of queries) {
    const params = new URLSearchParams({ q: `${query}, São José dos Campos, SP, Brasil`, format: 'jsonv2', limit: '3', countrycodes: 'br', 'accept-language': 'pt-BR', viewbox: VIEWBOX, bounded: '1' });
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
  const previous = await previousStations(); const features = [];
  for (let index = 0; index < STATIONS.length; index += 1) {
    const station = STATIONS[index];
    let coordinates = previous.get(station.name) ?? null;
    let coordinateSource = coordinates ? 'persisted-coordinate' : null;
    if (!coordinates) {
      coordinates = await boundedGeocode(station.queries);
      if (coordinates) coordinateSource = 'bounded-address-geocode';
    }
    if (!coordinates) {
      const mapped = strictMappedStation(stopFeatures, station);
      if (mapped) { coordinates = mapped.geometry.coordinates; coordinateSource = 'openstreetmap-linha-verde-point'; }
    }
    if (!coordinates) {
      coordinates = await boundedGeocode([station.name]);
      if (coordinates) coordinateSource = 'bounded-name-geocode';
    }
    if (!coordinates) throw new Error(`Could not resolve official Linha Verde station: ${station.name}`);
    features.push({ type: 'Feature', properties: {
      kind: 'linha-verde-station', name: station.name, sequence: index + 1,
      officialNameSource: OFFICIAL_LINE_GREEN, coordinateSource, coordinateRevision: COORDINATE_REVISION,
    }, geometry: { type: 'Point', coordinates } });
  }
  return features;
}

function validateStationGeometry(stations) {
  const ordered = [...stations].sort((a, b) => a.properties.sequence - b.properties.sequence);
  let routeChordLength = 0;
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]; const current = ordered[index];
    const distance = distanceMeters(previous.geometry.coordinates, current.geometry.coordinates);
    routeChordLength += distance;
    if (distance < 50) throw new Error(`Linha Verde stations collapse to the same point: ${previous.properties.name} / ${current.properties.name} (${Math.round(distance)}m)`);
    if (distance > 5500) throw new Error(`Implausible Linha Verde station jump: ${previous.properties.name} -> ${current.properties.name} (${Math.round(distance)}m)`);
  }
  if (routeChordLength < 7000 || routeChordLength > 25000) throw new Error(`Implausible Linha Verde station-chain length: ${Math.round(routeChordLength)}m`);
  return Math.round(routeChordLength);
}

function decodeHtml(value) {
  return value.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&aacute;/g, 'á').replace(/&atilde;/g, 'ã').replace(/&ccedil;/g, 'ç').replace(/&oacute;/g, 'ó').replace(/&#x27;|&#39;/g, "'");
}

async function officialRoutes() {
  const response = await fetch(OFFICIAL_TRANSPORT, { headers: { 'user-agent': 'Centro-Transito/0.6' }, signal: AbortSignal.timeout(45_000) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: official transport page`);
  const html = await response.text();
  const anchors = [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map((match) => decodeHtml(match[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()).filter(Boolean);
  const routes = [...new Set(anchors.filter((text) => /^\d{2,3}[A-Z]?\s+/.test(text) || /^LINHA VERDE\b/i.test(text)))];
  if (strict && routes.length < 50) throw new Error(`Official route directory unexpectedly small: ${routes.length}`);
  return routes;
}

function assertSnapshot(geojson, manifest, summary, raw) {
  if (geojson?.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) throw new Error('Invalid transit GeoJSON');
  const stations = geojson.features.filter((feature) => feature.properties?.kind === 'linha-verde-station');
  const transitPoints = geojson.features.filter((feature) => ['transit-stop', 'transit-terminal'].includes(feature.properties?.kind));
  if (stations.length !== 13) throw new Error(`Expected 13 Linha Verde stations, got ${stations.length}`);
  if (transitPoints.length < 100) throw new Error(`Transit point snapshot unexpectedly small: ${transitPoints.length}`);
  const stationChainMeters = validateStationGeometry(stations);
  if (manifest?.featureCount !== geojson.features.length) throw new Error('Transit featureCount mismatch');
  if (manifest?.sha256 !== digest(raw)) throw new Error('Transit digest mismatch');
  if (summary?.officialRouteDirectoryCount < 50) throw new Error('Official route directory count unexpectedly small');
  for (const feature of geojson.features) {
    const [lon, lat] = feature.geometry?.coordinates ?? [];
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !inBounds(lon, lat)) throw new Error('Transit point outside São José dos Campos bounds');
  }
  return { stations: stations.length, transitPoints: transitPoints.length, routes: summary.officialRouteDirectoryCount, stationChainMeters };
}

async function validatePersisted() {
  const [rawGeo, rawManifest, rawSummary] = await Promise.all([readFile(GEOJSON_PATH, 'utf8'), readFile(MANIFEST_PATH, 'utf8'), readFile(SUMMARY_PATH, 'utf8')]);
  const result = assertSnapshot(JSON.parse(rawGeo), JSON.parse(rawManifest), JSON.parse(rawSummary), rawGeo);
  console.log(`Validated transit snapshot: ${result.stations} Linha Verde stations · ${result.transitPoints} mapped stops/terminals · ${result.routes} official directory entries · station chain ${result.stationChainMeters}m`);
}

async function main() {
  if (validateExisting) return validatePersisted();
  const stopFeatures = await osmStops();
  const [stationFeatures, routes] = await Promise.all([resolveStations(stopFeatures), officialRoutes()]);
  const stationChainMeters = validateStationGeometry(stationFeatures);
  const geojson = { type: 'FeatureCollection', features: [...stopFeatures, ...stationFeatures] };
  const raw = `${JSON.stringify(geojson)}\n`;
  const summary = {
    version: 2, city: 'São José dos Campos', officialAuthority: 'Prefeitura de São José dos Campos · Mobilidade Urbana',
    officialTransportPage: OFFICIAL_TRANSPORT, officialLinhaVerdePage: OFFICIAL_LINE_GREEN,
    linhaVerde: { stationCount: 13, geometryStatus: 'stations-only', stationChainMeters, coordinateRevision: COORDINATE_REVISION },
    mappedStopsAndTerminals: stopFeatures.length, officialRouteDirectoryCount: routes.length, officialRouteDirectory: routes,
    note: 'Os nomes e a ordem das estações da Linha Verde vêm da Prefeitura. As coordenadas são resolvidas dentro de São José dos Campos e passam por validação geométrica. O Centro não desenha um traçado viário exato da Linha Verde sem geometria validada.',
  };
  const manifest = {
    schemaVersion: 2, area: 'São José dos Campos, SP, Brasil',
    source: { official: 'Prefeitura de São José dos Campos', mappedStops: 'OpenStreetMap via Overpass', stationCoordinates: 'bounded address geocoding / explicit Linha Verde OSM point / persisted coordinates', licenseOSM: 'ODbL 1.0' },
    featureCount: geojson.features.length, linhaVerdeStations: stationFeatures.length, stationChainMeters,
    mappedStopsAndTerminals: stopFeatures.length, sha256: digest(raw), artifact: '/data/maps/sjc-transit.geojson',
  };
  assertSnapshot(geojson, manifest, summary, raw);
  await Promise.all([mkdir(dirname(GEOJSON_PATH), { recursive: true }), mkdir(dirname(SUMMARY_PATH), { recursive: true })]);
  await Promise.all([writeFile(GEOJSON_PATH, raw), writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`), writeFile(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`)]);
  console.log(`Materialized ${stationFeatures.length} Linha Verde stations + ${stopFeatures.length} mapped public-transport points; route directory=${routes.length}; station chain=${stationChainMeters}m`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
