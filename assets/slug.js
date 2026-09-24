/* Municipality / district URL slugs, shared by Explore (atlas.js, explore-sections.js) and the map
 * (map.js). Same rule as the static pages: keep in sync with export_pages.slugify (DATA_CONTRACT §13).
 * Pure: no DOM access. */
export const slugOf = n => String(n || '').trim().toLowerCase().replace(/ /g, '-');

// The GeoJSON feature whose properties.name slugs to `slug` (null when unknown).
export function featureBySlug(gj, slug) {
  if (!gj || !Array.isArray(gj.features) || !slug) return null;
  return gj.features.find(f => f && f.properties && slugOf(f.properties.name) === slug) || null;
}

// [[west, south], [east, north]] of a Polygon / MultiPolygon feature (null without coordinates).
export function featureBounds(f) {
  const g = f && f.geometry;
  const polys = !g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const poly of polys) for (const ring of poly) for (const [x, y] of ring) {
    if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y;
  }
  return Number.isFinite(w) ? [[w, s], [e, n]] : null;
}
