// tests/fonts.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const dir = new URL('../assets/fonts/', import.meta.url);
const NEEDED = ['IBMPlexSans-VF-latin.woff2','IBMPlexSans-VF-latin-ext.woff2','SourceSerif4-SemiBold-latin.woff2','SourceSerif4-SemiBold-latin-ext.woff2','OFL-IBMPlexSans.txt','OFL-SourceSerif4.txt'];
test('font files exist, are woff2 and total ≤ 150 KB', () => {
  let total = 0;
  for (const f of NEEDED) {
    const p = new URL(f, dir); assert.ok(fs.existsSync(p), f + ' missing');
    if (f.endsWith('.woff2')) { const b = fs.readFileSync(p); assert.equal(b.subarray(0, 4).toString('latin1'), 'wOF2', f + ' not woff2'); total += b.length; }
  }
  assert.ok(total <= 150 * 1024, 'fonts total ' + total);
});
test('tokens.css declares the faces with swap and unicode ranges', () => {
  const css = fs.readFileSync(new URL('../assets/tokens.css', import.meta.url), 'utf8');
  assert.equal((css.match(/@font-face/g) || []).length, 4);
  assert.equal((css.match(/font-display:\s*swap/g) || []).length, 4);
  assert.ok(/unicode-range:\s*U\+0100-02BA/.test(css), 'latin-ext range for Afrikaans diacritics');
  assert.equal((css.match(/font-weight:\s*400 600/g) || []).length, 2, 'variable Plex covers 400–600');
  assert.ok(/--font-ui:\s*"IBM Plex Sans"/.test(css));
  assert.ok(/--font-display:\s*"Source Serif 4"/.test(css));
});
