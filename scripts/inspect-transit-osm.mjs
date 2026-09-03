const OVERPASS = 'https://overpass-api.de/api/interpreter';
const bbox = '-23.35,-46.02,-23.05,-45.75';
const query = `[out:json][timeout:45];(relation[route=bus](${bbox});relation[route=light_rail](${bbox});relation[route=tram](${bbox});node[public_transport=station](${bbox});node[amenity=bus_station](${bbox}););out tags center;`;
const response = await fetch(OVERPASS, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'Centro-Transito/0.6' }, body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(60000) });
if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
const payload = await response.json();
const rows = payload.elements
  .map((el) => ({ type: el.type, id: el.id, name: el.tags?.name ?? '', ref: el.tags?.ref ?? '', route: el.tags?.route ?? '', network: el.tags?.network ?? '', operator: el.tags?.operator ?? '' }))
  .filter((row) => /linha verde|vlp|estacao sul|rodoviaria|mauricio cury|verde/i.test(`${row.name} ${row.ref} ${row.network} ${row.operator}`) || row.type === 'relation')
  .slice(0, 200);
console.log(JSON.stringify(rows, null, 2));