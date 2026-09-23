#!/usr/bin/env node
/* Builds data/geo/renamed-places/overrides.json (the small file the map loads) from the renamed-places
 * registry (data/geo/renamed-places/registry.v1.json). Only entries whose override has a real match
 * ('id' or 'name-class') become label overrides; every entry with coordinates goes into the search
 * list, so both the former and the official name find the place. Output is sorted and deterministic.
 * Usage: node scripts/build-overrides.mjs [registry.json] [overrides.json] */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const REGISTRY = join(ROOT, 'data/geo/renamed-places/registry.v1.json');
export const OUT = join(ROOT, 'data/geo/renamed-places/overrides.json');

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function buildOverrides(reg) {
  const overrides = [], search = [];
  for (const e of reg.entries || []) {
    const d = e.display, o = e.override;
    if (!d || !o) throw new Error(`entry ${e.id}: no display or override block`);
    if (o.match === 'id' || o.match === 'name-class') {
      overrides.push({
        id: o.match === 'id' ? o.tile_feature_id : null,
        cls: o.class,
        current: [...o.current_names],
        en: d.primary_en,
        af: d.primary_af,
        official: d.official,
        effective_from: e.effective?.from ?? null,
        source: e.source ?? null,
      });
    }
    if (typeof e.lat === 'number' && typeof e.lon === 'number') {
      search.push({
        primary: d.primary_en,
        primary_af: d.primary_af,
        official: d.official,
        aliases: [...d.aliases],
        lat: e.lat,
        lon: e.lon,
        province: e.province,
      });
    }
  }
  overrides.sort((a, b) => cmp(a.id ?? Infinity, b.id ?? Infinity) || cmp(a.cls, b.cls) || cmp(a.en, b.en));
  search.sort((a, b) => cmp(a.primary, b.primary) || cmp(a.official, b.official) || a.lat - b.lat);
  return { version: reg.version, generated: reg.generated, overrides, search };
}

// One record per line: small, diff-friendly and byte-for-byte reproducible.
export function serialise(out) {
  const list = xs => (xs.length ? '[\n' + xs.map(x => JSON.stringify(x)).join(',\n') + '\n]' : '[]');
  return `{"version":${JSON.stringify(out.version)},"generated":${JSON.stringify(out.generated)},\n` +
    `"overrides":${list(out.overrides)},\n"search":${list(out.search)}}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const src = process.argv[2] || REGISTRY, dst = process.argv[3] || OUT;
  const out = buildOverrides(JSON.parse(readFileSync(src, 'utf8')));
  writeFileSync(dst, serialise(out));
  console.log(`build-overrides: ${out.overrides.length} overrides, ${out.search.length} search entries -> ${dst}`);
}
