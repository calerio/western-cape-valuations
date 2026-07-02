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
      layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#0c1512' } }],
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
      paint: { 'line-color': 'rgba(243,239,230,.55)', 'line-width': 1 },
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
        'line-color': '#e8b93c',          // amber, distinct from the white parcel lines
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
        'text-color': '#f3dfa0',
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
      'fill-color': '#ffd166',
      'fill-opacity': ['case', ['boolean', ['feature-state', 'sel'], false], 0.30, 0.03],
    },
  });
  const SEL = ['boolean', ['feature-state', 'sel'], false];
  map.addLayer({
    id: 'parcels-line', type: 'line', source: 'parcels',
    paint: {
      'line-color': ['case', SEL, '#ffd166', 'rgba(243,239,230,.85)'],
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
    setHint('Zoom in to see erven');
    return;
  }
  if (parcelAbort) parcelAbort.abort();
  const ctl = (parcelAbort = new AbortController());
  setHint('Loading erven…');
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
    setHint(json.exceededTransferLimit ? 'Too many erven for one view — zoom in'
                                       : 'Click an erf for its valuation');
  } catch (e) {
    if (e.name === 'AbortError') return;
    console.warn('parcel fetch failed', e);
    setHint('Erf boundaries unavailable right now');   // imagery keeps working — degrade quietly
  }
}

/* ─────────────────────── click → valuation (increment #3) ─────────────────────── */

let selId = null;

function onParcelClick(map) {
  map.on('mouseenter', 'parcels-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'parcels-fill', () => { map.getCanvas().style.cursor = ''; });
  map.on('click', 'parcels-fill', async (e) => {
    const f = e.features && e.features[0];
    if (!f) return;
    if (selId !== null) map.setFeatureState({ source: 'parcels', id: selId }, { sel: false });
    selId = f.id;
    map.setFeatureState({ source: 'parcels', id: selId }, { sel: true });
    await showValuation({ ...f.properties, _ward: wardAt(map, e.point) });
  });
}

// ---- tiny formatting helpers (mirrors atlas.js conventions) ----
const N = v => Number(v).toLocaleString('en-ZA');
const R = v => {
  if (v == null) return '—';
  if (v >= 1e9) return 'R' + (v / 1e9).toFixed(2) + ' bn';
  if (v >= 1e6) return 'R' + (v / 1e6).toFixed(2) + ' m';
  return 'R' + N(Math.round(v));
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clWs = s => (s || '').replace(/\s+/g, ' ').trim();
const DEFAULT_RATE = 0.9;   // cents per Rand — typical WC residential rate-in-the-rand

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
      'SELECT muni,suburb,erf,address,extent,value,tenure,category FROM prop ' +
      'WHERE erf_int=? AND value>0 ORDER BY value DESC LIMIT 80', [nval]);
    return { ...rankRows(rows, town), stale: false };
  } catch (err) {
    // The hosted search.db predates the erf_int column (upload pending): fall back to
    // the FTS index — bare + zero-padded erf tokens — then confirm the erf client-side.
    const rows = await db.db.query(
      'SELECT p.muni,p.suburb,p.erf,p.address,p.extent,p.value,p.tenure,p.category FROM psearch f ' +
      'JOIN prop p ON p.id=f.rowid WHERE psearch MATCH ? AND p.value>0 ORDER BY p.value DESC LIMIT 80',
      [`${dm[0]} OR ${String(nval).padStart(8, '0')}`]);
    const exact = rows.filter(r => parseInt((String(r.erf || '').match(/\d+/) || ['-1'])[0], 10) === nval);
    return { ...rankRows(exact, town), stale: true };
  }
}

const $ = id => document.getElementById(id);
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

