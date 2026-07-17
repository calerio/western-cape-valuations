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
 */
const maplibregl = window.maplibregl;
// design tokens (assets/tokens.css) — read once at boot; map.html pins dark
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
import { getRates, computeRates } from "./rates.js?v=1";

// Western Cape framing extent — the map is FIT to this on load (with padding) so the
// whole province frames itself on any screen/aspect, phone or desktop. [lng, lat]: SW, NE.
const WC_FIT = [[17.2, -34.95], [24.3, -30.55]];
// Pan clamp. Must be generous VERTICALLY: framing the wide province on a tall phone
// shows ~15° of latitude, so a tight clamp would force MapLibre to zoom in to obey it.
// This box only stops you wandering off across the country; load-fit does the framing.
const WC_PAN = [[13.0, -41.5], [28.0, -24.5]];

// Satellite/aerial basemap. Esri World Imagery: free, no API key, ~z19+ detail.
// To change basemap (e.g. SA NGI aerial, Sentinel-2) swap this one object — see spec §4.
// NB: the Esri tile path is {z}/{y}/{x} (y before x), not the usual {z}/{x}/{y}.
const BASEMAP = {
  id: 'esri-world-imagery',
  tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
  tileSize: 256,
  maxzoom: 19,
  attribution: 'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community',
};

// WC SG planning cadastre, layer 1 "Erven (Surveyor General)" — the join fields
// TAG_VALUE (erf number) + Town_name were validated live in MAP-FEASIBILITY.md.
// No published open licence: attributed to the Surveyor-General, served as-is.
const CADASTRE = {
  url: 'https://gis.westerncape.gov.za/server2/rest/services/SpatialDataWarehouse/SG_PlanningCadastre/MapServer/1/query',
  fields: 'TAG_VALUE,Town_name,PRCL_KEY',
  minzoom: 15.5,       // a viewport at this zoom holds well under the server's 1000-feature cap
  attribution: 'Parcels: Surveyor-General / Western Cape Government (as-is)',
};

function initMap() {
  const map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      sources: {},
      // neutral backdrop shown wherever imagery tiles are missing (degrade quietly)
      layers: [{ id: 'bg', type: 'background', paint: { 'background-color': cssVar('--map-bg') || '#0b0b0d' } }],
    },
    bounds: WC_FIT,                 // fit the province on load — responsive to viewport aspect
    fitBoundsOptions: { padding: 30 },
    minZoom: 4.8,
    maxZoom: BASEMAP.maxzoom,
    maxBounds: WC_PAN,              // clamp panning near the province
    attributionControl: false,      // we add our own (compact) below
    dragRotate: false,              // a flat aerial map — no rotation/pitch
    pitchWithRotate: false,
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  return map;
}

function addBasemap(map) {
  map.addSource(BASEMAP.id, {
    type: 'raster',
    tiles: BASEMAP.tiles,
    tileSize: BASEMAP.tileSize,
    maxzoom: BASEMAP.maxzoom,
    attribution: BASEMAP.attribution,
  });
  map.addLayer({ id: BASEMAP.id, type: 'raster', source: BASEMAP.id });
}

// Municipality outlines for orientation while zoomed out (same GeoJSON the Atlas uses,
// served same-origin from Pages). Purely contextual — failure to load is ignored.
async function addBoundaries(map) {
  try {
    const gj = await (await fetch('data/geo/wc-municipalities.geojson')).json();
    map.addSource('munis', { type: 'geojson', data: gj });
    map.addLayer({
      id: 'munis-line', type: 'line', source: 'munis',
      maxzoom: CADASTRE.minzoom,     // hand over to parcel lines once erven appear
      paint: { 'line-color': cssVar('--map-muni-line'), 'line-width': 1 },
    });
  } catch (e) { console.warn('muni boundaries unavailable', e); }
}

/* ───────────────────────────── wards (increment #4) ───────────────────────────── */

// Municipal ward boundaries (Municipal Demarcation Board, current delimitation) —
// an ORIENTATION overlay: dashed amber lines + "Ward N" labels, plus a transparent
// fill so a parcel click can name the ward it falls in. One committed GeoJSON
// (data/geo/wc-wards.geojson, 406 wards) serves this map and the Atlas.
// Failure to load degrades quietly: no wards, everything else keeps working.
const WARD_LAYERS = ['ward-fill', 'ward-lines', 'ward-labels'];

