/* Western Cape Property Valuation Atlas — satellite map view.
 *
 * Increment #1: the map shell — aerial-imagery basemap, WC bounds, controls.
 * Increment #2+#3 (this file now implements both): cadastral parcels + click-to-valuation.
 * Increment #4: ward-boundary overlay (MDB wards, dashed amber + labels + panel row).
 *
 * Parcels are fetched LIVE per viewport from the WC Surveyor-General planning cadastre
 * (ArcGIS REST, CORS-enabled, validated in MAP-FEASIBILITY.md) once you zoom close enough
 * — no pre-built tiles, no new hosting. A clicked parcel resolves to its valuation in the
 * existing Supabase-hosted search.db via the indexed erf_int column (see DATA_CONTRACT §9).
 * The PMTiles pipeline in MAP-FEASIBILITY.md remains a future optimisation if the live
 * service becomes a bottleneck. Everything degrades quietly: no parcels → imagery map;
 * no valuation match → an honest "no match" card.
 * Design: docs/superpowers/specs/2026-06-22-map-view-design.md (+ 2026-07-02 parcels spec)
 *
 * ONE page, two entry points: map.html (<body data-basemap="sat">) and plain.html
 * (<body data-basemap="map">) are the same shell with a different default basemap
 * (DATA_CONTRACT §15/§16). The OpenFreeMap Liberty style is fetched once and transformed
 * (assets/map/style.js: Esri imagery layer above `background`, satellite layer set, AF labels);
 * the Map/Satellite buttons switch IN PLACE (layer visibility/paint only — no setStyle, no
 * reload), so the camera, the open panel and the selected erf survive the switch. The URL hash
 * carries place/muni, basemap, camera and selected parcel (assets/map/hash.js).
 * Place search + boundary highlight live in places.js.
 * Design: docs/design-2026-09/03-design-plan.md §3, §5
 */
let maplibregl = null;          // window.maplibregl — the deferred CDN script; read in boot()
// design tokens (assets/tokens.css). The --map-* overlay inks live on the [data-theme] pins;
// setBasemap() flips the pin (sat → dark, map → light) and re-reads them (applyOverlayTokens).
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
import { renderState, lastRender, clearRender, configurePanel, initPanel, setSheet, labelSheet, clWs } from "./map/panel.js?v=3";
import { dur } from "./motion.js?v=1";
import { initPlaceSearch } from "./places.js?v=5";
import { createSelectionGuard, createProbeGate, lookupPath } from "./selection.js?v=1";
import { hatchImageData } from "./map/hatch.js?v=1";
import { shouldRefetch } from "./map/bbox.js?v=2";
import { parseMapHash, buildMapHash } from "./map/hash.js?v=1";
import { slugOf, featureBySlug, featureBounds } from "./slug.js?v=1";
import { transformStyle, applyBasemap, applyLanguage } from "./map/style.js?v=2";
import { t, tf, tn, loadCatalog, applyDom, setLang, onLangChange, currentLang } from "./i18n.js?v=1";

// The shell's default basemap (map.html: sat, plain.html: map) — omitted from the hash when current.
const PAGE_B = document.body.dataset.basemap === 'sat' ? 'sat' : 'map';
const readHash = () => parseMapHash(location.hash, { b: PAGE_B });
// Basemap on load: the hash's b= wins over the shell default.
const MODE0 = parseMapHash(location.hash, { b: document.body.dataset.basemap }).b;
let basemap = MODE0;
const themeFor = b => (b === 'sat' ? 'dark' : 'light');
// Theme pin + body flag BEFORE any cssVar() read, so the overlay inks match the basemap.
document.documentElement.dataset.theme = themeFor(MODE0);
document.body.dataset.basemap = MODE0;
// Browser chrome follows the pinned theme (the shells' own values: map.html dark, plain.html light).
function setThemeColor(b) {
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', themeFor(b) === 'dark' ? '#0b0b0d' : '#f5f5f7');
}
setThemeColor(MODE0);

// Merge a patch into the map hash (replaceState — no history entries, no hashchange).
// undefined/null removes a key; the shell's default basemap is left implicit.
function writeHash(patch) {
  const st = { ...readHash(), ...patch };
  for (const k of Object.keys(st)) if (st[k] == null) delete st[k];
  if (st.b === PAGE_B) delete st.b;
  history.replaceState(null, '', location.pathname + location.search + buildMapHash(st));
}
const round = (v, dp) => Math.round(v * 10 ** dp) / 10 ** dp;

// Western Cape framing extent — the map is FIT to this on load (with padding) so the
// whole province frames itself on any screen/aspect, phone or desktop. [lng, lat]: SW, NE.
const WC_FIT = [[17.2, -34.95], [24.3, -30.55]];
// Pan clamp. Must be generous VERTICALLY: framing the wide province on a tall phone
// shows ~15° of latitude, so a tight clamp would force MapLibre to zoom in to obey it.
// This box only stops you wandering off across the country; load-fit does the framing.
const WC_PAN = [[13.0, -41.5], [28.0, -24.5]];

// Satellite imagery (Esri World Imagery: free, keyless; tiles to z18, overzoomed above) is added to the Liberty
// style by transformStyle() (assets/map/style.js: ESRI_TILES / ESRI_ATTRIB) — swap it there.
const MAX_ZOOM = 19;

// Base style for BOTH basemaps — OpenFreeMap Liberty: free, keyless OSM vector tiles,
// crisp at parcel zoom (overzoomed vectors, unlike raster). Fetched ONCE as JSON and
// transformed; '/bright' and '/positron' are drop-in alternates, or self-host PMTiles
// if the community service ever becomes unreliable.
const PLAIN_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

// WC SG planning cadastre, layer 1 "Erven (Surveyor General)" — the join fields
// TAG_VALUE (erf number) + Town_name were validated live in MAP-FEASIBILITY.md. Town_name
// has since gone NULL on every parcel (provider join broke, seen 2026-09) — Town_code survives
// and is resolved through data/geo/sg-towns.json (see townOf).
// No published open licence: attributed to the Surveyor-General, served as-is.
const CADASTRE = {
  url: 'https://gis.westerncape.gov.za/server2/rest/services/SpatialDataWarehouse/SG_PlanningCadastre/MapServer/1/query',
  fields: 'TAG_VALUE,Town_name,Town_code,PRCL_KEY,WSTATUS',
  minzoom: 15.5,       // a viewport at this zoom holds well under the server's 1000-feature cap
  attribution: 'Parcels: Surveyor-General / Western Cape Government (as-is)',
};

