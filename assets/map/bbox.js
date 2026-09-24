/* Parcel refetch avoidance (design 2026-09, Task 12).
 * A bbox is { w, s, e, n } in degrees. `last` is the last SUCCESSFUL cadastre fetch:
 * { bbox, zoom, truncated }, where `truncated` is the server's exceededTransferLimit — the single
 * source of truth for "this fetch did not load every erf in its bbox" (map.js keeps a truncated
 * fetch in lastFetch and relies on shouldRefetch to refuse it). Pure — tests/bbox.test.mjs. */

// true when `inner` lies entirely inside `outer` (edges may touch)
export function bboxContains(outer, inner) {
  if (!outer || !inner) return false;
  return inner.w >= outer.w && inner.e <= outer.e && inner.s >= outer.s && inner.n <= outer.n;
}

// Refetch unless the last fetch succeeded, was not truncated (exceededTransferLimit), covers the
// whole new viewport, and was made at or below the new zoom.
export function shouldRefetch(last, next) {
  if (!last || last.truncated || !next) return true;
  if (!(next.zoom >= last.zoom)) return true;
  return !bboxContains(last.bbox, next.bbox);
}
