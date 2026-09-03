import { GeolocateControl, Map, Marker, NavigationControl, Popup, type MapGeoJSONFeature, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './home-map.css';

type SearchResult = { display_name: string; lat: string; lon: string };
type CycleGeoJson = {
  type: 'FeatureCollection';
  features: Array<{ type: 'Feature'; id?: number; properties?: Record<string, unknown>; geometry: { type: 'LineString'; coordinates: number[][] } }>;
};
type SafetyGeoJson = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    id?: string;
    properties?: {
      period?: string; date?: string; hour?: string; type?: string; turn?: string; roadType?: string; street?: string;
      fatal?: boolean; fatalVictims?: number; seriousVictims?: number;
      pedestrian?: number; bicycle?: number; motorcycle?: number; automobile?: number; bus?: number; truck?: number;
    };
    geometry: { type: 'Point'; coordinates: [number, number] };
  }>;
};
type MapManifest = { retrievedAt?: string; featureCount?: number; sha256?: string };
type SafetyManifest = {
  featureCount?: number;
  eventCount?: number;
  geocodedRate?: number;
  range?: { from?: string | null; to?: string | null; months?: number };
};

const BASE_SOURCE_ID = 'centro-osm-basemap';
const BASE_LAYER_ID = 'centro-osm-basemap-layer';
const BASEMAP_TIMEOUT_MS = 10_000;
const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const CYCLEWAYS_URL = '/data/maps/sjc-cycleways.geojson';
const MAP_MANIFEST_URL = '/data/maps/sjc-map-manifest.json';
const SAFETY_URL = '/data/maps/sjc-sinistros.geojson';
const SAFETY_MANIFEST_URL = '/data/maps/sjc-sinistros-manifest.json';
const SCHOOL_QUERY = 'Avenida São José, 1009';
const CITY_CENTER: [number, number] = [-45.8872, -23.1896];
const SEARCH_VIEWBOX = '-46.02,-23.05,-45.75,-23.35';
const SEARCH_CACHE = 'centro.map.search.v1:';

const BASEMAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    [BASE_SOURCE_ID]: {
      type: 'raster',
      tiles: [OSM_TILE_URL],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 19,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: BASE_LAYER_ID, type: 'raster', source: BASE_SOURCE_ID, minzoom: 0, maxzoom: 19 }],
};

let active: { anchor: Element; section: HTMLElement; map: Map; watchdog: number | null } | null = null;
let lastSearchAt = 0;
let cycleSnapshot: CycleGeoJson | null = null;
let cycleManifest: MapManifest | null = null;
let safetySnapshot: SafetyGeoJson | null = null;
let safetyManifest: SafetyManifest | null = null;

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const compact = (value: string) => value.replace(/\s+/g, ' ').trim();
const count = (value: number | null | undefined) => Number.isFinite(value) ? new Intl.NumberFormat('pt-BR').format(value as number) : '—';