function renderDetail(r, props, backList, backSub) {
  const ppm = r.extent && r.value ? 'R' + N(Math.round(r.value / r.extent)) + ' / m²' : '—';
  const ann = r.value * DEFAULT_RATE / 100;
  $('pbody').innerHTML =
    (backList ? `<div id="pback" class="pLink">← All ${backList.length} valuations on this erf</div>` : '') +
    `<div class="pKick">${esc([clWs(r.suburb), r.muni].filter(Boolean).join(' · '))}</div>` +
    `<div class="pAddr">${esc(clWs(r.address) || 'Unnamed erf')}</div>` +
    `<div class="pVal">${R(r.value)}</div>` +
    `<div class="pSub">municipal market value</div>` +
    statRow('Erf / unit', r.erf || '—') +
    (props._ward != null ? statRow('Ward', props._ward) : '') +
    statRow('Category', r.category || '—') +
    statRow('Extent', r.extent ? N(Math.round(r.extent)) + ' m²' : '—') +
    statRow('Value per m²', ppm) +
    statRow('≈ rates / year', 'R' + N(Math.round(ann)) + ` (at ${DEFAULT_RATE}c/R)`) +
    `<div class="pNote">Rates are an estimate at a typical WC residential rate-in-the-rand — use the
       Atlas search for the adjustable estimator. Parcel ${esc(props.PRCL_KEY || '')}.</div>`;
  if (backList) $('pback').onclick = () => renderList(backList, props, backSub);
  openPanel();
}

function renderList(rows, props, subText) {
  $('pbody').innerHTML =
    `<div class="pKick">${esc([props.Town_name, props._ward != null ? 'Ward ' + props._ward : null]
      .filter(Boolean).join(' · '))}</div>` +
    `<div class="pAddr">Erf ${esc(props.TAG_VALUE || '?')} — ${rows.length} valuations</div>` +
    `<div class="pSub">${esc(subText || 'portions or sectional-title units share this parcel')}</div>` +
    rows.slice(0, 40).map((r, i) =>
      `<div class="pRow pPick" data-i="${i}"><span class="k">${esc(clWs(r.address) || r.erf || 'Unnamed')}</span>` +
      `<span class="v">${R(r.value)}</span></div>`).join('') +
    (rows.length > 40 ? `<div class="pNote">Showing the 40 highest of ${rows.length}.</div>` : '');
  const sub = subText;
  $('pbody').querySelectorAll('.pPick').forEach(el =>
    el.addEventListener('click', () => renderDetail(rows[+el.dataset.i], props, rows, sub)));
  openPanel();
}

async function showValuation(props) {
  $('pbody').innerHTML =
    `<div class="pKick">${esc(props.Town_name || '')}</div>` +
    `<div class="pAddr">Erf ${esc(props.TAG_VALUE || '?')}</div>` +
    `<div class="pSub">Looking up valuation…</div>`;
  openPanel();
  let res;
  try { res = await lookupErf(props.TAG_VALUE, props.Town_name); }
  catch (e) {
    console.warn('valuation lookup failed', e);
    $('pbody').innerHTML += `<div class="pNote">The valuation database is still loading — try the parcel again in a moment.</div>`;
    resetDB();
    return;
  }
  if (!res.rows.length) {
    $('pbody').innerHTML =
      `<div class="pKick">${esc(props.Town_name || '')}</div>` +
      `<div class="pAddr">Erf ${esc(props.TAG_VALUE || '?')}</div>` +
      `<div class="pVal" style="font-size:22px">No valuation found</div>` +
      `<div class="pNote">This erf isn't in the extracted rolls — it may be municipal/state land, in a
         supplementary roll not yet loaded, or recorded under a different town name.
         ${res.stale ? 'The live search index is also one data-update behind, which can hide some erven.' : ''}</div>`;
    return;
  }
  const sure = res.best >= 4;    // suburb-level match = genuinely this parcel's rows
  const note =
    res.best === 0 ? `<div class="pNote">⚠ No town match at all — the same erf number exists in several municipalities; showing all of them. Verify the address.</div>` :
    !sure ? `<div class="pNote">⚠ This exact township wasn't found in the rolls — these are erf ${esc(props.TAG_VALUE || '')}'s entries elsewhere in the municipality. The clicked parcel itself may not be separately valued.</div>` : '';
  const listSub = sure ? 'portions or sectional-title units share this parcel'
                       : 'same erf number, other townships — may not be this parcel';
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
      'https://nxeasppmwvzcqbbgrdvf.supabase.co/storage/v1/object/public/valuations/config.json';
    const w = await createDbWorker([{ from: 'jsonconfig', configUrl: abs(DB_CONFIG) }],
      abs('assets/vendor/sqlite.worker.js'), abs('assets/vendor/sql-wasm.wasm'));
    await w.db.query('SELECT 1');   // cold-start can hand back an empty wasm buffer — verify before caching
    dbw = w; return w;
  })().catch(e => { dbwPromise = null; throw e; });   // never cache a broken worker; allow a clean retry
  return dbwPromise;
}
function resetDB() { dbw = null; dbwPromise = null; }

function boot() {
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
