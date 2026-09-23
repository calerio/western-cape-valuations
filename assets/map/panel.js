/* Map result panel (#ppanel / #pbody): one state model → badge + heading/sub + body + "Why this result?".
 *
 * map.js decides WHAT a click resolved to (offline link decision, CoCT scheme fallback, legacy
 * heuristic, or an error) and hands a model to renderState(); everything the panel draws lives here.
 * The renderers (renderDetail/renderList/renderUnverified/renderSchemeList/renderSchemeChooser/
 * renderSchemeSum/rejectedNote/maybeInjectChooser/renderParcelChooser) moved here from map.js unchanged
 * in behaviour; the state model adds a text+glyph badge (status is never colour alone), replaces the
 * raw evidence-codes line with a plain-language disclosure that keeps the raw codes, and gives the
 * panel dialog semantics. The EN substrings asserted by the smoke matrix stay verbatim in the
 * heading/sub/note lines; badge labels are additional text.
 * Design: docs/design-2026-09/03-design-plan.md §6, 04-visual-direction.md ("Copy and chrome rules").
 *
 * model = { state, props, link?, groups?, res?, variant?, why?: reasonsCsv, overlap?: parcel features }
 *   state: 'loading' | 'unavailable' | 'integrity' | a link decision (accepted_high, accepted_group,
 *          review, ambiguous, not_in_roll, abstain, missing — with `link`) | 'scheme' (CoCT scheme
 *          layer, with `groups`) | 'heuristic' (?nolink=1 / older DB, with `res` from lookupErf)
 * renderState() returns { state, status }: the badge state actually shown and the selection status
 * ('verified' | 'possible' | 'none') for map.js setSelectionStatus().
 */
import { t, tf, tn, currentLang } from '../i18n.js?v=1';
import { getRates, computeRates } from '../rates.js?v=1';
import { loadEvidence, explain, decisionSummary } from '../evidence.js?v=1';

export const STATE_BADGES = {
  accepted_high: { glyph: '✓', label: 'Verified', tone: 'ok' },
  accepted_group: { glyph: '✓', label: 'Verified property group · sectional scheme', tone: 'ok' },
  review: { glyph: '?', label: 'Possible match', tone: 'warn' },
  ambiguous: { glyph: '≡', label: 'Several entries fit', tone: 'neutral' },
  not_in_roll: { glyph: '⊘', label: 'No valuation found', tone: 'none' },
  abstain: { glyph: '⚠', label: 'Could not link', tone: 'warn' },
  missing: { glyph: '⊘', label: 'Not in this data build', tone: 'none' },
  unavailable: { glyph: '⚠', label: 'Valuation data unavailable', tone: 'bad' },
  integrity: { glyph: '⚠', label: 'Data build could not be verified', tone: 'bad' },
  loading: { glyph: '…', label: 'Looking up valuation…', tone: 'neutral' },
};

// Hooks into map.js (parcel selection lives there): set once by map.js via configurePanel().
const ctx = {
  pickParcel: () => {},
  townOf: p => (p && p.Town_name) || '',
  parcelAreaM2: () => Infinity,
};
export function configurePanel(hooks) { Object.assign(ctx, hooks); }

loadEvidence();                       // tiny JSON; long loaded before the first DB answer arrives

