// tests/style.test.mjs
import { test } from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
import { transformStyle, nameExpression, LABEL_LAYER_IDS, SAT_HIDDEN_LAYER_PREFIXES, applyBasemap, applyLanguage } from '../assets/map/style.js';
const liberty = JSON.parse(fs.readFileSync(new URL('./fixtures/liberty.json', import.meta.url), 'utf8'));
const GR = { id: 302117011, cls: 'town', current: ['Robert Sobukwe Town', 'Robert Sobukwe'], en: 'Graaff-Reinet', af: 'Graaff-Reinet' };
test('every name-bearing symbol layer is rewritten; others untouched', () => {
  const out = transformStyle(liberty, { lang: 'af' });
  // The vendored fixture (OpenFreeMap Liberty, fetched 2026-09-23) has 20 name-bearing symbol layers
  // (25 symbol layers: 2 one-way arrows without text-field + 3 ref shields). The brief said 23.
  const ids = LABEL_LAYER_IDS(liberty); assert.equal(ids.length, 20);
  for (const l of out.layers) if (ids.includes(l.id)) { assert.equal(l.layout['text-field'][0], 'case'); assert.ok(JSON.stringify(l.layout['text-field']).includes('"name:af"')); }
  const shield = out.layers.find(l => l.id === 'highway-shield-non-us'); assert.deepEqual(shield.layout['text-field'], ['to-string', ['get', 'ref']]);
  assert.notEqual(out, liberty);
});
test('af-fallback: the AF expression falls back to the original when name:af is absent', () => {
  const orig = ['coalesce', ['get', 'name_en'], ['get', 'name']];
  const e = nameExpression(orig, 'af'); assert.deepEqual(e, ['coalesce', ['get', 'name:af'], orig]);
  assert.deepEqual(nameExpression(orig, 'en'), orig);
});
test('override is keyed on id + class + current name, never a global replace', () => {
  const e = nameExpression(['get', 'name'], 'en', [GR]);
  assert.equal(e[0], 'case'); assert.deepEqual(e[1], ['all', ['==', ['id'], 302117011], ['==', ['get', 'class'], 'town'], ['in', ['get', 'name'], ['literal', GR.current]]]); assert.equal(e[2], 'Graaff-Reinet');
});
test('satellite: esri raster after background, fills hidden, symbols keep a dark halo', () => {
  const out = transformStyle(liberty, { basemap: 'sat' });
  assert.equal(out.layers[1].id, 'esri-world-imagery'); assert.equal(out.layers[1].layout.visibility, 'visible');
  assert.equal(out.layers.find(l => l.id === 'landcover_grass').layout.visibility, 'none');
  const town = out.layers.find(l => l.id === 'label_town'); assert.equal(town.layout.visibility ?? 'visible', 'visible'); assert.equal(town.paint['text-halo-color'], '#0f1418');
  const map = transformStyle(liberty, { basemap: 'map' }); assert.equal(map.layers[1].layout.visibility, 'none');
});
test('poi declutter: parking hidden, poi_r20 from z18', () => {
  const out = transformStyle(liberty, {}); const r20 = out.layers.find(l => l.id === 'poi_r20'); assert.equal(r20.minzoom, 18);
  assert.ok(JSON.stringify(out.layers.find(l => l.id === 'poi_r7').filter).includes('parking'));
});

// --- added: satellite keeps every symbol layer, source-keyed prefix, fake-map tests ---
test('satellite never hides a symbol layer; ne2_shaded hides the natural_earth raster by source', () => {
  const out = transformStyle(liberty, { basemap: 'sat' });
  for (const l of out.layers) if (l.type === 'symbol') assert.equal(l.layout?.visibility ?? 'visible', 'visible', l.id);
  assert.equal(out.layers.find(l => l.id === 'natural_earth').layout.visibility, 'none');
  assert.ok(SAT_HIDDEN_LAYER_PREFIXES.includes('ne2_shaded'));
  assert.equal(out.sources.esri.tiles[0].includes('World_Imagery'), true);
});

function fakeMap(style) {
  const calls = [];
  return {
    calls,
    getStyle: () => style,
    getLayer: (id) => style.layers.find(l => l.id === id),
    setLayoutProperty: (id, k, v) => calls.push(['layout', id, k, v]),
    setPaintProperty: (id, k, v) => calls.push(['paint', id, k, v]),
  };
}
test('applyBasemap: toggles esri + hidden layers and swaps/restores halo paint without setStyle', () => {
  const m = fakeMap(transformStyle(liberty, { basemap: 'map' }));
  applyBasemap(m, 'sat');
  const find = (t, id, k) => m.calls.filter(c => c[0] === t && c[1] === id && c[2] === k).at(-1)?.[3];
  assert.equal(find('layout', 'esri-world-imagery', 'visibility'), 'visible');
  assert.equal(find('layout', 'landcover_grass', 'visibility'), 'none');
  assert.equal(find('layout', 'label_town', 'visibility'), undefined);
  assert.equal(find('paint', 'label_town', 'text-halo-color'), '#0f1418');
  assert.equal(find('paint', 'label_town', 'text-halo-width'), 1.4);
  assert.equal(find('paint', 'label_town', 'text-color'), '#ffffff');
  m.calls.length = 0;
  applyBasemap(m, 'map');
  assert.equal(find('layout', 'esri-world-imagery', 'visibility'), 'none');
  assert.equal(find('layout', 'landcover_grass', 'visibility'), 'visible');
  assert.equal(find('paint', 'label_town', 'text-halo-color'), '#fff');
  assert.equal(find('paint', 'label_town', 'text-color'), '#000');
  // highway-name-minor has no text-halo-color in Liberty: restore unsets it
  const hm = m.calls.find(c => c[0] === 'paint' && c[1] === 'highway-name-minor' && c[2] === 'text-halo-color');
  assert.ok(hm); assert.equal(hm[3], undefined);
});
test('applyLanguage: re-derives text-field from the stored original, never compounding', () => {
  const style = transformStyle(liberty, { lang: 'af' });
  const m = fakeMap(style);
  applyLanguage(m, 'en', []);
  const orig = liberty.layers.find(l => l.id === 'label_town').layout['text-field'];
  const set = m.calls.filter(c => c[0] === 'layout' && c[2] === 'text-field');
  assert.equal(set.length, 20);
  assert.deepEqual(set.find(c => c[1] === 'label_town')[3], orig);
  assert.ok(!set.some(c => c[1] === 'highway-shield-non-us'));
  m.calls.length = 0;
  applyLanguage(m, 'af', [GR]);
  const af = m.calls.find(c => c[1] === 'label_town')[3];
  assert.equal(af[0], 'case'); assert.equal(af[2], 'Graaff-Reinet');
  assert.equal(JSON.stringify(af).split('["get","name:af"]').length - 1, 1);
});