function initMap(style, cam) {
  const map = new maplibregl.Map({
    container: 'map',
    style,                          // the transformed Liberty style object (both basemaps)
    // a camera in the hash (c=) wins; otherwise fit the province — responsive to viewport aspect
    ...(cam ? { center: [cam.lng, cam.lat], zoom: cam.z } : { bounds: WC_FIT, fitBoundsOptions: { padding: 30 } }),
    minZoom: 4.8,
    maxZoom: MAX_ZOOM,
    maxBounds: WC_PAN,              // clamp panning near the province
    attributionControl: false,      // ours lives in the ⓘ popover (initAttribution)
    dragRotate: false,              // a flat aerial map — no rotation/pitch
    pitchWithRotate: false,
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
  initAttribution(map);
  return map;
}

// Attribution: MapLibre's own control (so credits follow the sources actually in use — Esri
// appears only while imagery is shown) mounted inside #attrib. Wider than 640 px the credits line is
// always shown inline, bottom-right (map.css hides the ⓘ); on phones it is a popover behind the ⓘ.
function initAttribution(map) {
  const btn = $('attribBtn'), box = $('attrib');
  if (!btn || !box) { map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right'); return; }
  const ctrl = new maplibregl.AttributionControl({ compact: false });
  box.appendChild(ctrl.onAdd(map));
  const wide = matchMedia('(min-width: 641px)');
  const set = open => { box.hidden = !open; btn.setAttribute('aria-expanded', String(open)); };
  const layout = () => set(wide.matches);            // inline on wide screens, closed popover on phones
  layout();
  wide.addEventListener('change', layout);
  btn.addEventListener('click', e => { e.stopPropagation(); set(box.hidden); });
  document.addEventListener('click', e => { if (!wide.matches && !box.hidden && !box.contains(e.target)) set(false); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && !wide.matches && !box.hidden) set(false); });
}

// Municipality polygons: drawn as outlines below, and used by muniAt() to scope every erf
// lookup to the municipality actually clicked (the Integrity rule — see lookupErf).
// The UNSIMPLIFIED borders (wc-municipalities-full.geojson): the simplified file the Atlas draws
// moves borders by up to ~200 m and opens gaps between neighbours, which would mis-scope clicks
// near a border (DATA_CONTRACT §11).
const MUNIS = fetch('data/geo/wc-municipalities-full.geojson').then(r => r.json()).catch(() => null);
// SG town code -> township name (generated by the data repo's extract/fetch_sg_towns.py).
const SG_TOWNS = fetch('data/geo/sg-towns.json').then(r => r.json()).catch(() => ({}));
let sgTowns = {}, munisGj = null;
SG_TOWNS.then(d => { sgTowns = d || {}; });
MUNIS.then(d => { munisGj = d; });
const townOf = p => p.Town_name || sgTowns[p.Town_code] || '';

// Municipality containing a point (ray casting over the MDB polygons; holes respected).
function muniAt(ll) {
  if (!ll || !munisGj) return null;
  const inRing = (ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > ll.lat) !== (yj > ll.lat) && ll.lng < (xj - xi) * (ll.lat - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const inPoly = rings => inRing(rings[0]) && !rings.slice(1).some(inRing);
  for (const f of munisGj.features) {
    const g = f.geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    if (polys.some(inPoly)) return f.properties.name;
  }
  return null;
}

// Municipality outlines for orientation while zoomed out (same GeoJSON the Atlas uses,
// served same-origin from Pages). Purely contextual — failure to load is ignored.
async function addBoundaries(map, beforeId) {
  try {
    const gj = await MUNIS;
    if (!gj) return;
    map.addSource('munis', { type: 'geojson', data: gj });
    map.addLayer({
      id: 'munis-line', type: 'line', source: 'munis',
      maxzoom: CADASTRE.minzoom,     // hand over to parcel lines once erven appear
      paint: { 'line-color': cssVar('--map-muni-line'), 'line-width': 1 },
    }, beforeId);
  } catch (e) { console.warn('muni boundaries unavailable', e); }
}

/* ───────────────────────────── wards (increment #4) ───────────────────────────── */

// Municipal ward boundaries (Municipal Demarcation Board, current delimitation) —
// an ORIENTATION overlay: dashed amber lines + "Ward N" labels, plus a transparent
// fill so a parcel click can name the ward it falls in. One committed GeoJSON
// (data/geo/wc-wards.geojson, 406 wards) serves this map and the Atlas.
// Failure to load degrades quietly: no wards, everything else keeps working.
// Chip state. Ward labels are OFF by default (quiet map); they draw only while Wards is also on.
const chipState = { wards: true, wardLabels: false, labels: true };

// Ward-label halo per theme pin: a light halo under the dark amber label ink on the map basemap, a dark
// one under the pale label ink on satellite. (--map-halo is a light-dark() pair, which MapLibre cannot
// parse, so the two values are picked here from [data-theme].)
const wardHalo = () => (document.documentElement.dataset.theme === 'dark' ? 'rgba(12,21,18,.85)' : 'rgba(255,255,255,.85)');

async function addWards(map, beforeId) {
  try {
    const gj = await (await fetch('data/geo/wc-wards.geojson')).json();
    map.addSource('wards', {
      type: 'geojson', data: gj,
      attribution: 'Wards: Municipal Demarcation Board',
    });
    // transparent hit-layer: lets the click handler resolve "which ward is this
    // point in" at any zoom without ever drawing (or intercepting) anything.
    map.addLayer({
      id: 'ward-fill', type: 'fill', source: 'wards',
      paint: { 'fill-opacity': 0 },
    }, beforeId);
    map.addLayer({
      id: 'ward-lines', type: 'line', source: 'wards',
      minzoom: 8.5,                       // below this, municipalities are the story
      paint: {
        'line-color': cssVar('--map-ward'),   // amber, distinct from the white parcel lines
        'line-dasharray': [2.5, 2],
        'line-width': ['interpolate', ['linear'], ['zoom'], 8.5, 0.8, 13, 1.4, 18, 2.2],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 8.5, 0.5, 11, 0.8],
      },
    }, beforeId);
    map.addLayer({
      id: 'ward-labels', type: 'symbol', source: 'wards',
      minzoom: 10.5,
      layout: {
        'text-field': ['concat', t('Ward') + ' ', ['get', 'ward']],
        'text-size': ['interpolate', ['linear'], ['zoom'], 10.5, 10, 16, 13],
        // the OpenFreeMap glyph endpoint serves its own fonts, not MapLibre's default
        // (404s), so name one it actually has
        'text-font': ['Noto Sans Regular'],
        visibility: chipState.wards && chipState.wardLabels ? 'visible' : 'none',
      },
      paint: {
        'text-color': cssVar('--map-ward-label'),
        'text-halo-color': wardHalo(),
        'text-halo-width': 1.3,
      },
    }, beforeId);
    initWardChip(map);
  } catch (e) { console.warn('ward boundaries unavailable', e); }
}

// First symbol (label) layer of the current style — overlay anchor for plain mode.
function firstSymbolLayerId(map) {
  const l = map.getStyle().layers.find(l => l.type === 'symbol');
  return l && l.id;
}

// One role="switch" chip: flips chipState[key], mirrors it on the element, then re-applies.
function wireChip(id, key, apply) {
  const chip = $(id);
  if (!chip) return;
  chip.hidden = false;
  const sync = () => { chip.classList.toggle('on', chipState[key]); chip.setAttribute('aria-checked', String(chipState[key])); };
  const toggle = () => { chipState[key] = !chipState[key]; sync(); apply(); };
  sync();
  chip.addEventListener('click', toggle);
  chip.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
}

function applyWardVisibility(map) {
  const vis = on => (on ? 'visible' : 'none');
  for (const id of ['ward-fill', 'ward-lines'])
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis(chipState.wards));
  if (map.getLayer('ward-labels'))
    map.setLayoutProperty('ward-labels', 'visibility', vis(chipState.wards && chipState.wardLabels));
}

function initWardChip(map) {
  wireChip('wardchip', 'wards', () => applyWardVisibility(map));
  wireChip('wardlabelchip', 'wardLabels', () => applyWardVisibility(map));
}

// Basemap labels (the Liberty style's own symbol layers — place, road, POI names) on/off.
// Only the style's layers carry metadata.wcv_paint (set by transformStyle), so our overlays and
// the ward labels are untouched; applyBasemap() never changes symbol visibility.
function initLabelChip(map) {
  wireChip('labelchip', 'labels', () => {
    for (const l of map.getStyle().layers)
      if (l.type === 'symbol' && l.metadata && l.metadata.wcv_paint && map.getLayer(l.id))
        map.setLayoutProperty(l.id, 'visibility', chipState.labels ? 'visible' : 'none');
  });
}

// Ward containing a clicked point (null when wards are off/unavailable).
function wardAt(map, point) {
  if (!map.getLayer('ward-fill')) return null;
  const hit = map.queryRenderedFeatures(point, { layers: ['ward-fill'] })[0];
  return hit ? hit.properties.ward : null;
}

/* ───────────────────────────── parcels (increment #2) ───────────────────────────── */

const EMPTY_FC = { type: 'FeatureCollection', features: [] };
let parcelAbort = null, parcelTimer = null;
// The last SUCCESSFUL cadastre fetch now in the 'parcels' source: { bbox, zoom, truncated }. A moveend
// that stays inside it (at the same or a higher zoom, not truncated) needs no refetch. Cleared on a
// fetch error and when the source is emptied (zoomed out below minzoom). An ABORTED fetch leaves it
// alone: the source still holds the erven that lastFetch describes.
let lastFetch = null, parcelInFlight = false;

function esriToGeoJSON(esri) {
  // esriGeometryPolygon rings -> GeoJSON Polygon. Ring winding/holes are irrelevant
  // for outline + hit-test purposes, so rings are used as-is.
  return {
    type: 'FeatureCollection',
    // belt and braces: the query already asks for WSTATUS='C'; drop anything else client-side so an
    // obsolete erf can never be drawn or hit-tested even if the server ignores the filter
    features: (esri.features || []).filter(f => !f.attributes || f.attributes.WSTATUS == null || f.attributes.WSTATUS === 'C').map(f => ({
      type: 'Feature',
      properties: f.attributes,
      geometry: { type: 'Polygon', coordinates: f.geometry.rings },
    })),
  };
}

// '#rrggbb' (or '#rgb') → [r,g,b,255] for the hatch tiles; falls back to the cadastral accent.
function hexToRgba(hex) {
  let h = String(hex || '').trim().replace(/^#/, '');
  if (h.length === 3) h = h.replace(/./g, c => c + c);
  if (!/^[0-9a-f]{6}$/i.test(h)) return [31, 78, 140, 255];
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)).concat(255);
}

