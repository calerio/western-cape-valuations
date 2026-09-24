/* Explore charts: pure string builders for the Explore page's inline SVG charts.
 * Each takes plain data + { width, lang } and returns markup (no d3, no DOM, no external refs),
 * so they run in node tests and render with a single innerHTML. Colours come from CSS classes
 * in assets/explore.css (tokens), never from attributes, so light/dark follow the page.
 * Numbers go through format.js; words through i18n.js (identity in English). */
import { fmtR, fmtPct, fmtN } from './format.js?v=2';
import { t, tf } from './i18n.js?v=1';

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = x => +(+x).toFixed(1);                       // one decimal, trailing zeros dropped
const clamp01 = x => Math.max(0, Math.min(1, Number.isFinite(+x) ? +x : 0));
const svgOpen = (cls, w, h, label) =>
  `<svg class="${cls}" role="img" aria-label="${esc(label)}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMinYMid meet">`;

/** Log scale: min → 0, max → width, clamped; a degenerate domain maps to the middle. */
export function scaleLog(min, max, width) {
  const a = Math.log(min), b = Math.log(max);
  if (!(min > 0) || !(max > min)) return () => width / 2;
  return v => {
    if (!(v > 0)) return 0;
    const x = (Math.log(v) - a) / (b - a) * width;
    return Math.max(0, Math.min(width, x));
  };
}

/** Share of a total as a thin bar (0–1). */
export function shareBar(share, { width = 120, lang = 'en' } = {}) {
  const ok = share != null && Number.isFinite(+share), s = clamp01(share), h = 8;
  return svgOpen('c-share', width, h, ok ? fmtPct(s, lang) : '—') +
    `<rect class="sb-track" x="0" y="0" width="${width}" height="${h}"/>` +
    `<rect class="sb-fill" x="0" y="0" width="${r1(s * width)}" height="${h}"/></svg>`;
}

/** One value as a tick on a log scale shared by every row of a table (min/max = the column's range). */
export function markerScale(value, { min, max, width = 140, lang = 'en' } = {}) {
  const h = 14, ok = value > 0;
  const x = ok ? r1(scaleLog(min, max, width - 2)(value)) : 0;
  return svgOpen('c-marker', width, h, ok ? fmtR(value, lang) : '—') +
    `<line class="ms-axis" x1="0" y1="${h / 2}" x2="${width}" y2="${h / 2}"/>` +
    (ok ? `<rect class="ms-mark" x="${x}" y="1" width="2" height="${h - 2}"/>` : '') + `</svg>`;
}

/** Log-scale histogram: bins [{lo,hi,n}], the middle-50% band (q1..q3) and p10/p50/p90 lines. */
export function logHistogram(bins, { p10, p50, p90, q1, q3, width = 820, height = 140, lang = 'en' } = {}) {
  bins = (bins || []).filter(b => b && b.lo > 0 && b.hi > b.lo);
  const top = 34, bottom = 22, plotH = Math.max(20, height - top - bottom), W = width;
  const label = bins.length
    ? tf('Histogram of property values on a log scale. Median {m}; the middle half lies between {a} and {b}.',
      { m: fmtR(p50, lang), a: fmtR(q1, lang), b: fmtR(q3, lang) })
    : t('No distribution data for this area.');
  let out = svgOpen('c-hist', W, height, label);
  if (!bins.length) return out + `</svg>`;
  const lo = bins[0].lo, hi = bins[bins.length - 1].hi, x = scaleLog(lo, hi, W);
  const maxN = Math.max(1, ...bins.map(b => +b.n || 0)), base = top + plotH;
  if (q1 > 0 && q3 > q1) out += `<rect class="band" x="${r1(x(q1))}" y="${top}" width="${r1(x(q3) - x(q1))}" height="${plotH}"/>`;
  for (const b of bins) {
    const bx = x(b.lo), bw = Math.max(0.5, x(b.hi) - bx - 1), bh = (+b.n || 0) / maxN * plotH;
    out += `<rect class="bin" x="${r1(bx)}" y="${r1(base - bh)}" width="${r1(bw)}" height="${r1(bh)}"><title>${esc(fmtR(b.lo, lang, { short: true }))} – ${esc(fmtR(b.hi, lang, { short: true }))}: ${esc(fmtN(b.n, lang))}</title></rect>`;
  }
  out += `<line class="axis" x1="0" y1="${base}" x2="${W}" y2="${base}"/>`;
  // decade ticks under the axis
  for (let p = Math.ceil(Math.log10(lo)); 10 ** p <= hi; p++) {
    const tx = r1(x(10 ** p)), anchor = tx < 20 ? 'start' : tx > W - 20 ? 'end' : 'middle';
    out += `<text class="tick" x="${tx}" y="${height - 6}" text-anchor="${anchor}">${esc(fmtR(10 ** p, lang, { short: true }))}</text>`;
  }
  // percentile lines: the median's label on the upper row, p10/p90 on the lower row
  const pl = [[p10, t('10th percentile'), 26], [p50, t('median'), 12], [p90, t('90th percentile'), 26]];
  for (const [v, name, ty] of pl) {
    if (!(v > 0)) { out += `<line class="pct" x1="0" y1="0" x2="0" y2="0" visibility="hidden"/>`; continue; }
    const px = r1(x(v)), anchor = px < 60 ? 'start' : px > W - 60 ? 'end' : 'middle';
    out += `<line class="pct" x1="${px}" y1="${ty + 3}" x2="${px}" y2="${base}"/>` +
      `<text class="pct-l" x="${px}" y="${ty}" text-anchor="${anchor}">${esc(name)} ${esc(fmtR(v, lang, { short: true }))}</text>`;
  }
  return out + `</svg>`;
}

