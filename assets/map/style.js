/* Map style transform for the OpenFreeMap "Liberty" basemap.
 *   - Labels: EN keeps the style's own name expression; AF prefers `name:af` and falls back to it.
 *   - Name overrides are keyed on tile feature id + class + the exact current name(s) — never a
 *     global text replace.
 *   - Satellite: Esri World Imagery raster right above `background`; fill/line/raster layers hidden
 *     by id (or source) prefix; every symbol layer kept, with a dark halo.
 *   - POI declutter: parking dropped from poi_r7/poi_r20, poi_r20 only from z18.
 * transformStyle is pure (returns a new style). applyBasemap / applyLanguage mutate a live map via
 * setLayoutProperty / setPaintProperty only, using originals stashed in layer.metadata. No DOM. */

export const ESRI_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
export const ESRI_ATTRIB = 'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community';
export const ESRI_LAYER_ID = 'esri-world-imagery';

/* Matched against layer.id and layer.source (`ne2_shaded` is the natural_earth raster's source).
 * Symbol layers are never hidden, even when their id matches (water_name_*, highway-name-*, …). */
export const SAT_HIDDEN_LAYER_PREFIXES = ['landcover', 'landuse', 'park', 'water', 'building', 'aeroway', 'highway', 'road', 'railway', 'bridge', 'tunnel', 'ferry', 'ne2_shaded', 'boundary_3'];

export const SAT_LABEL_PAINT = { 'text-halo-color': '#0f1418', 'text-halo-width': 1.4, 'text-color': '#ffffff' };

const POI_DECLUTTER = ['poi_r7', 'poi_r20'];
const POI_R20_MINZOOM = 18;
const NOT_PARKING = ['!=', ['get', 'class'], 'parking'];

export const LABEL_LAYER_IDS = (style) => style.layers
  .filter(l => l.type === 'symbol' && JSON.stringify(l.layout?.['text-field'] || '').includes('name'))
  .map(l => l.id);

const isCase = (e) => Array.isArray(e) && e[0] === 'case';

function langExpression(original, lang) {
  if (lang !== 'af') return original;
  // Prepending a branch to an existing `case` is equivalent to coalesce(name:af, original) and
  // keeps the expression flat.
  if (isCase(original)) return ['case', ['has', 'name:af'], ['get', 'name:af'], ...original.slice(1)];
  return ['coalesce', ['get', 'name:af'], original];
}

export function nameExpression(original, lang, overrides = []) {
  const base = langExpression(original, lang);
  if (!overrides || !overrides.length) return base;
  const branches = [];
  for (const o of overrides) {
    const label = (lang === 'af' ? o.af : o.en) ?? o.en;
    if (label == null || !Array.isArray(o.current) || !o.current.length) continue;
    branches.push(
      ['all', ['==', ['id'], o.id], ['==', ['get', 'class'], o.cls], ['in', ['get', 'name'], ['literal', [...o.current]]]],
      label,
    );
  }
  if (!branches.length) return base;
  return isCase(base) ? ['case', ...branches, ...base.slice(1)] : ['case', ...branches, base];
}

function satHidden(layer) {
  if (layer.type === 'symbol' || layer.id === ESRI_LAYER_ID || layer.type === 'background') return false;
  return SAT_HIDDEN_LAYER_PREFIXES.some(p => layer.id.startsWith(p) || layer.source === p);
}

const meta = (l) => (l.metadata && typeof l.metadata === 'object' ? l.metadata : (l.metadata = {}));

export function transformStyle(style, { lang = 'en', basemap = 'map', overrides = [] } = {}) {
  const out = structuredClone(style);
  const sat = basemap === 'sat';
  out.sources = { ...out.sources, esri: { type: 'raster', tiles: [ESRI_TILES], tileSize: 256, maxzoom: 19, attribution: ESRI_ATTRIB } };

  const layers = [];
  for (const l of out.layers) {
    if (l.id === ESRI_LAYER_ID) continue; // idempotent: re-inserted below
    layers.push(l);

    if (l.type === 'symbol') {
      const m = meta(l);
      const tf = l.layout?.['text-field'];
      if (m.wcv_name_expr || JSON.stringify(tf || '').includes('name')) {
        if (!m.wcv_name_expr) m.wcv_name_expr = tf;
        l.layout['text-field'] = nameExpression(m.wcv_name_expr, lang, overrides);
      }
      if (!m.wcv_paint) {
        m.wcv_paint = {};
        for (const k of Object.keys(SAT_LABEL_PAINT)) m.wcv_paint[k] = l.paint?.[k] ?? null;
      }
      l.paint = { ...(l.paint || {}) };
      for (const k of Object.keys(SAT_LABEL_PAINT)) {
        const v = sat ? SAT_LABEL_PAINT[k] : m.wcv_paint[k];
        if (v == null) delete l.paint[k]; else l.paint[k] = v;
      }
    } else if (satHidden(l)) {
      const m = meta(l);
      if (!m.wcv_sat_hide) { m.wcv_sat_hide = true; m.wcv_visibility = l.layout?.visibility ?? 'visible'; }
      l.layout = { ...(l.layout || {}), visibility: sat ? 'none' : m.wcv_visibility };
    }

    if (POI_DECLUTTER.includes(l.id) && !JSON.stringify(l.filter || '').includes('"parking"')) {
      l.filter = l.filter ? ['all', l.filter, NOT_PARKING] : NOT_PARKING;
    }
    if (l.id === 'poi_r20') l.minzoom = Math.max(l.minzoom ?? 0, POI_R20_MINZOOM);

    if (l.id === 'background') {
      layers.push({ id: ESRI_LAYER_ID, type: 'raster', source: 'esri', layout: { visibility: sat ? 'visible' : 'none' } });
    }
  }
  if (!layers.some(l => l.id === ESRI_LAYER_ID)) {
    layers.unshift({ id: ESRI_LAYER_ID, type: 'raster', source: 'esri', layout: { visibility: sat ? 'visible' : 'none' } });
  }
  out.layers = layers;
  return out;
}

/* Live map, no setStyle. `map` needs getStyle(), getLayer(id), setLayoutProperty, setPaintProperty. */
export function applyBasemap(map, basemap) {
  const sat = basemap === 'sat';
  for (const l of map.getStyle().layers) {
    if (!map.getLayer(l.id)) continue;
    const m = l.metadata || {};
    if (l.id === ESRI_LAYER_ID) map.setLayoutProperty(l.id, 'visibility', sat ? 'visible' : 'none');
    else if (m.wcv_sat_hide) map.setLayoutProperty(l.id, 'visibility', sat ? 'none' : (m.wcv_visibility || 'visible'));
    else if (l.type === 'symbol' && m.wcv_paint) {
      for (const k of Object.keys(SAT_LABEL_PAINT)) {
        map.setPaintProperty(l.id, k, sat ? SAT_LABEL_PAINT[k] : (m.wcv_paint[k] ?? undefined));
      }
    }
  }
}

export function applyLanguage(map, lang, overrides = []) {
  for (const l of map.getStyle().layers) {
    const orig = l.metadata?.wcv_name_expr;
    if (orig === undefined || !map.getLayer(l.id)) continue;
    map.setLayoutProperty(l.id, 'text-field', nameExpression(orig, lang, overrides));
  }
}