// Filter that matches only the selected erf ('' matches nothing: PRCL_KEY is never empty).
const selFilter = id => ['==', ['get', 'PRCL_KEY'], id == null ? '' : id];
// Selection outline dash per link status (line-dasharray cannot read feature-state, so it is set
// with setPaintProperty by setSelectionStatus).
const SEL_DASH = { verified: [1, 0], possible: [2, 2], none: [1, 2] };
// Hatch tile per status ('none' keeps sparse but its opacity drops to 0 via feature-state).
const SEL_PATTERN = { verified: 'hatch-dense', possible: 'hatch-sparse', none: 'hatch-sparse' };

function addParcels(map, beforeId) {
  map.addSource('parcels', {
    type: 'geojson', data: EMPTY_FC,
    promoteId: 'PRCL_KEY',           // feature-state (selection highlight) keys on the SG key
    attribution: CADASTRE.attribution,
  });
  const selColor = cssVar('--map-parcel-sel');   // plain hex on the [data-theme] pins
  // SG-diagram hatch tiles for the selected erf (design 2026-09): dense = verified, sparse = possible
  const rgba = hexToRgba(selColor);
  for (const d of ['dense', 'sparse'])
    if (!map.hasImage('hatch-' + d)) map.addImage('hatch-' + d, hatchImageData(12, 4, rgba, d), { pixelRatio: 2 });
  const SEL = ['boolean', ['feature-state', 'sel'], false];
  // invisible-ish fill = the click/hover target + a light selection tint (the hatch carries the selection)
  map.addLayer({
    id: 'parcels-fill', type: 'fill', source: 'parcels',
    paint: {
      'fill-color': selColor,
      'fill-opacity': ['case', SEL, 0.12, 0.03],
    },
  }, beforeId);
  // 45° hatch inside the selected erf. fill-pattern cannot read feature-state (style spec: parameters
  // zoom + feature only), so the layer is filtered to the selected id and setSelectionStatus() swaps
  // the pattern with setPaintProperty; opacity does read feature-state ('none' → no hatch).
  map.addLayer({
    id: 'parcels-sel-hatch', type: 'fill', source: 'parcels',
    filter: selFilter(null),
    paint: {
      'fill-pattern': SEL_PATTERN.possible,
      // dense (verified) hatch at 0.55 so the imagery still reads through it; sparse at 0.9
      'fill-opacity': ['case', ['boolean', ['feature-state', 'none'], false], 0,
        ['boolean', ['feature-state', 'verified'], false], 0.55, 0.9],
    },
  }, beforeId);
  // every erf: pale hairline so the selection reads first
  map.addLayer({
    id: 'parcels-line', type: 'line', source: 'parcels',
    paint: {
      'line-color': cssVar('--map-parcel-line'),
      'line-opacity': 0.6,
      // NB: zoom interpolation must be the TOP-LEVEL expression (MapLibre rejects
      // zoom nested inside case — the layer silently never draws).
      'line-width': ['interpolate', ['linear'], ['zoom'], 15.5, 0.8, 19, 1.4],
    },
  }, beforeId);
  // ink outline of the selected erf; solid/dashed/dotted set per status by setSelectionStatus()
  map.addLayer({
    id: 'parcels-sel-line', type: 'line', source: 'parcels',
    filter: selFilter(null),
    paint: {
      'line-color': selColor,
      'line-width': ['interpolate', ['linear'], ['zoom'], 15.5, 2.5, 19, 3.2],
      'line-dasharray': SEL_DASH.possible,
    },
  }, beforeId);
  const refresh = () => { clearTimeout(parcelTimer); parcelTimer = setTimeout(() => loadParcels(map), 250); };
  map.on('moveend', refresh);
  refresh();
}

