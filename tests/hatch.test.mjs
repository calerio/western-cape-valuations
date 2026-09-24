// tests/hatch.test.mjs
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { hatchImageData } from '../assets/map/hatch.js';
test('hatch tile is square RGBA with a 45° stroke and transparent gaps', () => {
  const im = hatchImageData(12, 4, [31, 78, 140, 255], 'dense');
  assert.equal(im.width, 12); assert.equal(im.height, 12); assert.equal(im.data.length, 12 * 12 * 4);
  const px = (x, y) => im.data[(y * 12 + x) * 4 + 3];
  assert.equal(px(0, 0), 255); assert.equal(px(11, 11), 255);   // on the diagonal
  assert.equal(px(0, 6), 0);                                      // off the stroke (gap)
  const sparse = hatchImageData(12, 4, [31, 78, 140, 255], 'sparse');
  assert.ok(sparse.data.filter((v, i) => i % 4 === 3 && v > 0).length < im.data.filter((v, i) => i % 4 === 3 && v > 0).length);
});
