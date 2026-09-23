import { test } from 'node:test'; import assert from 'node:assert/strict';
globalThis.localStorage = { _s: {}, getItem(k) { return this._s[k] ?? null; }, setItem(k, v) { this._s[k] = String(v); } };
globalThis.document = { documentElement: { lang: 'en' }, querySelectorAll: () => [] };
const { I18N, loadCatalog, t, tf, setLang, onLangChange, currentLang } = await import('../assets/i18n.js');
test('t() is identity in EN and looks up AF; tf interpolates', async () => {
  await loadCatalog('af', null, { strings: { 'Ward {n}': 'Wyk {n}', 'No valuation found': 'Geen waardasie gevind nie' }, names: { 'Western Cape': 'Wes-Kaap' } });
  I18N.lang = 'en'; assert.equal(t('No valuation found'), 'No valuation found');
  I18N.lang = 'af'; assert.equal(t('No valuation found'), 'Geen waardasie gevind nie'); assert.equal(tf('Ward {n}', { n: 8 }), 'Wyk 8');
});
test('setLang notifies listeners and persists without reload', async () => {
  let seen = null; onLangChange(l => { seen = l; });
  await setLang('en'); assert.equal(seen, 'en'); assert.equal(localStorage.getItem('wcv-lang'), 'en'); assert.equal(currentLang(), 'en');
});
