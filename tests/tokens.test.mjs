// tests/tokens.test.mjs
import { test } from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
const css = fs.readFileSync(new URL('../assets/tokens.css', import.meta.url), 'utf8');
test('scale, spacing, status and accent tokens exist once in :root', () => {
  for (const t of ['--t-11','--t-12','--t-13','--t-14','--t-16','--t-20','--t-26','--t-34','--s-1','--s-4','--s-7','--st-ok-ink','--st-warn-ink','--st-neutral-ink','--st-none-ink','--st-bad-ink','--paper','--rule'])
    assert.ok(new RegExp(`${t}\\s*:`).test(css), t);
  assert.ok(/--accent:\s*#1f4e8c/i.test(css));
  assert.equal((css.match(/--t-16:\s*1rem/g) || []).length, 1);
});
test('dark theme is declared once (no duplicated block)', () => {
  const darkDecls = css.match(/--bg:\s*#[0-9a-f]{3,6}/gi) || [];
  assert.ok(darkDecls.length <= 2, 'light + dark only, found ' + darkDecls.length);
});
