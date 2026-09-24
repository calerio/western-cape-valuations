// tests/overrides.test.mjs: the renamed-places runtime file (data/geo/renamed-places/overrides.json)
import { test } from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REGISTRY, OUT } from '../scripts/build-overrides.mjs';

const reg = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
const file = JSON.parse(fs.readFileSync(OUT, 'utf8'));
const PLACE_CLASSES = ['city', 'town', 'village', 'hamlet', 'suburb', 'quarter', 'neighbourhood', 'isolated_dwelling', 'locality'];
const byEn = en => file.overrides.find(o => o.en === en);

test('overrides.json is in sync with the registry (rebuilt in a temp dir, byte for byte)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wcv-overrides-'));
  try {
    const out = path.join(dir, 'overrides.json');
    execFileSync(process.execPath, [new URL('../scripts/build-overrides.mjs', import.meta.url).pathname, REGISTRY, out]);
    assert.equal(fs.readFileSync(out, 'utf8'), fs.readFileSync(OUT, 'utf8'), 'run: node scripts/build-overrides.mjs');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  assert.equal(file.version, reg.version);
});

test('every override has a match key, both labels, a source and an effective date; ids are unique', () => {
  assert.ok(file.overrides.length > 0);
  const ids = new Set();
  for (const o of file.overrides) {
    assert.ok(o.id != null || (o.cls && o.current.length), `no match key: ${o.en}`);
    assert.ok(Array.isArray(o.current) && o.current.length, `no current names: ${o.en}`);
    for (const k of ['en', 'af', 'official', 'source', 'effective_from']) assert.ok(o[k], `${o.en}: ${k} missing`);
    assert.ok(PLACE_CLASSES.includes(o.cls), `${o.en}: class ${o.cls} is not a place class`);
    if (o.id != null) { assert.ok(!ids.has(o.id), `duplicate id ${o.id}`); ids.add(o.id); }
  }
});

test('the registry and the file agree: one override per id-matched entry, none for pending or reverted', () => {
  const matched = reg.entries.filter(e => e.override.match !== 'none');
  assert.equal(file.overrides.length, matched.length);
  for (const e of reg.entries) {
    assert.ok(e.display && e.override && e.effective, e.id);
    assert.equal(e.effective.to, null, e.id);
    if (e.override.match === 'none') assert.ok(/^(pending \(not in tiles\)|reverted, no override)$/.test(e.override.status), e.id);
  }
});

test('the six decisions are applied', () => {
  const gr = file.overrides.find(o => o.id === 302117011);                 // 1. contested 2026 renamings
  assert.equal(gr.en, 'Graaff-Reinet'); assert.equal(gr.cls, 'town'); assert.ok(gr.current.includes('Robert Sobukwe Town'));
  assert.equal(byEn('East London').af, 'Oos-Londen');
  const nb = byEn('Nieu-Bethesda');                                        // 2. OSM label correction
  assert.ok(nb.current.includes('Kwa Noheleni')); assert.equal(nb.official, 'Nieu-Bethesda');
  assert.equal(byEn('Mafikeng').official, 'Mahikeng');                     // 3. near-spellings
  assert.ok(byEn('Messina') && byEn('Tabankulu') && byEn('Teslaarsdal'));
  assert.equal(byEn('Zonnebloem').official, 'District Six');              // 4. apartheid-era former names
  const tri = file.search.find(s => s.primary === 'Triomf');               //    Sophiatown: not in the tiles
  assert.equal(tri.official, 'Sophiatown'); assert.equal(byEn('Triomf'), undefined);
  assert.equal(byEn('Umhlanga Rocks').official, 'uMhlanga Rocks');         // 5. KZN spelling changes
  assert.ok(byEn('Tongaat') && byEn('Amanzimtoti'));
  const mp = reg.entries.filter(e => e.province === 'Mpumalanga' && e.override.match === 'id' &&
    ['suburb', 'village'].includes(e.override.class));                     // 6. settlements
  assert.ok(mp.length >= 1 && byEn(mp[0].display.primary_en));
});

test('search lists every entry with coordinates, by primary, official and aliases', () => {
  const gr = file.search.find(s => s.primary === 'Graaff-Reinet');
  assert.equal(gr.official, 'Robert Sobukwe'); assert.ok(gr.aliases.includes('Robert Sobukwe Town'));
  const gt = file.search.find(s => s.primary === 'Grahamstown');
  assert.equal(gt.official, 'Makhanda'); assert.ok(Math.abs(gt.lon - 26.53) < 0.01 && Math.abs(gt.lat + 33.31) < 0.01);
  for (const s of file.search) assert.ok(s.primary && s.official && Array.isArray(s.aliases) && Number.isFinite(s.lat) && Number.isFinite(s.lon));
  // excluded municipality names never become a search entry
  assert.ok(!file.search.some(s => s.primary === 'Tshwane' || s.official === 'Tshwane'));
});
