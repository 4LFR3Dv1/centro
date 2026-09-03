import { parse } from 'csv-parse/sync';

const CKAN = 'https://dadosabertos.sp.gov.br/api/3/action';
const DATASET = 'eventos-de-sinistro';
const CITY = 'SAO JOSE DOS CAMPOS';

function normalize(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase();
}

function periodFrom(name) {
  const n = normalize(name);
  const months = { JANEIRO:'01', FEVEREIRO:'02', MARCO:'03', ABRIL:'04', MAIO:'05', JUNHO:'06', JULHO:'07', AGOSTO:'08', SETEMBRO:'09', OUTUBRO:'10', NOVEMBRO:'11', DEZEMBRO:'12' };
  const year = n.match(/20\d{2}/)?.[0];
  const month = Object.entries(months).find(([label]) => n.includes(label))?.[1];
  return year && month ? `${year}-${month}` : null;
}

function decode(buffer) {
  const utf8 = new TextDecoder('utf-8').decode(buffer);
  if ((utf8.match(/�/g) ?? []).length <= 2) return utf8;
  return new TextDecoder('windows-1252').decode(buffer);
}

const pkgResponse = await fetch(`${CKAN}/package_show?id=${DATASET}`);
const pkg = (await pkgResponse.json()).result;
const resource = (pkg.resources ?? [])
  .filter((r) => normalize(r.format) === 'CSV')
  .map((r) => ({ ...r, period: periodFrom(r.name ?? '') }))
  .filter((r) => r.period)
  .sort((a,b) => b.period.localeCompare(a.period))[0];
if (!resource) throw new Error('No resource');
const response = await fetch(resource.url);
const text = decode(await response.arrayBuffer()).replace(/^\uFEFF/, '');
const header = text.split(/\r?\n/, 1)[0] ?? '';
const delimiter = [';', ',', '\t'].map((d) => [d, header.split(d).length]).sort((a,b) => b[1]-a[1])[0][0];
const rows = parse(text, { columns: true, skip_empty_lines: true, relax_column_count: true, relax_quotes: true, trim: true, delimiter });
const keys = Object.keys(rows[0] ?? {});
const municipalityKey = keys.find((key) => normalize(key).includes('MUNICIPIO'));
const cityRow = rows.find((row) => municipalityKey && normalize(row[municipalityKey]).includes(CITY));
console.log(`Latest resource: ${resource.period} · ${resource.name}`);
console.log(`Fields (${keys.length}): ${keys.join(' | ')}`);
if (cityRow) {
  console.log('São José sample:');
  for (const key of keys) console.log(`${key}=${String(cityRow[key] ?? '').slice(0,120)}`);
}
