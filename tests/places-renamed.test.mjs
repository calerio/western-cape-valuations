// tests/places-renamed.test.mjs: the place search finds a renamed place by its former or official name
import { test } from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
import { filterPlaces, toRenamedEntries, inBounds } from '../assets/places.js';
const OV = JSON.parse(fs.readFileSync(new URL('../data/geo/renamed-places/overrides.json', import.meta.url), 'utf8'));
const PLACES = JSON.parse(fs.readFileSync(new URL('../data/geo/places.json', import.meta.url), 'utf8'));
const R = toRenamedEntries(OV.search);
const BOUNDS = [[13.0, -41.5], [28.0, -24.5]];

test('found by the official name, listed under the former name', () => {
  const r = filterPlaces('Robert Sobukwe', 8, PLACES, R)[0];
  assert.equal(r.type, 'renamed'); assert.equal(r.name, 'Graaff-Reinet'); assert.equal(r.official, 'Robert Sobukwe');
  assert.equal(filterPlaces('Makhanda', 8, PLACES, R)[0].name, 'Grahamstown');
});
test('found by the former name and its Afrikaans form', () => {
  const g = filterPlaces('Grahamstown', 8, PLACES, R)[0];
  assert.equal(g.official, 'Makhanda'); assert.ok(inBounds(g, BOUNDS));
  assert.equal(filterPlaces('Grahamstad', 8, PLACES, R)[0].name, 'Grahamstown');
  assert.equal(filterPlaces('oos-londen', 8, PLACES, R)[0].name, 'East London');
});
test('a place outside the map bounds is still listed', () => {
  const u = filterPlaces('Umhlanga Rocks', 8, PLACES, R)[0];
  assert.equal(u.name, 'Umhlanga Rocks'); assert.equal(inBounds(u, BOUNDS), false);
});
test('existing town and suburb results are unchanged', () => {
  const plain = filterPlaces('Hermanus', 8, PLACES, []);
  assert.deepEqual(filterPlaces('Hermanus', 8, PLACES, R).map(e => e.name), plain.map(e => e.name));
  assert.equal(plain[0].type, 'town');
  assert.deepEqual(filterPlaces('Stellenbosch', 8, PLACES, R), filterPlaces('Stellenbosch', 8, PLACES, []));
});
test('renamed entries search without the places index', () => {
  assert.equal(filterPlaces('Nelspruit', 8, null, R)[0].official, 'Mbombela');
  assert.deepEqual(filterPlaces('x', 8, null, []), []);
});
