import { test } from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
const dict = JSON.parse(fs.readFileSync(new URL('../data/evidence-codes.json', import.meta.url), 'utf8'));
const { loadEvidence, explain, decisionSummary } = await import('../assets/evidence.js');
await loadEvidence(null, dict);
test('every code has EN and AF text; parameterised codes interpolate', () => {
  for (const [c, v] of Object.entries(dict.codes)) { assert.ok(v.en && v.af, c); }
  const r = explain('TOWN_A,CONTRA_GROUPS:3,AREA_OK', 'en'); assert.equal(r.length, 3); assert.ok(r[1].text.includes('3'));
  assert.equal(explain('NOPE_CODE', 'af')[0].text, null);
  for (const d of ['accepted_high','accepted_group','accepted_lineage','review','ambiguous','not_in_roll','abstain','missing']) assert.ok(decisionSummary(d, 'af'));
});
test('pattern codes: percent suffix, literal fallback, AF, empty input, no leftover placeholders', () => {
  const [cov] = explain('ROLL_COVERAGE:99%', 'en');
  assert.equal(cov.code, 'ROLL_COVERAGE:99%'); assert.ok(cov.text.includes('99%'), cov.text);
  assert.equal(explain('ROLL_COVERAGE:?', 'en')[0].text, dict.codes['ROLL_COVERAGE:?'].en);
  assert.ok(explain('MULTI_GROUP:4', 'af')[0].text.startsWith('4 '));
  assert.deepEqual(explain('', 'en'), []); assert.deepEqual(explain(null, 'en'), []);
  assert.deepEqual(explain(' TOWN_A , AREA_OK ', 'en').map(x => x.code), ['TOWN_A', 'AREA_OK']);
  for (const code of Object.keys(dict.codes)) {
    const sample = code.replace('{n}', '7');
    for (const lang of ['en', 'af']) {
      const [e] = explain(sample, lang);
      assert.ok(e.text && !/[{}_]/.test(e.text), `${sample} ${lang}: ${e.text}`);
    }
  }
  assert.equal(decisionSummary('nope', 'en'), null);
  assert.equal(explain('TOWN_A', 'xx')[0].text, dict.codes.TOWN_A.en);   // unknown language → English
});
test('lineage codes explain the consolidation in plain words', () => {
  const [c] = explain('CONSOLIDATED_FROM:1497+1505+3500', 'en');
  assert.ok(c.text && c.text.includes('1497, 1505 and 3500'), c.text);
  const [one] = explain('CONSOLIDATED_FROM:3363', 'en');
  assert.ok(one.text && one.text.includes('erf 3363') && !one.text.includes('+'), one.text);
  assert.ok(explain('CONSOLIDATED_FROM:1497+1505+3500', 'af')[0].text.includes('1497, 1505 en 3500'));
  for (const code of ['LINEAGE_AREA_OK', 'LINEAGE_ROLL_AREA_OK', 'LINEAGE_ROLL_AREA_UNKNOWN'])
    for (const lang of ['en', 'af']) assert.ok(explain(code, lang)[0].text, `${code} ${lang}`);
});