async function addWards(map) {
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
    });
    map.addLayer({
      id: 'ward-lines', type: 'line', source: 'wards',
      minzoom: 8.5,                       // below this, municipalities are the story
      paint: {
        'line-color': cssVar('--map-ward'),   // amber, distinct from the white parcel lines
        'line-dasharray': [2.5, 2],
        'line-width': ['interpolate', ['linear'], ['zoom'], 8.5, 0.8, 13, 1.4, 18, 2.2],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 8.5, 0.5, 11, 0.8],
      },
    });
    map.addLayer({
      id: 'ward-labels', type: 'symbol', source: 'wards',
      minzoom: 10.5,
      layout: {
        'text-field': ['concat', 'Ward ', ['get', 'ward']],
        'text-size': ['interpolate', ['linear'], ['zoom'], 10.5, 10, 16, 13],
        'text-letter-spacing': 0.08,
        'text-transform': 'uppercase',
      },
      paint: {
        'text-color': cssVar('--map-ward-label'),
        'text-halo-color': 'rgba(12,21,18,.85)',
        'text-halo-width': 1.3,
      },
    });
    initWardChip(map);
  } catch (e) { console.warn('ward boundaries unavailable', e); }
}

function initWardChip(map) {
  const chip = $('wardchip');
  if (!chip) return;
  chip.hidden = false;
  chip.addEventListener('click', () => {
    const on = !chip.classList.contains('on');
    chip.classList.toggle('on', on);
    chip.setAttribute('aria-checked', String(on));
    WARD_LAYERS.forEach(id =>
      map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'));
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

function esriToGeoJSON(esri) {
  // esriGeometryPolygon rings -> GeoJSON Polygon. Ring winding/holes are irrelevant
  // for outline + hit-test purposes, so rings are used as-is.
  return {
    type: 'FeatureCollection',
    features: (esri.features || []).map(f => ({
      type: 'Feature',
      properties: f.attributes,
      geometry: { type: 'Polygon', coordinates: f.geometry.rings },
    })),
  };
}

function addParcels(map) {
  map.addSource('parcels', {
    type: 'geojson', data: EMPTY_FC,
    promoteId: 'PRCL_KEY',           // feature-state (selection highlight) keys on the SG key
    attribution: CADASTRE.attribution,
  });
  // invisible-ish fill = the click/hover target + selection tint
  map.addLayer({
    id: 'parcels-fill', type: 'fill', source: 'parcels',
    paint: {
      'fill-color': cssVar('--map-parcel-sel'),
      'fill-opacity': ['case', ['boolean', ['feature-state', 'sel'], false], 0.30, 0.03],
    },
  });
  const SEL = ['boolean', ['feature-state', 'sel'], false];
  map.addLayer({
    id: 'parcels-line', type: 'line', source: 'parcels',
    paint: {
      'line-color': ['case', SEL, cssVar('--map-parcel-sel'), cssVar('--map-parcel-line')],
      // NB: zoom interpolation must be the TOP-LEVEL expression (MapLibre rejects
      // zoom nested inside case — the layer silently never draws), so the
      // selected-vs-normal width choice lives inside each interpolation stop.
      'line-width': ['interpolate', ['linear'], ['zoom'],
        15.5, ['case', SEL, 2.5, 0.5],
        19, ['case', SEL, 3.2, 1.4]],
    },
  });
  const refresh = () => { clearTimeout(parcelTimer); parcelTimer = setTimeout(() => loadParcels(map), 250); };
  map.on('moveend', refresh);
  refresh();
}

async function loadParcels(map) {
  if (map.getZoom() < CADASTRE.minzoom) {
    map.getSource('parcels').setData(EMPTY_FC);
    setHint(t('Zoom in to see erven'));
    return;
  }
  if (parcelAbort) parcelAbort.abort();
  const ctl = (parcelAbort = new AbortController());
  setHint(t('Loading erven…'));
  const b = map.getBounds();
  const params = new URLSearchParams({
    geometry: JSON.stringify({ xmin: b.getWest(), ymin: b.getSouth(), xmax: b.getEast(), ymax: b.getNorth(),
      spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
    outFields: CADASTRE.fields, returnGeometry: 'true', outSR: '4326', geometryPrecision: '6', f: 'json',
  });
  try {
    const res = await fetch(`${CADASTRE.url}?${params}`, { signal: ctl.signal });
    const json = await res.json();
    if (ctl.signal.aborted) return;
    if (json.error) throw new Error(json.error.message || 'cadastre error');
    map.getSource('parcels').setData(esriToGeoJSON(json));
    setHint(json.exceededTransferLimit ? t('Too many erven for one view — zoom in')
                                       : t('Click an erf for its valuation'));
  } catch (e) {
    if (e.name === 'AbortError') return;
    console.warn('parcel fetch failed', e);
    setHint(t('Erf boundaries unavailable right now'));   // imagery keeps working — degrade quietly
  }
}

/* ─────────────────────── click → valuation (increment #3) ─────────────────────── */

let selId = null;
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
  const map = window._map;
  if (selId !== null) map.setFeatureState({ source: 'parcels', id: selId }, { sel: false });
  selId = f.id;
  map.setFeatureState({ source: 'parcels', id: selId }, { sel: true });
  await showValuation({ ...f.properties, _ward: parcelWard });
}

// ---- tiny formatting helpers (mirrors atlas.js conventions) ----
const N = v => Number(v).toLocaleString('en-ZA');
const R = v => {
  if (v == null) return '—';
  // Afrikaans large-number words differ (10⁹ = miljard, not "billion") — see atlas.js R()
  const af = LANG === 'af', d = s => af ? s.replace('.', ',') : s;
  if (v >= 1e9) return 'R' + d((v / 1e9).toFixed(2)) + (af ? ' mjd.' : ' bn');
  if (v >= 1e6) return 'R' + d((v / 1e6).toFixed(2)) + (af ? ' mn.' : ' m');
  return 'R' + N(Math.round(v));
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clWs = s => (s || '').replace(/\s+/g, ' ').trim();
const RZA = v => 'R' + N(Math.round(v));

// Verified municipal rates (rates.js + data/rates.json). Shown only when the
// municipality's official tariff is on file — no figure beats a made-up one.
let RATESDATA = null;
getRates().then(d => { RATESDATA = d; });

// Rank valuation rows for a clicked parcel: the same erf NUMBER recurs across towns,
// so prefer rows whose suburb/municipality matches the cadastre's Town_name. Suburb
// evidence outranks municipality evidence — several towns share one municipality
// (Stellenbosch town vs Franschhoek are both muni "Stellenbosch"), so a muni match
// alone must not tie with a town match.
function rankRows(rows, town) {
  const t = (town || '').toUpperCase().trim();
  const score = r => {
    const sub = (r.suburb || '').toUpperCase().trim(), mun = (r.muni || '').toUpperCase().trim();
    if (!t) return 0;
    if (sub === t) return 5;
    if (sub && (sub.includes(t) || t.includes(sub))) return 4;
    if (mun === t) return 2;
    if (mun && (mun.includes(t) || t.includes(mun))) return 1;
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

async function lookupErf(tag, town) {
  const dm = String(tag || '').match(/\d+/);
  if (!dm) return { rows: [], best: 0, stale: false };
  const nval = parseInt(dm[0], 10);
  const db = await ensureDB();
  try {
    const rows = await db.db.query(
      'SELECT muni,suburb,erf,address,extent,dwext,value,tenure,category FROM prop ' +
      'WHERE erf_int=? AND value>0 ORDER BY value DESC LIMIT 80', [nval]);
    return { ...rankRows(rows, town), stale: false };
  } catch (err) {
    // The hosted search.db predates the erf_int column (upload pending): fall back to
    // the FTS index — bare + zero-padded erf tokens — then confirm the erf client-side.
    const rows = await db.db.query(
      'SELECT p.muni,p.suburb,p.erf,p.address,p.extent,p.dwext,p.value,p.tenure,p.category FROM psearch f ' +
      'JOIN prop p ON p.id=f.rowid WHERE psearch MATCH ? AND p.value>0 ORDER BY p.value DESC LIMIT 80',
      [`${dm[0]} OR ${String(nval).padStart(8, '0')}`]);
    const exact = rows.filter(r => parseInt((String(r.erf || '').match(/\d+/) || ['-1'])[0], 10) === nval);
    return { ...rankRows(exact, town), stale: true };
  }
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
    if (!rows.length) rows = await db.db.query(
      SEL + 'scheme >= ? COLLATE NOCASE AND scheme < ? COLLATE NOCASE' + TAIL, [name, name + '￿']);
    for (const r of rows) {
      const key = r.scheme || name;
      if (!seen.has(key)) { seen.add(key); groups.push({ scheme: key, rows: [] }); }
      groups.find(g => g.scheme === key).rows.push(r);
    }
  }
  return groups;
}

function renderSchemeList(g, props) {
  const total = g.rows.reduce((s, r) => s + (r.value || 0), 0);
  $('pbody').innerHTML =
    `<div class="pKick">${esc([props.Town_name, props._ward != null ? 'Ward ' + props._ward : null]
      .filter(Boolean).join(' · '))}</div>` +
    `<div class="pAddr">${esc(clWs(g.scheme))}</div>` +
    `<div class="pVal">${R(total)}</div>` +
    `<div class="pSub">${tf('sectional-title scheme — {n} units', { n: g.rows.length })}</div>` +
    g.rows.slice(0, 40).map((r, i) =>
      `<div class="pRow pPick" data-i="${i}"><span class="k">${esc(clWs(r.address) || '—')}</span>` +
      `<span class="v">${R(r.value)}</span></div>`).join('') +
    (g.rows.length > 40 ? `<div class="pNote">${tf('Showing the 40 highest of {n}.', { n: g.rows.length })}</div>` : '');
  const sub = t('sectional-title units of this scheme');
  $('pbody').querySelectorAll('.pPick').forEach(el =>
    el.addEventListener('click', () => renderDetail(g.rows[+el.dataset.i], props, g.rows, sub)));
  openPanel();
  maybeInjectChooser();
}

function renderSchemeChooser(groups, props) {
  $('pbody').innerHTML =
    `<div class="pKick">${esc(props.Town_name || '')}</div>` +
    `<div class="pAddr">${tf('{n} schemes match here', { n: groups.length })}</div>` +
    `<div class="pSub">${t('same scheme name registered more than once — pick the one you mean')}</div>` +
    groups.map((g, i) =>
      `<div class="pRow pPick" data-i="${i}"><span class="k">${esc(clWs(g.scheme))}</span>` +
      `<span class="v">${tf('{n} units', { n: g.rows.length })}</span></div>`).join('');
  $('pbody').querySelectorAll('.pPick').forEach(el =>
    el.addEventListener('click', () => renderSchemeList(groups[+el.dataset.i], props)));
  openPanel();
  maybeInjectChooser();
}

const $ = id => document.getElementById(id);

/* ---- i18n (same catalog + resolution as atlas.js; see data/i18n-af.json) ---- */
const LANG = (() => { try { const v = localStorage.getItem('wcv-lang'); if (v === 'af' || v === 'en') return v; } catch (_) {}
  return (navigator.language || '').toLowerCase().startsWith('af') ? 'af' : 'en'; })();
let I18N = null;
const t = str => (I18N && I18N.strings[str]) || str;
const tn = n => (I18N && I18N.names[n]) || n;
const tf = (str, kw) => t(str).replace(/\{(\w+)\}/g, (_, k) => kw[k]);
async function initI18n() {
  if (LANG !== 'af') return;
  try { I18N = await (await fetch('data/i18n-af.json')).json(); } catch (_) { return; }
  document.documentElement.lang = 'af';
  document.title = t('Western Cape Property Valuation Atlas — Satellite map');
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  $('brandTitle').textContent = tn('Western Cape');
}
function wireLangToggle() {
  document.querySelectorAll('[data-lang]').forEach(a => {
    if (a.dataset.lang === LANG) a.setAttribute('aria-current', 'page');
    a.addEventListener('click', e => { e.preventDefault();
      try { localStorage.setItem('wcv-lang', a.dataset.lang); } catch (_) {}
      if (a.dataset.lang !== LANG) location.reload();
    });
  });
}
function setHint(text) { const h = $('maphint'); if (h) { h.textContent = text; h.hidden = !text; } }
function openPanel() { $('ppanel').hidden = false; }
function closePanel() {
  $('ppanel').hidden = true;
  if (selId !== null && window._map) window._map.setFeatureState({ source: 'parcels', id: selId }, { sel: false });
  selId = null;
}

function statRow(k, v) {
  return `<div class="pRow"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`;
}

function ratesNote(rr) {
  const cents = (rr.rate * 100).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return `${esc(cents)}c/R${rr.reduction ? tf(' on value above {v}', { v: RZA(rr.reduction) }) : ''}` +
         (rr.source ? ` · <a href="${esc(rr.source)}" target="_blank" rel="noopener">${t('Official tariff')} ↗</a>` : '');
}

function renderDetail(r, props, backList, backSub) {
  const ppm = r.extent && r.value ? 'R' + N(Math.round(r.value / r.extent)) + ' / m²' : '—';
  const rr = computeRates(RATESDATA, r.muni, r.category, r.tenure, r.value);
  $('pbody').innerHTML =
    (backList ? `<div id="pback" class="pLink">${tf('← All {n} valuations on this erf', { n: backList.length })}</div>` : '') +
    `<div class="pKick">${esc([clWs(r.suburb), tn(r.muni)].filter(Boolean).join(' · '))}</div>` +
    `<div class="pAddr">${esc(clWs(r.address) || t('Unnamed erf'))}</div>` +
    `<div class="pVal">${R(r.value)}</div>` +
    `<div class="pSub">${t('municipal market value')}</div>` +
    statRow(t('Erf / unit'), r.erf || '—') +
    (props._ward != null ? statRow(t('Ward'), props._ward) : '') +
    statRow(t('Category'), r.category || '—') +
    statRow(t('Extent'), r.extent ? N(Math.round(r.extent)) + ' m²' : '—') +
    (r.dwext ? statRow(t('Dwelling extent'), N(Math.round(r.dwext)) + ' m²') : '') +
    statRow(t('Value per m²'), ppm) +
    (rr ? statRow(tf('Rates / year ({year})', { year: rr.year }), RZA(rr.annual)) +
          statRow(t('Rates / month'), RZA(rr.monthly)) : '') +
    `<div class="pNote">${rr ? ratesNote(rr) + ' · ' : ''}${tf("Parcel {key}. Roll valuation as at the municipality's valuation date, set for rates — not today's sale price.", { key: esc(props.PRCL_KEY || '') })}</div>`;
  if (backList) $('pback').onclick = () => renderList(backList, props, backSub);
  openPanel();
  maybeInjectChooser();
}

function renderList(rows, props, subText) {
  $('pbody').innerHTML =
    `<div class="pKick">${esc([props.Town_name, props._ward != null ? 'Ward ' + props._ward : null]
      .filter(Boolean).join(' · '))}</div>` +
    `<div class="pAddr">${tf('Erf {erf} — {n} valuations', { erf: esc(props.TAG_VALUE || '?'), n: rows.length })}</div>` +
    `<div class="pSub">${esc(subText || t('portions or sectional-title units share this parcel'))}</div>` +
    rows.slice(0, 40).map((r, i) =>
      `<div class="pRow pPick" data-i="${i}"><span class="k">${esc(clWs(r.address) || r.erf || 'Unnamed')}</span>` +
      `<span class="v">${R(r.value)}</span></div>`).join('') +
    (rows.length > 40 ? `<div class="pNote">${tf('Showing the 40 highest of {n}.', { n: rows.length })}</div>` : '');
  const sub = subText;
  $('pbody').querySelectorAll('.pPick').forEach(el =>
    el.addEventListener('click', () => renderDetail(rows[+el.dataset.i], props, rows, sub)));
  openPanel();
  maybeInjectChooser();
}

// When a click hit several overlapping parcels, prepend a "N parcels here" switcher to whatever the
// panel currently shows (valuation, list, or no-match) so the user can pick a different parcel.
function maybeInjectChooser() {
  if (parcelCands.length < 2) return;
  const body = $('pbody'); if (!body) return;
  const bar = document.createElement('div');
  bar.className = 'pLink';
  bar.textContent = tf('⇅ {n} parcels overlap here — choose', { n: parcelCands.length });
  bar.onclick = renderParcelChooser;
  body.insertBefore(bar, body.firstChild);
}

function renderParcelChooser() {
  $('pbody').innerHTML =
    `<div class="pKick">${t('Overlapping parcels')}</div>` +
    `<div class="pAddr">${tf('{n} parcels at this point', { n: parcelCands.length })}</div>` +
    `<div class="pSub">${t('smallest (most specific) first — pick the one you mean')}</div>` +
    parcelCands.map((f, i) =>
      `<div class="pRow pPick" data-i="${i}"><span class="k">Erf ${esc(f.properties.TAG_VALUE || '?')}` +
      `${f.properties.Town_name ? ' · ' + esc(clWs(f.properties.Town_name)) : ''}</span>` +
      `<span class="v">${N(Math.round(parcelAreaM2(f.geometry)))} m²</span></div>`).join('');
  $('pbody').querySelectorAll('.pPick').forEach(el =>
    el.addEventListener('click', () => pickParcel(parcelCands[+el.dataset.i])));
  openPanel();
}

async function showValuation(props) {
  $('pbody').innerHTML =
    `<div class="pKick">${esc(props.Town_name || '')}</div>` +
    `<div class="pAddr">Erf ${esc(props.TAG_VALUE || '?')}</div>` +
    `<div class="pSub">${t('Looking up valuation…')}</div>`;
  openPanel();
  maybeInjectChooser();          // let the user switch parcels immediately, even while loading
  let res;
  try { res = await lookupErf(props.TAG_VALUE, props.Town_name); }
  catch (e) {
    console.warn('valuation lookup failed', e);
    $('pbody').innerHTML += `<div class="pNote">${t('The valuation database is still loading — try the parcel again in a moment.')}</div>`;
    resetDB();
    maybeInjectChooser();
    return;
  }
  // Weak or empty erf match → maybe a CoCT sectional building (roll has no erf for
  // those). Ask the City's scheme layer what sits under the click before giving up.
  if (!res.rows.length || res.best < 4) {
    try {
      const cands = await schemesAtClick();
      if (cands.length) {
        const groups = await lookupSchemes(cands);
        if (groups.length === 1) { renderSchemeList(groups[0], props); return; }
        if (groups.length > 1) { renderSchemeChooser(groups, props); return; }
      }
    } catch (e) { console.warn('scheme fallback failed', e); }
  }
  if (!res.rows.length) {
    $('pbody').innerHTML =
      `<div class="pKick">${esc(props.Town_name || '')}</div>` +
      `<div class="pAddr">Erf ${esc(props.TAG_VALUE || '?')}</div>` +
      `<div class="pVal" style="font-size:22px">${t('No valuation found')}</div>` +
      `<div class="pNote">${t('Not in the extracted rolls — possibly state land, a supplementary roll, or another town name.')}${res.stale ? t(' The search index is one update behind.') : ''}</div>`;
    maybeInjectChooser();
    return;
  }
  const sure = res.best >= 4;    // suburb-level match = genuinely this parcel's rows
  const note =
    res.best === 0 ? `<div class="pNote">${t('⚠ No town match — same erf number in several municipalities; verify the address.')}</div>` :
    !sure ? `<div class="pNote">${t('⚠ Same erf number, other townships — may not be this parcel.')}</div>` : '';
  const listSub = sure ? t('portions or sectional-title units share this parcel')
                       : t('same erf number, other townships — may not be this parcel');
  if (res.rows.length === 1) { renderDetail(res.rows[0], props, null); }
  else { renderList(res.rows, props, listSub); }
  if (note) $('pbody').insertAdjacentHTML('beforeend', note);
}

/* ─────────────────────── search.db worker (same pattern as atlas.js) ─────────────────────── */

let dbw = null, dbwPromise = null;
async function ensureDB() {
  if (dbw) return dbw;
  if (!dbwPromise) dbwPromise = (async () => {
    const mod = await import('https://cdn.jsdelivr.net/npm/sql.js-httpvfs@0.8.12/+esm');
    const createDbWorker = mod.createDbWorker || mod.default.createDbWorker;
    const abs = p => new URL(p, location.href).href;
    // Served from Supabase Storage, NOT GitHub Pages (Pages gzip-corrupts the HTTP range
    // requests sql.js-httpvfs needs — see DATA_CONTRACT §8). ?db=<url> overrides for local dev.
    const DB_CONFIG = new URLSearchParams(location.search).get('db') ||
      'https://nxeasppmwvzcqbbgrdvf.supabase.co/storage/v1/object/public/valuations/v5/config.json';
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

function boot() {
  wireLangToggle();
  initI18n();
  if (!maplibregl) {
    document.getElementById('mapfail')?.removeAttribute('hidden');
    return;
  }
  const map = initMap();
  window._map = map;                 // closePanel needs it to clear the selection
  map.on('load', () => {
    addBasemap(map);
    addBoundaries(map);
    addWards(map);
    addParcels(map);
    onParcelClick(map);
  });
  map.on('error', (e) => console.warn('map error', e && e.error)); // tile gaps degrade quietly
  $('pclose').addEventListener('click', closePanel);
  addEventListener('keydown', e => { if (e.key === 'Escape') closePanel(); });
  ensureDB().catch(() => {});       // pre-warm the SQLite worker so the first click is fast
}

boot();
