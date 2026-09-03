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

type CycleGeoJson = ReturnType<typeof toCycleGeoJson>;

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const SCHOOL_QUERY = 'Avenida São José, 1009, Centro, São José dos Campos, SP, Brasil';
const CITY_CENTER: [number, number] = [-45.8872, -23.1896];
const CITY_BBOX = '-23.35,-46.02,-23.05,-45.75';
const NOMINATIM_VIEWBOX = '-46.02,-23.05,-45.75,-23.35';
const CYCLE_CACHE_KEY = 'centro.map.cycleways.v1';
const SEARCH_CACHE_PREFIX = 'centro.map.search.v1:';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

let mounted: { anchor: Element; section: HTMLElement; map: Map } | null = null;
let lastSearchAt = 0;

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function compact(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function setStatus(node: HTMLElement, message: string, error = false) {
  node.textContent = message;
  node.dataset.tone = error ? 'error' : 'normal';
}

function buildSection() {
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
          <input id="centro-map-search" name="q" type="search" autocomplete="off" placeholder="Rua, praça ou lugar em São José" />
          <button type="submit">Buscar</button>
        </div>
        <small>A busca acontece somente quando você envia.</small>
      </form>
      <div class="home-map-actions" aria-label="Atalhos do mapa">
        <button type="button" data-map-action="locate"><span>◎</span> Minha localização</button>
        <button type="button" data-map-action="bike" aria-pressed="false"><span>⌁</span> Ciclovias</button>
        <button type="button" data-map-action="school"><span>●</span> Auto Escola Centro</button>
      </div>
      <div class="home-map-canvas" aria-label="Mapa interativo de São José dos Campos"></div>
      <div class="home-map-results" hidden></div>
      <div class="home-map-status" aria-live="polite">Arraste, aproxime ou escolha um atalho.</div>
      <div class="home-map-source">Mapa © OpenStreetMap contributors · renderização OpenFreeMap. Ciclovias exibidas conforme traçados comunitários do OpenStreetMap e podem diferir do mapa oficial.</div>
    </div>`;
  return section;
}

function getCachedSearch(query: string) {
  try {
    const raw = sessionStorage.getItem(`${SEARCH_CACHE_PREFIX}${query.toLowerCase()}`);
    return raw ? (JSON.parse(raw) as SearchResult[]) : null;
  } catch {
    return null;
  }
}

function cacheSearch(query: string, results: SearchResult[]) {
  try {
    sessionStorage.setItem(`${SEARCH_CACHE_PREFIX}${query.toLowerCase()}`, JSON.stringify(results));
  } catch {
    // Search remains functional if storage is unavailable.
  }
}

async function searchPlace(query: string) {
  const cached = getCachedSearch(query);
  if (cached) return cached;

  const elapsed = Date.now() - lastSearchAt;
  if (elapsed < 1100) await wait(1100 - elapsed);
  lastSearchAt = Date.now();

  const params = new URLSearchParams({
    q: `${query}, São José dos Campos, SP, Brasil`,
    format: 'jsonv2',
    limit: '5',
    countrycodes: 'br',
    'accept-language': 'pt-BR',
    viewbox: NOMINATIM_VIEWBOX,
    bounded: '1',
  });
  const response = await fetch(`${NOMINATIM}?${params.toString()}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Busca indisponível agora (${response.status}).`);
  const results = (await response.json()) as SearchResult[];
  cacheSearch(query, results);
  return results;
}

function markPlace(map: Map, result: SearchResult, label?: string) {
  const lng = Number(result.lon);
  const lat = Number(result.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;

  map.flyTo({ center: [lng, lat], zoom: 15.5, duration: 900 });
  const popup = new Popup({ offset: 22 }).setText(label ?? compact(result.display_name));
  const marker = new Marker({ color: '#2d5bff' }).setLngLat([lng, lat]).setPopup(popup).addTo(map);
  marker.togglePopup();
}

function renderSearchResults(node: HTMLElement, results: SearchResult[], map: Map) {
  node.replaceChildren();
  node.hidden = false;

  if (!results.length) {
    const message = document.createElement('p');
    message.textContent = 'Não encontrei esse lugar dentro de São José dos Campos.';
    node.append(message);
    return;
  }

  for (const result of results) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'home-map-result';
    button.textContent = compact(result.display_name);
    button.addEventListener('click', () => {
      markPlace(map, result);
      node.hidden = true;
    });
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

function getCachedCycleways(): CycleGeoJson | null {
  try {
    const raw = localStorage.getItem(CYCLE_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as { fetchedAt: number; data: CycleGeoJson };
    return Date.now() - cached.fetchedAt <= CACHE_TTL_MS ? cached.data : null;
  } catch {
    return null;
  }
}

function cacheCycleways(data: CycleGeoJson) {
  try {
    localStorage.setItem(CYCLE_CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), data }));
  } catch {
    // Layer remains functional without local persistence.
  }
}

async function loadCycleways() {
  const cached = getCachedCycleways();
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
  cacheCycleways(data);
  return data;
}

async function toggleCycleways(map: Map, button: HTMLButtonElement, status: HTMLElement) {
  const sourceId = 'centro-cycleways';
  const layerId = 'centro-cycleways-line';
  const active = button.getAttribute('aria-pressed') === 'true';

  if (active) {
    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', 'none');
    button.setAttribute('aria-pressed', 'false');
    setStatus(status, 'Ciclovias ocultadas.');
    return;
  }

  button.disabled = true;
  setStatus(status, 'Carregando ciclovias e ciclofaixas mapeadas…');
  try {
    if (!map.getSource(sourceId)) {
      const data = await loadCycleways();
      map.addSource(sourceId, { type: 'geojson', data });
      map.addLayer({
        id: layerId,
        type: 'line',
        source: sourceId,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#168a62',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 15, 5],
          'line-opacity': 0.88,
        },
      });
      map.on('click', layerId, (event) => {
        const feature = map.queryRenderedFeatures(event.point, { layers: [layerId] })[0];
        const name = String(feature?.properties?.name || 'Trecho cicloviário mapeado');
        new Popup({ offset: 8 }).setLngLat(event.lngLat).setText(`${compact(name)} · OpenStreetMap`).addTo(map);
      });
      map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
    } else if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, 'visibility', 'visible');
    }
    button.setAttribute('aria-pressed', 'true');
    setStatus(status, 'Ciclovias visíveis. Toque em um trecho para identificar o local.');
  } catch (error) {
    setStatus(status, error instanceof Error ? error.message : 'Não foi possível carregar as ciclovias.', true);
  } finally {
    button.disabled = false;
  }
}

function mount(anchor: Element) {
  const section = buildSection();
  anchor.append(section);

  const canvas = section.querySelector<HTMLElement>('.home-map-canvas');
  const form = section.querySelector<HTMLFormElement>('.home-map-search');
  const input = section.querySelector<HTMLInputElement>('#centro-map-search');
  const results = section.querySelector<HTMLElement>('.home-map-results');
  const status = section.querySelector<HTMLElement>('.home-map-status');
  const locateButton = section.querySelector<HTMLButtonElement>('[data-map-action="locate"]');
  const bikeButton = section.querySelector<HTMLButtonElement>('[data-map-action="bike"]');
  const schoolButton = section.querySelector<HTMLButtonElement>('[data-map-action="school"]');

  if (!canvas || !form || !input || !results || !status || !locateButton || !bikeButton || !schoolButton) {
    section.remove();
    return null;
  }

  const map = new Map({
    container: canvas,
    style: MAP_STYLE,
    center: CITY_CENTER,
    zoom: 11.6,
    minZoom: 9,
    maxZoom: 18,
    attributionControl: true,
  });
  map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');

  const geolocate = new GeolocateControl({
    positionOptions: { enableHighAccuracy: true, timeout: 9000 },
    trackUserLocation: false,
    showAccuracyCircle: true,
    showUserLocation: true,
    fitBoundsOptions: { maxZoom: 15 },
  });
  map.addControl(geolocate, 'bottom-right');
  geolocate.on('geolocate', () => setStatus(status, 'Sua localização foi encontrada.'));
  geolocate.on('error', () => setStatus(status, 'Não consegui acessar sua localização. Confira a permissão do navegador.', true));

  locateButton.addEventListener('click', () => {
    setStatus(status, 'Pedindo sua localização ao navegador…');
    geolocate.trigger();
  });
  bikeButton.addEventListener('click', () => void toggleCycleways(map, bikeButton, status));

  schoolButton.addEventListener('click', async () => {
    schoolButton.disabled = true;
    setStatus(status, 'Localizando a Auto Escola Centro…');
    try {
      const first = (await searchPlace(SCHOOL_QUERY))[0];
      if (!first) throw new Error('Não encontrei o endereço no mapa agora.');
      markPlace(map, first, 'Auto Escola Centro · Avenida São José, 1009');
      setStatus(status, 'Auto Escola Centro localizada no mapa.');
    } catch (error) {
      setStatus(status, error instanceof Error ? error.message : 'Não foi possível localizar a Auto Escola Centro.', true);
    } finally {
      schoolButton.disabled = false;
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const query = input.value.trim();
    if (query.length < 3) {
      setStatus(status, 'Digite pelo menos 3 caracteres para buscar.', true);
      return;
    }
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit) submit.disabled = true;
    setStatus(status, `Buscando “${query}”…`);
    try {
      const found = await searchPlace(query);
      renderSearchResults(results, found, map);
      if (found[0]) markPlace(map, found[0]);
      setStatus(status, found.length ? `${found.length} resultado${found.length === 1 ? '' : 's'} encontrado${found.length === 1 ? '' : 's'}.` : 'Nenhum resultado encontrado.');
    } catch (error) {
      setStatus(status, error instanceof Error ? error.message : 'A busca está indisponível agora.', true);
    } finally {
      if (submit) submit.disabled = false;
    }
  });

  map.on('load', () => setStatus(status, 'Mapa pronto. Busque um lugar ou escolha um atalho.'));
  map.on('error', () => setStatus(status, 'Algumas partes do mapa podem estar temporariamente indisponíveis.', true));
  return { anchor, section, map };
}

function cleanup() {
  if (!mounted) return;
  try { mounted.map.remove(); } catch { /* already detached */ }
  mounted.section.remove();
  mounted = null;
}

function scan() {
  if (window.location.pathname !== '/') {
    cleanup();
    return;
  }
  const anchor = document.querySelector('.city-home-section');
  if (!anchor) return;
  if (mounted?.anchor === anchor && document.contains(mounted.section)) return;
  cleanup();
  mounted = mount(anchor);
}

const observer = new MutationObserver(scan);
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('popstate', scan);
scan();