async function loadParcels(map) {
  // The deep-linked s= gets exactly one attempt: this first call claims it, whatever happens next.
  const selKey = pendingSel;
  pendingSel = null;
  const dropSel = () => { if (selKey && selId === null) writeHash({ s: undefined }); };  // never the user's own pick
  if (map.getZoom() < CADASTRE.minzoom) {
    dropSel();
    lastFetch = null;
    map.getSource('parcels').setData(EMPTY_FC);
    setHint('Zoom in to see erven');
    return;
  }
  const b = map.getBounds();
  const view = { bbox: { w: b.getWest(), s: b.getSouth(), e: b.getEast(), n: b.getNorth() }, zoom: map.getZoom() };
  if (!selKey && !shouldRefetch(lastFetch, view)) {
    // the loaded erven already cover this view; drop a fetch for an earlier view still in flight.
    // Re-set the hint so a stale "Loading erven…" never lingers, but keep the place search's
    // "Boundary unavailable" message: it describes the fly-to that caused this very moveend.
    if (parcelInFlight && parcelAbort) { parcelAbort.abort(); parcelInFlight = false; }
    const h = $('maphint');
    if (!h || h.dataset.i18n !== 'Boundary unavailable — zoomed to the area') setHint('Tap or click an erf for its valuation');
    return;
  }
  if (parcelAbort) parcelAbort.abort();
  const ctl = (parcelAbort = new AbortController());
  parcelInFlight = true;
  setHint('Loading erven…');
  const params = new URLSearchParams({
    geometry: JSON.stringify({ xmin: b.getWest(), ymin: b.getSouth(), xmax: b.getEast(), ymax: b.getNorth(),
      spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
    // current erven only: obsolete ones (WSTATUS='H', 5.4%) sit inside their successors and the
    // smallest-first chooser used to prefer them — a click landed on a parcel that no longer exists
    where: "WSTATUS='C'",
    outFields: CADASTRE.fields, returnGeometry: 'true', outSR: '4326', geometryPrecision: '6', f: 'json',
  });
  try {
    const res = await fetch(`${CADASTRE.url}?${params}`, { signal: ctl.signal });
    const json = await res.json();
    if (ctl.signal.aborted) { dropSel(); return; }
    if (json.error) throw new Error(json.error.message || 'cadastre error');
    map.getSource('parcels').setData(esriToGeoJSON(json));
    lastFetch = { ...view, truncated: !!json.exceededTransferLimit };   // shouldRefetch() refuses a truncated one
    setHint(lastFetch.truncated ? 'Too many erven for one view — zoom in'
                                : 'Tap or click an erf for its valuation');
    if (selKey) map.once('idle', () => selectPending(map, selKey));
  } catch (e) {
    dropSel();
    if (e.name === 'AbortError') return;
    lastFetch = null;
    console.warn('parcel fetch failed', e);
    setHint('Erf boundaries unavailable right now');   // imagery keeps working — degrade quietly
  } finally {
    if (parcelAbort === ctl) parcelInFlight = false;
  }
}

/* ─────────────────────── click → valuation (increment #3) ─────────────────────── */

let selId = null;
// s=<PRCL_KEY> from the hash on load: selected ONCE, after the first parcel load for that camera.
// Honoured only with a hash camera (c=) at parcel zoom; otherwise it is dropped from the hash now.
let pendingSel = null;
{
  const h0 = readHash();
  if (h0.s && h0.c && h0.c.z >= CADASTRE.minzoom) pendingSel = h0.s;
  else if (h0.s) writeHash({ s: undefined });
}

// Deep-linked selection → the ordinary click path (pickParcel) for that one erf. One attempt only:
// a parcel that is not in the first loaded view (e.g. no camera in the hash) is simply not selected.
function selectPending(map, key) {
  if (!key || selId !== null) return;      // the user already picked something — theirs wins
  const f = map.querySourceFeatures('parcels').find(f => (f.id != null ? f.id : f.properties.PRCL_KEY) === key);
  if (!f) { writeHash({ s: undefined }); return; }
  // a point for muniAt()/wardAt(): the hash camera when it lies on the erf, else the ring's mean vertex
  const ring = (f.geometry && f.geometry.coordinates && f.geometry.coordinates[0]) || [];
  const cam = readHash().c;
  let ll = cam ? { lng: cam.lng, lat: cam.lat } : null;
  const onErf = ll && map.queryRenderedFeatures(map.project(ll), { layers: ['parcels-fill'] })
    .some(h => (h.id != null ? h.id : h.properties.PRCL_KEY) === key);
  if (!onErf && ring.length) {
    const n = ring.length;
    ll = { lng: ring.reduce((a, p) => a + p[0], 0) / n, lat: ring.reduce((a, p) => a + p[1], 0) / n };
  }
  parcelCands = [f];
  parcelWard = ll ? wardAt(map, map.project(ll)) : null;
  lastClickLL = ll;
  pickParcel(f);
}
// parcels under the last click, smallest-first, + that click's ward — powers the overlap chooser.
// Cadastre parcels routinely overlap (utility erven, sectional-scheme PARENT parcels, remnant
// subdivisions), so one click can land on several. We auto-pick the SMALLEST (most specific): an
// individual erf beats the giant reservoir/complex sitting on top of it — and offer a chooser to
// switch. See docs/superpowers/specs/2026-07-03-performance-and-stats-design.md.
let parcelCands = [], parcelWard = null, lastClickLL = null;

// Approx footprint area (m²) of a parcel's outer ring (planar, scaled by mean latitude) — ranks
// overlapping parcels smallest-first and labels them in the chooser. Relative order is what matters.
function parcelAreaM2(geom) {
  const ring = geom && geom.coordinates && geom.coordinates[0];
  if (!ring || ring.length < 4) return Infinity;
  let latSum = 0; for (const p of ring) latSum += p[1];
  const mx = 111320 * Math.cos((latSum / ring.length) * Math.PI / 180), my = 110540;
  let a = 0;
  for (let i = 0, n = ring.length - 1; i < n; i++)
    a += (ring[i][0] * mx) * (ring[i + 1][1] * my) - (ring[i + 1][0] * mx) * (ring[i][1] * my);
  return Math.abs(a) / 2;
}

function onParcelClick(map) {
  map.on('mouseenter', 'parcels-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'parcels-fill', () => { map.getCanvas().style.cursor = ''; });
  map.on('click', 'parcels-fill', (e) => {
    // every parcel under the point (a geojson source returns full, un-clipped geometry here)
    const hits = map.queryRenderedFeatures(e.point, { layers: ['parcels-fill'] });
    if (!hits.length) return;
    const seen = new Set(); parcelCands = [];
    for (const f of hits) {
      const key = f.id != null ? f.id : f.properties.PRCL_KEY;
      if (seen.has(key)) continue;
      seen.add(key); parcelCands.push(f);
    }
    parcelCands.sort((a, b) => parcelAreaM2(a.geometry) - parcelAreaM2(b.geometry));
    parcelWard = wardAt(map, e.point);
    lastClickLL = e.lngLat;              // for the CoCT sectional-scheme fallback
    pickParcel(parcelCands[0]);          // the smallest, most specific erf
  });
}

// Select one parcel (highlight it) and show its valuation. Also invoked when the user switches
// parcels from the overlap chooser.
async function pickParcel(f) {
  const token = selection.begin();        // this selection now owns the panel; earlier lookups are stale
  const map = window._map;
  if (selId !== null) map.setFeatureState({ source: 'parcels', id: selId }, { sel: false, verified: false, none: false });
  selId = f.id;
  lastView = null;                        // until showValuation runs, a language switch must not re-render the previous parcel
  pendingSel = null;
  writeHash({ s: selId });
  map.setFeatureState({ source: 'parcels', id: selId }, { sel: true, verified: false });
  setSelFilter(map, selId);
  setSelectionStatus('possible');        // sparse hatch + dashed until the link decision is known
  panSelectionUp(map, f);                 // phones: keep the erf clear of the bottom sheet
  await Promise.all([SG_TOWNS, MUNIS]);   // town names + muni polygons: tiny, normally long loaded
  if (!selection.isCurrent(token)) return;
  await showValuation({ ...f.properties, Town_name: townOf(f.properties), _ward: parcelWard, _muni: muniAt(lastClickLL) }, token);
}

/* ---- phone bottom sheet (map.css ≤ 640 px): peek ↔ open, swipe down to close ---- */
const PHONE = '(max-width: 640px)';
const phoneMQ = (() => { try { return matchMedia(PHONE); } catch (_) { return null; } })();
const isPhone = () => !!(phoneMQ && phoneMQ.matches);

// Centre of a parcel's bounding box (the rendered, tile-clipped geometry is close enough to place it).
function featureCenter(g) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const walk = c => { if (typeof c[0] === 'number') { x0 = Math.min(x0, c[0]); x1 = Math.max(x1, c[0]); y0 = Math.min(y0, c[1]); y1 = Math.max(y1, c[1]); } else c.forEach(walk); };
  if (g && g.coordinates) walk(g.coordinates);
  return isFinite(x0) ? [(x0 + x1) / 2, (y0 + y1) / 2] : null;
}
// Phones: pan so the selected erf's centre lands at 30% of the map height — above the peek sheet
// (≤ 40vh), in the upper half. dur() makes it instant under prefers-reduced-motion.
function panSelectionUp(map, f) {
  if (!isPhone() || !map || !f) return;
  const c = featureCenter(f.geometry); if (!c) return;
  const h = map.getContainer().clientHeight;
  map.panTo(c, { offset: [0, Math.round(-0.2 * h)], duration: dur(300) });
}
// Keep --sheet-h (map.css) equal to the sheet's height so ⓘ, its popover and the hint sit above it.
function syncSheetH() {
  const p = $('ppanel');
  const h = p && !p.hidden && isPhone() ? p.offsetHeight : 0;
  document.documentElement.style.setProperty('--sheet-h', h + 'px');
}
// Handle tap (panel.js) + vertical drags anywhere on the sheet (Pointer Events: touch, pen, mouse):
// up > 40 px opens it; down > 40 px goes open → peek, or peek → closed (a long drag down from open,
// > 200 px, closes directly). While the open sheet's content is scrolled, a drag scrolls it instead.
// The peek sheet and #pgrab are touch-action:none (map.css); on the open sheet the browser keeps
// panning, and a pointercancel (it took the gesture to scroll) counts as no gesture. The click that
// follows a drag (> 10 px of movement) is swallowed, so a drag on #pgrab does not also toggle it.
function initSheet() {
  const p = $('ppanel'); if (!p) return;
  let id = null, y0 = 0, drag = false, dragged = false;
  p.addEventListener('pointerdown', e => {
    dragged = false;
    if (!isPhone() || !e.isPrimary || e.button > 0) { id = null; return; }
    id = e.pointerId; y0 = e.clientY;
    const onGrab = !!(e.target.closest && e.target.closest('#pgrab'));
    drag = onGrab || p.dataset.sheet !== 'open' || p.scrollTop <= 0;
    // Capture on the pressed element itself (not the sheet), so a plain tap still clicks that button/link.
    try { if (e.target.setPointerCapture) e.target.setPointerCapture(id); } catch (_) { }
  });
  p.addEventListener('pointerup', e => {
    if (id == null || e.pointerId !== id) return;
    id = null;
    const dy = e.clientY - y0;
    if (!drag) return;
    // A press that moved (> 10 px) is a drag, not a tap: swallow the click this pointerup produces.
    if (Math.abs(dy) > 10) { dragged = true; setTimeout(() => { dragged = false; }, 0); }
    if (Math.abs(dy) <= 40) return;
    if (dy < 0) setSheet('open');
    else if (p.dataset.sheet === 'open' && dy <= 200) setSheet('peek');
    else closePanel();
  });
  p.addEventListener('pointercancel', e => { if (e.pointerId === id) id = null; });
  p.addEventListener('click', e => { if (dragged) { dragged = false; e.stopPropagation(); e.preventDefault(); } }, true);
  // Peek clips #pbody: KEYBOARD focus moving past the handle and close button expands the sheet. Focus
  // that is not :focus-visible (engines that focus a tapped button) is a tap, not navigation — ignored.
  const kbdFocus = el => { try { return el.matches(':focus-visible'); } catch (_) { return true; } };
  p.addEventListener('focusin', e => {
    if (p.dataset.sheet === 'peek' && e.target !== p && e.target !== $('pclose') && e.target !== $('pgrab') &&
        isPhone() && kbdFocus(e.target)) setSheet('open');
  });
  if (typeof ResizeObserver === 'function') new ResizeObserver(syncSheetH).observe(p);
  new MutationObserver(syncSheetH).observe(p, { attributes: true, attributeFilter: ['hidden', 'data-sheet'] });
  if (phoneMQ) { if (phoneMQ.addEventListener) phoneMQ.addEventListener('change', syncSheetH); else if (phoneMQ.addListener) phoneMQ.addListener(syncSheetH); }
  syncSheetH();
}

// Point the selection layers (hatch + outline) at one erf, or at nothing (id null).
function setSelFilter(map, id) {
  for (const l of ['parcels-sel-hatch', 'parcels-sel-line'])
    if (map.getLayer(l)) map.setFilter(l, selFilter(id));
}

// Draw the selected erf by link status, like an SG diagram:
//   'verified' → dense hatch + solid outline; 'possible' (possible/several) → sparse hatch + dashed;
//   'none' (no valuation / could not link) → no hatch, dotted outline.
function setSelectionStatus(status) {
  const map = window._map;
  if (!map || selId === null) return;
  if (!SEL_DASH[status]) status = 'possible';
  map.setFeatureState({ source: 'parcels', id: selId }, { verified: status === 'verified', none: status === 'none' });
  if (map.getLayer('parcels-sel-hatch')) map.setPaintProperty('parcels-sel-hatch', 'fill-pattern', SEL_PATTERN[status]);
  if (map.getLayer('parcels-sel-line')) map.setPaintProperty('parcels-sel-line', 'line-dasharray', SEL_DASH[status]);
}

// Formatting helpers + the Matzikama address suppression live with the panel (assets/map/panel.js).

// Rank valuation rows for a clicked parcel: the same erf NUMBER recurs across towns,
// so prefer rows whose suburb/municipality matches the cadastre's Town_name. Suburb
// evidence outranks municipality evidence — several towns share one municipality
// (Stellenbosch town vs Franschhoek are both muni "Stellenbosch"), so a muni match
// alone must not tie with a town match.
// Township-name normaliser: the cadastre labels towns in English with punctuation
// ("BETTY`S BAY", "BOT RIVER", "STILL BAY EAST", "GROOT BRAK RIVER (MOSSEL BAY)") while the
// rolls use Afrikaans/compact spellings ("BETTYS BAY", "BOTRIVIER", "STILBAAI OOS",
// "GROOT BRAKRIVIER"). Both sides are normalised to the same shape, so pairs converge
// regardless of which language either side used.
function normTown(s) {
  return (s || '').toUpperCase().replace(/\(.*?\)/g, '')
    .replace(/\bRIVER\b/g, 'RIVIER').replace(/\bBAY\b/g, 'BAAI')
    .replace(/\bEAST\b/g, 'OOS').replace(/\bWEST\b/g, 'WES')
    .replace(/[^A-Z]/g, '').replace(/(.)\1+/g, '$1'); // collapse doubles: STILL/STIL, GRAAFF/GRAAF
}
// Cadastre name -> roll name where spelling genuinely differs (alias / roll typo).
// Single source: data/geo/town-aliases.json (also read by the offline linker in extract/match).
// The literal is the fallback while the file loads / if it fails. Keys/values are normTown output.
let TOWN_ALIAS = { ARNISTON: 'WAENHUISKRANS', MCGREGOR: 'MCREGOR', BELVEDERE: 'BELVIDERE', GRAAFWATER: 'GRAAFFWATER',
  BETIESBAI: 'BETYSBAI' };
fetch('data/geo/town-aliases.json').then(r => r.json()).then(d => { if (d && typeof d === 'object') TOWN_ALIAS = d; }).catch(() => {});
function rankRows(rows, town) {
  const t = (town || '').toUpperCase().trim();
  const nt = normTown(t), at = TOWN_ALIAS[nt] ? normTown(TOWN_ALIAS[nt]) : null;
  // town evidence from ONE label: the roll's suburb, or its town column where the export carries
  // it (George "GEORGE"/"PACALTSDORP", Beaufort West's five towns — DATA_CONTRACT §9)
  const scoreLabel = label => {
    const sub = (label || '').toUpperCase().trim();
    if (!t || !sub) return 0;
    if (sub === t) return 5;
    const ns = normTown(sub);
    if (ns && ns === nt) return 5;
    if (ns && nt && (ns.includes(nt) || nt.includes(ns))) return 4;
    if (at && ns && (ns === at || ns.includes(at) || at.includes(ns))) return 4;
    return 0;
  };
  const score = r => {
    const mun = (r.muni || '').toUpperCase().trim();
    if (!t) return 0;
    const s = Math.max(scoreLabel(r.suburb), scoreLabel(r.town));   // max: the two labels are not independent
    if (s) return s;
    if (mun === t) return 2;
    const nm = normTown(mun);
    if (nm && nt && (nm.includes(nt) || nt.includes(nm))) return 1;
    return 0;
  };
  const scored = rows.map(r => [score(r), r]).sort((a, b) => b[0] - a[0] || b[1].value - a[1].value);
  const best = scored.length ? scored[0][0] : 0;
  // best>=4 = the clicked TOWN matched (suburb evidence) — those rows genuinely sit on
  // this parcel (portions/sectional units). best 1-3 = municipality-level only: the erf
  // number exists elsewhere in the muni but this exact township wasn't found — honest
  // labelling of that difference happens in showValuation.
  return { rows: (best > 0 ? scored.filter(x => x[0] === best) : scored).map(x => x[1]), best };
}

// INTEGRITY RULE: a clicked parcel only ever shows valuations from the municipality it lies
// in. Erf numbers restart in every township, so an erf-number match alone is province-wide
// noise (erf 15773 exists in 14 towns). The municipality comes from the click point itself
// (muniAt), so it holds even when the cadastre's town attributes go missing. Rows from another
// municipality are allowed only with town-level (suburb) evidence — a boundary-sliver safety net.
// search.db ≥ v10 carries prop.town (the roll's own town column, DATA_CONTRACT §4.2); older
// hosted DBs don't — detect once so the same JS works against either.
// Probe gates (assets/selection.js): 'present'/'absent' are cached only after a SUCCESSFUL probe; a
// throwing probe is 'error' and is probed again on the next click. No error is ever cached as "absent".
const townColGate = createProbeGate(async () => {
  const db = await ensureDB();
  return (await db.db.query('PRAGMA table_info(prop)')).some(c => c.name === 'town');
});
async function hasTownCol() {
  const s = await townColGate.state();
  if (s === 'error') throw new Error('valuation database unavailable');
  return s === 'present';
}

async function lookupErf(tag, town, muni) {
  const dm = String(tag || '').match(/\d+/);
  if (!dm) return { rows: [], best: 0, stale: false };
  const nval = parseInt(dm[0], 10);
  const m = muni || '';
  const db = await ensureDB();
  let res, stale = false;
  try {
    // Town-match rows FIRST, then by value, THEN the row cap: common erf numbers recur in
    // 100-500 townships, so a plain "ORDER BY value DESC LIMIT 80" silently dropped the
    // clicked town's modest-value house before rankRows ever saw it. Rows are physically
    // clustered by erf_int (export_site.py), so scanning all of one erf's rows is a few
    // contiguous range reads.
    const t = String(town || '').trim();
    const tc = await hasTownCol();
    const q = (gate, lim) => db.db.query(
      `SELECT muni,suburb,erf,address,extent,dwext,value,tenure,category${tc ? ',town' : ''} FROM prop ` +
      `WHERE erf_int=?1 AND value>0 ${gate ? 'AND muni=?3 ' : ''}ORDER BY (suburb=?2 COLLATE NOCASE${tc ? ' OR town=?2 COLLATE NOCASE' : ''}) DESC, ` +
      "(?2<>'' AND (instr(upper(suburb),upper(?2))>0 OR instr(upper(?2),upper(suburb))>0" +
      `${tc ? " OR instr(upper(coalesce(town,'')),upper(?2))>0" : ''})) DESC, ` +
      `value DESC LIMIT ${lim}`, gate ? [nval, t, m] : [nval, t]);
    const rows = await q(!!m, 80);
    res = rankRows(rows, town);
    // No town match in the top 80? The right row may sit below the value cutoff under a
    // spelling SQL can't see (normaliser/alias cases). Rows are clustered by erf_int, so
    // fetching the erf's full row set is still only a few contiguous range reads.
    if (res.best < 4 && rows.length === 80) {
      const wide = rankRows(await q(!!m, 600), town);
      if (wide.best > res.best) res = wide;
    }
    // Nothing in the clicked municipality: accept another municipality's rows only on a
    // town-level match (click near a boundary the MDB and SG draw slightly differently).
    if (m && !res.rows.length) {
      const x = rankRows(await q(false, 600), town);
      if (x.best >= 4) res = x;
    }
  } catch (err) {
    // The hosted search.db predates the erf_int column (upload pending): fall back to
    // the FTS index — bare + zero-padded erf tokens — then confirm the erf client-side.
    const rows = await db.db.query(
      'SELECT p.muni,p.suburb,p.erf,p.address,p.extent,p.dwext,p.value,p.tenure,p.category FROM psearch f ' +
      'JOIN prop p ON p.id=f.rowid WHERE psearch MATCH ? AND p.value>0 ORDER BY p.value DESC LIMIT 80',
      [`${dm[0]} OR ${String(nval).padStart(8, '0')}`]);
    const exact = rows.filter(r => parseInt((String(r.erf || '').match(/\d+/) || ['-1'])[0], 10) === nval);
    res = rankRows(m ? exact.filter(r => r.muni === m) : exact, town);
    stale = true;
  }
  // Every surviving row is from the clicked municipality → at least municipality-level
  // evidence, never the "several municipalities" case.
  if (m && res.rows.length && res.best < 1) res = { ...res, best: 1 };
  return { ...res, stale };
}

/* ---- Offline parcel link table (DATA_CONTRACT §9, extract/match in the data repo) ----------
 * Every clickable SG parcel is adjudicated OFFLINE into one decision keyed by PRCL_KEY:
 *   accepted_high  one roll row tied to this parcel by town + erf (+ area)  → detail card, "verified"
 *   accepted_group one sectional scheme's units                            → unit list
 *   review         one leading candidate, locality not confirmed          → list, never a certain card
 *   ambiguous      several rows fit equally                               → unverified list
 *   not_in_roll    roll covers the town, no entry for this erf            → "No valuation found"
 *   abstain        evidence insufficient/conflicting                      → "Could not link" + unverified list
 * `pids` are property ids (= prop.pid). Detected once so the same JS works against an older DB. */
// Build verification (fails closed): the DB carries its build_id in link_meta; config.json and
// manifest.json (fetched fresh, no long-lived cache) carry the same id. Any disagreement means the
// chunks being read do not belong to the manifest — the link table is then treated as UNREADABLE
// (integrity card on every click), never as absent and never as a reason to run the heuristic.
let buildCheckPromise = null;
function verifyBuild() {
  if (!buildCheckPromise) buildCheckPromise = (async () => {
    const cfgUrl = new URLSearchParams(location.search).get('db') || DB_CONFIG_URL;
    const abs = new URL(cfgUrl, location.href);
    const fresh = u => fetch(u, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null);
    const [cfg, man] = await Promise.all([fresh(abs.href), fresh(new URL('manifest.json', abs).href)]);
    const db = await ensureDB();
    const meta = Object.fromEntries((await db.db.query('SELECT key, value FROM link_meta')).map(r => [r.key, r.value]));
    const ids = [cfg && cfg.buildId, man && man.build_id, meta.build_id];
    const ok = ids.every(Boolean) && ids.every(x => x === ids[0]) && (!man || !cfg || man.size_bytes === cfg.databaseLengthBytes);
    if (!ok) console.warn('build verification failed', { config: ids[0], manifest: ids[1], db: ids[2] });
    return ok;
  })().catch(e => { buildCheckPromise = null; throw e; });   // a transient failure is retried, never remembered
  return buildCheckPromise;
}
const linkGate = createProbeGate(async () => {
  const db = await ensureDB();
  return (await db.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='link'")).length > 0;
});
// true = link table PROVEN present · false = PROVEN absent (older hosted DB) · throws = not determinable
// right now (the click then renders the explicit "unavailable" state; the heuristic is never enabled).
async function hasLinkTable() {
  const s = await linkGate.state();
  if (s === 'error') throw new Error('link table state unavailable');
  return s === 'present';
}
const selection = createSelectionGuard();   // monotonically increasing parcel-selection token (stale-click guard)
let heuristicRuns = 0;                      // read-only diagnostics for the smoke matrix
const LINK_DISABLED = new URLSearchParams(location.search).get('nolink') === '1';
// test hook for the smoke matrix (extract/match/smoke_matrix.py): module scope is not reachable from
// the automation, so the link-path functions are exposed read-only here. Not used by the UI.
window._integrity = Object.freeze({ hasLinkTable: () => hasLinkTable(), lookupLink: k => lookupLink(k), verifyBuild: () => verifyBuild(), linkDisabled: LINK_DISABLED,
  stats: () => ({ heuristicRuns, selection: selection.current() }) });
const unavailable = cause => Object.assign(new Error('valuation data unavailable'), { code: 'DB_UNAVAILABLE', cause });
async function lookupLink(prclKey) {
  // Which lookup may run (selection.js lookupPath): 'link' when the table is PROVEN present; 'heuristic'
  // only for ?nolink=1 or a PROVEN older DB without the table; 'unavailable' for anything else (network,
  // worker, integrity or version error) — fail closed, never the heuristic (DATA_CONTRACT §9b).
  const gate = LINK_DISABLED ? 'absent' : await linkGate.state();
  const path = lookupPath(gate, LINK_DISABLED);
  if (path === 'heuristic') return null;
  if (path !== 'link') throw unavailable(gate);
  let db;
  try { db = await ensureDB(); } catch (e) { throw unavailable(e); }
  if (!(await verifyBuild())) throw new Error('build mismatch');   // fail closed (integrity card)
  // SELECT * so a build without the newer columns (complete, parent_ids) still reads; a missing
  // column is simply undefined and the feature it gates stays off
  const l = prclKey
    ? (await db.db.query('SELECT * FROM link WHERE prcl_key=?', [prclKey]))[0]
    : null;
  if (!l) return { decision: 'missing', rows: [], cands: [] };   // integrity/version gap — NOT a fallback
  const fetchRows = async (csv, cap) => {
    const ids = String(csv || '').split(',').filter(Boolean).map(Number).slice(0, cap);
    return ids.length
      ? db.db.query(`SELECT muni,suburb,town,erf,address,extent,dwext,value,tenure,category,scheme,pid FROM prop WHERE pid IN (${ids.map(() => '?').join(',')}) ORDER BY value DESC`, ids)
      : [];
  };
  return { ...l, rows: await fetchRows(l.pids, 400), cands: await fetchRows(l.cands, 40) };
}
// The panel for one link decision. Sectional buildings: the roll's units carry no erf (CoCT), so the
// offline linker can only say not_in_roll/abstain. The City's scheme-polygon layer is an independent
// evidence route (not the erf heuristic), so it is still consulted for those two decisions before the
// card. What each decision may list is decided in assets/map/panel.js (renderLinkView).
async function showLink(link, props, live) {
  const d = link.decision;
  if (d === 'not_in_roll' || d === 'abstain') {
    try {
      const cands = await schemesAtClick();
      if (!live()) return;
      if (cands.length) {
        const groups = await lookupSchemes(cands);
        if (!live()) return;
        if (groups.length) { show({ state: 'scheme', props, groups }); return; }
      }
    } catch (e) { console.warn('scheme fallback failed', e); }
  }
  if (!live()) return;
  show({ state: d, props, link, why: link.reasons });
}
/* ---- City of Cape Town sectional-scheme fallback ----------------------------------
 * The CoCT sectional roll carries NO erf numbers (units are "SCHEME UNIT n" under a
 * scheme ref like SS513/2006), so the erf join above can't find them — a click on a
 * sectional building (e.g. Portside) matched nothing, or same-numbered erven in other
 * towns. The City publishes its sectional-scheme polygons; when the erf lookup is weak
 * we ask that layer what scheme covers the click, then look its units up by the
 * `scheme` column in search.db. Metro-only by nature (the layer covers only CoCT). */
const ST_SCHEME_URL = 'https://citymaps.capetown.gov.za/agsext/rest/services/Search_Layers/SL_WGDB_ST_SCHM/MapServer/0/query';
const COCT_BBOX = { w: 18.2, e: 19.1, s: -34.4, n: -33.4 };   // rough metro extent — cheap gate

async function schemesAtClick() {
  const ll = lastClickLL;
  if (!ll || ll.lng < COCT_BBOX.w || ll.lng > COCT_BBOX.e || ll.lat < COCT_BBOX.s || ll.lat > COCT_BBOX.n) return [];
  const p = new URLSearchParams({
    geometry: JSON.stringify({ x: ll.lng, y: ll.lat }), geometryType: 'esriGeometryPoint',
    inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
    outFields: 'ST_SCHM_NAME,ST_SCHM_NO,ST_SCHM_YEAR', returnGeometry: 'false', f: 'json',
  });
  const ctl = new AbortController(); const tid = setTimeout(() => ctl.abort(), 6000);
  try {
    const json = await (await fetch(`${ST_SCHEME_URL}?${p}`, { signal: ctl.signal })).json();
    return (json.features || []).map(f => f.attributes).filter(a => a.ST_SCHM_NAME);
  } catch (e) { console.warn('scheme layer query failed', e); return []; }
  finally { clearTimeout(tid); }
}

// Units of the scheme(s) under the click, grouped per distinct scheme ref. An exact
// "NAME SSno/year" match is used when the layer gives the number; otherwise name-prefix
// (which can span two same-named schemes — hence the grouping, so the user picks).
async function lookupSchemes(cands) {
  const db = await ensureDB();
  const seen = new Set(), groups = [];
  for (const a of cands) {
    const name = clWs(a.ST_SCHM_NAME).toUpperCase();
    const exact = a.ST_SCHM_NO && a.ST_SCHM_YEAR ? `${name} SS${a.ST_SCHM_NO}/${a.ST_SCHM_YEAR}` : null;
    // COLLATE NOCASE so both predicates SEEK the (NOCASE) idx_scheme index — a bare
    // BINARY comparison, or a parameterised LIKE, degrades to a scan over httpvfs.
    // Name-prefix matching is an explicit index range: scheme ∈ [name, name+'￿').
    const SEL = 'SELECT muni,suburb,erf,address,extent,dwext,value,tenure,category,scheme FROM prop WHERE ';
    const TAIL = ' AND value>0 ORDER BY value DESC LIMIT 300';
    // the layer's scheme number is sometimes the PLAN number, not the roll's SS ref —
    // when the exact ref finds nothing, retry by scheme name
    let rows = exact ? await db.db.query(SEL + 'scheme = ? COLLATE NOCASE' + TAIL, [exact]) : [];
    const isExact = rows.length > 0;
    if (!rows.length) rows = await db.db.query(
      SEL + 'scheme >= ? COLLATE NOCASE AND scheme < ? COLLATE NOCASE' + TAIL, [name, name + '￿']);
    for (const r of rows) {
      const key = r.scheme || name;
      if (!seen.has(key)) { seen.add(key); groups.push({ scheme: key, rows: [], exact: isExact }); }
      groups.find(g => g.scheme === key).rows.push(r);
    }
  }
  return groups;
}

const $ = id => document.getElementById(id);

/* ---- i18n: shared module (assets/i18n.js, catalogue data/i18n-af.json). The EN/AF buttons switch
 * IN PLACE (no reload): setLang() re-applies the [data-i18n] DOM and notifies onLangChange, which
 * re-derives the basemap label expressions (applyLanguage) and re-renders the open panel. ---- */
function applyPageI18n() {
  document.title = t(PAGE_B === 'map'
    ? 'Western Cape Property Valuation Atlas — Map'
    : 'Western Cape Property Valuation Atlas — Satellite map');
  const bt = $('brandTitle'); if (bt) bt.textContent = tn('Western Cape');
  document.querySelectorAll('button[data-lang]').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.lang === currentLang())));
}
async function initI18n() {
  const lang = currentLang();
  await loadCatalog(lang);                     // EN: no fetch (the key is the text)
  if (currentLang() !== lang) return;          // the user switched meanwhile — setLang owns the page
  document.documentElement.lang = lang;
  applyDom();
  refreshLang(lang);                           // anything rendered before the catalogue landed
}
// Re-derive everything language-dependent outside the [data-i18n] DOM: page chrome, basemap
// label expressions, the ward-label text and the open panel. Used by initI18n and onLangChange.
function refreshLang(lang) {
  applyPageI18n();
  const map = window._map;
  if (map && map.getStyle()) {
    applyLanguage(map, lang, []);             // renamed-places overrides: not approved yet
    if (map.getLayer('ward-labels'))
      map.setLayoutProperty('ward-labels', 'text-field', ['concat', t('Ward') + ' ', ['get', 'ward']]);
  }
  labelSheet();                               // the sheet handle's Expand/Collapse name
  rerenderPanel();
}
// The chips wrap to more rows on a narrow screen and change width with the language; map.css places
// the zoom buttons under them (narrow mouse-driven windows) via --chips-h, kept current here.
function trackChipsHeight() {
  const c = $('chips'); if (!c) return;
  const sync = () => document.documentElement.style.setProperty('--chips-h', Math.ceil(c.getBoundingClientRect().height) + 'px');
  if (typeof ResizeObserver === 'function') new ResizeObserver(sync).observe(c);
  sync();
}
function wireLangToggle() {
  document.querySelectorAll('[data-lang]').forEach(a => {
    a.addEventListener('click', e => { e.preventDefault();
      if (a.dataset.lang !== currentLang()) setLang(a.dataset.lang);
    });
  });
  onLangChange(refreshLang);
  applyPageI18n();
}
// setHint takes the ENGLISH catalogue key, not translated text: the key is kept in data-i18n, so
// applyDom() re-translates the hint in place on an EN↔AF switch (never stale, never the old language).
// tests/check-i18n.mjs scans the string literals passed to setHint exactly like t() calls.
function setHint(key) {
  const h = $('maphint'); if (!h) return;
  if (key) { h.dataset.i18n = key; h.textContent = t(key); } else { delete h.dataset.i18n; h.textContent = ''; }
  h.hidden = !key;
}
function closePanel() {
  selection.begin();                      // an in-flight lookup must not reopen the panel after a close
  const wasOpen = !$('ppanel').hidden;
  $('ppanel').hidden = true;
  const st = $('pstatus'); if (st) st.textContent = '';   // the next open announces even the same status
  lastView = null;
  clearRender();
  if (selId !== null && window._map) window._map.setFeatureState({ source: 'parcels', id: selId }, { sel: false, verified: false, none: false });
  selId = null;
  if (window._map) setSelFilter(window._map, null);
  writeHash({ s: undefined });
  if (wasOpen) focusMap();
}
// Focus back to the map after the panel closes (the container is made programmatically focusable).
function focusMap() {
  const m = $('map');
  if (!m) return;
  if (!m.hasAttribute('tabindex')) m.tabIndex = -1;
  m.focus({ preventScroll: true });
}

