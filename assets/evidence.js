/* Linker evidence codes → plain-language sentences (EN/AF), for the map panel's "Why this result?"
 * disclosure. The dictionary is data/evidence-codes.json: `codes` (26 codes; five are patterns with an
 * {n} slot, e.g. `CONTRA_GROUPS:{n}`, `ROLL_COVERAGE:{n}%`) and `decisions` (one summary per link
 * decision). Pure and DOM-free (unit-tested in tests/evidence.test.mjs); before the dictionary has
 * loaded every lookup answers null, so the panel simply shows the raw codes. */
let DICT = { codes: {}, decisions: {} };
let exact = new Map(), patterns = [];
let loading = null;

function install(d) {
  DICT = { codes: (d && d.codes) || {}, decisions: (d && d.decisions) || {} };
  exact = new Map(); patterns = [];
  for (const [key, v] of Object.entries(DICT.codes)) {
    if (!key.includes('{n}')) { exact.set(key, v); continue; }
    const [pre, post] = key.split('{n}').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    patterns.push({ re: new RegExp(`^${pre}(.+?)${post}$`), v });
  }
  return DICT;
}

// Loads the dictionary once. `preloaded` (the file's parsed JSON) skips the fetch — used by tests. A
// failed fetch leaves the dictionary empty (raw codes only) and allows a later retry.
export async function loadEvidence(url = 'data/evidence-codes.json', preloaded) {
  if (preloaded) { loading = Promise.resolve(install(preloaded)); return loading; }
  if (!loading) loading = (async () => {
    try { return install(await (await fetch(url || 'data/evidence-codes.json')).json()); }
    catch (_) { loading = null; return DICT; }
  })();
  return loading;
}

const pick = (v, lang) => (v && (v[lang] || v.en)) || null;

// 'TOWN_A,CONTRA_GROUPS:3,AREA_OK' → [{ code, text }] in input order; unknown codes → { code, text: null }.
export function explain(reasonsCsv, lang = 'en') {
  return String(reasonsCsv || '').split(',').map(s => s.trim()).filter(Boolean).map(code => {
    const hit = exact.get(code);
    if (hit) return { code, text: pick(hit, lang) };
    for (const p of patterns) {
      const m = code.match(p.re);
      if (m) { const s = pick(p.v, lang); return { code, text: s ? s.replace(/\{n\}/g, m[1]) : null }; }
    }
    return { code, text: null };
  });
}

// One-sentence summary of a link decision (accepted_high … missing); null when unknown.
export function decisionSummary(decision, lang = 'en') {
  return pick(DICT.decisions[decision], lang);
}