function periodLabel(period?: string | null) {
  if (!period) return '';
  const [year, month] = period.split('-').map(Number);
  if (!year || !month) return period;
  return new Intl.DateTimeFormat('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function status(node: HTMLElement, message: string, isError = false) {
  node.textContent = message;
  node.dataset.tone = isError ? 'error' : 'normal';
}

function sectionMarkup() {
  const section = document.createElement('section');
  section.className = 'home-map-explorer';
  section.dataset.mapState = 'loading';
  section.innerHTML = `
    <div class="home-map-copy">
      <div>
        <p class="eyebrow">EXPLORE SÃO JOSÉ</p>
        <h2>A cidade também pode ser navegada.</h2>
        <p>Busque uma rua, encontre sua localização, veja ciclovias ou explore registros de sinistros de trânsito.</p>
      </div>
      <div class="home-map-fact">
        <strong>271,43 km</strong>
        <span>de infraestrutura cicloviária informada pela Prefeitura.</span>
        <a href="https://www.sjc.sp.gov.br/servicos/mobilidade-urbana/ciclovias/" target="_blank" rel="noreferrer">Ver mapa oficial ↗</a>
      </div>
    </div>
    <div class="home-map-frame">
      <form class="home-map-search" role="search">
        <label for="centro-map-search">Onde você quer ir?</label>
        <div class="home-map-search-row">
          <input id="centro-map-search" type="search" autocomplete="off" placeholder="Rua, praça ou lugar em São José" />
          <button type="submit">Buscar</button>
        </div>
        <small>A busca acontece somente quando você envia.</small>
      </form>
      <div class="home-map-actions" aria-label="Camadas e atalhos do mapa">
        <button type="button" data-action="locate"><span>◎</span> Minha localização</button>
        <button type="button" data-action="bike" aria-pressed="false"><span>⌁</span> Ciclovias</button>
        <button type="button" data-action="safety" aria-pressed="false"><span>＋</span> Sinistros</button>
        <button type="button" data-action="school"><span>●</span> Auto Escola Centro</button>
      </div>
      <div class="home-map-canvas" aria-label="Mapa interativo de São José dos Campos"></div>
      <div class="home-map-results" hidden></div>
      <div class="home-map-status" aria-live="polite">Carregando mapa de São José dos Campos…</div>
      <div class="home-map-source">Mapa © OpenStreetMap contributors. Ciclovias usam um retrato periódico do OpenStreetMap. Sinistros usam registros georreferenciados do Detran-SP/Infosiga; nem todo registro possui coordenadas.</div>
    </div>`;
  return section;
}

function cachedSearch(query: string) {
  try {
    const raw = sessionStorage.getItem(`${SEARCH_CACHE}${query.toLowerCase()}`);
    return raw ? (JSON.parse(raw) as SearchResult[]) : null;
  } catch { return null; }
}

async function searchPlace(query: string) {
  const cached = cachedSearch(query);
  if (cached) return cached;
  const elapsed = Date.now() - lastSearchAt;
  if (elapsed < 1100) await sleep(1100 - elapsed);
  lastSearchAt = Date.now();
  const params = new URLSearchParams({
    q: `${query}, São José dos Campos, SP, Brasil`, format: 'jsonv2', limit: '5', countrycodes: 'br',
    'accept-language': 'pt-BR', viewbox: SEARCH_VIEWBOX, bounded: '1',
  });
  const response = await fetch(`${NOMINATIM}?${params.toString()}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Busca indisponível agora (${response.status}).`);
  const results = (await response.json()) as SearchResult[];
  try { sessionStorage.setItem(`${SEARCH_CACHE}${query.toLowerCase()}`, JSON.stringify(results)); } catch { /* optional */ }
  return results;
}

function showPlace(map: Map, result: SearchResult, label?: string) {
  const lng = Number(result.lon); const lat = Number(result.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
  map.flyTo({ center: [lng, lat], zoom: 15.5, duration: 900 });
  const marker = new Marker({ color: '#2d5bff' }).setLngLat([lng, lat])
    .setPopup(new Popup({ offset: 22 }).setText(label ?? compact(result.display_name))).addTo(map);
  marker.togglePopup();
}

function searchResults(node: HTMLElement, results: SearchResult[], map: Map) {
  node.replaceChildren(); node.hidden = false;
  if (!results.length) {
    const empty = document.createElement('p'); empty.textContent = 'Não encontrei esse lugar dentro de São José dos Campos.'; node.append(empty); return;
  }
  for (const result of results) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'home-map-result';
    button.textContent = compact(result.display_name); button.onclick = () => { showPlace(map, result); node.hidden = true; }; node.append(button);
  }
}

async function loadCycleSnapshot() {
  if (cycleSnapshot) return { data: cycleSnapshot, manifest: cycleManifest };
  const [geoResponse, manifestResponse] = await Promise.all([
    fetch(CYCLEWAYS_URL, { headers: { Accept: 'application/geo+json,application/json' }, cache: 'force-cache' }),
    fetch(MAP_MANIFEST_URL, { headers: { Accept: 'application/json' }, cache: 'force-cache' }),
  ]);
  if (!geoResponse.ok) throw new Error(`Mapa cicloviário indisponível agora (${geoResponse.status}).`);
  if (!manifestResponse.ok) throw new Error(`Informações do mapa indisponíveis agora (${manifestResponse.status}).`);
  const data = (await geoResponse.json()) as CycleGeoJson; const manifest = (await manifestResponse.json()) as MapManifest;
  if (data.type !== 'FeatureCollection' || !Array.isArray(data.features) || !data.features.length) throw new Error('O retrato de ciclovias está vazio ou inválido.');
  if (manifest.featureCount !== data.features.length) throw new Error('O retrato de ciclovias não passou pela validação de integridade.');
  cycleSnapshot = data; cycleManifest = manifest; return { data, manifest };
}

function snapshotLabel(manifest: MapManifest | null) {
  if (!manifest?.retrievedAt) return '';
  const date = new Date(manifest.retrievedAt); if (Number.isNaN(date.getTime())) return '';
  return ` · atualizado em ${date.toLocaleDateString('pt-BR')}`;
}

async function toggleBike(map: Map, button: HTMLButtonElement, live: HTMLElement) {
  const source = 'centro-cycleways'; const layer = 'centro-cycleways-line';
  const enabled = button.getAttribute('aria-pressed') === 'true';
  if (enabled) {
    if (map.getLayer(layer)) map.setLayoutProperty(layer, 'visibility', 'none');
    button.setAttribute('aria-pressed', 'false'); status(live, 'Ciclovias ocultadas.'); return;
  }
  if (!map.isStyleLoaded()) { status(live, 'Aguarde o mapa terminar de iniciar antes de abrir as ciclovias.', true); return; }
  button.disabled = true; status(live, 'Abrindo ciclovias de São José…');
  try {
    if (!map.getSource(source)) {
      const snapshot = await loadCycleSnapshot();
      map.addSource(source, { type: 'geojson', data: snapshot.data });
      map.addLayer({ id: layer, type: 'line', source, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: {
        'line-color': '#168a62', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 15, 5], 'line-opacity': 0.88,
      }});
      map.on('click', layer, (event) => {
        const feature = map.queryRenderedFeatures(event.point, { layers: [layer] })[0];
        const name = compact(String(feature?.properties?.name || 'Trecho cicloviário mapeado'));
        new Popup({ offset: 8 }).setLngLat(event.lngLat).setText(`${name} · OpenStreetMap`).addTo(map);
      });
      map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
    } else if (map.getLayer(layer)) map.setLayoutProperty(layer, 'visibility', 'visible');
    button.setAttribute('aria-pressed', 'true');
    status(live, `Ciclovias visíveis${snapshotLabel(cycleManifest)}. Toque em um trecho para identificar o local.`);
  } catch (error) { status(live, error instanceof Error ? error.message : 'Não foi possível abrir as ciclovias.', true); }
  finally { button.disabled = false; }
}