// ---- tiny formatting helpers (mirrors atlas.js conventions) ----
const $ = id => document.getElementById(id);
export const N = v => Number(v).toLocaleString('en-ZA');
export const R = v => {
  if (v == null) return '—';
  // Afrikaans large-number words differ (10⁹ = miljard, not "billion") — see atlas.js R()
  const af = currentLang() === 'af', d = s => af ? s.replace('.', ',') : s;
  if (v >= 1e9) return 'R' + d((v / 1e9).toFixed(2)) + (af ? ' mjd.' : ' bn');
  if (v >= 1e6) return 'R' + d((v / 1e6).toFixed(2)) + (af ? ' mn.' : ' m');
  return 'R' + N(Math.round(v));
};
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const clWs = s => (s || '').replace(/\s+/g, ' ').trim();
// PRIVACY HOTFIX (2026-09-23, DATA_CONTRACT §7): the Matzikama roll's parsed address column can hold the
// registered owner's name (column-shifted rows). Until the corrected immutable build ships, NO Matzikama
// address is displayed — every row shows a neutral "Address unavailable". No heuristic name detection.
const ADDRESS_HIDDEN_MUNIS = new Set(['Matzikama']);
const addrHidden = muni => ADDRESS_HIDDEN_MUNIS.has(String(muni || '').trim());
const dispAddr = (r, fallback) => addrHidden(r && r.muni) ? t('Address unavailable') : (clWs(r && r.address) || fallback);
const RZA = v => 'R' + N(Math.round(v));
// Kicker lines read as a sentence ("Mbekweni, Drakenstein, ward 8"): comma-joined, and the roll's /
// cadastre's ALL-CAPS place names set in title case (mixed-case names are left alone).
const titleCase = s => /[a-z]/.test(s) ? s : s.toLowerCase().replace(/(^|[\s\-'’(/])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
const kicker = parts => parts.map(p => clWs(p == null ? '' : String(p))).filter(Boolean).map(titleCase).join(', ');
const wardPart = w => (w != null ? tf('ward {n}', { n: w }) : null);

// Verified municipal rates (rates.js + data/rates.json). Shown only when the
// municipality's official tariff is on file — no figure beats a made-up one.
let RATESDATA = null;
getRates().then(d => { RATESDATA = d; });

// Make a clickable div keyboard-operable — tabbable, role=button, Enter/Space (audit 2026-07-19).
export function wireAct(el, fn) {
  el.tabIndex = 0; el.setAttribute('role', 'button');
  el.addEventListener('click', fn);
  el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } });
}

/* ---- dialog shell ---- */

// #ppanel as a labelled, non-modal dialog with a polite status line (set once at boot; the shells'
// markup stays as is so the static /af/ pages need no regeneration). The status line sits just
// OUTSIDE the panel: a live region inside a hidden dialog is not in the accessibility tree yet when the
// panel first opens, so its first announcement would be lost. #pgrab is the phone sheet's handle
// (hidden on desktop by map.css; map.js wires the swipe gestures).
export function initPanel() {
  const p = $('ppanel');
  if (!p) return;
  p.setAttribute('role', 'dialog');
  p.setAttribute('aria-labelledby', 'pTitle');
  if (!$('pstatus')) {
    const s = document.createElement('div');
    s.id = 'pstatus'; s.className = 'vh';
    s.setAttribute('aria-live', 'polite'); s.setAttribute('role', 'status');
    p.parentNode.insertBefore(s, p);
  }
  if (!$('pgrab')) {
    const g = document.createElement('button');
    g.type = 'button'; g.id = 'pgrab';
    g.setAttribute('aria-controls', 'pbody');
    g.addEventListener('click', () => setSheet(p.dataset.sheet === 'open' ? 'peek' : 'open'));
    p.insertBefore(g, p.firstChild);
  }
  setSheet('peek');
}
// Phone bottom sheet state: 'peek' (badge, address, value) or 'open' (the whole panel, scrollable).
export function setSheet(state) {
  const p = $('ppanel'); if (!p) return;
  p.dataset.sheet = state === 'open' ? 'open' : 'peek';
  if (p.dataset.sheet === 'peek') p.scrollTop = 0;
  labelSheet();
}
// The handle's name follows the state and the language (re-run on a language switch).
export function labelSheet() {
  const p = $('ppanel'), g = $('pgrab'); if (!p || !g) return;
  const open = p.dataset.sheet === 'open';
  g.setAttribute('aria-expanded', String(open));
  g.setAttribute('aria-label', t(open ? 'Collapse' : 'Expand'));
}
// Show the panel; focus moves to its close button only when it was closed (re-renders and drill-ins
// inside an open panel never steal focus). A fresh open always starts as a peek on phones.
export function openPanel() {
  const p = $('ppanel');
  if (!p || !p.hidden) return;
  setSheet('peek');
  p.hidden = false;
  const c = $('pclose');
  if (c) c.focus({ preventScroll: true });
}

