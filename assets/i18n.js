/* Shared i18n: Afrikaans catalogue (data/i18n-af.json — the same file export_pages.py renders
 * the static pages from; English source strings are the keys), t/tf/tn lookups, DOM
 * application of [data-i18n] / [data-i18n-ph] / [data-i18n-aria], and an in-place language
 * switch (no reload). English is the identity: the key IS the text, so re-applying in EN
 * restores English. No DOM/storage access at import time except behind guards. */
const KEY = 'wcv-lang';

function initialLang() {
  try { const v = localStorage.getItem(KEY); if (v === 'af' || v === 'en') return v; } catch (_) {}
  try { return (navigator.language || '').toLowerCase().startsWith('af') ? 'af' : 'en'; } catch (_) { return 'en'; }
}

export const I18N = { lang: initialLang(), strings: {}, names: {}, blocks: {} };

let afLoad = null;            // cached promise for the af catalogue (idempotent loads)
const listeners = [];

function install(cat) {
  I18N.strings = (cat && cat.strings) || {};
  I18N.names = (cat && cat.names) || {};
  I18N.blocks = (cat && cat.blocks) || {};
}

// Loads the catalogue for `lang` once. EN needs none (identity). `preloaded` (an object of
// the catalogue's shape) skips the fetch — used by tests. A failed fetch leaves an empty
// catalogue, i.e. the page stays English rather than breaking.
export async function loadCatalog(lang, url = 'data/i18n-af.json', preloaded) {
  if (lang !== 'af') return I18N;
  if (preloaded) { install(preloaded); afLoad = Promise.resolve(I18N); return I18N; }
  if (!afLoad) {
    afLoad = (async () => {
      try { install(await (await fetch(url || 'data/i18n-af.json')).json()); }
      catch (_) { afLoad = null; }
      return I18N;
    })();
  }
  return afLoad;
}

const af = () => I18N.lang === 'af';
export function t(s) { return (af() && I18N.strings[s]) || s; }
export function tf(s, vars = {}) { return t(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)); }
export function tn(name) { return (af() && I18N.names[name]) || name; }

export function applyDom(root = (typeof document !== 'undefined' ? document : null)) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-ph]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPh);
    if (el.getAttribute('aria-label')) el.setAttribute('aria-label', t(el.dataset.i18nPh));
  });
  root.querySelectorAll('[data-i18n-aria]').forEach(el => el.setAttribute('aria-label', t(el.dataset.i18nAria)));
}

// Monotonic call counter: a slow af catalogue load must not land after a later setLang('en').
// Only the LATEST call applies the language and notifies; superseded calls resolve quietly.
let setSeq = 0;
export async function setLang(lang) {
  lang = lang === 'af' ? 'af' : 'en';
  const mine = ++setSeq;
  try { localStorage.setItem(KEY, lang); } catch (_) {}
  await loadCatalog(lang);
  if (mine !== setSeq) return I18N.lang;
  I18N.lang = lang;
  if (typeof document !== 'undefined' && document.documentElement) document.documentElement.lang = lang;
  applyDom();
  for (const fn of listeners) { try { fn(lang); } catch (e) { console.error(e); } }
  return lang;
}

export function onLangChange(fn) { if (typeof fn === 'function') listeners.push(fn); }

export function currentLang() { return I18N.lang; }
