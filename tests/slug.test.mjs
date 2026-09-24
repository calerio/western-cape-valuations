// tests/slug.test.mjs — the shared slug rule (= export_pages.slugify) and the municipality lookup map.js uses
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { slugOf, featureBySlug, featureBounds } from '../assets/slug.js';
test('slugOf lower-cases and hyphenates spaces only (export_pages.slugify)', () => {
  assert.equal(slugOf('Stellenbosch'), 'stellenbosch');
  assert.equal(slugOf('City of Cape Town'), 'city-of-cape-town');
  assert.equal(slugOf('  Prince Albert '), 'prince-albert');
  assert.equal(slugOf('Cape Agulhas'), 'cape-agulhas');
  assert.equal(slugOf(null), '');
});
test('featureBySlug resolves a municipality and returns null for unknown slugs', () => {
  const gj = { features: [{ properties: { name: 'Swellendam' } }, { properties: { name: 'City of Cape Town' } }] };
  assert.equal(featureBySlug(gj, 'city-of-cape-town'), gj.features[1]);
  assert.equal(featureBySlug(gj, 'nowhere'), null);
  assert.equal(featureBySlug(null, 'swellendam'), null);
  assert.equal(featureBySlug(gj, ''), null);
});
test('featureBounds spans Polygon and MultiPolygon rings', () => {
  const sq = (x, y) => [[[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y]]];
  assert.deepEqual(featureBounds({ geometry: { type: 'Polygon', coordinates: sq(18, -34) } }), [[18, -34], [19, -33]]);
  assert.deepEqual(featureBounds({ geometry: { type: 'MultiPolygon', coordinates: [sq(18, -34), sq(20, -32)] } }), [[18, -34], [21, -31]]);
  assert.equal(featureBounds({ geometry: null }), null);
});