// The parcel whose valuation the panel shows — a language switch re-renders the panel's last state
// model for it (rerenderPanel) instead of reloading the page.
let lastView = null;             // { props }

// Draw one state model into the panel (assets/map/panel.js) and mirror its status on the map.
function show(model) {
  const r = renderState($('pbody'), { ...model, overlap: parcelCands });
  setSelectionStatus(r.status);
}

// Re-render the open panel in the current language from its cached state model: same parcel, no new
// lookup, no loading placeholder, and an in-flight lookup is left to finish (it renders in the new
// language). A drill-in (list → one entry, scheme chooser) returns to the parcel's main card.
function rerenderPanel() {
  if (!lastView || $('ppanel').hidden || selId === null) return;
  const r = lastRender();
  if (r && r.model && r.model.props === lastView.props) renderState($('pbody'), r.model);
}

async function showValuation(props, token = selection.begin()) {
  const live = () => selection.isCurrent(token);   // only the CURRENT selection may write to the panel
  lastView = { props };
  show({ state: 'loading', props });   // the overlap chooser is offered immediately, even while loading
  // Offline link table first (search.db ≥ v10 with `link`): one explicit, evidence-backed decision
  // for EVERY current parcel. Any decision — abstain and ambiguous included — wins over the
  // click-time heuristic below. A key missing from the table is a data-build mismatch and is
  // reported as such; the heuristic runs only when the whole table is absent (older hosted DB)
  // or intentionally disabled with ?nolink=1.
  let link = null;
  try { link = await lookupLink(props.PRCL_KEY); }
  catch (e) {
    if (!live()) return;
    if (e && e.code === 'DB_UNAVAILABLE') {
      // transient: network, worker or build-check failure — an explicit state, probed again on the next
      // click; NEVER the heuristic (that path exists only for ?nolink=1 or a proven older DB)
      console.warn('valuation data unavailable', e);
      show({ state: 'unavailable', props });
      resetDB();
      return;
    }
    // the table exists but cannot be read (schema mismatch between this JS and the hosted DB) or the
    // build could not be verified: an integrity error card — never a hang, never the heuristic
    console.warn('link table unreadable', e);
    show({ state: 'integrity', props });
    return;
  }
  if (!live()) return;
  if (link) { await showLink(link, props, live); return; }
  heuristicRuns++;                           // legitimately reached only via ?nolink=1 or a proven older DB
  let res;
  try { res = await lookupErf(props.TAG_VALUE, props.Town_name, props._muni); }
  catch (e) {
    if (!live()) return;
    console.warn('valuation lookup failed', e);
    show({ state: 'unavailable', variant: 'loading', props });
    resetDB();
    return;
  }
  // Weak or empty erf match → maybe a CoCT sectional building (roll has no erf for
  // those). Ask the City's scheme layer what sits under the click before giving up.
  if (!res.rows.length || res.best < 4) {
    try {
      const cands = await schemesAtClick();
      if (!live()) return;
      if (cands.length) {
        const groups = await lookupSchemes(cands);
        if (!live()) return;
        if (groups.length) { show({ state: 'scheme', props, groups }); return; }
      }
    } catch (e) { console.warn('scheme fallback failed', e); }
  }
  if (!live()) return;
  show({ state: 'heuristic', props, res });
}