/* ---- state model ---- */

let host = null;                 // the element renderState() writes into (#pbody)
const pb = () => host || $('pbody');
let cur = null;                  // { model, state, why, overlap } of the last renderState()
let overlap = [];                // parcels under the last click (the overlap chooser)

export function lastRender() { return cur ? { model: cur.model } : null; }
export function clearRender() { cur = null; overlap = []; }

export function badgeHtml(state) {
  const b = STATE_BADGES[state];
  if (!b) return '';
  return `<span class="badge badge-${b.tone}"><span aria-hidden="true">${b.glyph}</span> ${esc(t(b.label))}</span>`;
}

// "Why this result?": the decision summary + one plain sentence per known code, then the raw codes in
// monospace (unknown codes appear only there). '' when there is nothing to explain.
export function renderDisclosure(reasonsCsv, decision) {
  const codes = String(reasonsCsv || '').split(',').map(s => s.trim()).filter(Boolean);
  const lang = currentLang();
  const plain = [decisionSummary(decision, lang), ...explain(reasonsCsv, lang).map(e => e.text)].filter(Boolean).join(' ');
  if (!codes.length && !plain) return '';
  return `<details class="why"><summary>${esc(t('Why this result?'))}</summary>` +
    (plain ? `<p>${esc(plain)}</p>` : '') +
    (codes.length ? `<code>${esc(codes.join(' · '))}</code>` : '') + '</details>';
}

// Selection status (map hatch/outline) for the state shown.
function statusFor(state, listed) {
  if (state === 'accepted_high' || state === 'accepted_group') return 'verified';
  if (state === 'review' || state === 'ambiguous' || state === 'loading') return 'possible';
  if (state === 'abstain') return listed ? 'possible' : 'none';
  return 'none';
}

export function renderState(el, model) {
  host = el || null;
  overlap = model.overlap || [];
  cur = { model, state: model.state, why: null };
  let listed = false;
  const props = model.props || {};
  switch (model.state) {
    case 'loading':
      pb().innerHTML = card(props, null, null, `<div class="pSub">${t('Looking up valuation…')}</div>`);
      break;
    case 'unavailable':
      pb().innerHTML = model.variant === 'loading'
        // the legacy heuristic's DB read failed (only reachable with ?nolink=1 or a proven older DB)
        ? card(props, null, t('The valuation database is still loading — try the parcel again in a moment.'))
        : card(props, t('Valuation data unavailable'), t('The valuation database could not be reached, so no valuation is shown rather than a guess. Try the parcel again in a moment.'));
      break;
    case 'integrity':
      pb().innerHTML = card(props, t('Not in this data build'), t('The link table in this data build could not be read — no valuation is shown rather than a guess.'));
      break;
    case 'scheme': {
      // CoCT sectional-scheme layer: independent evidence, never the offline verification → possible match
      cur.state = 'review';
      const g = model.groups || [];
      if (g.length === 1) renderSchemeList(g[0], props); else renderSchemeChooser(g, props);
      listed = true;
      break;
    }
    case 'heuristic': {
      const shown = renderHeuristic(model.res, props);
      cur.state = shown ? 'review' : 'not_in_roll';
      listed = shown;
      break;
    }
    default:
      if (model.link) {
        const r = renderLinkView(model.link, props);
        cur.state = r.state; listed = r.listed;
        cur.why = r.state === 'missing' ? null : String(model.link.reasons || '');
      } else {
        cur.state = 'missing';
        pb().innerHTML = card(props, t('Not in this data build'), null);
      }
  }
  openPanel();
  maybeInjectChooser();
  const s = $('pstatus'), b = STATE_BADGES[cur.state];
  if (s && b) s.textContent = t(b.label);
  return { state: cur.state, status: statusFor(cur.state, listed) };
}

