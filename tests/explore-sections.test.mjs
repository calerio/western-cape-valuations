// tests/explore-sections.test.mjs — ledger sort/rank, the one Cape Town share, the province concentration pair.
import { test } from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
const { sortRows, ledgerRows, ctExclusion, spreadConc } = await import('../assets/explore-sections.js');
const X = JSON.parse(fs.readFileSync(new URL('../data/explore.json', import.meta.url), 'utf8'));
const S = JSON.parse(fs.readFileSync(new URL('../data/stats.json', import.meta.url), 'utf8'));

test('sortRows: blanks last, direction honoured, input untouched', () => {
  const rows = [{ name: 'b', label: 'B', total: 5 }, { name: 'a', label: 'A', total: null }, { name: 'c', label: 'C', total: 9 }];
  assert.deepEqual(sortRows(rows, { key: 'total', dir: -1 }).map(r => r.name), ['c', 'b', 'a']);
  assert.deepEqual(sortRows(rows, { key: 'total', dir: 1 }).map(r => r.name), ['b', 'c', 'a']);
  assert.equal(rows[0].name, 'b');
});

// rank + name cells, in document order, from the rendered <tbody> HTML
const cells = html => [...html.matchAll(/<td class="c-rank num">(\d+)<\/td><td class="c-name">(?:<a [^>]*>)?([^<]*)/g)].map(m => [+m[1], m[2]]);
test('ledgerRows: the rendered rank column is the position after each sort, and the cut keeps the top rows', () => {
  const rows = [{ label: 'Bravo', total: 5, properties: 10, median: 2e6 }, { label: 'Alpha', total: 9, properties: 30, median: 1e6 },
    { label: 'Charlie', total: 7, properties: 20, median: 3e6 }];
  assert.deepEqual(cells(ledgerRows(rows, { state: { key: 'total', dir: -1, expanded: true }, muni: true })),
    [[1, 'Alpha'], [2, 'Charlie'], [3, 'Bravo']]);
  assert.deepEqual(cells(ledgerRows(rows, { state: { key: 'name', dir: 1, expanded: true }, muni: true })),
    [[1, 'Alpha'], [2, 'Bravo'], [3, 'Charlie']]);
  assert.deepEqual(cells(ledgerRows(rows, { state: { key: 'median', dir: -1, expanded: false }, first: 2, muni: true })),
    [[1, 'Charlie'], [2, 'Bravo']]);
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