/* ─────────────────────── search.db worker (same pattern as atlas.js) ─────────────────────── */

// The production search DB (immutable, content-addressed namespace; see DATA_CONTRACT §8/§9).
const DB_CONFIG_URL = 'https://nxeasppmwvzcqbbgrdvf.supabase.co/storage/v1/object/public/valuations/b-2b502178f94f/config.json';
let dbw = null, dbwPromise = null;
async function ensureDB() {
  if (dbw) return dbw;
  if (!dbwPromise) dbwPromise = (async () => {
    const mod = await import('https://cdn.jsdelivr.net/npm/sql.js-httpvfs@0.8.12/+esm');
    const createDbWorker = mod.createDbWorker || mod.default.createDbWorker;
    const abs = p => new URL(p, location.href).href;
    // Served from Supabase Storage, NOT GitHub Pages (Pages gzip-corrupts the HTTP range
    // requests sql.js-httpvfs needs — see DATA_CONTRACT §8). ?db=<url> overrides for local dev.
    const DB_CONFIG = new URLSearchParams(location.search).get('db') || DB_CONFIG_URL;
    const w = await createDbWorker([{ from: 'jsonconfig', configUrl: abs(DB_CONFIG) }],
      abs('assets/vendor/sqlite.worker.js'), abs('assets/vendor/sql-wasm.wasm'));
    // Cold-start can hand back an empty wasm buffer — verify before caching. Then fault in the hot
    // index pages the first real click will need: the boot pre-warm used to run only SELECT 1, so
    // the first erf lookup paid the whole cold B-tree descent (the 20s stall). These tiny probes
    // warm the (erf_int,value) index + FTS in the background, before the user clicks.
    await w.db.query('SELECT 1');
    try {
      await w.db.query('SELECT value FROM prop WHERE erf_int=? AND value>0 ORDER BY value DESC LIMIT 1', [1]);
      await w.db.query('SELECT rowid FROM psearch WHERE psearch MATCH ? LIMIT 1', ['a*']);
    } catch (_) { /* best-effort warm-up; an older-schema DB just stays cold */ }
    dbw = w; return w;
  })().catch(e => { dbwPromise = null; throw e; });   // never cache a broken worker; allow a clean retry
  return dbwPromise;
}
function resetDB() { dbw = null; dbwPromise = null; }

