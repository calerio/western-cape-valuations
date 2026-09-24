#!/usr/bin/env node
/* i18n completeness check: every literal key the site translates at runtime must have an
 * Afrikaans entry in data/i18n-af.json (`strings`, or `names` for tn()).
 * Scans assets/*.js, assets/map/*.js, index.html, map.html, plain.html, templates/*.html for
 *   t('…') / tf('…') / t("…") / tf("…")   → strings
 *   tn('…')                               → names
 *   setHint('…')  (map.js: takes the EN key and translates it itself) → strings
 *   data-i18n / data-i18n-ph / data-i18n-aria="…" → strings
 * Also: data/explore.json strings the page passes through t() — meta.caveats, rolls[].date_note and
 * findings[].en (unless the finding carries its own af).
 * Other keys built at runtime (variables, template literals) are not checked.
 * Usage: node tests/check-i18n.mjs  → prints missing keys and exits 1, or prints OK. */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cat = JSON.parse(readFileSync(join(ROOT, 'data/i18n-af.json'), 'utf8'));
const strings = cat.strings || {}, names = cat.names || {};

const ls = (d, re) => existsSync(join(ROOT, d))
  ? readdirSync(join(ROOT, d)).filter(f => re.test(f)).map(f => join(d, f)) : [];
const files = [
  ...ls('assets', /\.js$/), ...ls('assets/map', /\.js$/),
  'index.html', 'map.html', 'plain.html', ...ls('templates', /\.html$/),
].filter(f => existsSync(join(ROOT, f)));

// JS string literal body → value (handles \' \" \\ \n \uXXXX \u{…} \xXX).
function unescapeJs(body) {
  return body.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_, e) => {
    if (e[0] === 'u' && e[1] === '{') return String.fromCodePoint(parseInt(e.slice(2, -1), 16));
    if (e[0] === 'u' && e.length === 5) return String.fromCharCode(parseInt(e.slice(1), 16));
    if (e[0] === 'x' && e.length === 3) return String.fromCharCode(parseInt(e.slice(1), 16));
    return ({ n: '\n', t: '\t', r: '\r' })[e] ?? e;
  });
}
const decodeHtml = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>');

const CALL = /(?<![\w$.])(t|tf|tn|setHint)\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)")/g;
const ATTR = /\bdata-i18n(?:-ph|-aria)?\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export function extract(src, isHtml) {
  const out = [];
  for (const m of src.matchAll(CALL)) {
    const key = unescapeJs(m[2] ?? m[3]);
    if (key) out.push({ key, kind: m[1] === 'tn' ? 'names' : 'strings' });
  }
  for (const m of src.matchAll(ATTR)) {
    let key = m[1] ?? m[2];
    if (isHtml) key = decodeHtml(key);
    if (key && !key.includes('${')) out.push({ key, kind: 'strings' });
  }
  return out;
}

// Returns [{ key: 'strings: …', files: [...] }] for every literal key without an af entry.
export function findMissing(catalog = cat) {
  const st = catalog.strings || {}, nm = catalog.names || {};
  const missing = new Map(); let total = 0;
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    for (const { key, kind } of extract(src, f.endsWith('.html'))) {
      total++;
      const ok = kind === 'names' ? (key in nm || key in st) : key in st;
      if (!ok) { const k = `${kind}: ${key}`; if (!missing.has(k)) missing.set(k, new Set()); missing.get(k).add(f); }
    }
  }
  const X = existsSync(join(ROOT, 'data/explore.json')) ? JSON.parse(readFileSync(join(ROOT, 'data/explore.json'), 'utf8')) : null;
  if (X) {
    const data = [...((X.meta || {}).caveats || []), ...(X.rolls || []).map(r => r.date_note),
      ...(X.findings || []).filter(f => !f.af).map(f => f.en)].filter(Boolean);
    for (const key of data) {
      total++;
      if (!(key in st)) { const k = `strings: ${key}`; if (!missing.has(k)) missing.set(k, new Set()); missing.get(k).add('data/explore.json'); }
    }
  }
  return { total, files: files.length, missing: [...missing].map(([key, fs]) => ({ key, files: [...fs] })) };
}

// Catalogue keys no source mentions any more (a WARNING, never a failure: some keys arrive from data
// the check cannot see). A key counts as used when its text — raw, JS/JSON-escaped or HTML-escaped —
// appears in the scanned site files, 404.html, data/*.json, or the data repo's extract/*.py (the
// static-page generator and the authored prose it translates), found next to this checkout
// or via WCV_DATA_REPO.
export function findUnused(catalog = cat) {
  const dataRepo = process.env.WCV_DATA_REPO || join(ROOT, '..', 'western-cape-property-valuations');
  const texts = [...files, '404.html', ...ls('data', /\.json$/).filter(f => !f.endsWith('i18n-af.json'))]
    .filter(f => existsSync(join(ROOT, f))).map(f => readFileSync(join(ROOT, f), 'utf8'));
  const ex = join(dataRepo, 'extract');
  const pySeen = existsSync(ex);
  if (pySeen) for (const f of readdirSync(ex).filter(f => f.endsWith('.py'))) texts.push(readFileSync(join(ex, f), 'utf8'));
  // join implicitly concatenated literals split over lines ("…"\n    "…" in Python, '…' +\n '…' in JS)
  const hay = texts.join('\n').replace(/(["'])\s*\+?\s*\n\s*\+?\s*\1/g, '');
  const uEsc = k => k.replace(/[^\x00-\x7f]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  const forms = k => [k, JSON.stringify(k).slice(1, -1), k.replace(/'/g, "\\'"), k.replace(/&/g, '&amp;'), uEsc(k)];
  const unused = Object.keys(catalog.strings || {}).filter(k => !forms(k).some(f => hay.includes(f)));
  return { unused, pySeen };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const u = findUnused();
  if (u.unused.length) {
    console.warn(`check-i18n: WARNING ${u.unused.length} catalogue key(s) no source uses${u.pySeen ? '' : ' (data repo not found: generator keys not checked)'}:`);
    for (const k of u.unused) console.warn(`  ${JSON.stringify(k)}`);
  }
  const r = findMissing();
  if (r.missing.length) {
    console.error(`check-i18n: ${r.missing.length} key(s) without an af entry in data/i18n-af.json:`);
    for (const m of r.missing) console.error(`  ${JSON.stringify(m.key)}  (${m.files.join(', ')})`);
    process.exit(1);
  }
  console.log(`check-i18n: OK — ${r.total} literal keys in ${r.files} files all have af entries`);
}
