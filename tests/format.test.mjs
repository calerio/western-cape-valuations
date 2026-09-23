import { test } from 'node:test'; import assert from 'node:assert/strict';
import { fmtR, fmtN, fmtPct, fmtM2 } from '../assets/format.js';
test('rand formatting matches the panel convention in EN', () => {
  assert.equal(fmtR(850000), 'R850 000');
  assert.equal(fmtR(1250000), 'R1.25 m');
  assert.equal(fmtR(2660416645748), 'R2.66 tn');
  assert.equal(fmtR(38400000), 'R38.4 m');
  assert.equal(fmtR(null), '—');
});
test('Afrikaans uses the decimal comma and number words', () => {
  assert.equal(fmtR(1250000, 'af'), 'R1,25 mn.');
  assert.equal(fmtR(2660416645748, 'af'), 'R2,66 bilj.');
  assert.equal(fmtR(17640000000, 'af'), 'R17,64 mjd.');
});
test('short form for tiles', () => { assert.equal(fmtR(915000, 'en', { short: true }), 'R915 k'); assert.equal(fmtR(915000, 'af', { short: true }), 'R915 k'); });
test('numbers, percentages, m²', () => {
  assert.equal(fmtN(1459474), '1 459 474'); assert.equal(fmtPct(0.647), '64.7%'); assert.equal(fmtPct(0.647, 'af'), '64,7%'); assert.equal(fmtM2(358), '358 m²');
});
