/* Explore sections: the reading column of index.html, drawn from data/explore.json (+ stats.json /
 * towns.json for the per-node figures). atlas.js builds a plain `ctx` for the current scope and
 * calls renderSections(ctx); this module owns the markup of #secValue, #secSpread, #secMix,
 * #secDates, #secFindings and the rail's coverage strip. Every section: one <h2>, one plain
 * sentence (.lede), the chart, notes, and a closed "How this is computed" disclosure with the
 * committed SQL (explore.queries). A section whose data is absent is hidden, never faked. */
import { fmtR, fmtN, fmtPct } from './format.js?v=2';
import { t, tf, tn, currentLang } from './i18n.js?v=1';
import { shareBar, markerScale, logHistogram, stackedBar, dateDots, fmtDate } from './explore-charts.js?v=1';

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const L = () => currentLang();
const R = (v, o) => fmtR(v, L(), o), N = v => fmtN(v, L()), P = v => fmtPct(v, L());
export const slugOf = n => String(n || '').trim().toLowerCase().replace(/ /g, '-');   // = export_pages.slugify
const cycleLabel = c => String(c || '').replace('-draft', ' ' + t('draft')).replace(/(\d{4})-(\d{4})/, '$1–$2');

/* ---------- SQL disclosure ---------- */
function sqlFor(X, ids, level) {
  if (!X || !X.queries) return '';
  const nodeExpr = (X.queries._node || {})[level === 'district' ? 'district' : level === 'municipality' ? 'muni' : 'province'] || "'province'";
  return ids.filter(id => X.queries[id]).map(id => {
    const q = X.queries[id];
    const body = typeof q === 'string' ? q : JSON.stringify(q, null, 1);
    return `-- ${id}\n` + body.replace(/\{node\}/g, nodeExpr);
  }).join('\n\n');
}
const how = (sql, extra = '', summary = 'How this is computed') => sql || extra
  ? `<details class="how"><summary>${esc(t(summary))}</summary>${extra}${sql ? `<pre>${esc(sql)}</pre>` : ''}</details>` : '';

// Phones (≤ 720 px, the explore.css breakpoint): each section is a <details> card whose summary carries
// the heading and the key sentence; the first two start open, the rest collapsed, and a reader's own
// open/close choice survives re-renders (sort, language). Desktop keeps plain, always-open sections.
const PHONE = '(max-width: 720px)';
const phoneMQ = (() => { try { return typeof matchMedia === 'function' ? matchMedia(PHONE) : null; } catch (_) { return null; } })();
const isPhone = () => !!(phoneMQ && phoneMQ.matches);
const CARD_ORDER = ['secValue', 'secSpread', 'secMix', 'secDates', 'secFindings'];
const userOpen = {};                                   // section id → the reader's choice (phones)
const cardOpen = id => (id in userOpen ? userOpen[id] : CARD_ORDER.indexOf(id) < 2);

function shell(id, { h2, lede, body, notes = [], sql = '', howExtra = '' }) {
  const el = $(id); if (!el) return null;
  el.hidden = false;
  const head = `<h2>${esc(h2)}</h2>` + (lede ? `<p class="lede">${esc(lede)}</p>` : '');
  const inner = `<div class="sec-body"><div class="chart">${body}</div>` +
    notes.filter(Boolean).map(n => `<p class="note">${esc(n)}</p>`).join('') + how(sql, howExtra) + `</div>`;
  if (isPhone()) {
    el.innerHTML = `<details class="card"${cardOpen(id) ? ' open' : ''}><summary>${head}</summary>${inner}</details>`;
    const d = el.querySelector('details.card');
    d.addEventListener('toggle', () => { if (isPhone()) userOpen[id] = d.open; });
  } else el.innerHTML = head + inner;
  return el;
}
const hide = id => { const el = $(id); if (el) { el.hidden = true; el.innerHTML = ''; } };

