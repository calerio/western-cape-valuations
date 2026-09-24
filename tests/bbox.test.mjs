// tests/bbox.test.mjs
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { bboxContains, shouldRefetch } from '../assets/map/bbox.js';

const outer = { w: 18.40, s: -33.95, e: 18.45, n: -33.90 };

test('bboxContains: inside, touching edges, overlapping, outside', () => {
  assert.equal(bboxContains(outer, { w: 18.41, s: -33.94, e: 18.44, n: -33.91 }), true);
  assert.equal(bboxContains(outer, { ...outer }), true);
  assert.equal(bboxContains(outer, { w: 18.39, s: -33.94, e: 18.44, n: -33.91 }), false);
  assert.equal(bboxContains(outer, { w: 18.41, s: -33.94, e: 18.46, n: -33.91 }), false);
  assert.equal(bboxContains(outer, { w: 18.41, s: -33.96, e: 18.44, n: -33.91 }), false);
  assert.equal(bboxContains(outer, { w: 18.41, s: -33.94, e: 18.44, n: -33.89 }), false);
  assert.equal(bboxContains(outer, { w: 18.50, s: -33.80, e: 18.60, n: -33.70 }), false);
  assert.equal(bboxContains(null, outer), false);
  assert.equal(bboxContains(outer, null), false);
});

test('shouldRefetch: skips only inside a complete fetch at the same or a higher zoom', () => {
  const last = { bbox: outer, zoom: 16, truncated: false };
  const inside = { w: 18.41, s: -33.94, e: 18.44, n: -33.91 };
  assert.equal(shouldRefetch(last, { bbox: inside, zoom: 16 }), false);
  assert.equal(shouldRefetch(last, { bbox: inside, zoom: 17.5 }), false);
  assert.equal(shouldRefetch(last, { bbox: inside, zoom: 15.9 }), true);          // zoomed out
  assert.equal(shouldRefetch(last, { bbox: { ...inside, e: 18.46 }, zoom: 17 }), true); // panned past the edge
  assert.equal(shouldRefetch({ ...last, truncated: true }, { bbox: inside, zoom: 17 }), true);
  assert.equal(shouldRefetch(null, { bbox: inside, zoom: 17 }), true);           // nothing fetched / cleared
});
