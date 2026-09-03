import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const OVERPASS_URL = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const CITY_BBOX = '-23.35,-46.02,-23.05,-45.75';
const GEOJSON_PATH = resolve('public/data/maps/sjc-cycleways.geojson');
const MANIFEST_PATH = resolve('public/data/maps/sjc-map-manifest.json');
const strict = process.argv.includes('--strict');
const checkOnly = process.argv.includes('--check');
const validateExisting = process.argv.includes('--validate-existing');

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function compact(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

function overpassQuery() {
  return `[out:json][timeout:45];(
    way["highway"="cycleway"](${CITY_BBOX});
    way["cycleway"](${CITY_BBOX});
    way["cycleway:left"](${CITY_BBOX});
    way["cycleway:right"](${CITY_BBOX});
  );out tags geom;`;
}

function normalize(payload) {
  const seen = new Set();
  const features = [];

  for (const element of payload.elements ?? []) {
    if (element.type !== 'way' || !Array.isArray(element.geometry) || element.geometry.length < 2) continue;
    if (seen.has(element.id)) continue;
    seen.add(element.id);

    const coordinates = element.geometry
      .map((point) => [Number(point.lon), Number(point.lat)])
      .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));
    if (coordinates.length < 2) continue;

    const tags = element.tags ?? {};
    features.push({
      type: 'Feature',
      id: element.id,
      properties: {
        osmId: element.id,
        name: compact(tags.name),
        highway: compact(tags.highway),
        cycleway: compact(tags.cycleway),
        cyclewayLeft: compact(tags['cycleway:left']),
        cyclewayRight: compact(tags['cycleway:right']),
        surface: compact(tags.surface),
      },
      geometry: { type: 'LineString', coordinates },
    });
  }

  features.sort((a, b) => Number(a.id) - Number(b.id));
  return { type: 'FeatureCollection', features };
}

async function fetchSnapshot() {
  const response = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'User-Agent': 'CentroTraffic/0.4 (+https://centro-web-production.up.railway.app)',
    },
    body: `data=${encodeURIComponent(overpassQuery())}`,
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Overpass responded ${response.status}`);
  return response.json();
}

async function existingManifest() {
  try {
    return JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function assertSnapshot(geojson, manifest, rawGeoJson) {
  if (geojson?.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
    throw new Error('Invalid cycleway GeoJSON snapshot');
  }
  if (geojson.features.length < 10) {
    throw new Error(`Unexpectedly small cycleway snapshot: ${geojson.features.length} features`);
  }
  if (manifest?.schemaVersion !== 1 || manifest?.artifact !== '/data/maps/sjc-cycleways.geojson') {
    throw new Error('Invalid map manifest contract');
  }
  if (manifest.featureCount !== geojson.features.length) {
    throw new Error(`Manifest featureCount mismatch: ${manifest.featureCount} != ${geojson.features.length}`);
  }
  const sha256 = digest(rawGeoJson);
  if (manifest.sha256 !== sha256) {
    throw new Error(`Map snapshot digest mismatch: ${manifest.sha256} != ${sha256}`);
  }
  return { featureCount: geojson.features.length, sha256 };
}

async function validatePersistedSnapshot() {
  const [rawGeoJson, rawManifest] = await Promise.all([
    readFile(GEOJSON_PATH, 'utf8'),
    readFile(MANIFEST_PATH, 'utf8'),
  ]);
  const geojson = JSON.parse(rawGeoJson);
  const manifest = JSON.parse(rawManifest);
  const result = assertSnapshot(geojson, manifest, rawGeoJson);
  console.log(`Validated ${result.featureCount} persisted cycleway features (${result.sha256.slice(0, 12)})`);
}

async function main() {
  if (validateExisting) {
    await validatePersistedSnapshot();
    return;
  }

  const payload = await fetchSnapshot();
  const geojson = normalize(payload);
  if (geojson.features.length === 0) throw new Error('No cycleway geometry returned for São José dos Campos');

  const canonicalGeoJson = `${JSON.stringify(geojson)}\n`;
  const sha256 = digest(canonicalGeoJson);
  const previous = await existingManifest();
  const retrievedAt = previous?.sha256 === sha256 && previous?.retrievedAt
    ? previous.retrievedAt
    : new Date().toISOString();

  const manifest = {
    schemaVersion: 1,
    area: 'São José dos Campos, SP, Brasil',
    bbox: CITY_BBOX.split(',').map(Number),
    source: {
      name: 'OpenStreetMap',
      transport: 'Overpass API',
      endpoint: OVERPASS_URL,
      license: 'ODbL 1.0',
    },
    retrievedAt,
    featureCount: geojson.features.length,
    sha256,
    artifact: '/data/maps/sjc-cycleways.geojson',
  };

  if (strict && manifest.featureCount < 10) {
    throw new Error(`Unexpectedly small cycleway snapshot: ${manifest.featureCount} features`);
  }

  if (checkOnly) {
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  await mkdir(dirname(GEOJSON_PATH), { recursive: true });
  await writeFile(GEOJSON_PATH, canonicalGeoJson);
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Materialized ${manifest.featureCount} cycleway features (${sha256.slice(0, 12)})`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