/* ---------- data helpers ---------- */
function pctRow(X, kind, node) {
  const r = X && X.pct && X.pct[kind] && X.pct[kind][node]; if (!r) return null;
  const o = {}; (X.pct.cols || []).forEach((c, i) => { o[c] = r[i]; }); return o;
}
function concRow(X, node) {
  const r = X && X.conc && X.conc.nodes && X.conc.nodes[node]; if (!r) return null;
  const o = {}; (X.conc.cols || []).forEach((c, i) => { o[c] = r[i]; }); return o;
}
// loghist.n is per province + municipality; a district is the sum of its municipalities (counts add up)
function histCounts(X, ctx) {
  const H = X && X.loghist; if (!H || !H.n) return null;
  if (H.n[ctx.node]) return H.n[ctx.node];
  if (ctx.level !== 'district') return null;
  const parts = ctx.muniSlugs.map(s => H.n['m:' + s]).filter(Boolean);
  if (!parts.length || parts.length !== ctx.muniSlugs.length) return null;
  return parts[0].map((_, i) => parts.reduce((a, p) => a + (p[i] || 0), 0));
}
function histBins(X, counts) {
  const E = X.loghist.edges, idx = X.loghist.bins, step = E[1] / E[0];
  return idx.map((b, i) => {
    const lo = b < 0 ? E[0] / step : b >= E.length - 1 ? E[E.length - 1] : E[b];
    const hi = b < 0 ? E[0] : b >= E.length - 1 ? E[E.length - 1] * step : E[b + 1];
    return { lo, hi, n: counts[i] || 0 };
  });
}
const rollBySlug = (X, slug) => (X && X.rolls || []).find(r => r.slug === slug) || null;
const dateBySlug = (X, slug) => (X && X.dates || []).find(d => d.slug === slug) || null;

/* ---------- Where the value sits: the ledger table ---------- */
const tableState = { key: 'total', dir: -1, expanded: false, kind: null };
const FIRST = 8;

