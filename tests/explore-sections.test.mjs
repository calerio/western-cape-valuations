// tests/explore-sections.test.mjs — ledger sort/rank, the one Cape Town share, the province concentration pair.
import { test } from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
const { sortRows, ctExclusion, spreadConc } = await import('../assets/explore-sections.js');
const X = JSON.parse(fs.readFileSync(new URL('../data/explore.json', import.meta.url), 'utf8'));
const S = JSON.parse(fs.readFileSync(new URL('../data/stats.json', import.meta.url), 'utf8'));

test('sortRows: blanks last, direction honoured; rank = position in the sorted order', () => {
  const rows = [{ name: 'b', label: 'B', total: 5 }, { name: 'a', label: 'A', total: null }, { name: 'c', label: 'C', total: 9 }];
  assert.deepEqual(sortRows(rows, { key: 'total', dir: -1 }).map(r => r.name), ['c', 'b', 'a']);
  assert.deepEqual(sortRows(rows, { key: 'total', dir: 1 }).map(r => r.name), ['b', 'c', 'a']);
  const byName = sortRows(rows, { key: 'name', dir: 1 });
  assert.deepEqual(byName.map((r, i) => [i + 1, r.label]), [[1, 'A'], [2, 'B'], [3, 'C']]);   // re-ranked after the sort
  assert.equal(rows[0].name, 'b', 'input untouched');
});

test('ctExclusion: the province ledger shows the findings Cape Town share, and shares still add to 100%', () => {
  const rows = Object.entries(S.districts).map(([name, d]) => ({ name, total: d.total }));
  const tot = rows.reduce((a, r) => a + r.total, 0);
  const ex = ctExclusion(X, rows, tot);
  const f = X.findings.find(x => x.id === 'ct_share');
  assert.ok(ex, 'applies at province level');
  assert.ok(Math.abs(ex.shareOf(rows.find(r => r.name === 'City of Cape Town')) - f.value) < 1e-9);
  assert.ok(Math.abs(rows.reduce((a, r) => a + ex.shareOf(r), 0) - 1) < 1e-9);
  // the recovered double count is of the order the data audit states (~R36bn, about 1.4% of the total)
  assert.ok(ex.excluded / tot > 0.005 && ex.excluded / tot < 0.03, String(ex.excluded));
  assert.equal(ctExclusion(X, rows.filter(r => r.name !== 'City of Cape Town'), tot), null, 'no Cape Town row');
  assert.equal(ctExclusion(X, rows.filter(r => r.name === 'City of Cape Town'), tot), null, 'single row');
  assert.equal(ctExclusion({ findings: [] }, rows, tot), null, 'no finding (degraded)');
});

test('spreadConc: province uses the findings pair; other nodes the exported conc row', () => {
  const p = spreadConc(X, { level: 'province', node: 'province' });
  assert.equal(p.top10, X.findings.find(f => f.id === 'top10_share').value);
  assert.equal(p.bottom50, X.findings.find(f => f.id === 'bottom50_share').value);
  const m = spreadConc(X, { level: 'municipality', node: 'm:stellenbosch' });
  const cols = X.conc.cols, row = X.conc.nodes['m:stellenbosch'];
  assert.equal(m.top10, row[cols.indexOf('top10')]);
  assert.ok(!m.excl);
});