async function loadSafetySnapshot() {
  if (safetySnapshot) return { data: safetySnapshot, manifest: safetyManifest };
  const [geoResponse, manifestResponse] = await Promise.all([
    fetch(SAFETY_URL, { headers: { Accept: 'application/geo+json,application/json' }, cache: 'force-cache' }),
    fetch(SAFETY_MANIFEST_URL, { headers: { Accept: 'application/json' }, cache: 'force-cache' }),
  ]);
  if (!geoResponse.ok) throw new Error(`Dados de sinistros indisponíveis agora (${geoResponse.status}).`);
  if (!manifestResponse.ok) throw new Error(`Informações dos sinistros indisponíveis agora (${manifestResponse.status}).`);
  const data = (await geoResponse.json()) as SafetyGeoJson; const manifest = (await manifestResponse.json()) as SafetyManifest;
  if (data.type !== 'FeatureCollection' || !Array.isArray(data.features) || !data.features.length) throw new Error('O retrato de sinistros está vazio ou inválido.');
  if (manifest.featureCount !== data.features.length) throw new Error('O retrato de sinistros não passou pela validação de integridade.');
  safetySnapshot = data; safetyManifest = manifest; return { data, manifest };
}

function safetyPopup(feature: MapGeoJSONFeature) {
  const props = feature.properties ?? {};
  const root = document.createElement('div'); root.className = 'centro-safety-popup';
  const title = document.createElement('strong'); title.textContent = compact(String(props.type || 'Sinistro de trânsito'));
  const place = document.createElement('span'); place.textContent = compact(String(props.street || props.roadType || 'Local informado pelo Infosiga'));
  const when = document.createElement('span');
  when.textContent = [compact(String(props.date || '')), compact(String(props.hour || '')), compact(String(props.turn || ''))].filter(Boolean).join(' · ');
  root.append(title, place); if (when.textContent) root.append(when);
  const fatalVictims = Number(props.fatalVictims || 0); const seriousVictims = Number(props.seriousVictims || 0);
  if (fatalVictims > 0 || seriousVictims > 0) {
    const severity = document.createElement('span');
    severity.textContent = [fatalVictims > 0 ? `${fatalVictims} vítima${fatalVictims === 1 ? '' : 's'} fatal${fatalVictims === 1 ? '' : 'is'}` : '', seriousVictims > 0 ? `${seriousVictims} grave${seriousVictims === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
    root.append(severity);
  }
  const source = document.createElement('small'); source.textContent = 'Detran-SP · Infosiga'; root.append(source);
  return root;
}

async function toggleSafety(map: Map, button: HTMLButtonElement, live: HTMLElement) {
  const source = 'centro-safety'; const heat = 'centro-safety-heat'; const points = 'centro-safety-points';
  const enabled = button.getAttribute('aria-pressed') === 'true';
  if (enabled) {
    if (map.getLayer(heat)) map.setLayoutProperty(heat, 'visibility', 'none');
    if (map.getLayer(points)) map.setLayoutProperty(points, 'visibility', 'none');
    button.setAttribute('aria-pressed', 'false'); status(live, 'Sinistros ocultados.'); return;
  }
  if (!map.isStyleLoaded()) { status(live, 'Aguarde o mapa terminar de iniciar antes de abrir os sinistros.', true); return; }
  button.disabled = true; status(live, 'Abrindo registros de sinistros de trânsito…');
  try {
    if (!map.getSource(source)) {
      const snapshot = await loadSafetySnapshot();
      map.addSource(source, { type: 'geojson', data: snapshot.data });
      map.addLayer({ id: heat, type: 'heatmap', source, maxzoom: 13.5, paint: {
        'heatmap-weight': ['case', ['boolean', ['get', 'fatal'], false], 1.8, 0.8],
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 9, 0.6, 13, 1.1],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 9, 10, 13, 24],
        'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.65, 13.5, 0.15],
        'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(45,91,255,0)', 0.25, 'rgba(45,91,255,0.35)', 0.55, 'rgba(255,149,64,0.55)', 0.8, 'rgba(224,80,55,0.7)', 1, 'rgba(140,24,24,0.82)'],
      }});
      map.addLayer({ id: points, type: 'circle', source, minzoom: 11.5, paint: {
        'circle-radius': ['case', ['boolean', ['get', 'fatal'], false], 5, 3],
        'circle-color': ['case', ['boolean', ['get', 'fatal'], false], '#a3261f', '#e56f2d'],
        'circle-opacity': ['interpolate', ['linear'], ['zoom'], 11.5, 0.32, 14, 0.78],
        'circle-stroke-color': '#ffffff', 'circle-stroke-width': 0.7,
      }});
      map.on('click', points, (event) => {
        const feature = map.queryRenderedFeatures(event.point, { layers: [points] })[0]; if (!feature) return;
        new Popup({ offset: 8, maxWidth: '310px' }).setLngLat(event.lngLat).setDOMContent(safetyPopup(feature)).addTo(map);
      });
      map.on('mouseenter', points, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', points, () => { map.getCanvas().style.cursor = ''; });
    } else {
      if (map.getLayer(heat)) map.setLayoutProperty(heat, 'visibility', 'visible');
      if (map.getLayer(points)) map.setLayoutProperty(points, 'visibility', 'visible');
    }
    button.setAttribute('aria-pressed', 'true');
    const m = safetyManifest;
    const range = m?.range ? `${periodLabel(m.range.from)} → ${periodLabel(m.range.to)}` : 'últimos períodos disponíveis';
    status(live, `${count(m?.featureCount)} sinistros com coordenadas visíveis · ${count(m?.eventCount)} registros no período ${range}.`);
  } catch (error) { status(live, error instanceof Error ? error.message : 'Não foi possível abrir os sinistros.', true); }
  finally { button.disabled = false; }
}

function mount(anchor: Element) {
  const section = sectionMarkup(); anchor.append(section);
  const canvas = section.querySelector<HTMLElement>('.home-map-canvas');
  const form = section.querySelector<HTMLFormElement>('.home-map-search');
  const input = section.querySelector<HTMLInputElement>('#centro-map-search');
  const results = section.querySelector<HTMLElement>('.home-map-results');
  const live = section.querySelector<HTMLElement>('.home-map-status');
  const locate = section.querySelector<HTMLButtonElement>('[data-action="locate"]');
  const bike = section.querySelector<HTMLButtonElement>('[data-action="bike"]');
  const safety = section.querySelector<HTMLButtonElement>('[data-action="safety"]');
  const school = section.querySelector<HTMLButtonElement>('[data-action="school"]');
  if (!canvas || !form || !input || !results || !live || !locate || !bike || !safety || !school) return null;

  const map = new Map({ container: canvas, style: BASEMAP_STYLE, center: CITY_CENTER, zoom: 11.6, minZoom: 9, maxZoom: 18 });
  let baseMapReady = false; let watchdog: number | null = null;
  const verifyBaseMap = () => {
    if (baseMapReady || !map.isStyleLoaded()) return;
    try { if (!map.isSourceLoaded(BASE_SOURCE_ID)) return; } catch { return; }
    baseMapReady = true; section.dataset.mapState = 'ready';
    if (watchdog !== null) window.clearTimeout(watchdog); watchdog = null;
    status(live, 'Mapa pronto. Busque um lugar ou escolha uma camada.');
  };
  map.on('load', verifyBaseMap); map.on('sourcedata', verifyBaseMap); map.on('render', verifyBaseMap);
  map.on('error', () => { if (!baseMapReady) section.dataset.mapState = 'degraded'; });
  watchdog = window.setTimeout(() => {
    if (baseMapReady) return; section.dataset.mapState = 'unavailable';
    status(live, 'O mapa não carregou agora. Busca, localização e atalhos continuam disponíveis.', true);
  }, BASEMAP_TIMEOUT_MS);

  map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
  const geolocate = new GeolocateControl({ positionOptions: { enableHighAccuracy: true, timeout: 9000 }, trackUserLocation: false, showAccuracyCircle: true, showUserLocation: true, fitBoundsOptions: { maxZoom: 15 } });
  map.addControl(geolocate, 'bottom-right');
  geolocate.on('geolocate', () => status(live, 'Sua localização foi encontrada.'));
  geolocate.on('error', () => status(live, 'Não consegui acessar sua localização. Confira a permissão do navegador.', true));

  locate.onclick = () => { status(live, 'Pedindo sua localização ao navegador…'); geolocate.trigger(); };
  bike.onclick = () => void toggleBike(map, bike, live);
  safety.onclick = () => void toggleSafety(map, safety, live);
  school.onclick = async () => {
    school.disabled = true; status(live, 'Localizando a Auto Escola Centro…');
    try {
      const first = (await searchPlace(SCHOOL_QUERY))[0]; if (!first) throw new Error('Não encontrei o endereço no mapa agora.');
      showPlace(map, first, 'Auto Escola Centro · Avenida São José, 1009'); status(live, 'Auto Escola Centro localizada no mapa.');
    } catch (error) { status(live, error instanceof Error ? error.message : 'Não foi possível localizar a Auto Escola Centro.', true); }
    finally { school.disabled = false; }
  };

  form.onsubmit = async (event) => {
    event.preventDefault(); const query = input.value.trim();
    if (query.length < 3) { status(live, 'Digite pelo menos 3 caracteres para buscar.', true); return; }
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]'); if (submit) submit.disabled = true;
    status(live, `Buscando “${query}”…`);
    try {
      const found = await searchPlace(query); searchResults(results, found, map); if (found[0]) showPlace(map, found[0]);
      status(live, found.length ? `${found.length} resultado${found.length === 1 ? '' : 's'} encontrado${found.length === 1 ? '' : 's'}.` : 'Nenhum resultado encontrado.');
    } catch (error) { status(live, error instanceof Error ? error.message : 'A busca está indisponível agora.', true); }
    finally { if (submit) submit.disabled = false; }
  };

  return { anchor, section, map, watchdog };
}

function cleanup() {
  if (!active) return; if (active.watchdog !== null) window.clearTimeout(active.watchdog);
  try { active.map.remove(); } catch { /* already detached */ }
  active.section.remove(); active = null;
}

function scan() {
  if (location.pathname !== '/') { cleanup(); return; }
  const anchor = document.querySelector('.city-home-section'); if (!anchor) return;
  if (active?.anchor === anchor && document.contains(active.section)) return;
  cleanup(); active = mount(anchor);
}

new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('popstate', scan);
scan();
