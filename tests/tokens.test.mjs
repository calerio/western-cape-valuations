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

// WCAG 2.x contrast of the five status badge pairs (ink on its own tint), light and dark.
// A translucent dark tint is composited over the surfaces a badge sits on (--bg, --bg2).
const parseColor = s => {
  s = s.trim();
  let m = s.match(/^#([0-9a-f]{6})$/i);
  if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
  m = s.match(/^rgba?\(([^)]+)\)$/i);
  if (m) { const p = m[1].split(',').map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
  throw new Error('unparsed colour ' + s);
};
const lightDark = name => {
  const m = css.match(new RegExp(name + ':\\s*light-dark\\(\\s*(#[0-9a-f]{6}|rgba?\\([^)]*\\))\\s*,\\s*(#[0-9a-f]{6}|rgba?\\([^)]*\\))\\s*\\)', 'i'));
  assert.ok(m, name + ' is a light-dark() pair');
  return { light: parseColor(m[1]), dark: parseColor(m[2]) };
};
const over = (top, under) => { const a = top[3]; return [0, 1, 2].map(i => top[i] * a + under[i] * (1 - a)).concat(1); };
const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
test('status badge pairs reach 4.5:1 in light and dark (WCAG 2.x)', () => {
  const surfaces = ['--bg', '--bg2'].map(lightDark);
  for (const st of ['ok', 'warn', 'neutral', 'none', 'bad']) {
    const ink = lightDark(`--st-${st}-ink`), bg = lightDark(`--st-${st}-bg`);
    for (const scheme of ['light', 'dark']) for (const s of surfaces) {
      const tint = over(bg[scheme], s[scheme]);
      const r = ratio(over(ink[scheme], tint), tint);
      assert.ok(r >= 4.5, `${st} ${scheme}: ${r.toFixed(2)}:1`);
    }
  }
});
test('contrast helper matches known WCAG values', () => {
  assert.equal(ratio([0, 0, 0, 1], [255, 255, 255, 1]).toFixed(2), '21.00');
  assert.equal(ratio([0x6b, 0x6f, 0x76, 1], [0xf0, 0xf0, 0xf2, 1]).toFixed(2), '4.43');
});