function valueRows(ctx) {
  const X = ctx.explore;
  if (ctx.level === 'municipality') {
    return (ctx.towns || []).map(tw => ({ name: tw.name, label: tw.name, properties: tw.parcels, total: tw.total, median: tw.median, date: null }));
  }
  return ctx.children.map(c => {
    const s = c.stat || {}, fh = pctRow(X, 'res_fh', 'm:' + c.slug), d = dateBySlug(X, c.slug), roll = rollBySlug(X, c.slug);
    const prov = s.provenance || {};
    return {
      name: c.name, label: tn(c.name), href: '#m/' + c.slug, properties: s.properties, total: s.total,
      median: fh ? fh.p50 : (s.res_median != null ? s.res_median : null),
      date: d ? d.valued_as_at : null,
      dateText: d && d.valued_as_at ? fmtDate(d.valued_as_at, L()) : (prov.valued_as_at && !d ? prov.valued_as_at : ''),
      dateNote: roll ? roll.date_note : null, cycle: (d && d.cycle) || s.cycle,
    };
  });
}
function sortRows(rows) {
  const { key, dir } = tableState;
  const val = r => key === 'name' ? r.label : key === 'date' ? (r.date || null) : r[key];
  return rows.slice().sort((a, b) => {
    const va = val(a), vb = val(b);
    if (va == null && vb == null) return 0; if (va == null) return 1; if (vb == null) return -1;   // blanks last
    return (typeof va === 'string' ? va.localeCompare(vb) : va - vb) * dir;
  });
}
function renderValue(ctx) {
  const X = ctx.explore, muni = ctx.level === 'municipality';
  const rows = valueRows(ctx).filter(r => r.total != null);
  if (!rows.length) return hide('secValue');
  const kind = muni ? 'towns' : 'munis';
  if (tableState.kind !== kind) Object.assign(tableState, { key: 'total', dir: -1, expanded: false, kind });
  // Shares: at municipality level towns.json lists at most 40 places (those with the most
  // properties), so the denominator is the municipality's roll total from stats.json, never the
  // sum of the listed rows; the unlisted remainder is shown as its own row.
  const listed = rows.reduce((a, r) => a + (r.total || 0), 0);
  const tot = muni && ctx.stat && ctx.stat.total > 0 ? ctx.stat.total : listed;
  const rest = muni ? Math.max(0, tot - listed) : 0;
  const meds = rows.map(r => r.median).filter(v => v > 0);
  const mMin = meds.length ? Math.min(...meds) : 1, mMax = meds.length ? Math.max(...meds) : 1;
  const top = rows.slice().sort((a, b) => b.total - a.total)[0];
  const hiM = rows.filter(r => r.median > 0).sort((a, b) => b.median - a.median);
  let lede;
  if (muni) lede = tf('{top} holds {pct} of the value on the {place} roll.', { top: top.label, pct: P(top.total / tot), place: tn(ctx.name) });
  else if (rows.length === 1) lede = tf('{top} is the only municipality here.', { top: top.label });
  else if (!hiM.length) lede = tf('{top} holds {pct} of the value.', { top: top.label, pct: P(top.total / tot) });
  else lede = tf('{top} holds {pct} of the value; the median home value runs from {lo} in {loName} to {hi} in {hiName}.', {
    top: top.label, pct: P(top.total / tot), lo: R(hiM[hiM.length - 1].median, { short: true }), loName: hiM[hiM.length - 1].label,
    hi: R(hiM[0].median, { short: true }), hiName: hiM[0].label });
  const th = (key, label, cls = '') => `<th scope="col" data-sort="${key}" class="${cls}" aria-sort="${tableState.key === key ? (tableState.dir < 0 ? 'descending' : 'ascending') : 'none'}"><button type="button">${esc(label)}</button></th>`;
  const head = `<thead><tr><th scope="col" class="c-rank"><span class="sr">${esc(t('Rank'))}</span></th>` +
    th('name', t(muni ? 'Town or suburb' : 'Municipality'), 'c-name') + th('properties', t('Properties'), 'c-props num') +
    th('total', t('Total value'), 'c-total num') + th('median', t(muni ? 'Median value' : 'Median home value'), 'c-med num') +
    (muni ? '' : th('date', t('Date of valuation'), 'c-date')) + `</tr></thead>`;
  const body = () => {
    const sorted = sortRows(rows), shown = tableState.expanded ? sorted : sorted.slice(0, FIRST);
    return shown.map((r, i) => `<tr${r.href ? ` data-href="${esc(r.href)}"` : ''}><td class="c-rank num">${i + 1}</td>` +
      `<td class="c-name">${r.href ? `<a href="${esc(r.href)}">${esc(r.label)}</a>` : esc(r.label)}</td>` +
      `<td class="c-props num">${esc(N(r.properties))}</td>` +
      `<td class="c-total num"><span class="fig">${esc(R(r.total))}</span>${shareBar(tot ? r.total / tot : 0, { width: 96, lang: L() })}</td>` +
      `<td class="c-med num"><span class="fig">${esc(r.median > 0 ? R(r.median, { short: true }) : '—')}</span>${markerScale(r.median, { min: mMin, max: mMax, width: 110, lang: L() })}</td>` +
      (muni ? '' : `<td class="c-date"${r.dateNote && !r.date ? ` title="${esc(r.dateNote)}"` : ''}>${esc(r.dateText || t('date not stated'))}</td>`) + `</tr>`).join('');
  };
  // the unlisted remainder (municipality level only): a fixed footer row, outside the sort
  const foot = muni && rest / tot >= 0.0005
    ? `<tfoot><tr class="rest"><td class="c-rank num"></td><td class="c-name">${esc(t('Places not listed'))}</td><td class="c-props num"></td>` +
      `<td class="c-total num"><span class="fig">${esc(R(rest))}</span>${shareBar(rest / tot, { width: 96, lang: L() })}</td><td class="c-med num"></td></tr></tfoot>` : '';
  const more = rows.length > FIRST
    ? `<button type="button" class="more" aria-expanded="${tableState.expanded}">${esc(tableState.expanded ? t('Show fewer')
      : muni ? tf('Show {n} more', { n: rows.length - FIRST }) : tf('Show all {n}', { n: rows.length }))}</button>` : '';
  const notes = muni
    ? [tf('The {n} towns and suburbs with the most properties, as the roll names them. Each share is of the whole {place} roll.', { n: rows.length, place: tn(ctx.name) }),
      rest / tot >= 0.0005 ? tf('The places listed hold {pct} of the roll value; {rest} is in places not listed.', { pct: P(listed / tot), rest: R(rest) }) : null]
    : [t('A comparison, not a trend: each roll values property at its own date. Median home value is for freehold residential property.')];
  const townsHow = muni ? `<p>${esc(t('Town figures come from the site export (export_site.py, the towns block), not from a query on this page: properties valued above zero are grouped by the roll’s suburb name, suburbs with fewer than 3 properties are dropped, and the 40 with the most properties are kept. Shares divide by the municipality’s total from the query below.'))}</p>` : '';
  const el = shell('secValue', { h2: t('Where the value sits'), lede, body: `<table class="ledger">${head}<tbody>${body()}</tbody>${foot}</table>${more}`,
    notes, howExtra: townsHow, sql: X ? sqlFor(X, muni ? ['totals'] : ['totals', 'pct_res_fh', 'rolls'], ctx.level) : '' });
  if (!el) return;
  const table = el.querySelector('table.ledger');
  table.querySelector('thead').addEventListener('click', e => {
    const h = e.target.closest('th[data-sort]'); if (!h) return;
    const key = h.dataset.sort;
    if (tableState.key === key) tableState.dir *= -1; else Object.assign(tableState, { key, dir: key === 'name' || key === 'date' ? 1 : -1 });
    renderValue(ctx);
    const again = $('secValue').querySelector(`th[data-sort="${key}"] button`); if (again) again.focus();
  });
  // a click anywhere on a municipality row opens it (the name link stays the keyboard route)
  table.querySelector('tbody').addEventListener('click', e => {
    if (e.target.closest('a')) return;
    const tr = e.target.closest('tr[data-href]'); if (tr) location.hash = tr.dataset.href;
  });
  const mb = el.querySelector('button.more');
  if (mb) mb.onclick = () => { tableState.expanded = !tableState.expanded; renderValue(ctx); const b = $('secValue').querySelector('button.more'); if (b) b.focus(); };
}

