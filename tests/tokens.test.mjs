// tests/tokens.test.mjs
import { test } from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
const css = fs.readFileSync(new URL('../assets/tokens.css', import.meta.url), 'utf8');
const MAP = ['--map-bg','--map-parcel-line','--map-parcel-sel','--map-ward','--map-ward-label','--map-muni-line'];
const rule = sel => { const m = css.match(new RegExp(sel.replace(/[[\]"]/g, '\\$&') + '\\s*\\{([^}]*)\\}')); return m ? m[1] : null; };
test('scale, spacing, status and accent tokens exist once in :root', () => {
  for (const t of ['--t-11','--t-12','--t-13','--t-14','--t-16','--t-20','--t-26','--t-34','--s-1','--s-4','--s-7','--st-ok-ink','--st-warn-ink','--st-neutral-ink','--st-none-ink','--st-bad-ink','--paper','--rule'])
    assert.ok(new RegExp(`${t}\\s*:`).test(css), t);
  assert.ok(/--accent:\s*(light-dark\(\s*)?#1f4e8c/i.test(css));
  assert.equal((css.match(/--t-16:\s*1rem/g) || []).length, 1);
});
test('colour tokens are declared once via light-dark(), no media-query dark block', () => {
  const bg = css.match(/--bg:\s*([^;]+);/g) || [];
  assert.equal(bg.length, 1, '--bg declared ' + bg.length + ' times');
  assert.ok(/--bg:\s*light-dark\(/.test(css), '--bg must use light-dark()');
  assert.ok(!/@media\s*\(\s*prefers-color-scheme/.test(css), 'no prefers-color-scheme block');
  assert.ok(/--warn\s*:/.test(css) === false, '--warn removed');
});
test('theme pins set color-scheme and carry the six --map-* tokens', () => {
  const dark = rule(':root[data-theme="dark"]'), light = rule(':root[data-theme="light"]');
  assert.ok(dark && /color-scheme:\s*dark\s*;/.test(dark), 'dark pin color-scheme');
  assert.ok(light && /color-scheme:\s*light\s*;/.test(light), 'light pin color-scheme');
  assert.ok(/:root\s*\{[^}]*color-scheme:\s*light dark/.test(css), ':root follows the OS');
  for (const t of MAP) {
    assert.ok(new RegExp(`${t}\\s*:`).test(dark), 'dark pin ' + t);
    assert.ok(new RegExp(`${t}\\s*:`).test(light), 'light pin ' + t);
  }
});
test('theme pins declare only the six --map-* custom properties', () => {
  for (const sel of [':root[data-theme="dark"]', ':root[data-theme="light"]']) {
    const body = rule(sel);
    const names = [...body.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]);
    assert.deepEqual([...new Set(names)].sort(), [...MAP].sort(), sel);
    assert.equal(names.length, MAP.length, sel + ' has duplicate declarations');
  }
});
