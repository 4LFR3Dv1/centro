import { GeolocateControl, Map, Marker, NavigationControl, Popup } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './home-map.css';

type SearchResult = { display_name: string; lat: string; lon: string };
type OverpassElement = {
  id: number;
  type: string;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
};
type OverpassResponse = { elements?: OverpassElement[] };

type CycleData = ReturnType<typeof toCycleGeoJson>;

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const SCHOOL_QUERY = 'Avenida São José, 1009, Centro, São José dos Campos, SP, Brasil';
const CITY_CENTER: [number, number] = [-45.8872, -23.1896];
const CITY_BBOX = '-23.35,-46.02,-23.05,-45.75';
const SEARCH_VIEWBOX = '-46.02,-23.05,-45.75,-23.35';
const CYCLE_CACHE = 'centro.map.cycleways.v1';
const SEARCH_CACHE = 'centro.map.search.v1:';
const DAY = 86_400_000;

let active: { anchor: Element; section: HTMLElement; map: Map } | null = null;
let lastSearchAt = 0;

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const compact = (value: string) => value.replace(/\s+/g, ' ').trim();

function status(node: HTMLElement, message: string, isError = false) {
  node.textContent = message;
  node.dataset.tone = isError ? 'error' : 'normal';
}

function sectionMarkup() {
  const section = document.createElement('section');
  section.className = 'home-map-explorer';
  section.innerHTML = `
    <div class="home-map-copy">
      <div>
        <p class="eyebrow">EXPLORE SÃO JOSÉ</p>
        <h2>A cidade também pode ser navegada.</h2>
        <p>Busque uma rua, encontre sua localização ou veja a malha cicloviária mapeada na cidade.</p>
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
      <div class="home-map-actions" aria-label="Atalhos do mapa">
        <button type="button" data-action="locate"><span>◎</span> Minha localização</button>
        <button type="button" data-action="bike" aria-pressed="false"><span>⌁</span> Ciclovias</button>
        <button type="button" data-action="school"><span>●</span> Auto Escola Centro</button>
      </div>
      <div class="home-map-canvas" aria-label="Mapa interativo de São José dos Campos"></div>
      <div class="home-map-results" hidden></div>
      <div class="home-map-status" aria-live="polite">Arraste, aproxime ou escolha um atalho.</div>
      <div class="home-map-source">Mapa © OpenStreetMap contributors · renderização OpenFreeMap. Ciclovias exibidas conforme traçados comunitários do OpenStreetMap e podem diferir do mapa oficial.</div>
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
  try { sessionStorage.setItem(`${SEARCH_CACHE}${query.toLowerCase()}`, JSON.stringify(results)); } catch { /* optional cache */ }
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

function toCycleGeoJson(payload: OverpassResponse) {
  const seen = new Set<number>();
  const features = (payload.elements ?? []).flatMap((element) => {
    if (element.type !== 'way' || !element.geometry?.length || seen.has(element.id)) return [];
    seen.add(element.id);
    return [{
      type: 'Feature' as const,
      id: element.id,
      properties: { name: element.tags?.name ?? '' },
      geometry: {
        type: 'LineString' as const,
        coordinates: element.geometry.map((point) => [point.lon, point.lat]),
      },
    }];
  });
  return { type: 'FeatureCollection' as const, features };
}

function cachedCycleways(): CycleData | null {
  try {
    const raw = localStorage.getItem(CYCLE_CACHE);
    if (!raw) return null;
    const cached = JSON.parse(raw) as { fetchedAt: number; data: CycleData };
    return Date.now() - cached.fetchedAt <= DAY ? cached.data : null;
  } catch {
    return null;
  }
}

async function cycleways() {
  const cached = cachedCycleways();
  if (cached) return cached;
  const query = `[out:json][timeout:25];(
    way["highway"="cycleway"](${CITY_BBOX});
    way["cycleway"](${CITY_BBOX});
    way["cycleway:left"](${CITY_BBOX});
    way["cycleway:right"](${CITY_BBOX});
  );out geom;`;
  const response = await fetch(OVERPASS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!response.ok) throw new Error(`Camada cicloviária indisponível agora (${response.status}).`);
  const data = toCycleGeoJson((await response.json()) as OverpassResponse);
  try { localStorage.setItem(CYCLE_CACHE, JSON.stringify({ fetchedAt: Date.now(), data })); } catch { /* optional cache */ }
  return data;
}

async function toggleBike(map: Map, button: HTMLButtonElement, live: HTMLElement) {
  const source = 'centro-cycleways';
  const layer = 'centro-cycleways-line';
  const enabled = button.getAttribute('aria-pressed') === 'true';
  if (enabled) {
    if (map.getLayer(layer)) map.setLayoutProperty(layer, 'visibility', 'none');
    button.setAttribute('aria-pressed', 'false');
    status(live, 'Ciclovias ocultadas.');
    return;
  }

  button.disabled = true;
  status(live, 'Carregando ciclovias e ciclofaixas mapeadas…');
  try {
    if (!map.getSource(source)) {
      map.addSource(source, { type: 'geojson', data: await cycleways() });
      map.addLayer({
        id: layer,
        type: 'line',
        source,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#168a62',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 15, 5],
          'line-opacity': 0.88,
        },
      });
      map.on('click', layer, (event) => {
        const feature = map.queryRenderedFeatures(event.point, { layers: [layer] })[0];
        const name = compact(String(feature?.properties?.name || 'Trecho cicloviário mapeado'));
        new Popup({ offset: 8 }).setLngLat(event.lngLat).setText(`${name} · OpenStreetMap`).addTo(map);
      });
      map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
    } else if (map.getLayer(layer)) {
      map.setLayoutProperty(layer, 'visibility', 'visible');
    }
    button.setAttribute('aria-pressed', 'true');
    status(live, 'Ciclovias visíveis. Toque em um trecho para identificar o local.');
  } catch (error) {
    status(live, error instanceof Error ? error.message : 'Não foi possível carregar as ciclovias.', true);
  } finally {
    button.disabled = false;
  }
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
  const bike = section.querySelector<HTMLButtonElement>('[data-action="bike"]');
  const school = section.querySelector<HTMLButtonElement>('[data-action="school"]');
  if (!canvas || !form || !input || !results || !live || !locate || !bike || !school) return null;

  const map = new Map({ container: canvas, style: MAP_STYLE, center: CITY_CENTER, zoom: 11.6, minZoom: 9, maxZoom: 18 });
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

  locate.onclick = () => { status(live, 'Pedindo sua localização ao navegador…'); geolocate.trigger(); };
  bike.onclick = () => void toggleBike(map, bike, live);
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

  map.on('load', () => status(live, 'Mapa pronto. Busque um lugar ou escolha um atalho.'));
  map.on('error', () => status(live, 'Algumas partes do mapa podem estar temporariamente indisponíveis.', true));
  return { anchor, section, map };
}

function cleanup() {
  if (!active) return;
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
