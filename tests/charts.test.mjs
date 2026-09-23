// tests/charts.test.mjs
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { shareBar, markerScale, logHistogram, stackedBar, dateDots, scaleLog } from '../assets/explore-charts.js';
test('shareBar and markerScale are labelled SVG with no external refs', () => {
  const s = shareBar(0.647, { width: 120 }); assert.ok(s.startsWith('<svg')); assert.ok(s.includes('aria-label="64.7%"')); assert.ok(s.includes('width="77.6"'));
  const m = markerScale(915000, { min: 42000, max: 26500000, width: 140, lang: 'en' }); assert.ok(/aria-label="R915 000"/.test(m)); assert.ok(!/http/.test(m));
});
test('log scale maps min→0 and max→width', () => { const f = scaleLog(1e4, 1e8, 400); assert.equal(f(1e4), 0); assert.equal(f(1e8), 400); assert.equal(Math.round(f(1e6)), 200); });
test('histogram draws one rect per bin and three percentile lines', () => {
  const bins = Array.from({ length: 22 }, (_, i) => ({ lo: 1e4 * 10 ** (i / 4), hi: 1e4 * 10 ** ((i + 1) / 4), n: i + 1 }));
  const h = logHistogram(bins, { p10: 2e5, p50: 9e5, p90: 4e6, q1: 3e5, q3: 2e6, width: 820, height: 140, lang: 'en' });
  assert.equal((h.match(/<rect class="bin"/g) || []).length, 22); assert.equal((h.match(/<line class="pct"/g) || []).length, 3); assert.ok(h.includes('class="band"'));
});
test('stackedBar keeps group order and dateDots one dot per roll', () => {
  const sb = stackedBar([{ key: 'residential', n: 10, value: 5 }, { key: 'vacant', n: 2, value: 1 }], { width: 820, lang: 'en' }); assert.ok(sb.indexOf('residential') < sb.indexOf('vacant'));
  const dd = dateDots([{ name: 'Hessequa', slug: 'hessequa', valued_as_at: '2020-07-01' }, { name: 'Kannaland', slug: 'kannaland', valued_as_at: '2025-09-01' }, { name: 'Laingsburg', slug: 'laingsburg', valued_as_at: null }], { width: 820, lang: 'en' });
  assert.equal((dd.match(/<circle/g) || []).length, 2); assert.ok(dd.includes('Laingsburg'));
});
// --- added beyond the brief: escaping, degenerate input, AF formatting ---
test('builders escape names and survive empty / degenerate input', () => {
  const dd = dateDots([{ name: '<b>X</b>', slug: 'x', valued_as_at: '2022-07-01' }], { lang: 'en' });
  assert.ok(!dd.includes('<b>X</b>')); assert.ok(dd.includes('&lt;b&gt;'));
  assert.equal(shareBar(null, {}).includes('width="0"'), true);
  assert.ok(logHistogram([], { lang: 'en' }).startsWith('<svg'));
  assert.ok(stackedBar([], { lang: 'en' }).length >= 0);
  const f = scaleLog(5, 5, 100); assert.equal(f(5), 50);
});
test('Afrikaans labels use the decimal comma', () => {
  assert.ok(shareBar(0.647, { width: 120, lang: 'af' }).includes('aria-label="64,7%"'));
  assert.ok(markerScale(1250000, { min: 1e4, max: 1e8, lang: 'af' }).includes('aria-label="R1,25 mn."'));
});
