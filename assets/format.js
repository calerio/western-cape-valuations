/* Shared number/money formatting (EN + AF). One place for the conventions that atlas.js
 * R()/N() and map.js R()/N() each carried: Afrikaans large-number words differ from English
 * (10⁹ = miljard, 10¹² = biljoen — NOT "billion"), so af uses mn./mjd./bilj. and the decimal
 * comma; a space separates the figure from the word (map-page convention); below R1 m the
 * full rand amount is shown, space-grouped. Grouping is done by hand, not toLocaleString,
 * because en-ZA output differs between engines (NBSP vs comma). */
const WORDS = { en: { k: ' k', m: ' m', bn: ' bn', tn: ' tn' }, af: { k: ' k', m: ' mn.', bn: ' mjd.', tn: ' bilj.' } };
const dec = (s, lang) => lang === 'af' ? s.replace('.', ',') : s;
const bad = v => v == null || v === '' || !Number.isFinite(+v);
// toFixed, then trim trailing decimal zeros: 38.40 → 38.4, 2.00 → 2 (integers untouched).
const fixed = (x, d) => { const s = x.toFixed(d); return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s; };
const group = s => s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

export function fmtN(n, lang = 'en') {
  if (bad(n)) return '—';
  const [i, f] = String(Math.abs(+n)).split('.');
  return (+n < 0 ? '-' : '') + group(i) + (f ? (lang === 'af' ? ',' : '.') + f : '');
}

// A value takes the larger word as soon as its figure in the smaller unit would ROUND to 1000
// or more: 999 999.6 reads "R1 m" (never "R1 000 000"), 999 995 000 reads "R1 bn" (never
// "R1000 m"), and the short form's 999 600 reads "R1 m" (never "R1000 k").
export function fmtR(value, lang = 'en', opts = {}) {
  if (bad(value)) return '—';
  const v = +value, w = WORDS[lang] || WORDS.en, a = Math.abs(v), sign = v < 0 ? '-' : '';
  const f = (x, d) => dec(fixed(x, d), lang);
  const reaches = (x, d) => +x.toFixed(d) >= 1000;
  if (reaches(a / 1e9, 2)) return `${sign}R${f(a / 1e12, 2)}${w.tn}`;
  if (reaches(a / 1e6, 2)) return `${sign}R${f(a / 1e9, 2)}${w.bn}`;
  if (opts.short ? reaches(a / 1e3, 0) : Math.round(a) >= 1e6) return `${sign}R${f(a / 1e6, 2)}${w.m}`;
  if (opts.short && a >= 1e3) return `${sign}R${f(a / 1e3, 0)}${w.k}`;
  return `${sign}R${fmtN(Math.round(a), lang)}`;
}

export function fmtPct(x, lang = 'en', digits = 1) { return bad(x) ? '—' : dec((+x * 100).toFixed(digits), lang) + '%'; }

export function fmtM2(n, lang = 'en') { return bad(n) ? '—' : `${fmtN(Math.round(+n), lang)} m²`; }
