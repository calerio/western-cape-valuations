// tests/hash.test.mjs
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { parseMapHash, buildMapHash } from '../assets/map/hash.js';
test('legacy place hash keeps working', () => { assert.deepEqual(parseMapHash('#p/tSTELLENBOSCH'), { place: 'tSTELLENBOSCH', b: 'map' }); });
test('full hash round-trips', () => {
  const s = { place: 'tSTELLENBOSCH', b: 'sat', c: { lng: 18.861, lat: -33.9366, z: 17 }, s: 'W024C067002200001942000000' };
  assert.equal(buildMapHash(s), '#p/tSTELLENBOSCH&b=sat&c=18.861,-33.9366,17&s=W024C067002200001942000000');
  assert.deepEqual(parseMapHash(buildMapHash(s)), s);
});
test('municipality hash from Explore and defaults', () => {
  assert.deepEqual(parseMapHash('#m/mossel-bay', { b: 'sat' }), { muni: 'mossel-bay', b: 'sat' });
  assert.deepEqual(parseMapHash('', { b: 'map' }), { b: 'map' });
  assert.deepEqual(parseMapHash('#p/x&b=nonsense'), { place: 'x', b: 'map' });
});