// Kicker + "Erf n" + optional big-type title + optional note: the shape of every no-list card.
function card(props, title, note, extra = '') {
  return `<div class="pKick">${esc(kicker([props.Town_name]))}</div>` +
    `<div class="pAddr">Erf ${esc(props.TAG_VALUE || '?')}</div>` +
    (title ? `<div class="pVal" style="font-size:22px">${title}</div>` : '') + extra +
    (note ? `<div class="pNote">${note}</div>` : '');
}

/* ---- Offline parcel link table (DATA_CONTRACT §9, extract/match in the data repo) ----------
 * One explicit decision per parcel (see map.js lookupLink). What may be LISTED for an explicit
 * ambiguous/abstain/review decision (display rule, 2026-09-22): only the linker's own candidates that
 * carry positive locality or area evidence and no hard contradiction (`cands`, filtered offline). Rows
 * that share the erf number but are tied to OTHER towns are never listed — they are reported as rejected.
 * Returns the badge state actually shown (e.g. an accepted decision whose rows this DB build cannot show
 * renders as a possible match). */
function rejectedNote(link) {
  const n = link.n_rejected || 0, w = link.n_weak || 0;
  const parts = [];
  if (n) parts.push(tf('{n} roll entries with this erf number were found but rejected: their locality refers to other towns.', { n }));
  if (w) parts.push(tf('{n} further entries share the number but carry no locality or area evidence and are not shown.', { n: w }));
  return parts.join(' ');
}
function renderUnverified(props, title, note, rows, link) {
  if (rows.length) {
    renderList(rows, props, t('unverified — same erf number, with some locality or area evidence'));
    // one heading: the list's own "Erf n — k valuations" title becomes the decision's title
    const h = pb().querySelector('.pAddr');
    if (h) h.textContent = title;
  } else {
    pb().innerHTML = card(props, esc(title), null);
  }
  const rej = rejectedNote(link || {});
  pb().insertAdjacentHTML('beforeend', `<div class="pNote">${note}${rej ? ' ' + esc(rej) : ''}</div>`);
  maybeInjectChooser();
}
function renderLinkView(link, props) {
  const d = link.decision, rows = link.rows || [], cands = link.cands || [];
  if (d === 'accepted_high' && rows.length === 1) {
    renderDetail(rows[0], props, null);
    pb().insertAdjacentHTML('beforeend', `<div class="pNote">${t('Verified link: this roll entry is tied to this parcel by its town and erf number.')}</div>`);
    return { state: 'accepted_high', listed: true };
  }
  if (d === 'accepted_group' && rows.length) {
    renderList(rows, props, tf('{n} sectional-title units on this parcel (verified scheme) — list may be incomplete; no parcel valuation is implied', { n: rows.length }));
    if (link.complete) renderSchemeSum(rows);
    return { state: 'accepted_group', listed: true };
  }
  if ((d === 'review' || d === 'accepted_high' || d === 'accepted_group') && rows.length && link.show !== 0) {
    // review — or an accepted decision whose rows this DB build cannot show: a list, never a certain card
    renderList(rows, props, t('possible match — town not confirmed'));
    pb().insertAdjacentHTML('beforeend', `<div class="pNote">${t('Likely but unconfirmed: the roll entry fits the erf number, but its locality could not be tied to this SG town with certainty.')}${rejectedNote(link) ? ' ' + esc(rejectedNote(link)) : ''}</div>`);
    return { state: 'review', listed: true };
  }
  if (d === 'review') {
    // the leading row has no positive locality/area evidence of its own: nothing is listed
    renderUnverified(props, t('Could not link this parcel to the roll'),
      t('The evidence is insufficient or conflicting; no entry can be shown as a possible match.'), [], link);
    return { state: 'abstain', listed: false };
  }
  if (d === 'ambiguous') {
    renderUnverified(props, tf('Erf {erf} — several entries fit', { erf: props.TAG_VALUE || '?' }),
      t('Several roll entries fit this erf number and cannot be told apart.'), cands, link);
    return { state: 'ambiguous', listed: cands.length > 0 };
  }
  if (d === 'missing') {
    pb().innerHTML = card(props, t('Not in this data build'),
      t('This parcel is newer than, or missing from, the current link table — no valuation is shown rather than a guess.'));
    return { state: 'missing', listed: false };
  }
  if (d === 'not_in_roll') {
    pb().innerHTML = card(props, t('No valuation found'), t('Checked: the roll covers this town but has no entry for this erf.'));
    return { state: 'not_in_roll', listed: false };
  }
  renderUnverified(props, t('Could not link this parcel to the roll'),
    cands.length ? t('The evidence is insufficient or conflicting; any entries below are unverified.') : t('The evidence is insufficient or conflicting; no entry can be shown as a possible match.'), cands, link);
  return { state: 'abstain', listed: cands.length > 0 };
}