/* ---------- How values are spread ---------- */
function renderSpread(ctx) {
  const X = ctx.explore, counts = histCounts(X, ctx);
  if (!counts) return hide('secSpread');
  const p = pctRow(X, 'all', ctx.node) || {}, s = ctx.stat || {};
  const q = { p10: p.p10 ?? s.p10, p50: p.p50 ?? s.median, p90: p.p90 ?? s.p90, q1: p.p25 ?? s.q1, q3: p.p75 ?? s.q3 };
  const c = concRow(X, ctx.node);
  const callouts = c ? `<dl class="callouts"><div><dt>${esc(t('Most valuable 10% of properties'))}</dt><dd>${esc(tf('hold {pct} of the value', { pct: P(c.top10) }))}</dd></div>` +
    `<div><dt>${esc(t('Least valuable half'))}</dt><dd>${esc(tf('hold {pct} of the value', { pct: P(c.bottom50) }))}</dd></div></dl>` : '';
  shell('secSpread', {
    h2: t('How values are spread'),
    lede: tf('Half of all properties are valued below {median}; the middle half lie between {q1} and {q3}.', { median: R(q.p50, { short: true }), q1: R(q.q1, { short: true }), q3: R(q.q3, { short: true }) }),
    body: logHistogram(histBins(X, counts), { ...q, width: 640, height: 150, lang: L() }) + callouts,
    notes: [t('Log scale: each step to the right is a larger band of value. The shaded band is the middle half of properties.'),
      t('Concentration here is of assessed property values, not of household wealth.')],
    sql: sqlFor(X, ['loghist', 'pct_all', 'conc'], ctx.level),
  });
}

