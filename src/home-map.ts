import { GeolocateControl, Map, Marker, NavigationControl, Popup, type MapGeoJSONFeature, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './home-map.css';

type SearchResult = { display_name: string; lat: string; lon: string };
type FeatureCollection = { type: 'FeatureCollection'; features: Array<{ type: 'Feature'; id?: string | number; properties?: Record<string, unknown>; geometry: { type: string; coordinates: unknown } }> };
type MapManifest = { retrievedAt?: string; featureCount?: number; sha256?: string };
type SafetyManifest = { featureCount?: number; eventCount?: number; geocodedRate?: number; range?: { from?: string | null; to?: string | null; months?: number } };
type TransitManifest = { featureCount?: number; linhaVerdeStations?: number; mappedStopsAndTerminals?: number };
type OverlayId = 'cycling' | 'safety' | 'transit';
type OverlayRuntime = {
  enabled: Record<OverlayId, boolean>;
  loading: Record<OverlayId, boolean>;
  buttons: Record<OverlayId, HTMLButtonElement>;
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
const TRANSIT_URL = '/data/maps/sjc-transit.geojson';
const TRANSIT_MANIFEST_URL = '/data/maps/sjc-transit-manifest.json';
const SCHOOL_QUERY = 'Avenida São José, 1009';
const CITY_CENTER: [number, number] = [-45.8872, -23.1896];
const SEARCH_VIEWBOX = '-46.02,-23.05,-45.75,-23.35';
const SEARCH_CACHE = 'centro.map.search.v1:';

const LAYERS = {
  cycling: ['centro-cycleways-line'],
  safety: ['centro-safety-heat', 'centro-safety-points'],
  transit: ['centro-transit-stops', 'centro-transit-terminals', 'centro-linha-verde-stations'],
} as const;

// Bottom -> top. Reapplied after every lazy overlay materialization so activation order never changes z-order.
const OVERLAY_LAYER_ORDER = [
  'centro-safety-heat',
  'centro-cycleways-line',
  'centro-transit-stops',
  'centro-safety-points',
  'centro-transit-terminals',
  'centro-linha-verde-stations',
] as const;

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
let cycleSnapshot: FeatureCollection | null = null;
let cycleManifest: MapManifest | null = null;
let safetySnapshot: FeatureCollection | null = null;
let safetyManifest: SafetyManifest | null = null;
let transitSnapshot: FeatureCollection | null = null;
let transitManifest: TransitManifest | null = null;

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
        <p>Busque uma rua, encontre sua localização e combine ciclovias, sinistros e transporte coletivo no mesmo mapa.</p>
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
        <button type="button" data-overlay="cycling" aria-pressed="false"><span>⌁</span> Ciclovias</button>
        <button type="button" data-overlay="safety" aria-pressed="false"><span>＋</span> Sinistros</button>
        <button type="button" data-overlay="transit" aria-pressed="false"><span>▦</span> Transporte</button>
        <button type="button" data-action="school"><span>●</span> Auto Escola Centro</button>
      </div>
      <div class="home-map-canvas" aria-label="Mapa interativo de São José dos Campos"></div>
      <div class="home-map-results" hidden></div>
      <div class="home-map-status" aria-live="polite">Carregando mapa de São José dos Campos…</div>
      <div class="home-map-source">Mapa © OpenStreetMap contributors. Ciclovias e pontos de transporte usam retratos periódicos do OpenStreetMap. Sinistros usam Detran-SP/Infosiga. Os nomes e a ordem das 13 estações da Linha Verde vêm da Prefeitura; o Centro não desenha um trajeto viário exato sem geometria validada.</div>
    </div>`;
  return section;
}

function cachedSearch(query: string) {
  try {
    const raw = sessionStorage.getItem(`${SEARCH_CACHE}${query.toLowerCase()}`);
    return raw ? (JSON.parse(raw) as SearchResult[]) : null;
  } catch {
    return null;
  }
}

async function searchPlace(query: string) {
  const cached = cachedSearch(query);
  if (cached) return cached;
  const elapsed = Date.now() - lastSearchAt;
  if (elapsed < 1100) await sleep(1100 - elapsed);
  lastSearchAt = Date.now();
  const params = new URLSearchParams({
    q: `${query}, São José dos Campos, SP, Brasil`,
    format: 'jsonv2',
    limit: '5',
    countrycodes: 'br',
    'accept-language': 'pt-BR',
    viewbox: SEARCH_VIEWBOX,
    bounded: '1',
  });
  const response = await fetch(`${NOMINATIM}?${params.toString()}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Busca indisponível agora (${response.status}).`);
  const results = (await response.json()) as SearchResult[];
  try { sessionStorage.setItem(`${SEARCH_CACHE}${query.toLowerCase()}`, JSON.stringify(results)); } catch { /* optional session cache */ }
  return results;
}

function showPlace(map: Map, result: SearchResult, label?: string) {
  const lng = Number(result.lon);
  const lat = Number(result.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
  map.flyTo({ center: [lng, lat], zoom: 15.5, duration: 900 });
  const marker = new Marker({ color: '#2d5bff' })
    .setLngLat([lng, lat])
    .setPopup(new Popup({ offset: 22 }).setText(label ?? compact(result.display_name)))
    .addTo(map);
  marker.togglePopup();
}

function searchResults(node: HTMLElement, results: SearchResult[], map: Map) {
  node.replaceChildren();
  node.hidden = false;
  if (!results.length) {
    const empty = document.createElement('p');
    empty.textContent = 'Não encontrei esse lugar dentro de São José dos Campos.';
    node.append(empty);
    return;
  }
  for (const result of results) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'home-map-result';
    button.textContent = compact(result.display_name);
    button.onclick = () => { showPlace(map, result); node.hidden = true; };
    node.append(button);
  }
}

async function loadPair<TManifest>(dataUrl: string, manifestUrl: string, emptyMessage: string) {
  const [geoResponse, manifestResponse] = await Promise.all([
    fetch(dataUrl, { headers: { Accept: 'application/geo+json,application/json' }, cache: 'force-cache' }),
    fetch(manifestUrl, { headers: { Accept: 'application/json' }, cache: 'force-cache' }),
  ]);
  if (!geoResponse.ok) throw new Error(`${emptyMessage} (${geoResponse.status}).`);
  if (!manifestResponse.ok) throw new Error(`Informações da camada indisponíveis agora (${manifestResponse.status}).`);
  const data = (await geoResponse.json()) as FeatureCollection;
  const manifest = (await manifestResponse.json()) as TManifest & { featureCount?: number };
  if (data.type !== 'FeatureCollection' || !Array.isArray(data.features) || !data.features.length) throw new Error(`${emptyMessage}: retrato vazio ou inválido.`);
  if (manifest.featureCount !== data.features.length) throw new Error(`${emptyMessage}: falha de integridade do retrato.`);
  return { data, manifest };
}

async function cycleData() {
  if (!cycleSnapshot) {
    const loaded = await loadPair<MapManifest>(CYCLEWAYS_URL, MAP_MANIFEST_URL, 'Mapa cicloviário indisponível agora');
    cycleSnapshot = loaded.data;
    cycleManifest = loaded.manifest;
  }
  return { data: cycleSnapshot, manifest: cycleManifest };
}

async function safetyData() {
  if (!safetySnapshot) {
    const loaded = await loadPair<SafetyManifest>(SAFETY_URL, SAFETY_MANIFEST_URL, 'Dados de sinistros indisponíveis agora');
    safetySnapshot = loaded.data;
    safetyManifest = loaded.manifest;
  }
  return { data: safetySnapshot, manifest: safetyManifest };
}

async function transitData() {
  if (!transitSnapshot) {
    const loaded = await loadPair<TransitManifest>(TRANSIT_URL, TRANSIT_MANIFEST_URL, 'Dados de transporte indisponíveis agora');
    transitSnapshot = loaded.data;
    transitManifest = loaded.manifest;
  }
  return { data: transitSnapshot, manifest: transitManifest };
}

function snapshotLabel(manifest: MapManifest | null) {
  if (!manifest?.retrievedAt) return '';
  const date = new Date(manifest.retrievedAt);
  if (Number.isNaN(date.getTime())) return '';
  return ` · atualizado em ${date.toLocaleDateString('pt-BR')}`;
}

function setLayersVisible(map: Map, overlay: OverlayId, visible: boolean) {
  for (const layerId of LAYERS[overlay]) {
    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
  }
}

function enforceOverlayOrder(map: Map) {
  for (const layerId of OVERLAY_LAYER_ORDER) {
    if (map.getLayer(layerId)) map.moveLayer(layerId);
  }
}

function syncOverlayButton(runtime: OverlayRuntime, overlay: OverlayId) {
  const button = runtime.buttons[overlay];
  button.setAttribute('aria-pressed', runtime.enabled[overlay] ? 'true' : 'false');
  button.setAttribute('aria-busy', runtime.loading[overlay] ? 'true' : 'false');
  button.disabled = runtime.loading[overlay];
}

async function ensureCycling(map: Map) {
  const source = 'centro-cycleways';
  const layer = LAYERS.cycling[0];
  if (!map.getSource(source)) {
    const snapshot = await cycleData();
    map.addSource(source, { type: 'geojson', data: snapshot.data as never });
  }
  if (!map.getLayer(layer)) {
    map.addLayer({
      id: layer,
      type: 'line',
      source,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#168a62', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 15, 5], 'line-opacity': 0.88 },
    });
  }
}

async function ensureSafety(map: Map) {
  const source = 'centro-safety';
  const [heat, points] = LAYERS.safety;
  if (!map.getSource(source)) {
    const snapshot = await safetyData();
    map.addSource(source, { type: 'geojson', data: snapshot.data as never });
  }
  if (!map.getLayer(heat)) {
    map.addLayer({ id: heat, type: 'heatmap', source, maxzoom: 13.5, paint: {
      'heatmap-weight': ['case', ['boolean', ['get', 'fatal'], false], 1.8, 0.8],
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 9, 0.6, 13, 1.1],
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 9, 10, 13, 24],
      'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.65, 13.5, 0.15],
      'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(45,91,255,0)', 0.25, 'rgba(45,91,255,0.35)', 0.55, 'rgba(255,149,64,0.55)', 0.8, 'rgba(224,80,55,0.7)', 1, 'rgba(140,24,24,0.82)'],
    }});
  }
  if (!map.getLayer(points)) {
    map.addLayer({ id: points, type: 'circle', source, minzoom: 11.5, paint: {
      'circle-radius': ['case', ['boolean', ['get', 'fatal'], false], 5, 3],
      'circle-color': ['case', ['boolean', ['get', 'fatal'], false], '#a3261f', '#e56f2d'],
      'circle-opacity': ['interpolate', ['linear'], ['zoom'], 11.5, 0.32, 14, 0.78],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 0.7,
    }});
  }
}

async function ensureTransit(map: Map) {
  const source = 'centro-transit';
  const [stops, terminals, stations] = LAYERS.transit;
  if (!map.getSource(source)) {
    const snapshot = await transitData();
    map.addSource(source, { type: 'geojson', data: snapshot.data as never });
  }
  if (!map.getLayer(stops)) {
    map.addLayer({ id: stops, type: 'circle', source, minzoom: 11.8, filter: ['==', ['get', 'kind'], 'transit-stop'], paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11.8, 2, 15, 4],
      'circle-color': '#436f91',
      'circle-opacity': ['interpolate', ['linear'], ['zoom'], 11.8, 0.28, 14, 0.65],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 0.5,
    }});
  }
  if (!map.getLayer(terminals)) {
    map.addLayer({ id: terminals, type: 'circle', source, minzoom: 10, filter: ['==', ['get', 'kind'], 'transit-terminal'], paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 4, 15, 7],
      'circle-color': '#244c70',
      'circle-opacity': 0.9,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.2,
    }});
  }
  if (!map.getLayer(stations)) {
    map.addLayer({ id: stations, type: 'circle', source, minzoom: 9, filter: ['==', ['get', 'kind'], 'linha-verde-station'], paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 4.5, 14, 8],
      'circle-color': '#0f8a63',
      'circle-opacity': 0.95,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.6,
    }});
  }
}

const overlayLoaders: Record<OverlayId, (map: Map) => Promise<void>> = {
  cycling: ensureCycling,
  safety: ensureSafety,
  transit: ensureTransit,
};

function overlayStatus(overlay: OverlayId) {
  if (overlay === 'cycling') return `Ciclovias visíveis${snapshotLabel(cycleManifest)}. Toque em um trecho para identificar o local.`;
  if (overlay === 'safety') {
    const range = safetyManifest?.range ? `${periodLabel(safetyManifest.range.from)} → ${periodLabel(safetyManifest.range.to)}` : 'últimos períodos disponíveis';
    return `${count(safetyManifest?.featureCount)} sinistros com coordenadas visíveis · ${count(safetyManifest?.eventCount)} registros no período ${range}.`;
  }
  return `${count(transitManifest?.linhaVerdeStations)} estações da Linha Verde · ${count(transitManifest?.mappedStopsAndTerminals)} paradas e terminais mapeados. Sem localização de ônibus em tempo real neste corte.`;
}

async function toggleOverlay(map: Map, runtime: OverlayRuntime, overlay: OverlayId, live: HTMLElement) {
  if (!map.isStyleLoaded()) {
    status(live, 'Aguarde o mapa terminar de iniciar antes de abrir uma camada.', true);
    return;
  }
  if (runtime.loading[overlay]) return;

  if (runtime.enabled[overlay]) {
    runtime.enabled[overlay] = false;
    setLayersVisible(map, overlay, false);
    syncOverlayButton(runtime, overlay);
    status(live, `${overlay === 'cycling' ? 'Ciclovias' : overlay === 'safety' ? 'Sinistros' : 'Transporte'} ocultado${overlay === 'cycling' ? 's' : ''}.`);
    return;
  }

  runtime.loading[overlay] = true;
  syncOverlayButton(runtime, overlay);
  status(live, overlay === 'cycling' ? 'Abrindo ciclovias de São José…' : overlay === 'safety' ? 'Abrindo registros de sinistros de trânsito…' : 'Abrindo Linha Verde e transporte coletivo…');

  try {
    await overlayLoaders[overlay](map);
    runtime.enabled[overlay] = true;
    setLayersVisible(map, overlay, true);
    enforceOverlayOrder(map);
    status(live, overlayStatus(overlay));
  } catch (error) {
    runtime.enabled[overlay] = false;
    setLayersVisible(map, overlay, false);
    status(live, error instanceof Error ? error.message : 'Não foi possível abrir esta camada.', true);
  } finally {
    runtime.loading[overlay] = false;
    syncOverlayButton(runtime, overlay);
  }
}

function safetyPopup(feature: MapGeoJSONFeature) {
  const props = feature.properties ?? {};
  const root = document.createElement('div');
  root.className = 'centro-safety-popup';
  const title = document.createElement('strong');
  title.textContent = compact(String(props.type || 'Sinistro de trânsito'));
  const place = document.createElement('span');
  place.textContent = compact(String(props.street || props.roadType || 'Local informado pelo Infosiga'));
  const when = document.createElement('span');
  when.textContent = [compact(String(props.date || '')), compact(String(props.hour || '')), compact(String(props.turn || ''))].filter(Boolean).join(' · ');
  root.append(title, place);
  if (when.textContent) root.append(when);
  const fatalVictims = Number(props.fatalVictims || 0);
  const seriousVictims = Number(props.seriousVictims || 0);
  if (fatalVictims > 0 || seriousVictims > 0) {
    const severity = document.createElement('span');
    severity.textContent = [
      fatalVictims > 0 ? `${fatalVictims} vítima${fatalVictims === 1 ? '' : 's'} fatal${fatalVictims === 1 ? '' : 'is'}` : '',
      seriousVictims > 0 ? `${seriousVictims} grave${seriousVictims === 1 ? '' : 's'}` : '',
    ].filter(Boolean).join(' · ');
    root.append(severity);
  }
  const source = document.createElement('small');
  source.textContent = 'Detran-SP · Infosiga';
  root.append(source);
  return root;
}

function transitPopup(feature: MapGeoJSONFeature) {
  const props = feature.properties ?? {};
  const kind = String(props.kind || '');
  const root = document.createElement('div');
  root.className = 'centro-safety-popup';
  const title = document.createElement('strong');
  const name = compact(String(props.name || 'Ponto de transporte'));
  title.textContent = kind === 'linha-verde-station' && props.sequence ? `${props.sequence} · ${name}` : name;
  root.append(title);
  if (kind === 'linha-verde-station') {
    const detail = document.createElement('span');
    detail.textContent = 'Linha Verde · estação oficial';
    root.append(detail);
    const source = document.createElement('small');
    source.textContent = 'Nome/ordem: Prefeitura de São José dos Campos · coordenada para visualização';
    root.append(source);
  } else {
    const ref = compact(String(props.ref || ''));
    if (ref) {
      const detail = document.createElement('span');
      detail.textContent = `Referência ${ref}`;
      root.append(detail);
    }
    const source = document.createElement('small');
    source.textContent = 'Ponto mapeado no OpenStreetMap';
    root.append(source);
  }
  return root;
}

function interactiveLayerIds(map: Map) {
  return ['centro-linha-verde-stations', 'centro-transit-terminals', 'centro-safety-points', 'centro-transit-stops', 'centro-cycleways-line']
    .filter((layerId) => Boolean(map.getLayer(layerId)));
}

function bindMapInteractions(map: Map) {
  map.on('click', (event) => {
    const layers = interactiveLayerIds(map);
    if (!layers.length) return;
    const feature = map.queryRenderedFeatures(event.point, { layers })[0];
    if (!feature) return;
    const layerId = feature.layer.id;
    const popup = new Popup({ offset: 8, maxWidth: '320px' }).setLngLat(event.lngLat);
    if (layerId === 'centro-safety-points') popup.setDOMContent(safetyPopup(feature));
    else if (layerId === 'centro-cycleways-line') popup.setText(`${compact(String(feature.properties?.name || 'Trecho cicloviário mapeado'))} · OpenStreetMap`);
    else popup.setDOMContent(transitPopup(feature));
    popup.addTo(map);
  });

  map.on('mousemove', (event) => {
    const layers = interactiveLayerIds(map);
    map.getCanvas().style.cursor = layers.length && map.queryRenderedFeatures(event.point, { layers }).length ? 'pointer' : '';
  });
}

function mount(anchor: Element) {
  const section = sectionMarkup();
  anchor.append(section);
  const canvas = section.querySelector<HTMLElement>('.home-map-canvas');
  const form = section.querySelector<HTMLFormElement>('.home-map-search');
  const input = section.querySelector<HTMLInputElement>('#centro-map-search');
  const results = section.querySelector<HTMLElement>('.home-map-results');
  const live = section.querySelector<HTMLElement>('.home-map-status');
  const locate = section.querySelector<HTMLButtonElement>('[data-action="locate"]');
  const cycling = section.querySelector<HTMLButtonElement>('[data-overlay="cycling"]');
  const safety = section.querySelector<HTMLButtonElement>('[data-overlay="safety"]');
  const transit = section.querySelector<HTMLButtonElement>('[data-overlay="transit"]');
  const school = section.querySelector<HTMLButtonElement>('[data-action="school"]');
  if (!canvas || !form || !input || !results || !live || !locate || !cycling || !safety || !transit || !school) return null;

  const runtime: OverlayRuntime = {
    enabled: { cycling: false, safety: false, transit: false },
    loading: { cycling: false, safety: false, transit: false },
    buttons: { cycling, safety, transit },
  };
  const map = new Map({ container: canvas, style: BASEMAP_STYLE, center: CITY_CENTER, zoom: 11.6, minZoom: 9, maxZoom: 18 });
  let baseMapReady = false;
  let watchdog: number | null = null;

  const verifyBaseMap = () => {
    if (baseMapReady || !map.isStyleLoaded()) return;
    try { if (!map.isSourceLoaded(BASE_SOURCE_ID)) return; } catch { return; }
    baseMapReady = true;
    section.dataset.mapState = 'ready';
    if (watchdog !== null) window.clearTimeout(watchdog);
    watchdog = null;
    status(live, 'Mapa pronto. Busque um lugar ou combine as camadas.');
  };
  map.on('load', verifyBaseMap);
  map.on('sourcedata', verifyBaseMap);
  map.on('render', verifyBaseMap);
  map.on('error', () => { if (!baseMapReady) section.dataset.mapState = 'degraded'; });
  watchdog = window.setTimeout(() => {
    if (baseMapReady) return;
    section.dataset.mapState = 'unavailable';
    status(live, 'O mapa não carregou agora. Busca, localização e atalhos continuam disponíveis.', true);
  }, BASEMAP_TIMEOUT_MS);

  map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
  const geolocate = new GeolocateControl({
    positionOptions: { enableHighAccuracy: true, timeout: 9000 },
    trackUserLocation: false,
    showAccuracyCircle: true,
    showUserLocation: true,
    fitBoundsOptions: { maxZoom: 15 },
  });
  map.addControl(geolocate, 'bottom-right');
  geolocate.on('geolocate', () => status(live, 'Sua localização foi encontrada.'));
  geolocate.on('error', () => status(live, 'Não consegui acessar sua localização. Confira a permissão do navegador.', true));
  bindMapInteractions(map);

  locate.onclick = () => { status(live, 'Pedindo sua localização ao navegador…'); geolocate.trigger(); };
  cycling.onclick = () => void toggleOverlay(map, runtime, 'cycling', live);
  safety.onclick = () => void toggleOverlay(map, runtime, 'safety', live);
  transit.onclick = () => void toggleOverlay(map, runtime, 'transit', live);
  school.onclick = async () => {
    school.disabled = true;
    status(live, 'Localizando a Auto Escola Centro…');
    try {
      const first = (await searchPlace(SCHOOL_QUERY))[0];
      if (!first) throw new Error('Não encontrei o endereço no mapa agora.');
      showPlace(map, first, 'Auto Escola Centro · Avenida São José, 1009');
      status(live, 'Auto Escola Centro localizada no mapa.');
    } catch (error) {
      status(live, error instanceof Error ? error.message : 'Não foi possível localizar a Auto Escola Centro.', true);
    } finally {
      school.disabled = false;
    }
  };

  form.onsubmit = async (event) => {
    event.preventDefault();
    const query = input.value.trim();
    if (query.length < 3) { status(live, 'Digite pelo menos 3 caracteres para buscar.', true); return; }
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit) submit.disabled = true;
    status(live, `Buscando “${query}”…`);
    try {
      const found = await searchPlace(query);
      searchResults(results, found, map);
      if (found[0]) showPlace(map, found[0]);
      status(live, found.length ? `${found.length} resultado${found.length === 1 ? '' : 's'} encontrado${found.length === 1 ? '' : 's'}.` : 'Nenhum resultado encontrado.');
    } catch (error) {
      status(live, error instanceof Error ? error.message : 'A busca está indisponível agora.', true);
    } finally {
      if (submit) submit.disabled = false;
    }
  };

  return { anchor, section, map, watchdog };
}

function cleanup() {
  if (!active) return;
  if (active.watchdog !== null) window.clearTimeout(active.watchdog);
  try { active.map.remove(); } catch { /* already detached */ }
  active.section.remove();
  active = null;
}

function scan() {
  if (location.pathname !== '/') { cleanup(); return; }
  const anchor = document.querySelector('.city-home-section');
  if (!anchor) return;
  if (active?.anchor === anchor && document.contains(active.section)) return;
  cleanup();
  active = mount(anchor);
}

new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('popstate', scan);
scan();