// Legacy click-time erf heuristic (only ?nolink=1 or a proven older DB): res = lookupErf() result.
// Returns true when rows are listed.
function renderHeuristic(res, props) {
  if (!res || !res.rows.length) {
    pb().innerHTML = card(props, t('No valuation found'),
      `${t('Not in the extracted rolls — possibly state land, a supplementary roll, or another town name.')}${res && res.stale ? t(' The search index is one update behind.') : ''}`);
    return false;
  }
  const sure = res.best >= 4;    // suburb-level match = genuinely this parcel's rows
  const note =
    res.best === 0 ? `<div class="pNote">${t('No town match — the same erf number exists in several municipalities; verify the address.')}</div>` :
    !sure ? `<div class="pNote">${t('Same erf number, other townships — this may not be the right parcel.')}</div>` : '';
  const listSub = sure ? t('portions or sectional-title units share this parcel')
                       : t('same erf number, other townships — may not be this parcel');
  if (res.rows.length === 1) { renderDetail(res.rows[0], props, null); }
  else { renderList(res.rows, props, listSub); }
  if (note) pb().insertAdjacentHTML('beforeend', note);
  return true;
}

/* ---- City of Cape Town sectional schemes (groups from map.js lookupSchemes) ---- */

// Sum of the unit valuations, shown ONLY when the unit set is the roll's complete set for the
// scheme (offline link with `complete`=1, or a Cape Town exact scheme-reference match, which
// returns every roll row of that reference). Always labelled as a sum of units — the erf's own
// official valuation is R0 (the roll values the units, not the land parcel).
function renderSchemeSum(rows) {
  const total = rows.reduce((s, r) => s + (r.value || 0), 0);
  const scheme = clWs(rows[0].scheme || '') || 'the scheme';
  const sub = pb().querySelector('.pSub');
  sub.insertAdjacentHTML('beforebegin',
    `<div class="pVal">${R(total)}</div>` +
    `<div class="pSub">${tf('sum of the {n} unit valuations on the roll for scheme {scheme} — not the erf’s official valuation, which is R0', { n: rows.length, scheme: esc(scheme) })}</div>`);
  sub.textContent = tf('{n} sectional-title units on this parcel', { n: rows.length });
}
function renderSchemeList(g, props) {
  // A sectional scheme is a GROUP of units. The list is the roll's complete set only when the
  // City's scheme reference matched exactly (`g.exact`); otherwise no aggregate is shown, the
  // count is stated and the list is marked possibly incomplete. A single matched unit is never
  // the parcel's value.
  const total = g.rows.reduce((s, r) => s + (r.value || 0), 0);
  const head = g.exact
    ? `<div class="pVal">${R(total)}</div><div class="pSub">${tf('sum of the {n} unit valuations on the roll for scheme {scheme} — not the erf’s official valuation, which is R0', { n: g.rows.length, scheme: esc(clWs(g.scheme)) })}</div>`
    : `<div class="pSub">${tf('{n} sectional-title units matched — list may be incomplete; no parcel valuation is implied', { n: g.rows.length })}</div>`;
  pb().innerHTML =
    `<div class="pKick">${esc(kicker([props.Town_name, wardPart(props._ward)]))}</div>` +
    `<div class="pAddr">${esc(clWs(g.scheme))}</div>` + head +
    `<div class="pNote">${t('Scheme identified from the City’s sectional-scheme layer at the click point; units matched by scheme reference or name.')}</div>` +
    g.rows.slice(0, 40).map((r, i) =>
      `<div class="pRow pPick" data-i="${i}"><span class="k">${esc(dispAddr(r, '—'))}</span>` +
      `<span class="v">${R(r.value)}</span></div>`).join('') +
    (g.rows.length > 40 ? `<div class="pNote">${tf('Showing the 40 highest of {n}.', { n: g.rows.length })}</div>` : '');
  const sub = t('sectional-title units of this scheme');
  pb().querySelectorAll('.pPick').forEach(el =>
    wireAct(el, () => renderDetail(g.rows[+el.dataset.i], props, g.rows, sub)));
  openPanel();
  maybeInjectChooser();
}

