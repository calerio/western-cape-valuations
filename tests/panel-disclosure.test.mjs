// tests/panel-disclosure.test.mjs — "Why this result?" text for the shown state (panel.js renderDisclosure)
import { test } from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
const { loadEvidence } = await import('../assets/evidence.js?v=1');
const { renderDisclosure } = await import('../assets/map/panel.js');
await loadEvidence(null, JSON.parse(fs.readFileSync(new URL('../data/evidence-codes.json', import.meta.url), 'utf8')));
test('review (downgraded accepted) leaves out the positive town sentences but keeps every code', () => {
  const html = renderDisclosure('TOWN_A,AREA_OK', 'review');
  assert.match(html, /town could not be confirmed/);
  assert.doesNotMatch(html, /clearly corresponds/);
  assert.match(html, /<code>TOWN_A · AREA_OK<\/code>/);
  assert.match(renderDisclosure('TOWN_A', 'accepted_high'), /clearly corresponds/);
});
test('not_in_roll does not repeat the card note', () => {
  const note = 'Checked: the roll covers this town but has no entry for this erf.';
  const html = renderDisclosure('ROLL_COVERAGE:100%', 'not_in_roll', { note });
  assert.doesNotMatch(html, /Checked: the roll covers/);
  assert.match(renderDisclosure('ROLL_COVERAGE:100%', 'not_in_roll'), /Checked: the roll covers/);
});