// Overlay inks follow the theme pin (tokens.css: --map-* on [data-theme]); re-read after a flip.
function applyOverlayTokens(map) {
  const paint = (id, prop, v) => { if (v && map.getLayer(id)) map.setPaintProperty(id, prop, v); };
  const sel = cssVar('--map-parcel-sel');
  paint('munis-line', 'line-color', cssVar('--map-muni-line'));
  paint('ward-lines', 'line-color', cssVar('--map-ward'));
  paint('ward-labels', 'text-color', cssVar('--map-ward-label'));
  paint('ward-labels', 'text-halo-color', wardHalo());
  paint('parcels-fill', 'fill-color', sel);
  paint('parcels-line', 'line-color', cssVar('--map-parcel-line'));
  paint('parcels-sel-line', 'line-color', sel);
  paint('place-hl-fill', 'fill-color', sel);
  paint('place-hl-line', 'line-color', sel);
  const rgba = hexToRgba(sel);
  for (const d of ['dense', 'sparse'])
    if (map.hasImage('hatch-' + d)) map.updateImage('hatch-' + d, hatchImageData(12, 4, rgba, d));
}

// Map ↔ Satellite, in place: layer visibility/paint only (applyBasemap — no setStyle, no reload),
// so the camera, the panel and the selection are untouched. Theme pin, overlay inks, button state
// and the hash follow.
function setBasemap(b) {
  b = b === 'sat' ? 'sat' : 'map';
  basemap = b;
  document.body.dataset.basemap = b;
  document.documentElement.dataset.theme = themeFor(b);
  setThemeColor(b);
  document.querySelectorAll('button[data-basemap]').forEach(el =>
    el.setAttribute('aria-pressed', String(el.dataset.basemap === b)));
  const map = window._map;
  if (map && map.getStyle()) { applyBasemap(map, b); applyOverlayTokens(map); }
  writeHash({ b });
}

