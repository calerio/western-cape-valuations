/*
 * hatch.js — the SG-diagram hatch used to draw the selected erf (design 2026-09, "the one
 * memorable thing"): 45° strokes inside the parcel, dense when the valuation link is verified,
 * sparse when it is only possible/one of several.
 *
 * Pure (no canvas, no DOM) so it runs in node tests and in the browser alike. The result is the
 * `{ width, height, data }` shape MapLibre's map.addImage() accepts; register it with
 * `{ pixelRatio: 2 }` so one tile covers size/2 CSS px.
 *
 * A pixel is on a stroke when ((x - y) mod period) < STROKE. The stroke direction is the 45°
 * diagonal through (0,0) and (size-1,size-1). Line spacing (the period):
 *   dense  = gap          (4 px → 2 px stroke, 2 px clear)
 *   sparse = 3 × gap      (12 px → 2 px stroke, 10 px clear)
 * The tile is seamless when the period divides `size` — true for the defaults (12, 4). A period
 * of gap + 2 (= 6) would also tile, but it puts a stroke on (0, size/2), so the spacing is kept
 * off every divisor of size/2.
 */
const STROKE = 2;

export function hatchImageData(size = 12, gap = 4, rgba = [31, 78, 140, 255], density = 'dense') {
  const period = Math.max(STROKE + 1, density === 'sparse' ? gap * 3 : gap);
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if ((((x - y) % period) + period) % period >= STROKE) continue;   // gap stays transparent
      const i = (y * size + x) * 4;
      data[i] = rgba[0]; data[i + 1] = rgba[1]; data[i + 2] = rgba[2]; data[i + 3] = rgba[3];
    }
  }
  return { width: size, height: size, data };
}