/* ---------- What the roll contains ---------- */
function renderMix(ctx) {
  const X = ctx.explore, G = X && X.groups, row = G && G.nodes && G.nodes[ctx.node];
  if (!row) return hide('secMix');
  const groups = G.order.map((k, i) => ({ key: k, n: (row[i] || [])[0] || 0, value: (row[i] || [])[1] || 0 }));
  const tot = groups.reduce((a, g) => a + g.n, 0); if (!tot) return hide('secMix');
  const big = groups.slice().sort((a, b) => b.n - a.n)[0];
  const vac = groups.find(g => g.key === 'vacant');
  const caveat = (X.meta && X.meta.caveats || []).find(c => /vacant-land category/.test(c));
  const notes = [ctx.level === 'municipality' && vac && !vac.n
    ? t('This roll has no vacant-land category, so vacant land is counted under other groups.') : (caveat ? t(caveat) : null)];
  shell('secMix', {
    h2: t('What the roll contains'),
    lede: tf(big.key === 'residential' ? 'Share of properties by rating category; residential properties make up {pct}.'
      : 'Share of properties by rating category; the largest group makes up {pct}.', { pct: P(big.n / tot) }),
    body: stackedBar(groups, { width: 640, lang: L() }), notes,
    sql: sqlFor(X, ['catmap', 'groups_count'], ctx.level),
  });
}

/* ---------- When each municipality valued ---------- */
function renderDates(ctx) {
  const X = ctx.explore; if (!X || !X.rolls || !X.rolls.length) return hide('secDates');
  const inScope = new Set(ctx.muniSlugs);
  const rolls = X.rolls.map(r => { const d = dateBySlug(X, r.slug); return { name: tn(r.name), slug: r.slug, valued_as_at: d ? d.valued_as_at : r.valued_as_at, date_note: r.date_note }; });
  const dated = rolls.filter(r => r.valued_as_at).map(r => r.valued_as_at).sort();
  const years = dated.map(d => +d.slice(0, 4));
  const from = Math.min(2018, ...years), to = Math.max(2026, ...years.map(y => y + 1));
  let lede;
  if (ctx.level === 'municipality') {
    const me = rolls.find(r => r.slug === ctx.slug), cyc = cycleLabel(ctx.stat && ctx.stat.cycle);
    lede = me && me.valued_as_at ? tf('The {place} roll values property as at {date}, for the {cycle} rating cycle.', { place: tn(ctx.name), date: fmtDate(me.valued_as_at, L()), cycle: cyc })
      : tf('The {place} roll does not state its date of valuation; it serves the {cycle} rating cycle.', { place: tn(ctx.name), cycle: cyc });
  } else lede = tf('Each roll values property at its own date, from {a} to {b}; compare with care.', { a: fmtDate(dated[0], L()), b: fmtDate(dated[dated.length - 1], L()) });
  const el = shell('secDates', {
    h2: t('When each municipality valued'), lede,
    body: dateDots(rolls, { from, to, width: 640, lang: L() }),
    notes: [t('Each dot is a date of valuation, not a trend.')], sql: sqlFor(X, ['rolls'], ctx.level),
  });
  if (el && ctx.level !== 'province') el.querySelectorAll('g.dot').forEach(g => g.classList.toggle('on', inScope.has(g.dataset.slug)));
}