function renderSchemeChooser(groups, props) {
  pb().innerHTML =
    `<div class="pKick">${esc(kicker([props.Town_name]))}</div>` +
    `<div class="pAddr">${tf('{n} schemes match here', { n: groups.length })}</div>` +
    `<div class="pSub">${t('same scheme name registered more than once — pick the one you mean')}</div>` +
    groups.map((g, i) =>
      `<div class="pRow pPick" data-i="${i}"><span class="k">${esc(clWs(g.scheme))}</span>` +
      `<span class="v">${tf('{n} units', { n: g.rows.length })}</span></div>`).join('');
  pb().querySelectorAll('.pPick').forEach(el =>
    wireAct(el, () => renderSchemeList(groups[+el.dataset.i], props)));
  openPanel();
  maybeInjectChooser();
}

/* ---- detail card + list ---- */

function statRow(k, v) {
  return `<div class="pRow"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`;
}

function ratesNote(rr) {
  const cents = (rr.rate * 100).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return `${esc(cents)}c/R${rr.reduction ? tf(' on value above {v}', { v: RZA(rr.reduction) }) : ''}` +
         (rr.source ? ` · <a href="${esc(rr.source)}" target="_blank" rel="noopener">${t('Official tariff')} ↗</a>` : '');
}

function renderDetail(r, props, backList, backSub) {
  const ppm = r.extent && r.value ? 'R' + N(Math.round(r.value / r.extent)) + ' / m²' : '—';
  const rr = computeRates(RATESDATA, r.muni, r.category, r.tenure, r.value);
  pb().innerHTML =
    (backList ? `<div id="pback" class="pLink">${tf('← All {n} valuations on this erf', { n: backList.length })}</div>` : '') +
    `<div class="pKick">${esc(kicker([r.suburb, tn(r.muni)]))}</div>` +
    `<div class="pAddr">${esc(dispAddr(r, t('Unnamed erf')))}</div>` +
    `<div class="pVal">${R(r.value)}</div>` +
    `<div class="pSub">${t('municipal market value')}</div>` +
    statRow(t('Erf / unit'), r.erf || '—') +
    (props._ward != null ? statRow(t('Ward'), props._ward) : '') +
    statRow(t('Category'), r.category || '—') +
    statRow(t('Extent'), r.extent ? N(Math.round(r.extent)) + ' m²' : '—') +
    (r.dwext ? statRow(t('Dwelling extent'), N(Math.round(r.dwext)) + ' m²') : '') +
    statRow(t('Value per m²'), ppm) +
    (rr ? statRow(tf('Rates / year ({year})', { year: rr.year }), RZA(rr.annual)) +
          statRow(t('Rates / month'), RZA(rr.monthly)) : '') +
    `<div class="pNote">${rr ? ratesNote(rr) + ' · ' : ''}${tf("Parcel {key}. Roll valuation as at the municipality’s valuation date, set for rates — not today’s sale price.", { key: esc(props.PRCL_KEY || '') })}</div>`;
  if (backList) wireAct($('pback'), () => renderList(backList, props, backSub));
  openPanel();
  maybeInjectChooser();
}