function wireBasemapButtons() {
  document.querySelectorAll('button[data-basemap]').forEach(el => {
    el.setAttribute('aria-pressed', String(el.dataset.basemap === basemap));
    el.addEventListener('click', () => { if (el.dataset.basemap !== basemap) setBasemap(el.dataset.basemap); });
  });
}

// Camera → hash (c=lng,lat,z), debounced; rounded so the URL stays short and stable.
let camTimer = null;
function trackCamera(map) {
  map.on('moveend', () => {
    clearTimeout(camTimer);
    camTimer = setTimeout(() => {
      const c = map.getCenter();
      writeHash({ c: { lng: round(c.lng, 5), lat: round(c.lat, 5), z: round(map.getZoom(), 2) } });
    }, 300);
  });
}

// Explore → map context (#m/<slug>, e.g. from Explore's "Open the map" links): with no camera in the
// hash (c= wins), fit the municipality's full-resolution outline. An unknown slug leaves the
// province framing in place, silently.
async function fitMuniFromHash(map) {
  const h = readHash();
  if (!h.muni || h.c) return;
  const b = featureBounds(featureBySlug(await MUNIS, h.muni));
  if (!b || readHash().c) return;          // unknown slug, or the camera moved and was written meanwhile
  map.fitBounds(b, { padding: 24, duration: dur(600) });
}

// Map → Explore context: the switcher's Explore link (and the map-failure fallback) carries the
// municipality under the map centre (#m/<slug>), plain index.html when the centre is outside every
// municipality. Debounced on moveend, like the camera hash.
let exploreTimer = null;
function updateExploreLinks(map) {
  const m = map ? muniAt(map.getCenter()) : null;
  const href = 'index.html' + (m ? '#m/' + slugOf(m) : '');
  document.querySelectorAll('#viewsegWrap a[href^="index.html"], #mapfail a[href^="index.html"]')
    .forEach(a => a.setAttribute('href', href));
}
function trackExploreLink(map) {
  map.on('moveend', () => { clearTimeout(exploreTimer); exploreTimer = setTimeout(() => updateExploreLinks(map), 300); });
  MUNIS.then(() => updateExploreLinks(map));
}

function showMapFail() { document.getElementById('mapfail')?.removeAttribute('hidden'); }

async function boot() {
  wireLangToggle();
  trackChipsHeight();
  initI18n();
  wireBasemapButtons();
  maplibregl = window.maplibregl || null;
  if (!maplibregl) { showMapFail(); return; }
  // The Liberty style, fetched ONCE; both basemaps live in this one style (transformStyle).
  let style;
  try {
    const res = await fetch(PLAIN_STYLE);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    style = transformStyle(await res.json(), { lang: currentLang(), basemap: MODE0, overrides: [] });
  } catch (e) {
    console.warn('basemap style unavailable', e);
    showMapFail();
    return;
  }
  let map;
  try {
    map = initMap(style, readHash().c);   // throws without WebGL
  } catch (e) {
    console.warn('map unavailable', e);
    showMapFail();
    return;
  }
  window._map = map;                 // closePanel needs it to clear the selection
  fitMuniFromHash(map);              // #m/<slug> without c=: frame the municipality
  trackExploreLink(map);
  map.on('load', () => {
    // our overlays slot in UNDER the style's first symbol layer so its road/place labels stay
    // legible above our translucent fills (and above the imagery in satellite)
    const beforeId = firstSymbolLayerId(map);
    addBoundaries(map, beforeId);
    addWards(map, beforeId);
    addParcels(map, beforeId);
    onParcelClick(map);
    initLabelChip(map);
    initPlaceSearch(map, { t, setHint, beforeId, writeHash });
    trackCamera(map);
  });
  map.on('error', (e) => console.warn('map error', e && e.error)); // tile gaps degrade quietly
  initPanel();                      // #ppanel: role="dialog", aria-labelledby="pTitle", #pstatus live line, #pgrab
  initSheet();                      // phones: bottom-sheet gestures + --sheet-h
  configurePanel({ pickParcel, townOf, parcelAreaM2 });
  $('pclose').addEventListener('click', closePanel);
  addEventListener('keydown', e => { if (e.key === 'Escape' && !$('ppanel').hidden) closePanel(); });
  // Pre-warm the SQLite worker so the first click is fast — but only once the map has drawn and the
  // browser is idle, so the worker, WASM and DB range reads never compete with first paint. A click
  // before that simply awaits ensureDB() itself (lookupErf).
  const idle = window.requestIdleCallback || (f => setTimeout(f, 1500));
  map.once('idle', () => idle(() => ensureDB().catch(() => {}), { timeout: 4000 }));
}

// MapLibre is a deferred classic script ahead of this module, so it has run by DOMContentLoaded.
if (document.readyState === 'loading') addEventListener('DOMContentLoaded', boot);
else boot();