/* The 8 category groups of explore.json (category_rule_version 8group-2026-09-23). */
export const GROUP_LABEL = {
  residential: 'Residential', business_commercial: 'Business and commercial', industrial: 'Industrial',
  agricultural: 'Agricultural', vacant: 'Vacant land', public_infrastructure: 'Public service infrastructure',
  municipal_state: 'Municipal and state', other: 'Other and uncoded',
};

/** One stacked bar of property counts by group + a legend list (order kept as given). */
export function stackedBar(groups, { width = 820, lang = 'en' } = {}) {
  groups = (groups || []).filter(g => g && g.key);
  const tot = groups.reduce((a, g) => a + (+g.n || 0), 0), h = 18;
  const label = t('Share of properties by category');
  let x = 0, bar = svgOpen('c-stack', width, h, label);
  for (const g of groups) {
    const n = +g.n || 0; if (!tot || !n) continue;
    const w = n / tot * width, name = t(GROUP_LABEL[g.key] || g.key);
    bar += `<rect class="seg g-${esc(g.key)}" data-key="${esc(g.key)}" x="${r1(x)}" y="0" width="${r1(Math.max(0, w - 1))}" height="${h}"><title>${esc(name)}: ${esc(fmtPct(n / tot, lang))}</title></rect>`;
    x += w;
  }
  bar += `</svg>`;
  const legend = `<ul class="c-legend">` + groups.map(g => {
    const n = +g.n || 0, name = t(GROUP_LABEL[g.key] || g.key);
    return `<li data-key="${esc(g.key)}"><span class="sw g-${esc(g.key)}" aria-hidden="true"></span>${esc(name)} <span class="num">${tot ? esc(fmtPct(n / tot, lang)) : '—'}</span></li>`;
  }).join('') + `</ul>`;
  return bar + legend;
}

const yearFrac = iso => {                               // '2022-07-01' → 2022.5
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); if (!m) return null;
  return +m[1] + (+m[2] - 1) / 12 + (+m[3] - 1) / 365;
};
export const fmtDate = (iso, lang = 'en') => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); if (!m) return '';
  const EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const AF = ['Jan.', 'Feb.', 'Mrt.', 'Apr.', 'Mei', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Des.'];
  return `${+m[3]} ${(lang === 'af' ? AF : EN)[+m[2] - 1]} ${m[1]}`;
};

/** One dot per roll on a from–to date axis; rolls without a date are listed below the chart. */
export function dateDots(rolls, { from = 2018, to = 2026, width = 820, lang = 'en' } = {}) {
  rolls = rolls || [];
  const dated = rolls.filter(r => yearFrac(r.valued_as_at) != null)
    .map(r => ({ ...r, y: yearFrac(r.valued_as_at) })).sort((a, b) => a.y - b.y);
  const undated = rolls.filter(r => yearFrac(r.valued_as_at) == null);
  const padL = 6, padR = 6, plotW = width - padL - padR;
  const X = y => padL + Math.max(0, Math.min(1, (y - from) / (to - from))) * plotW;
  // greedy lanes: a name goes to the first lane where it does not collide with the previous label
  const lanes = [], CH = 6.6, laneH = 20;
  for (const d of dated) {
    const x = X(d.y), w = String(d.name).length * CH + 12;
    let li = lanes.findIndex(end => end < x - 4);
    if (li < 0) { li = lanes.length; lanes.push(0); }
    lanes[li] = x + w; d.x = x; d.lane = li;
  }
  const nL = Math.max(1, lanes.length), axisY = 8 + nL * laneH + 4, height = axisY + 22;
  const label = tf('Date of valuation for {n} municipalities, {a} to {b}.', { n: dated.length, a: from, b: to });
  let out = svgOpen('c-dates', width, height, label);
  for (let yr = from; yr <= to; yr++) {
    const gx = r1(X(yr));
    out += `<line class="grid" x1="${gx}" y1="4" x2="${gx}" y2="${axisY}"/>` +
      ((yr - from) % 2 === 0 ? `<text class="tick" x="${gx}" y="${height - 6}" text-anchor="${yr === from ? 'start' : yr === to ? 'end' : 'middle'}">${yr}</text>` : '');
  }
  out += `<line class="axis" x1="${padL}" y1="${axisY}" x2="${width - padR}" y2="${axisY}"/>`;
  for (const d of dated) {
    const cy = 8 + d.lane * laneH + laneH / 2;
    out += `<g class="dot" data-slug="${esc(d.slug)}"><circle cx="${r1(d.x)}" cy="${cy}" r="4.5"><title>${esc(d.name)}: ${esc(fmtDate(d.valued_as_at, lang))}</title></circle>` +
      `<text class="dot-l" x="${r1(d.x + 8)}" y="${cy + 4}">${esc(d.name)}</text></g>`;
  }
  out += `</svg>`;
  if (undated.length) out += `<p class="c-undated">${esc(t('Date of valuation not stated in the roll:'))} ` +
    undated.map(r => `<span${r.date_note ? ` title="${esc(r.date_note)}"` : ''}>${esc(r.name)}</span>`).join(', ') + `.</p>`;
  return out;
}
