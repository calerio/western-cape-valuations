// tests/check-i18n.test.mjs — the i18n completeness check itself, and the live catalogue passing it.
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { extract, findMissing } from './check-i18n.mjs';

test('extract: t/tf/tn/setHint literals and data-i18n attributes, not look-alikes', () => {
  const js = `t('A'); tf("B {n}", {n}); tn('Mossel Bay'); setHint('Loading…'); x.t('C'); split('D'); t(v); t('It\\'s'); t('\\u2014')`;
  assert.deepEqual(extract(js, false), [
    { key: 'A', kind: 'strings' }, { key: 'B {n}', kind: 'strings' }, { key: 'Mossel Bay', kind: 'names' },
    { key: 'Loading…', kind: 'strings' }, { key: "It's", kind: 'strings' }, { key: '—', kind: 'strings' }]);
  const html = `<b data-i18n="Map">Map</b><input data-i18n-ph="Search &amp; go"><a data-i18n-aria='Close'>`;
  assert.deepEqual(extract(html, true).map(k => k.key), ['Map', 'Search & go', 'Close']);
});

test('findMissing: flags a key the catalogue lacks', () => {
  const r = findMissing({ strings: {}, names: {} });
  assert.ok(r.missing.length > 0);
});

test('every literal key on the site has an af entry', () => {
  const r = findMissing();
  assert.deepEqual(r.missing, [], JSON.stringify(r.missing, null, 1));
});