function renderList(rows, props, subText) {
  pb().innerHTML =
    `<div class="pKick">${esc(kicker([props.Town_name, wardPart(props._ward)]))}</div>` +
    `<div class="pAddr">${tf(rows.length === 1 ? 'Erf {erf} — 1 valuation' : 'Erf {erf} — {n} valuations', { erf: esc(props.TAG_VALUE || '?'), n: rows.length })}</div>` +
    `<div class="pSub">${esc(subText || t('portions or sectional-title units share this parcel'))}</div>` +
    rows.slice(0, 40).map((r, i) =>
      `<div class="pRow pPick" data-i="${i}"><span class="k">${esc(dispAddr(r, r.erf || 'Unnamed'))}</span>` +
      `<span class="v">${R(r.value)}</span></div>`).join('') +
    (rows.length > 40 ? `<div class="pNote">${tf('Showing the 40 highest of {n}.', { n: rows.length })}</div>` : '');
  const sub = subText;
  pb().querySelectorAll('.pPick').forEach(el =>
    wireAct(el, () => renderDetail(rows[+el.dataset.i], props, rows, sub)));
  openPanel();
  maybeInjectChooser();
}

/* ---- chrome shared by every view: overlap bar, badge, title id, disclosure ---- */

// Idempotent: called by every renderer (and again by renderState once its notes are appended), so the
// overlap bar (#overlapBar) and the badge (#pBadge) are inserted exactly once, at the top, and the
// disclosure exactly once, at the end. Drill-ins (list → one entry) keep the parcel's badge and why.
function maybeInjectChooser() {
  const body = pb(); if (!body) return;
  for (const id of ['overlapBar', 'pBadge']) { const o = body.querySelector('#' + id); if (o) o.remove(); }
  const old = body.querySelector('details.why'); if (old) old.remove();
  if (cur && STATE_BADGES[cur.state]) {
    const row = document.createElement('div');
    row.id = 'pBadge'; row.className = 'pBadge';
    row.innerHTML = badgeHtml(cur.state);
    body.insertBefore(row, body.firstChild);
  }
  // When a click hit several overlapping parcels, prepend a "N parcels here" switcher to whatever the
  // panel currently shows (valuation, list, or no-match) so the user can pick a different parcel.
  if (overlap.length >= 2) {
    const bar = document.createElement('div');
    bar.id = 'overlapBar';
    bar.className = 'pLink';
    bar.textContent = tf('⇅ {n} parcels overlap here — choose', { n: overlap.length });
    wireAct(bar, renderParcelChooser);
    body.insertBefore(bar, body.firstChild);
  }
  if (cur && cur.why != null) {
    const why = renderDisclosure(cur.why, cur.state);
    if (why) body.insertAdjacentHTML('beforeend', why);
  }
  labelTitle(body);
}
// The panel's heading (first .pAddr) names the dialog (aria-labelledby="pTitle").
function labelTitle(body) {
  const old = body.querySelector('#pTitle'); if (old) old.removeAttribute('id');
  const h = body.querySelector('.pAddr'); if (h) h.id = 'pTitle';
}

function renderParcelChooser() {
  const cands = overlap;
  pb().innerHTML =
    `<div class="pKick">${t('Overlapping parcels')}</div>` +
    `<div class="pAddr">${tf('{n} parcels at this point', { n: cands.length })}</div>` +
    `<div class="pSub">${t('smallest (most specific) first — pick the one you mean')}</div>` +
    cands.map((f, i) =>
      `<div class="pRow pPick" data-i="${i}"><span class="k">${esc(kicker(['Erf ' + (f.properties.TAG_VALUE || '?'), ctx.townOf(f.properties)]))}</span>` +
      `<span class="v">${N(Math.round(ctx.parcelAreaM2(f.geometry)))} m²</span></div>`).join('');
  pb().querySelectorAll('.pPick').forEach(el =>
    wireAct(el, () => ctx.pickParcel(cands[+el.dataset.i])));
  labelTitle(pb());
  openPanel();
}