/* ---------- Notable findings ---------- */
function findingValue(f) {
  if (f.unit === 'share') return P(f.value);
  if (f.unit === 'ZAR') return R(f.value, { short: true });
  if (f.unit === 'count') return N(f.value);
  return '';
}
function scopedFindings(ctx) {
  const X = ctx.explore, place = tn(ctx.name), out = [];
  const c = concRow(X, ctx.node);
  if (c && c.top10 != null) out.push({ value: P(c.top10), text: tf('The most valuable 10% of properties in {place} account for {pct} of its roll value.', { place, pct: P(c.top10) }), q: ['conc'] });
  const fh = pctRow(X, 'res_fh', ctx.node);
  if (fh && fh.p50) out.push({ value: R(fh.p50, { short: true }), text: tf('The median freehold home in {place} is valued at {v}.', { place, v: R(fh.p50) }), q: ['pct_res_fh'] });
  const land = ctx.level === 'municipality' && X.land && X.land['m:' + ctx.slug];
  if (land && land.ppm) out.push({ value: tf('{v}/m²', { v: R(land.ppm[1]) }), text: tf('Full-title residential property in {place} has a median value of {v} per m² of land (whole-property value divided by land area).', { place, v: R(land.ppm[1]) }), q: ['land_ppm', 'reliable_roll'] });
  const inScope = new Set(ctx.muniSlugs), top = X.places && (X.places.top || []).find(p => inScope.has(p.muni_slug));
  if (top) out.push({ value: R(top.median, { short: true }), text: tf('{label} has the highest median freehold home value in {place}, {v}.', { label: top.label, place, v: R(top.median) }), q: ['places'] });
  return out;
}
function renderFindings(ctx) {
  const X = ctx.explore; if (!X) return hide('secFindings');
  const items = ctx.level === 'province'
    ? (X.findings || []).map(f => ({ value: findingValue(f), text: (L() === 'af' && f.af) || t(f.en), q: [f.query_id] }))
    : scopedFindings(ctx);
  if (!items.length) return hide('secFindings');
  const body = `<ol class="findings">` + items.map(f => `<li><p class="f-num">${esc(f.value)}</p><p class="f-text">${esc(f.text)}</p>` +
    how(sqlFor(X, f.q, ctx.level), '', 'Show the query') + `</li>`).join('') + `</ol>`;
  shell('secFindings', { h2: t('Notable findings'), lede: t('Figures from the rolls, each with the query that produced it.'), body,
    notes: [t('Value per m² is shown only where a roll’s land extents passed the reliability check.')] });
}

/* ---------- rail: coverage strip ---------- */
export function renderCoverage(X) {
  const el = $('coverage'); if (!el) return;
  if (!X || !X.meta) { el.hidden = true; el.innerHTML = ''; return; }
  const m = X.meta, ct = rollBySlug(X, 'city-of-cape-town'), drafts = (X.rolls || []).filter(r => r.kind === 'draft');
  const bits = [tf('Built from {n} municipal valuation rolls, with supplementary rolls for {sv} of them.', { n: m.rolls.municipalities, sv: (m.sv_municipalities || []).length })];
  if (ct) bits.push(tf('Cape Town is its {cycle} general valuation.', { cycle: cycleLabel(ct.cycle) }));
  drafts.forEach(d => bits.push(tf('{name} is a draft roll ({cycle}).', { name: tn(d.name), cycle: cycleLabel(d.cycle) })));
  bits.push(t('Sectional-title units count as properties.'));
  el.hidden = false;
  el.innerHTML = `<p>${esc(bits.join(' '))}</p><details class="how"><summary>${esc(t('Details'))}</summary><ul>` +
    (m.caveats || []).map(c => `<li>${esc(t(c))}</li>`).join('') + `</ul></details>`;
}

/* ---------- entry point ---------- */
let lastCtx = null;
// crossing the phone breakpoint re-renders the column in the other form (cards ↔ plain sections)
if (phoneMQ) { const re = () => { if (lastCtx) renderSections(lastCtx); };
  if (phoneMQ.addEventListener) phoneMQ.addEventListener('change', re); else if (phoneMQ.addListener) phoneMQ.addListener(re); }
export function renderSections(ctx) {
  lastCtx = ctx;
  renderValue(ctx);
  if (!ctx.explore) { ['secSpread', 'secMix', 'secDates', 'secFindings'].forEach(hide); return; }
  renderSpread(ctx); renderMix(ctx); renderDates(ctx); renderFindings(ctx);
}
