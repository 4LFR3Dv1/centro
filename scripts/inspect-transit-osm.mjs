import { readFile } from 'node:fs/promises';
const geojson = JSON.parse(await readFile('public/data/maps/sjc-transit.geojson', 'utf8'));
const stations = geojson.features
  .filter((feature) => feature.properties?.kind === 'linha-verde-station')
  .map((feature) => ({ sequence: feature.properties.sequence, name: feature.properties.name, source: feature.properties.coordinateSource, coordinates: feature.geometry.coordinates }));
console.log(JSON.stringify(stations, null, 2));
