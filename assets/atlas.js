import { getRates, computeRates } from "./rates.js?v=1";
import { t, tf, tn, loadCatalog, applyDom, setLang, onLangChange, currentLang } from "./i18n.js?v=1";
import { fmtR, fmtN } from "./format.js?v=2";
import { dur } from "./motion.js?v=1";
import { renderSections, renderCoverage } from "./explore-sections.js?v=2";

// d3 comes from the UMD bundle loaded in <head> — importing the jsdelivr +esm build
// as well would fetch the whole ~30-module d3 graph a second time (and trigger a wall
// of phantom /npm/* preload 404s against our own origin).
const d3 = window.d3;

/* ============================ config / tokens ============================ */
// The choropleth lives in the Explore rail (≈ 410 px wide), so the viewBox is rail-sized: label
// sizes in viewBox units are close to CSS px.
const W = 460, H = 360, MAXK = 46;
// design tokens (assets/tokens.css) — read once at boot
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const RAMP = [1, 2, 3, 4, 5].map(i => cssVar(`--ramp-${i}`));
const LAND = cssVar("--land"), NODATA = cssVar("--nodata");
const $ = s => document.getElementById(s);

// Make a clickable element keyboard-operable — tabbable, role, Enter/Space (audit 2026-07-19).
function wireAct(el, fn, role = "button") {
  el.tabIndex = 0; el.setAttribute("role", role);
  el.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); } });
}

/* ============================ i18n ============================ */
// Language: sticky toggle (localStorage) → device language → English, resolved by the shared
// module assets/i18n.js. The Afrikaans catalog (data/i18n-af.json) is the SAME file
// export_pages.py renders the static pages from — one source of truth. t() maps English source
// strings; tn() maps place display names (slugs, hashes and SQL filters stay English); tf()
// interpolates. The EN/AF buttons switch IN PLACE (setLang → applyDom + navigate) — no reload.
const isAF = () => currentLang() === "af";
const GUIDE = () => isAF() ? "af/gids/hoe-waardasies-werk.html" : "guide/how-valuations-work.html";

function applyStaticI18n() {
  document.documentElement.lang = currentLang();
  document.title = t("Western Cape Property Valuation Atlas — search municipal property values");
  const md = document.querySelector('meta[name="description"]');
  if (md) md.content = t("Free interactive atlas of official municipal property valuations across the Western Cape. Search any address or erf, explore districts and municipalities, see price distributions.");
  applyDom();
  const sf = $("siteFooter");
  if (sf) sf.innerHTML = `<p>${t("Public data under the Municipal Property Rates Act.")}
      <a href="${GUIDE()}">${t("How valuations work")}</a>.
      <a href="m/index.html">${t("Browse municipalities and districts")}</a>.
      <a href="map.html">${t("Satellite map")}</a>.</p>`;
  document.querySelectorAll("button[data-lang]").forEach(b =>
    b.setAttribute("aria-pressed", String(b.dataset.lang === currentLang())));
}
function wireLangToggle() {
  document.querySelectorAll("[data-lang]").forEach(a => {
    a.addEventListener("click", e => { e.preventDefault();
      if (a.dataset.lang !== currentLang()) setLang(a.dataset.lang);
    });
  });
  onLangChange(() => {
    applyStaticI18n();
    // Lighter than navigate(): re-render the text only (labels + chrome, which renders the dash),
    // so a manual pan/zoom, open search results and the panel scroll position all survive.
    if (STATS) { labels(statePath.length, statePath); renderChrome(statePath); renderCoverage(EXPLORE); }
  });
}

/* ☰ menu (#menu, a <details> holding #viewsegWrap): on phones it is a closed dropdown that closes
 * again on an outside tap or Escape; on desktop it is always open and its summary is hidden (CSS).
 * index.html closes it before first paint on phones; this keeps it right across the breakpoint. */
function wireMenu() {
  const m = $("menu"); if (!m) return;
  let mq = null; try { mq = matchMedia("(max-width: 720px)"); } catch (_) { }
  const phone = () => !!(mq && mq.matches);
  const sync = () => { m.open = !phone(); };
  if (mq) { if (mq.addEventListener) mq.addEventListener("change", sync); else if (mq.addListener) mq.addListener(sync); }
  sync();
  document.addEventListener("click", e => { if (phone() && m.open && !m.contains(e.target)) m.open = false; });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && phone() && m.open) { m.open = false; m.querySelector("summary").focus(); }
  });
}

/* Money + counts: the shared EN/AF formatter (assets/format.js) — "R850 000", "R1.25 m",
 * "R2.66 tn"; Afrikaans uses the decimal comma and mn./mjd./bilj. (same as the map page). */
const R = (v, o) => fmtR(v, currentLang(), o);
const N = v => fmtN(v, currentLang());
const norm = s => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const clAddr = s => (s || "").replace(/\s+/g, " ").trim();                 // collapse OCR padding
// PRIVACY HOTFIX (2026-09-23, DATA_CONTRACT §7): the Matzikama roll's parsed address column can hold the
// registered owner's name (column-shifted rows). Until the corrected immutable build ships, NO Matzikama
// address is displayed — every row shows a neutral "Address unavailable". No heuristic name detection.
const ADDRESS_HIDDEN_MUNIS = new Set(["Matzikama"]);
const addrHidden = muni => ADDRESS_HIDDEN_MUNIS.has(String(muni || "").trim());
const dispAddr = r => addrHidden(r && r.muni) ? t("Address unavailable") : (clAddr(r && r.address) || t("Unnamed erf"));
const clSub = s => clAddr(s).replace(/(\s+\d{3,})+$/, "");                 // strip trailing data codes

/* ============================ state ============================ */
let STATS, TOWNS, PROV, DISTF, MUNIF, EXPLORE = null;
let proj, path, gNode, gProv, gDist, gMuni, gWard, gLabel, defs, svg;
let DISTRICTS = {};            // name -> {feature, munis:[name]}
let muniByName = {};           // name -> feature
let muniSlugs = {}, distSlugs = {};   // url-slug -> name (deep-link lookup, built in buildHierarchy)
let curK = 1, statePath = [];
// slug rule shared with the static pages — keep in sync with export_pages.slugify (DATA_CONTRACT §13)
const slugOf = n => n.trim().toLowerCase().replace(/ /g, "-");
// Party colours for seat bars — keep in sync with extract/politics.py PARTY_COLOURS.
const PARTY_COLOURS = {DA:"#0071e3",ANC:"#00853f",EFF:"#e7261f","FF+":"#f39200",
  "VF Plus":"#f39200",ACDP:"#c8102e",PA:"#6a1b9a",GOOD:"#00a3a3",ASA:"#1565c0",
  Cope:"#e30613",IFP:"#e2001a","Al Jama-ah":"#2e7d32","Ind.":"#8a8f98",Independent:"#8a8f98"};
const partyColour = p => PARTY_COLOURS[p] || "#8a8f98";
let dbw = null, dbwPromise = null, areaIndex = null;

/* ============================ boot ============================ */
(async function () {
  wireMenu();
  wireLangToggle();
  await loadCatalog(currentLang());                    // EN: no fetch (the key is the text)
  applyStaticI18n();
  try {
    const exploreP = loadExplore();                    // optional: null → the page degrades to stats.json
    [STATS, TOWNS, PROV, DISTF, MUNIF, EXPLORE] = await Promise.all([
      fetch("data/stats.json").then(r => r.json()),
      fetch("data/towns.json").then(r => r.json()),
      fetch("data/geo/za-provinces.geojson").then(r => r.json()),
      fetch("data/geo/wc-districts.geojson").then(r => r.json()),
      fetch("data/geo/wc-municipalities.geojson").then(r => r.json()),
      exploreP,
    ]);
  } catch (e) {
    $("loadingMsg").textContent = t("Could not load the atlas data. Try reloading the page.");
    return;
  }
  clipMainland(); toPlanar(); buildHierarchy(); initMap();
  $("loading").style.display = "none";
  renderCoverage(EXPLORE);
  navigate(parseHash(), false);                        // deep-link boot (#m/<slug> / #d/<slug>); no hash = province
  reveal();
  addEventListener("hashchange", () => {               // manual address-bar edits; our own
    const p = parseHash();                             // replaceState updates never fire this
    if (JSON.stringify(p) !== JSON.stringify(statePath)) navigate(p);
  });
  wireSearch();
  $("findBtn").onclick = () => { const s = $("search"); scrollTo({ top: 0, behavior: dur(1) ? "smooth" : "auto" }); s.focus(); };
  let rzT; addEventListener("resize", () => { clearTimeout(rzT); rzT = setTimeout(() => navigate(statePath, false), 200); });

  // top-N properties overlay
  const cardKey = id => id === "hiCard" ? "hi" : "lo";
  ["hiCard", "loCard"].forEach(id => {
    const el = $(id);
    el.onclick = () => openTop(cardKey(id));
    el.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openTop(cardKey(id)); } };
  });
  $("tlClose").onclick = closeTop;
  $("tlScrim").onclick = closeTop;
  $("tlSeg").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; tlN = +b.dataset.n;
    [...$("tlSeg").children].forEach(x => { x.classList.toggle("on", x === b); x.setAttribute("aria-selected", String(x === b)); }); loadTop(); });
  wireTopRows();
  $("pdClose").onclick = closeProp;
  $("pdScrim").onclick = closeProp;
  trapTab($("toplist")); trapTab($("propdetail"));
  addEventListener("keydown", e => { if (e.key !== "Escape") return; if ($("propdetail").classList.contains("open")) closeProp(); else if ($("toplist").classList.contains("open")) closeTop(); });
  // The search DB is only for address search / top-N lists (never for aggregates): start it when
  // the browser is idle after first paint, or on the first search focus, whichever comes first.
  const warm = () => ensureDB().catch(() => {});
  if (typeof requestIdleCallback === "function") requestIdleCallback(warm, { timeout: 4000 }); else setTimeout(warm, 2500);
})();

/* data/explore.json: province/district/municipality statistics for the reading column.
 * Resolves null on any failure — the headline + table still render from stats.json. */
async function loadExplore() {
  try {
    const r = await fetch("data/explore.json?v=1");
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.meta && j.nodes ? j : null;
  } catch (_) { return null; }
}

/* One staged reveal on first paint (rail, then the column's sections), ≤ 8 items, 60 ms apart;
 * nothing under prefers-reduced-motion (dur() → 0). */
function reveal() {
  if (!dur(1)) return;
  const items = [...document.querySelectorAll(".rail > *:not([hidden]), .column > .sec:not([hidden])")].slice(0, 8);
  items.forEach((el, i) => {
    if (el.animate) el.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }],
      { duration: dur(320), delay: i * dur(60), easing: "ease-out", fill: "backwards" });
  });
}

const name = f => f.properties.name;

function buildHierarchy() {
  DISTF.features.forEach(f => { DISTRICTS[name(f)] = { feature: f, munis: [] }; distSlugs[slugOf(name(f))] = name(f); });
  MUNIF.features.forEach(f => {
    muniByName[name(f)] = f;
    muniSlugs[slugOf(name(f))] = name(f);
    const d = f.properties.district;
    if (DISTRICTS[d]) DISTRICTS[d].munis.push(name(f));
  });
  Object.values(DISTRICTS).forEach(d => d.munis.sort());
}

/* Deep links: #m/<slug> (municipality) and #d/<slug> (district) — the contract the static
 * /m/ and /d/ pages link with. No hash, or an unknown/malformed one, lands on the province
 * (Explore has no "South Africa" level any more: province stats show without a click). */
function parseHash() {
  const m = /^#(m|d)\/(.+)$/.exec(decodeURIComponent(location.hash || ""));
  if (!m) return [wcCrumb()];
  if (m[1] === "d") {
    const d = distSlugs[m[2]];
    return d ? [wcCrumb(), { type: "district", name: d }] : [wcCrumb()];
  }
  const mu = muniSlugs[m[2]];
  const d = mu && muniByName[mu].properties.district;
  return DISTRICTS[d] ? [wcCrumb(), { type: "district", name: d }, { type: "municipality", name: mu }] : [wcCrumb()];
}
function syncHash(p) {
  // replaceState, never pushState: navigate() also fires on resize/search/breadcrumbs, and
  // pushing would bury the back button under drill states. Views stay shareable regardless.
  const frag = p.length >= 3 ? "#m/" + slugOf(p[2].name) : p.length === 2 ? "#d/" + slugOf(p[1].name) : "";
  if (location.hash !== frag) history.replaceState(null, "", location.pathname + location.search + frag);
}

/* ============================ geometry fixes (per spec) ============================ */
function clipMainland() {
  const inM = p => p[0] >= 14 && p[0] <= 34 && p[1] <= -21 && p[1] >= -35.6;
  const keep = poly => poly[0].some(inM);
  const fix = fc => fc.features.forEach(f => { const g = f.geometry; if (!g) return;
    if (g.type === "MultiPolygon") { const k = g.coordinates.filter(keep);
      if (k.length) { if (k.length === 1) { g.type = "Polygon"; g.coordinates = k[0]; } else g.coordinates = k; } } });
  [PROV, DISTF, MUNIF].forEach(fix);
}
function planarize(fc) {   // lon/lat -> the Web-Mercator plane every layer renders in
  const conv = a => { if (typeof a[0] === "number") { const lng = a[0], lat = a[1];
      a[0] = lng * Math.PI / 180; a[1] = Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)); }
    else a.forEach(conv); };
  fc.features.forEach(f => f.geometry && conv(f.geometry.coordinates));
  return fc;
}
function toPlanar() { [PROV, DISTF, MUNIF].forEach(planarize); }
/* ============================ stats accessors (REAL data) ============================ */
const provStat = () => STATS.province;
const distStat = n => STATS.districts[n] || null;
function muniStat(n) { for (const d in STATS.districts) { const m = STATS.districts[d].municipalities[n]; if (m) return m; } return null; }
const townsOf = m => TOWNS[m] || [];
const med = s => s ? s.median : null;
const ext = arr => { const v = arr.filter(x => x != null); return v.length ? [Math.min(...v), Math.max(...v)] : [0, 1]; };
function color(v, e) { if (v == null) return NODATA; const [lo, hi] = e; const t = hi > lo ? (v - lo) / (hi - lo) : .5;
  return d3.interpolateRgbBasis(RAMP)(Math.max(0, Math.min(1, t))); }

/* ============================ map init ============================ */
function initMap() {
  proj = d3.geoIdentity().reflectY(true).fitExtent([[46, 40], [W - 46, H - 40]], PROV);
  path = d3.geoPath(proj);
  svg = d3.select("#map").append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("preserveAspectRatio", "xMidYMid meet");
  defs = svg.append("defs");
  const g = svg.append("g"); gNode = g.node();
  gNode.style.transformBox = "view-box"; gNode.style.transformOrigin = "0 0";
  gProv = g.append("g"); gDist = g.append("g"); gMuni = g.append("g"); gWard = g.append("g"); gLabel = g.append("g");
  gWard.style("pointer-events", "none");   // orientation only — hover/click stays on the municipality
  [gDist, gMuni].forEach(l => l.node().style.transition = "opacity .5s ease");

  gProv.selectAll("path").data(PROV.features).join("path")
    .attr("d", path)
    .attr("fill", d => name(d) === "Western Cape" ? "none" : LAND)
    .attr("stroke", d => name(d) === "Western Cape" ? cssVar("--map-outline") : "none")
    .attr("stroke-width", 1.1).attr("vector-effect", "non-scaling-stroke")
    .attr("class", d => name(d) === "Western Cape" ? "o-clickable o-wc" : "o-other")
    .each(function (d) { if (name(d) === "Western Cape") d3.select(this)
      .on("click", () => navigate([wcCrumb()]))
      .on("mouseenter mousemove", e => tip(e, tn("Western Cape"), provStat(), true))
      .on("mouseleave", tipHide); });
  $("legendBar").innerHTML = RAMP.map(c => `<i style="background:${c}"></i>`).join("");
  drawLocator();
}
/* South Africa locator (decorative, aria-hidden): the provinces at 120×90 with the Western Cape
 * inked. Reuses the already-loaded provinces GeoJSON (Task 12 swaps in a simplified outline). */
function drawLocator() {
  const el = $("saLocator"); if (!el) return;
  const lp = d3.geoPath(d3.geoIdentity().reflectY(true).fitExtent([[2, 2], [118, 88]], PROV));
  el.innerHTML = PROV.features.map(f => `<path class="${name(f) === "Western Cape" ? "loc-wc" : "loc-za"}" d="${lp(f)}"/>`).join("");
}
const wcCrumb = () => ({ type: "province", name: "Western Cape" });

/* ============================ draw layers ============================ */
let distDrawn = false, muniDistrict = null;

function drawDistricts() {
  if (distDrawn) return; distDrawn = true;
  const e = ext(Object.keys(DISTRICTS).map(d => med(distStat(d))));
  gDist.selectAll("path").data(DISTF.features).join("path")
    .attr("d", path)
    .attr("fill", d => color(med(distStat(name(d))), e))
    .attr("stroke", cssVar("--map-stroke")).attr("stroke-width", 1.1).attr("vector-effect", "non-scaling-stroke")
    .attr("class", "o-clickable")
    .on("click", (ev, d) => navigate([wcCrumb(), { type: "district", name: name(d) }]))
    .on("mouseenter mousemove", (ev, d) => tip(ev, tn(name(d)), distStat(name(d)), true))
    .on("mouseleave", tipHide);
}
// Municipalities of one district, or (district = null) all 25 for the province-level choropleth.
const ALL = "__all__";
const scopeMunis = district => district ? DISTRICTS[district].munis : Object.values(DISTRICTS).flatMap(d => d.munis);
function drawMunis(district) {
  const key = district || ALL;
  if (muniDistrict === key) return; muniDistrict = key;
  const munis = scopeMunis(district);
  const e = ext(munis.map(m => med(muniStat(m))));
  gMuni.selectAll("path").data(munis.map(m => muniByName[m]).filter(Boolean), d => name(d)).join("path")
    .attr("d", path)
    .attr("fill", d => color(med(muniStat(name(d))), e))
    .attr("stroke", cssVar("--map-stroke")).attr("stroke-width", 1).attr("vector-effect", "non-scaling-stroke")
    .attr("class", "o-clickable")
    .on("click", (ev, d) => navigate([wcCrumb(), { type: "district", name: d.properties.district }, { type: "municipality", name: name(d) }]))
    .on("mouseenter mousemove", (ev, d) => tip(ev, tn(name(d)), muniStat(name(d)), true))
    .on("mouseleave", tipHide);
}
/* Ward boundaries (Municipal Demarcation Board, current delimitation) — shown as an
 * orientation overlay when drilled into a municipality. The ~1 MB GeoJSON is fetched
 * lazily on the FIRST municipality drill and cached; fetch failure just means no
 * ward lines (degrade quietly, per the data contract). */
let wardsPromise = null;
const fetchWards = () => wardsPromise ||
  (wardsPromise = fetch("data/geo/wc-wards.geojson").then(r => r.json()).then(planarize)
    .catch(e => { console.warn("wards unavailable", e); return { features: [] }; }));

async function drawWards(muni) {
  const gj = await fetchWards();
  // a slow fetch may resolve after the user has drilled elsewhere — recheck state
  if (!(statePath.length === 3 && statePath[2].name === muni)) return;
  const feats = gj.features.filter(f => f.properties.muni === muni);
  const k = curK;
  // paper-white like the muni borders — the choropleth fill underneath can be
  // near-black green, so a dark stroke would vanish; dashing tells wards apart.
  gWard.selectAll("path").data(feats, f => f.properties.ward_id).join("path")
    .attr("d", path)
    .attr("fill", "none")
    .attr("stroke", cssVar("--map-stroke")).attr("stroke-opacity", .7)
    .attr("stroke-width", 0.8).attr("vector-effect", "non-scaling-stroke")
    .attr("stroke-dasharray", `${4 / k} ${3 / k}`);
  gWard.selectAll("text").data(feats, f => f.properties.ward_id).join("text")
    .attr("x", f => path.centroid(f)[0]).attr("y", f => path.centroid(f)[1])
    .attr("text-anchor", "middle").attr("dy", ".32em")
    .attr("fill", cssVar("--map-outline")).attr("fill-opacity", .8)
    .attr("stroke", cssVar("--map-halo")).attr("stroke-width", 2.5 / k).attr("paint-order", "stroke")
    .style("font-weight", 600).style("font-size", 9 / k + "px")
    .text(f => f.properties.ward);
}
const clearWards = () => gWard.selectAll("*").remove();

function setLayers(len) {
  gProv.style("opacity", 0.5).style("pointer-events", "none");
  const set = (g, on, dim) => g.style("display", dim ? "block" : "none").style("opacity", on ? 1 : 0.16).style("pointer-events", on ? "auto" : "none");
  set(gDist, false, len >= 2);                        // other districts stay as faint context once drilled
  set(gMuni, true, true);                             // province: all 25; district/municipality: the district's
}

/* ============================ zoom (CSS transform) ============================ */
function zoom(feats, animate) {
  let b = null; feats.forEach(f => { const bb = path.bounds(f); b = b ? [[Math.min(b[0][0], bb[0][0]), Math.min(b[0][1], bb[0][1])], [Math.max(b[1][0], bb[1][0]), Math.max(b[1][1], bb[1][1])]] : bb; });
  const dx = b[1][0] - b[0][0], dy = b[1][1] - b[0][1], cx = (b[0][0] + b[1][0]) / 2, cy = (b[0][1] + b[1][1]) / 2;
  const rv = 0;                                            // the map has its own box in the rail now
  const k = Math.min(MAXK, 0.84 / Math.max(dx / (W - rv), dy / H));
  curK = k;
  gNode.style.transition = animate ? "transform .95s cubic-bezier(.4,0,.2,1)" : "none";
  gNode.style.transform = `translate(${(W + rv) / 2 - k * cx}px,${H / 2 - k * cy}px) scale(${k})`;
}

/* ============================ label placement ============================ */
/* Pole of inaccessibility (adapted from Mapbox polylabel, ISC-licensed): the
 * interior point farthest from every edge. Used instead of the geometric centroid,
 * which drifts outside concave shapes — so "City of Cape Town" no longer floats over
 * the bay and district names sit in the visual centre rather than on a border.
 * Runs in projected pixel space (same units as path.centroid), once per navigation. */
function segDistSq(px, py, a, b) {
  let x = a[0], y = a[1], dx = b[0] - x, dy = b[1] - y;
  if (dx || dy) { const t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) { x = b[0]; y = b[1]; } else if (t > 0) { x += dx * t; y += dy * t; } }
  dx = px - x; dy = py - y; return dx * dx + dy * dy;
}
// signed distance from (x,y) to the polygon (rings): positive inside, negative outside
function pointToPolyDist(x, y, rings) {
  let inside = false, minSq = Infinity;
  for (const ring of rings)
    for (let i = 0, len = ring.length, j = len - 1; i < len; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
      minSq = Math.min(minSq, segDistSq(x, y, a, b));
    }
  return (inside ? 1 : -1) * Math.sqrt(minSq);
}
function polyCell(x, y, h, rings) { const d = pointToPolyDist(x, y, rings); return { x, y, h, d, max: d + h * Math.SQRT2 }; }
function centroidCell(rings) {
  let area = 0, x = 0, y = 0, r = rings[0];
  for (let i = 0, len = r.length, j = len - 1; i < len; j = i++) {
    const a = r[i], b = r[j], f = a[0] * b[1] - b[0] * a[1]; x += (a[0] + b[0]) * f; y += (a[1] + b[1]) * f; area += f * 3;
  }
  return area ? polyCell(x / area, y / area, 0, rings) : polyCell(r[0][0], r[0][1], 0, rings);
}
function polylabel(rings, precision) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pt of rings[0]) { if (pt[0] < minX) minX = pt[0]; if (pt[1] < minY) minY = pt[1]; if (pt[0] > maxX) maxX = pt[0]; if (pt[1] > maxY) maxY = pt[1]; }
  const width = maxX - minX, height = maxY - minY, cellSize = Math.min(width, height);
  if (!cellSize) return [minX, minY];
  const h = cellSize / 2, heap = [];                      // binary max-heap keyed on cell.max
  const swap = (i, j) => { const t = heap[i]; heap[i] = heap[j]; heap[j] = t; };
  const push = c => { heap.push(c); let i = heap.length - 1; while (i > 0) { const par = (i - 1) >> 1; if (heap[par].max >= heap[i].max) break; swap(par, i); i = par; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let big = i; if (l < heap.length && heap[l].max > heap[big].max) big = l; if (r < heap.length && heap[r].max > heap[big].max) big = r; if (big === i) break; swap(big, i); i = big; } } return top; };
  for (let x = minX; x < maxX; x += cellSize) for (let y = minY; y < maxY; y += cellSize) push(polyCell(x + h, y + h, h, rings));
  let best = polyCell(minX + width / 2, minY + height / 2, 0, rings);
  const cen = centroidCell(rings); if (cen.d > best.d) best = cen;
  while (heap.length) {
    const c = pop();
    if (c.d > best.d) best = c;
    if (c.max - best.d <= precision) continue;
    const hh = c.h / 2;
    push(polyCell(c.x - hh, c.y - hh, hh, rings)); push(polyCell(c.x + hh, c.y - hh, hh, rings));
    push(polyCell(c.x - hh, c.y + hh, hh, rings)); push(polyCell(c.x + hh, c.y + hh, hh, rings));
  }
  return [best.x, best.y];
}
const ringAbsArea = r => { let a = 0; for (let i = 0, len = r.length, j = len - 1; i < len; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return Math.abs(a); };
// projected-pixel label anchor for a feature (largest ring of a MultiPolygon)
function labelPoint(f) {
  const g = f && f.geometry; if (!g) return path.centroid(f);
  const proj1 = ring => ring.map(pt => proj(pt));
  let poly;                                                // GeoJSON coords are pre-planarized; uniform proj preserves area order
  if (g.type === "Polygon") poly = g.coordinates;
  else if (g.type === "MultiPolygon") { let ba = -1; for (const pl of g.coordinates) { const a = ringAbsArea(pl[0]); if (a > ba) { ba = a; poly = pl; } } }
  if (!poly || !poly.length) return path.centroid(f);
  const rings = poly.map(proj1);
  if (!rings[0] || !rings[0].length) return path.centroid(f);
  try { return polylabel(rings, 0.6); } catch (_) { return path.centroid(f); }
}

/* ============================ labels ============================ */
function labels(len, p) {
  gLabel.selectAll("*").remove();
  let items = [];
  const mk = (t, f, extra) => { const c = labelPoint(f); return Object.assign({ t, x: c[0], y: c[1], f }, extra || {}); };
  if (len <= 2) items = scopeMunis(len === 2 ? p[1].name : null).map(m => muniByName[m]).filter(Boolean).map(f => mk(tn(name(f)), f));
  else { const f = muniByName[p[2].name]; if (f) items = [mk(tn(name(f)), f)]; }
  const k = curK, baseFs = (len <= 1 ? 9.5 : 11) / k;
  // Apple-map cartographic type: SF Pro (via --font-map), lighter weights, a soft
  // white halo carrying legibility over the dark end of the choropleth.
  const sel = gLabel.selectAll("text").data(items).join("text")
    .attr("x", d => d.x).attr("y", d => d.y).attr("text-anchor", "middle").attr("dy", ".32em")
    .attr("fill", cssVar("--map-outline"))
    .attr("stroke", cssVar("--map-halo")).attr("stroke-width", 3.2 / k).attr("paint-order", "stroke")
    .attr("letter-spacing", d => d.wc ? (1.6 / k) + "px" : (0.1 / k) + "px")
    .style("font-weight", d => d.wc ? 600 : 500).style("font-size", baseFs + "px")
    .style("opacity", d => d.wc ? .92 : .88).text(d => d.t);
  // Fit-to-region: shrink any name wider than its own shape so it never spills across a
  // border (region width and text length are both in viewBox units → directly comparable).
  // Floored at 68%; on the crowded province view a name that still does not fit is left out
  // (the tooltip and the table carry every name).
  sel.each(function (d) {
    const b = path.bounds(d.f), regionW = (b[1][0] - b[0][0]) * (d.wc ? 1 : 0.92), tl = this.getComputedTextLength();
    if (regionW > 0 && tl > regionW) {
      if (len <= 1 && baseFs * regionW / tl < baseFs * 0.68) { this.style.display = "none"; return; }
      this.style.fontSize = Math.max(baseFs * 0.68, baseFs * regionW / tl) + "px";
    }
  });
}

/* ============================ tooltip ============================ */
// B3 fix: the element is tipEl — naming it `t` shadowed the i18n t() and threw on every hover.
function tip(e, nm, st, drill) { if (innerWidth <= 720) return;   // phones: tap drills in, no off-screen tooltip
  const tipEl = $("tip");
  tipEl.innerHTML = `<div class="tip-name">${esc(nm)}</div>` +
    (st ? `<dl class="tip-grid">` +
      `<dt>${t("Median")}</dt><dd>${R(st.median)}</dd>` +
      `<dt>${t("Total roll")}</dt><dd>${R(st.total)}</dd>` +
      `<dt>${t("Properties")}</dt><dd>${N(st.properties || st.valued)}</dd></dl>`
      : `<div class="tip-none">${t("No public roll (search-only)")}</div>`) +
    (drill && st ? `<div class="tip-go">${t("Click to open")}</div>` : "");
  tipEl.style.opacity = 1;
  let x = e.clientX + 16, y = e.clientY + 16;
  if (x + 250 > innerWidth) x = e.clientX - 250; if (y + 130 > innerHeight) y = e.clientY - 130;
  tipEl.style.left = x + "px"; tipEl.style.top = y + "px";
}
const tipHide = () => $("tip").style.opacity = 0;

/* ============================ valuation-provenance popover ============================ */
// "How was this valued?" — a hover / focus / tap card on the municipality roll date, built
// entirely from scope.provenance (backbone facts from the roll + any authored note). When a
// municipality has no provenance the trigger isn't rendered, so this degrades to a plain date.
const KIND_LABEL = { general: "General valuation roll", supplementary: "Supplementary valuation roll", draft: "Draft valuation roll" };
let provTimer = null;
function provEl() {
  let el = $("provPop");
  if (!el) {
    el = document.createElement("div"); el.id = "provPop"; el.className = "platter"; el.setAttribute("role", "tooltip");
    el.addEventListener("mouseenter", () => clearTimeout(provTimer));   // hover-bridge: keep open while the pointer is on the card
    el.addEventListener("mouseleave", hideProv);
    document.body.appendChild(el);
    // tap / click outside closes it (mobile has no hover to close on)
    document.addEventListener("click", e => { if (!e.target.closest(".rollprov,#provPop")) el.classList.remove("on"); });
  }
  return el;
}
function provInner(p) {
  const rows = [];
  if (p.valued_as_at) rows.push([t("Values as at"), esc(p.valued_as_at)]);
  if (p.cycle) rows.push([t("Rating cycle"), esc(String(p.cycle).replace("-draft", t(" · draft")))]);
  if (p.properties != null) rows.push([t("Properties valued"), N(p.properties)]);
  if (p.coverage) rows.push([t("Coverage"), esc(p.coverage)]);
  return `<div class="ppTitle">${t(KIND_LABEL[p.kind] || "Valuation roll")}</div>` +
    `<div class="ppGrid">` + rows.map(([k, v]) => `<span class="ppK">${k}</span><span class="ppV">${v}</span>`).join("") + `</div>` +
    (p.note ? `<div class="ppNote">${esc(t(p.note))}</div>` : "") +
    // fixed caveat, every municipality: roll values are rating valuations, not sale prices
    `<div class="ppNote">${t("Values are the municipal valuer’s market value as at the date above, set for rates — a property can sell for more or less today.")}</div>` +
    (p.source_url ? `<div class="ppSrc"><a href="${esc(p.source_url)}" target="_blank" rel="noopener">${t("Official source")} ↗</a></div>` : "");
}
function showProv(trigger, p) {
  clearTimeout(provTimer);
  const el = provEl(); el.innerHTML = provInner(p);
  const r = trigger.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;   // measurable while visibility:hidden
  const x = Math.min(Math.max(12, r.left), innerWidth - 12 - w);
  let y = r.bottom + 8; if (y + h > innerHeight - 12) y = r.top - 8 - h;                 // flip above if it would overflow
  el.style.left = Math.round(x) + "px"; el.style.top = Math.round(Math.max(12, y)) + "px";
  el.classList.add("on");
}
function hideProv() { clearTimeout(provTimer); provTimer = setTimeout(() => { const el = $("provPop"); if (el) el.classList.remove("on"); }, 90); }
const provOff = () => { const el = $("provPop"); if (el) el.classList.remove("on"); };
function wireProv(trigger, p) {
  trigger.addEventListener("mouseenter", () => showProv(trigger, p));
  trigger.addEventListener("mouseleave", hideProv);
  trigger.addEventListener("focus", () => showProv(trigger, p));
  trigger.addEventListener("blur", hideProv);
  trigger.addEventListener("click", e => { e.stopPropagation(); const el = $("provPop"); el && el.classList.contains("on") ? provOff() : showProv(trigger, p); });
  trigger.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); showProv(trigger, p); } else if (e.key === "Escape") provOff(); });
}

/* ============================ navigation ============================ */
function navigate(p, animate = true) {
  if (!p || !p.length) p = [wcCrumb()];                 // no level 0: the province is the landing view
  statePath = p; const len = p.length;
  drawMunis(len >= 2 ? p[1].name : null);
  drawDistricts();
  setLayers(len);
  let feats = len === 1 ? [PROV.features.find(f => name(f) === "Western Cape")]
    : len === 2 ? [DISTRICTS[p[1].name].feature] : [muniByName[p[2].name]].filter(Boolean);
  if (!feats.length) feats = [PROV.features.find(f => name(f) === "Western Cape")];
  zoom(feats, animate && dur(1) > 0);
  if (len === 3) drawWards(p[2].name); else clearWards();
  labels(len, p);
  hideResults(); tipHide();
  renderChrome(p);
  syncHash(p);
  if (animate && scrollY > 0) scrollTo({ top: 0, behavior: dur(1) ? "smooth" : "auto" });   // a drill starts at the top
}

/* ============================ chrome + dashboard ============================ */
const cycleLabel = c => String(c || "").replace("-draft", " " + t("draft")).replace(/(\d{4})-(\d{4})/, "$1–$2");
function renderChrome(p) {
  const len = p.length;
  // breadcrumb: Western Cape › district › municipality (metro: the district and municipality share a name)
  const steps = [{ label: tn("Western Cape"), path: [wcCrumb()] }];
  if (len >= 2) steps.push({ label: tn(p[1].name), path: [wcCrumb(), p[1]] });
  if (len >= 3) { if (p[2].name === p[1].name) steps.pop(); steps.push({ label: tn(p[2].name), path: p }); }
  const cr = $("crumbs"); cr.hidden = len === 1; cr.innerHTML = "";
  steps.forEach((s, i) => {
    const last = i === steps.length - 1;
    const a = document.createElement(last ? "span" : "a");
    a.textContent = s.label;
    if (last) a.setAttribute("aria-current", "page");
    else { a.href = s.path.length === 1 ? "#" : "#d/" + slugOf(s.path[1].name); a.onclick = e => { e.preventDefault(); navigate(s.path); }; }
    cr.appendChild(a);
  });

  // legend: the choropleth shades municipalities at province + district level; a single
  // municipality (ward outlines only) has no value shading, so no legend.
  const lb = $("legendBox");
  lb.hidden = len >= 3;
  if (len < 3) { const e = ext(scopeMunis(len === 2 ? p[1].name : null).map(m => med(muniStat(m))));
    $("legendTitle").textContent = t("Median value by municipality");
    $("legendMin").textContent = R(e[0], { short: true }); $("legendMax").textContent = R(e[1], { short: true }); }

  // Explore → map carries the municipality (#m/<slug>; the map page fits its camera to it)
  const frag = len >= 3 ? "#m/" + slugOf(p[2].name) : "";
  document.querySelectorAll('a[data-maplink]').forEach(a => { a.href = a.dataset.maplink + frag; });

  renderDash(p);
}

// The municipalities' dates of valuation. One source per page: once explore.json has loaded its
// `dates` are the only source (a null there means the roll does not state its date, as #secDates
// says); the stats.json provenance text is used only in degraded mode, when explore.json is absent
// or lists no roll for the municipality.
function datesFor(munis) {
  // same lookup as #secDates (explore-sections.js renderDates): dates entry, else the rolls entry
  const entry = s => EXPLORE && ((EXPLORE.dates || []).find(x => x.slug === s) || (EXPLORE.rolls || []).find(x => x.slug === s));
  return munis.map(m => { const d = entry(slugOf(m));
    if (d) return { iso: d.valued_as_at || null, year: d.valued_as_at ? +d.valued_as_at.slice(0, 4) : null, text: null };
    const pv = (muniStat(m) || {}).provenance;
    return { iso: null, year: pv && /\d{4}/.test(pv.valued_as_at || "") ? +/\d{4}/.exec(pv.valued_as_at)[0] : null, text: pv && pv.valued_as_at }; });
}
const fmtIso = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ""); if (!m) return "";
  const MON = isAF() ? ["Januarie", "Februarie", "Maart", "April", "Mei", "Junie", "Julie", "Augustus", "September", "Oktober", "November", "Desember"]
    : ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${+m[3]} ${MON[+m[2] - 1]} ${m[1]}`; };

function renderDash(p) {
  const len = p.length, isMuni = len >= 3;
  let scope, scopeName, level, munis;
  if (len === 1) { scope = provStat(); scopeName = "Western Cape"; level = "province"; munis = scopeMunis(null); }
  else if (len === 2) { scope = distStat(p[1].name); scopeName = p[1].name; level = "district"; munis = DISTRICTS[p[1].name].munis; }
  else { scope = muniStat(p[2].name); scopeName = p[2].name; level = "municipality"; munis = [p[2].name]; }
  const node = level === "province" ? "province" : (level === "district" ? "d:" : "m:") + slugOf(scopeName);
  const children = isMuni ? [] : munis.map(m => ({ name: m, slug: slugOf(m), stat: muniStat(m) }));

  $("scopeLabel").textContent = tn(scopeName);
  provOff();   // dismiss any open provenance popover from the previous view
  const sub = $("scopeSub");
  if (!scope) sub.textContent = t("No public valuation roll");
  else if (isMuni) {
    // one plain sentence; the cycle opens "how was this valued?" when the roll has provenance
    const cyc = cycleLabel(scope.cycle), [a, b] = t("Valued for the {cycle} rating cycle, on the municipality’s own roll.").split("{cycle}");
    if (scope.provenance && b != null) {
      sub.innerHTML = `${esc(a)}<span class="rollprov" tabindex="0" role="button" aria-label="${esc(t("How this municipality's values were determined"))}">${esc(cyc)}<span class="provi" aria-hidden="true">ⓘ</span></span>${esc(b)}`;
      wireProv(sub.querySelector(".rollprov"), scope.provenance);
    } else sub.textContent = tf("Valued for the {cycle} rating cycle, on the municipality’s own roll.", { cycle: cyc });
  } else {
    const nk = children.filter(c => c.stat).length;
    sub.textContent = tf(nk === 1 ? "{n} municipality and {p} properties on its valuation roll." : "{n} municipalities and {p} properties on their valuation rolls.",
      { n: nk, p: N(scope.properties) });
  }
  $("statTotal").textContent = scope ? R(scope.total) : "—";
  $("statMedian").textContent = scope ? R(scope.median, { short: true }) : "—";
  $("statAvg").textContent = scope ? R(scope.mean ?? scope.avg, { short: true }) : "—";
  $("statParcels").textContent = scope ? N(scope.properties || scope.valued) : "—";
  const ds = datesFor(munis), years = ds.map(d => d.year).filter(Boolean);
  $("statDates").textContent = isMuni
    ? (ds[0].iso ? fmtIso(ds[0].iso) : ds[0].text || t("Not stated"))
    : years.length ? (Math.min(...years) === Math.max(...years) ? String(years[0]) : `${Math.min(...years)}–${Math.max(...years)}`) : "—";
  $("statDatesLab").textContent = t(isMuni ? "Date of valuation" : "Dates of valuation");

  renderSections({ level, node, name: scopeName, slug: slugOf(scopeName), stat: scope, children,
    towns: isMuni ? townsOf(scopeName) : null, muniSlugs: munis.map(slugOf), explore: EXPLORE });

  fillProp("hi", scope && scope.hi);
  fillProp("lo", scope && scope.lo);
  tlEnabled = !!scope;
  ["hiCard", "loCard"].forEach(id => { const el = $(id); if (el) el.classList.toggle("off", !scope); });
  // roll ≠ market price: rolls state "market value" as at the valuation date, for rating purposes —
  // an area's values can sit well off today's sale prices. Said once, wherever values are shown.
  const CAVEAT = t(" Values are municipal valuations as at each roll’s date — set for rates, not today’s sale prices.");
  $("dashNote").textContent = !scope
    ? t("No aggregated data is available for this area yet.")
    : (isMuni
    ? t("Dashed lines on the map are ward boundaries (Municipal Demarcation Board), for orientation.")
    : t("Recomputed from each area's latest published valuation roll.")) + CAVEAT;

  // the municipality's own blocks (each auto-hides when its data is absent)
  renderStanding(p, scope, isMuni);
  renderGrowth(scope);
  renderAfford(scope);
  renderQuality(scope);
  renderAuthorities(scope);
  renderPolitics(scope);
}

function fillProp(id, pr) {
  if (!pr) { $(id + "Addr").textContent = "—"; $(id + "Sub").textContent = ""; $(id + "Val").textContent = ""; $(id + "Meta").textContent = ""; return; }
  $(id + "Addr").textContent = dispAddr(pr);
  $(id + "Sub").textContent = [pr.suburb && clSub(pr.suburb), tn(pr.muni)].filter(Boolean).join(", ");
  $(id + "Val").textContent = R(pr.value);
  $(id + "Meta").textContent = pr.extent ? tf("{m2} m², R{ppm} per m²", { m2: N(pr.extent), ppm: N(Math.round(pr.value / pr.extent)) }) : t("extent n/a");
}

const CATLAB = { res: "Residential", com: "Business", agri: "Agricultural", state: "State / municipal", vacant: "Vacant", other: "Other" };
const CATORDER = ["res", "com", "agri", "state", "vacant", "other"];

/* ============================ richer place-panel sections (M5) ============================ */
// The municipality's own blocks below the Explore sections: .stile tiles and hairline rows
// (restyled flat in explore.css); each auto-hides its whole section when the data is absent.
function showSec(id, on) { const el = $(id); if (el) el.style.display = on ? "block" : "none"; return on; }
// value `v` is escaped (safe by default)
const tilesHTML = tiles => `<div class="statgrid">` + tiles.map(([l, v, n]) =>
  `<div class="stile"><div class="stl">${esc(l)}</div><div class="stv">${esc(v)}</div><div class="stn">${esc(n || "")}</div></div>`).join("") + `</div>`;
// hairline label→value row; `v` is raw HTML (caller escapes any user-derived text)
const hairRow = (l, v) => `<div style="display:flex;justify-content:space-between;gap:14px;padding:12px 0;border-bottom:1px solid var(--sep);font-size:14px">` +
  `<span style="color:var(--ink2)">${esc(l)}</span><span style="font-variant-numeric:tabular-nums;text-align:right">${v}</span></div>`;
// left-aligned label→value row for PROSE (authorities); label fixed-width, value wraps left
const aRow = (l, v) => `<div style="display:flex;gap:14px;padding:11px 0;border-bottom:1px solid var(--sep);font-size:14px">` +
  `<span style="flex:0 0 132px;color:var(--ink2)">${esc(l)}</span><span style="flex:1;min-width:0">${v}</span></div>`;

// Standing — this municipality's rank within its district + biggest suburb / category by value
function renderStanding(p, s, isMuni) {
  if (!showSec("secStanding", !!(isMuni && s && p.length >= 3))) return;
  const muni = p[2].name, dist = p[1].name;
  const sibs = DISTRICTS[dist] ? DISTRICTS[dist].munis.map(muniStat).filter(Boolean) : [];
  // all WC municipalities with a stats node — the province-wide rank next to the district one
  const wc = Object.values(STATS.districts).flatMap(d => Object.values(d.municipalities || {}));
  const rankIn = (pool, key) => { const mine = s[key]; if (mine == null) return null;
    const vals = pool.map(x => x[key]).filter(v => v != null); if (vals.length < 2) return null;
    return tf("#{rank} of {n}", { rank: vals.filter(v => v > mine).length + 1, n: vals.length }); };
  const rankOf = key => { const d = rankIn(sibs, key); if (!d) return null;
    const w = rankIn(wc, key); return d + (w ? ` <span style="color:var(--label2)">· ${t("WC")} ${w}</span>` : ""); };
  const rows = [];
  const add = (l, key) => { const r = rankOf(key); if (r) rows.push([l, r]); };
  add(t("Median value"), "median"); add(t("Total roll value"), "total");
  if (s.ppm_median != null) add(t("Home price per m²"), "ppm_median");
  if (s.vacant_share != null) add(t("Vacant-land share"), "vacant_share");
  let topTown = null; townsOf(muni).forEach(t => { if (!topTown || t.total > topTown.total) topTown = t; });
  let topCat = null; if (s.cat_mix) CATORDER.forEach(k => { const c = s.cat_mix[k]; if (c && c.value > 0 && (!topCat || c.value > topCat.value)) topCat = { k, value: c.value }; });
  let html = `<div style="font-size:12px;color:var(--label2);margin-bottom:6px">${tf("Rank among the {n} municipalities in {district} · then all {m} in the Western Cape", { n: sibs.length, district: esc(tn(dist)), m: wc.filter(x => x.median != null).length })}</div>`;
  html += rows.map(([l, v]) => hairRow(l, v)).join("");
  if (topTown) html += hairRow(t("Biggest suburb by value"), esc(topTown.name) + " · " + R(topTown.total));
  if (topCat) html += hairRow(t("Largest category by value"), t(CATLAB[topCat.k]) + " · " + R(topCat.value));
  $("secStandingBody").innerHTML = html;
}

// Change over time — growth + CAGR vs the previous roll (absent until a 2nd roll exists → hidden)
function renderGrowth(s) {
  const on = !!(s && (s.median_growth != null || s.total_growth != null || s.res_median_growth != null || s.cagr != null));
  if (!showSec("secGrowth", on)) return;
  const pct = v => (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%";
  const col = v => v >= 0 ? "var(--ok)" : "var(--bad)";
  const gt = (l, v, n) => v == null ? "" :
    `<div class="stile"><div class="stl">${esc(l)}</div><div class="stv" style="color:${col(v)}">${pct(v)}</div><div class="stn">${esc(n || "")}</div></div>`;
  const since = s.growth_from ? tf("since the {cycle} roll", { cycle: s.growth_from }) : t("since the previous roll");
  $("secGrowthBody").innerHTML = `<div style="font-size:12px;color:var(--label2);margin-bottom:16px">${esc(since)}</div>` +
    `<div class="statgrid">` + gt(t("Median value"), s.median_growth) + gt(t("Total roll value"), s.total_growth) +
    gt(t("Residential median"), s.res_median_growth) + gt(t("Annualised · CAGR"), s.cagr, t("compound, per year")) + `</div>`;
}

// Affordability — estimated monthly bond + income needed for the median home (clearly an estimate)
function renderAfford(s) {
  const prime = RATESDATA && RATESDATA.prime_rate;
  const home = s && (s.res_median || s.median);
  if (!showSec("secAfford", !!(prime && prime.pct > 0 && home > 0))) return;
  const r = prime.pct / 100 / 12, n = 240;
  const monthly = home * r / (1 - Math.pow(1 + r, -n));   // 20-yr bond, full value, at prime
  const income = monthly / 0.30;                          // banks cap the bond at ~30% of gross income
  const src = prime.source ? ` · <a href="${esc(prime.source)}" target="_blank" rel="noopener">SARB ↗</a>` : "";
  $("secAffordBody").innerHTML =
    `<div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);margin-bottom:10px">${t("Illustrative estimate")}</div>` +
    `<div class="kpinum" style="font-size:26px">R${N(Math.round(monthly))}<span style="font-size:14px;font-weight:600;color:var(--label2)"> /mo</span></div>` +
    `<div style="font-size:12px;color:var(--label2);margin-top:8px;line-height:1.5">${tf("estimated bond on the median home of {home}", { home: R(home) })}</div>` +
    tilesHTML([[t("Gross income needed"), "R" + N(Math.round(income)) + t("/mo"), t("at 30% of income on the bond")],
               [t("Key assumptions"), tf("prime {pct}%", { pct: prime.pct }), t("20-year bond, no deposit")]]) +
    `<div style="font-size:11px;line-height:1.55;color:var(--label2);margin-top:12px">${t("A rough guide to the bond only — excludes transfer duty, bond registration and legal fees; your actual rate depends on credit, deposit and bank.")} ${tf("Prime {pct}% eff. {eff}.", { pct: esc(String(prime.pct)), eff: esc(prime.effective || prime.year || "") })}${src}</div>`;
}

// Data quality — how complete this roll's fields are (straight counts from the parsed roll,
// so "how much can I trust these stats" is answerable on the page; hidden where dq_* is absent)
function renderQuality(s) {
  const on = !!(s && s.dq_no_value != null);
  if (!showSec("secQuality", on)) return;
  const pct = v => v == null ? "" : (v > 0 && v < .001 ? "<0.1" : (v * 100).toFixed(1)) + "%" + t(" of parcels");
  const tiles = [];
  if (s.dq_no_value > 0) tiles.push([t("No value recorded"), N(s.dq_no_value), pct(s.dq_no_value_share)]);
  if (s.dq_nominal > 0) tiles.push([t("Nominal values · ≤ R1 000"), N(s.dq_nominal), t("placeholder entries in the roll")]);
  if (s.dq_no_extent > 0) tiles.push([t("No recorded size"), N(s.dq_no_extent), pct(s.dq_no_extent_share)]);
  if (s.dq_no_cat > 0) tiles.push([t("No category"), N(s.dq_no_cat), pct(s.dq_no_cat_share)]);
  $("secQualityBody").innerHTML = tiles.length
    ? `<div style="font-size:12px;color:var(--label2);margin-bottom:16px">${t("Gaps in the published roll itself — counted, not estimated. Affected parcels are excluded from the relevant stats.")}</div>` + tilesHTML(tiles)
    : `<div style="font-size:12px;color:var(--label2)">${t("No gaps detected — every parcel in this roll carries a value, size and category.")}</div>`;
}

// Who sets & governs these values — the municipal valuer + who to contact (from authorities.py,
// attached to each muni node by export_site.py). Two-tier: valuer/dept/objections, then the quiet
// province/national role-players. Hidden for scopes with no primary data (districts, CoCT-absent).
function renderAuthorities(s) {
  const a = s && s.authorities, p = (a && a.primary) || {};
  const link = `<div style="margin-top:16px;font-size:12.5px"><a href="${GUIDE()}">${t("How valuations work")}</a></div>`;
  const rows = [];
  const valuer = p.valuer || (p.valuer_note ? t(p.valuer_note) : null);
  if (valuer) rows.push(aRow(t("Municipal valuer"), esc(valuer) + (p.cycle ? ` <span style="color:var(--label2)">· ${esc(p.cycle)}</span>` : "")));
  const d = p.dept || {};
  if (d.name) rows.push(aRow(t("Valuations office"), esc(t(d.name))));
  const contact = [];
  if (d.phone) contact.push(esc(d.phone));
  if (d.email) contact.push(`<a href="mailto:${esc(d.email)}">${esc(d.email)}</a>`);
  if (contact.length) rows.push(aRow(t("Contact"), contact.join(" · ")));
  if (d.address) rows.push(aRow(t("Address"), esc(d.address)));
  if (d.url) rows.push(aRow(t("Official page"), `<a href="${esc(d.url)}" target="_blank" rel="noopener">${t("Valuations page")} ↗</a>`));
  const o = p.objections || {};
  if (o.to) rows.push(aRow(t("Lodge an objection with"), esc(t(o.to))));
  if (o.mm) rows.push(aRow(t("Municipal manager"), esc(o.mm)));
  if (o.how) rows.push(aRow(t("How to object"), esc(t(o.how))));
  if (o.form_url) rows.push(aRow(t("Objection form"), `<a href="${esc(o.form_url)}" target="_blank" rel="noopener">${t("Get the form")} ↗</a>`));
  if (!showSec("secAuthorities", rows.length > 0)) return;
  const sh = (a && a.shared) || {};
  const one = x => x && x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(t(x.name))} ↗</a>` : (x ? esc(t(x.name)) : "");
  const shared = (sh.appeal_board || sh.province || sh.national)
    ? `<div style="margin-top:14px;font-size:11.5px;line-height:1.6;color:var(--label2)">${t("Other role-players:")} `
      + [sh.appeal_board, sh.province, sh.national].filter(Boolean).map(one).join(" · ")
      + " " + t("Appeals against the valuer’s decision go to the Valuation Appeal Board.") + `</div>`
    : "";
  $("secAuthoritiesBody").innerHTML = rows.join("") + shared + link;
}

// Who represents this municipality — panel SUMMARY only (governance line + seat bar).
// Full seat table + ward councillors live on the muni page; link out to it.
// Data = scope.politics (panel-lean, from export_site.panel_politics). Hidden when absent.
function renderPolitics(s) {
  const p = s && s.politics;
  if (!showSec("secPolitics", !!(p && (p.election || p.governing || p.seats)))) return;
  const e = p.election || {}, g = p.governing || {}, m = p.mayor || {}, seats = p.seats || [];
  const line = [];
  if (e.winner) {
    const sf = (e.winner_seats && e.total_seats) ? ` (${e.winner_seats}/${e.total_seats})` : "";
    line.push(`<strong>${esc(t(e.date || "2021 election"))}:</strong> ${tf("{party} won{seats}", { party: esc(e.winner), seats: esc(sf) })}`);
  }
  if (g.party) line.push(`<strong>${t("Now:")}</strong> ${esc(g.party)}${g.basis ? " " + esc(t(g.basis)) : ""}`
    + (g.as_of ? ` <span style="color:var(--label2)">(${t("as of")} ${esc(g.as_of)})</span>` : ""));
  if (m.name) line.push(`<strong>${esc(t(m.title || "Mayor"))}:</strong> ${esc(m.name)}`
    + (m.party ? ` (${esc(m.party)})` : ""));
  let html = line.length ? `<div style="font-size:13.5px;line-height:1.7">${line.join(" · ")}</div>` : "";
  if (seats.length) {
    const total = e.total_seats || seats.reduce((a, x) => a + x.seats, 0) || 1;
    const bar = seats.map(x =>
      `<span title="${esc(x.party)}: ${x.seats}" style="display:inline-block;height:10px;`
      + `width:${(100 * x.seats / total).toFixed(2)}%;background:${partyColour(x.party)}"></span>`).join("");
    const legend = seats.map(x =>
      `<span style="white-space:nowrap;margin-right:12px">`
      + `<span style="display:inline-block;width:9px;height:9px;border-radius:2px;`
      + `background:${partyColour(x.party)};margin-right:5px"></span>${esc(x.party)} ${x.seats}`
      + (x.votes_pct != null ? ` · ${x.votes_pct.toFixed(1)}%` : "") + `</span>`).join("");
    html += `<div style="display:flex;border-radius:4px;overflow:hidden;margin:10px 0 8px">${bar}</div>`
      + `<div style="font-size:11.5px;line-height:1.9;color:var(--label2)">${legend}</div>`;
  }
  const muni = s && s.name;
  if (muni) html += `<div style="margin-top:14px;font-size:12.5px">`
    + `<a href="${isAF() ? "af/" : ""}m/${slugOf(muni)}.html">${t("Full council and ward councillors")}</a></div>`;
  $("secPoliticsBody").innerHTML = html;
}

/* ============================ top-N properties (live DB query) ============================ */
let tlKind = "hi", tlN = 10, tlEnabled = false, tlReq = 0, tlRows = [];
// a ranked row opens that property's detail (value, extent, rates) over the list
function wireTopRows() {
  const open = e => { const row = e.target.closest(".tlRow[data-i]"); if (!row) return;
    if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault(); const r = tlRows[+row.dataset.i]; if (r) openProp(r); };
  $("tlBody").addEventListener("click", open); $("tlBody").addEventListener("keydown", open);
}
function scopeFilter() {
  const p = statePath, len = p.length;
  if (len >= 3) return { where: "muni = ?", args: [p[2].name], name: p[2].name };
  if (len === 2) { const ms = DISTRICTS[p[1].name].munis; return { where: `muni IN (${ms.map(() => "?").join(",")})`, args: ms, name: p[1].name }; }
  return { where: "", args: [], name: "the Western Cape" };   // scope names stay English (SQL filters + tn at display)
}
let tlPrevFocus = null, pdPrevFocus = null;
// Keep Tab inside an open modal (audit 2026-07-19) — paired with focus restore on close.
function trapTab(panel) {
  panel.addEventListener("keydown", e => {
    if (e.key !== "Tab") return;
    const f = [...panel.querySelectorAll('button,[href],input,[tabindex]:not([tabindex="-1"])')]
      .filter(x => !x.hidden && x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}
function openTop(kind) {
  if (!tlEnabled) return;
  tlPrevFocus = document.activeElement;
  tlKind = kind; tlN = 10;
  const sc = scopeFilter();
  $("tlKicker").textContent = t(kind === "hi" ? "Most valuable" : "Most affordable") + " · " + (sc.name === "the Western Cape" ? t("the Western Cape") : tn(sc.name));
  $("tlTitle").textContent = t(kind === "hi" ? "Most valuable properties" : "Most affordable homes");
  $("tlNote").textContent = kind === "hi"
    ? t("All categories, ranked by municipal market value.")
    : t("Residential only · nominal values under R100 000 excluded.");
  [...$("tlSeg").children].forEach(b => { const on = +b.dataset.n === tlN; b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); });
  $("toplist").classList.add("open"); $("toplist").setAttribute("aria-hidden", "false");
  document.documentElement.style.overflow = "hidden";
  $("tlClose").focus();
  loadTop();
}
function closeTop() {
  $("toplist").classList.remove("open"); $("toplist").setAttribute("aria-hidden", "true");
  document.documentElement.style.overflow = "";
  if (tlPrevFocus && tlPrevFocus.focus) tlPrevFocus.focus();
}
async function loadTop() {
  const body = $("tlBody"); body.innerHTML = `<div style="padding:34px 0;color:var(--label2);font-size:14px">${t("Finding properties…")}</div>`;
  $("tlCount").textContent = "";
  const kind = tlKind, n = tlN, req = ++tlReq, sc = scopeFilter();
  let where = "value>0", args = [];
  if (sc.where) { where += " AND " + sc.where; args = [...sc.args]; }
  if (kind === "lo") where += " AND value>=100000 AND UPPER(category) LIKE '%RES%'";
  const sql = `SELECT muni,suburb,erf,address,extent,dwext,value,tenure,category FROM prop WHERE ${where} ORDER BY value ${kind === "hi" ? "DESC" : "ASC"} LIMIT ${n}`;
  let rows = null;
  for (let attempt = 0; attempt < 2 && rows === null; attempt++) {
    try { rows = await (await ensureDB()).db.query(sql, args); }
    catch (e) { resetDB(); if (attempt === 1) { if (req === tlReq) body.innerHTML = `<div style="padding:34px 0;color:var(--bad);font-size:14px">${t("Couldn’t load the list — try again.")}</div>`; return; } }
  }
  if (req !== tlReq) return;   // a newer request superseded this one
  if (!rows.length) { body.innerHTML = `<div style="padding:34px 0;color:var(--label2);font-size:14px">${t("No properties found for this area.")}</div>`; return; }
  const muniScope = statePath.length >= 3;
  tlRows = rows;
  body.innerHTML = rows.map((r, i) => {
    const addr = esc(dispAddr(r));
    const sub = esc((muniScope ? [clSub(r.suburb)] : [clSub(r.suburb), tn(r.muni)]).filter(Boolean).join(" · "));
    const cat = r.category ? `<span class="tlCat">${esc(r.category)}</span>` : "";
    const meta = (r.extent ? N(Math.round(r.extent)) + " m²" : t("extent n/a")) + (r.extent ? " · R" + N(Math.round(r.value / r.extent)) + "/m²" : "");
    return `<div class="tlRow o-clickable" data-i="${i}" role="button" tabindex="0"><div class="tlRank">${i + 1}</div>` +
      `<div class="tlMain"><div class="tlAddr">${addr}${cat}</div><div class="tlSub">${sub}</div></div>` +
      `<div class="tlRight"><div class="tlVal">${R(r.value)}</div><div class="tlMeta">${meta}</div></div></div>`;
  }).join("");
  $("tlCount").textContent = tf("Top {n}", { n: rows.length });
}

/* ============================ search (area names + addresses) ============================ */
function buildAreaIndex() {
  const out = [];
  for (const d in DISTRICTS) {
    out.push({ label: tn(d), alt: d, sub: t("District"), go: () => navigate([wcCrumb(), { type: "district", name: d }]) });
    DISTRICTS[d].munis.forEach(m => {
      out.push({ label: tn(m), alt: m, sub: tn(d), go: () => navigate([wcCrumb(), { type: "district", name: d }, { type: "municipality", name: m }]) });
      townsOf(m).forEach(tw => out.push({ label: tw.name, sub: tn(m), go: () => navigate([wcCrumb(), { type: "district", name: d }, { type: "municipality", name: m }]) }));
    });
  }
  return out;
}
const SEARCH_PAIRS = [["search", "results"], ["msearch", "mresults"]];
function wireSearch() {
  SEARCH_PAIRS.forEach(([inId, resId]) => {
    const inp = $(inId); if (!inp) return; let timer, active = -1;
    const options = () => [...$(resId).querySelectorAll('[role="option"]')];
    const mark = rs => rs.forEach((r, i) => {
      r.setAttribute("aria-selected", String(i === active));
      r.style.background = i === active ? "color-mix(in srgb, var(--accent) 14%, transparent)" : "";
      if (i === active) { r.scrollIntoView({ block: "nearest" }); inp.setAttribute("aria-activedescendant", r.id); }
    });
    inp.addEventListener("input", () => { clearTimeout(timer); active = -1; inp.removeAttribute("aria-activedescendant");
      const q = inp.value.trim(); if (q.length < 2) return hideResults(); timer = setTimeout(() => runSearch(q, inId, resId), 150); });
    inp.addEventListener("focus", () => { ensureDB().catch(() => {});      // start the search DB on first focus
      if (inp.value.trim().length >= 2) runSearch(inp.value.trim(), inId, resId); });
    inp.addEventListener("keydown", e => {
      if (e.key === "Escape") { hideResults(); inp.blur(); return; }
      const rs = options();
      if (!rs.length || $(resId).hidden) return;
      if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(active + 1, rs.length - 1); mark(rs); }
      else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(active - 1, 0); mark(rs); }
      else if (e.key === "Enter") { e.preventDefault(); rs[active >= 0 ? active : 0].dispatchEvent(new MouseEvent("mousedown")); }
    });
  });
  document.addEventListener("click", e => { if (!e.target.closest("#search,#results,#msearch,#mresults")) hideResults(); });
}
function hideResults() { ["results", "mresults"].forEach(id => { const r = $(id); if (r) { r.hidden = true; r.innerHTML = ""; } });
  ["search", "msearch"].forEach(id => { const i = $(id); if (i) { i.setAttribute("aria-expanded", "false"); i.removeAttribute("aria-activedescendant"); } }); }
let searchSeq = 0;
const SEARCH_NOISE = new Set(["street", "st", "straat", "str", "road", "rd", "weg", "avenue", "ave",
  "av", "laan", "lane", "ln", "drive", "dr", "rylaan", "crescent", "cres", "close", "cl", "way",
  "singel", "boulevard", "blvd", "the", "erf", "no", "nr"]);
// build an FTS5 prefix-AND query from free text: tokens become prefix terms, noise words dropped
function ftsQuery(q) {
  const toks = q.toLowerCase().split(/[^a-z0-9]+/).filter(t => t && (t.length > 1 || /[0-9]/.test(t)) && !SEARCH_NOISE.has(t));
  return toks.length ? toks.map(t => t + "*").join(" ") : null;
}
function searchRow(box, inId, label, sub, go, right) {
  const d = document.createElement("div"); d.className = "o-clickable";
  d.setAttribute("role", "option"); d.setAttribute("aria-selected", "false");
  d.id = box.id + "-opt-" + box.children.length;
  d.style.cssText = "display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:12px 14px;border-bottom:1px solid var(--sep);cursor:pointer";
  d.innerHTML = `<span style="font-size:14px;color:var(--ink)">${esc(label)}</span><span style="font-size:11px;letter-spacing:.04em;color:var(--label2);text-transform:uppercase;white-space:nowrap">${esc(right || sub)}</span>`;
  d.onmousedown = e => { e.preventDefault(); go(); const inp = $(inId); if (inp) inp.value = ""; if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); hideResults(); };
  box.appendChild(d);
}
function searchNote(box, text) {
  const d = document.createElement("div"); d.dataset.note = "1";
  d.style.cssText = "padding:11px 14px;font-size:11.5px;color:var(--label2);border-bottom:1px solid var(--sep)";
  d.textContent = text; box.appendChild(d); return d;
}
async function runSearch(q, inId = "search", resId = "results") {
  if (!areaIndex) areaIndex = buildAreaIndex();
  const seq = ++searchSeq, nq = norm(q), box = $(resId);
  const areas = areaIndex.filter(x => norm(x.label).includes(nq) || (x.alt && norm(x.alt).includes(nq))).slice(0, 6);
  // 1) render area-name matches INSTANTLY (no waiting on the property DB)
  box.innerHTML = "";
  areas.forEach(a => searchRow(box, inId, a.label, a.sub, a.go, a.sub));
  const ph = searchNote(box, t("Searching addresses…"));
  box.hidden = false;
  $(inId).setAttribute("aria-expanded", "true");
  // 2) full-text property search (matches address/suburb/erf tokens in any order), with cold-start retry
  const fts = ftsQuery(q);
  let rows = fts ? null : [];
  for (let attempt = 0; attempt < 2 && rows === null; attempt++) {
    try {
      rows = await (await ensureDB()).db.query(
        "SELECT p.muni,p.suburb,p.address,p.erf,p.extent,p.dwext,p.value,p.tenure,p.category FROM psearch f " +
        "JOIN prop p ON p.id=f.rowid WHERE psearch MATCH ? AND p.value>0 ORDER BY p.value DESC LIMIT 8", [fts]);
    } catch (e) { resetDB(); }
  }
  if (seq !== searchSeq) return;            // a newer keystroke superseded this query
  if (ph.parentNode) ph.remove();
  if (rows === null) {                        // DB momentarily unavailable — keep area results, don't blank out
    if (!areas.length) searchNote(box, t("Address search is still loading — try again in a moment."));
    return;
  }
  rows.forEach(r => searchRow(box, inId, dispAddr(r),
    [clSub(r.suburb), tn(r.muni)].filter(Boolean).join(", "), () => openProp(r), R(r.value)));
  if (!box.children.length) searchNote(box, t("No matches"));
}
/* ============================ property detail + verified rates ============================ */
const RZA = v => "R" + N(Math.round(v));   // full-precision Rand (no k/m abbreviation) for rates

/* Verified municipal rates (rates.js + data/rates.json). Rendered ONLY when the
 * municipality's official tariff is on file — otherwise the block is omitted
 * entirely: no figure beats a made-up one. */
let RATESDATA = null;
getRates().then(d => { RATESDATA = d; });
function ratesBlock(r) {
  const rr = computeRates(RATESDATA, r.muni, r.category, r.tenure, r.value);
  if (!rr) return "";
  const cents = (rr.rate * 100).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return `<div class="pdTax">
      <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);margin-bottom:12px">${t("Municipal rates · {year}").replace("{year}", esc(rr.year))}</div>
      <div class="pdStat"><span class="k">${t("Per year")}</span><span class="v" style="font-family:var(--font-ui);font-weight:600;font-size:19px">${RZA(rr.annual)}</span></div>
      <div class="pdStat" style="border-bottom:none"><span class="k">${t("Per month")}</span><span class="v">${RZA(rr.monthly)}</span></div>
      <div style="font-size:11px;line-height:1.55;color:var(--label2);margin-top:10px">${esc(cents)}c/R${rr.reduction ? tf(" on value above {v}", { v: RZA(rr.reduction) }) : ""}${rr.source ? ` · <a href="${esc(rr.source)}" target="_blank" rel="noopener">${t("Official tariff")} ↗</a>` : ""}</div>
    </div>`;
}
// B4: the roll's own rating cycle (stats.json provenance / cycle), never a hard-coded year
function propCycle(muni) {
  const s = muniStat(muni), c = s && ((s.provenance && s.provenance.cycle) || s.cycle);
  return c ? tf("Municipal market value on the {cycle} valuation roll", { cycle: cycleLabel(c) }) : t("Municipal market value");
}
function openProp(r) {
  $("pdKicker").textContent = [clSub(r.suburb), tn(r.muni)].filter(Boolean).join(", ");
  $("pdAddr").textContent = dispAddr(r);
  const ppm = r.extent ? "R" + N(Math.round(r.value / r.extent)) + " / m²" : "—";
  const stats = [
    [t("Erf / unit"), r.erf || "—"],
    [t("Category"), r.category || "—"],
    [t("Extent"), r.extent ? N(Math.round(r.extent)) + " m²" : "—"],
    ...(r.dwext ? [[t("Dwelling extent"), N(Math.round(r.dwext)) + " m²"]] : []),
    [t("Value per m²"), ppm],
    [t("Municipality"), tn(r.muni) || "—"],
  ];
  $("pdBody").innerHTML =
    `<div class="pdVal">${R(r.value)}</div>` +
    `<div class="pdCycle">${esc(propCycle(r.muni))}</div>` +
    stats.map(([k, v]) => `<div class="pdStat"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join("") +
    ratesBlock(r) +
    `<div id="pdGo" class="o-clickable">${tf("Explore {muni}", { muni: esc(tn(r.muni) || t("area")) })}</div>`;
  const goMuni = () => { const f = muniByName[r.muni]; closeProp();
    if (f) navigate([wcCrumb(), { type: "district", name: f.properties.district }, { type: "municipality", name: r.muni }]); };
  $("pdGo").onclick = goMuni;
  wireAct($("pdGo"), goMuni);
  pdPrevFocus = document.activeElement;
  $("propdetail").classList.add("open"); $("propdetail").setAttribute("aria-hidden", "false");
  document.documentElement.style.overflow = "hidden";
  $("pdClose").focus();
}
function closeProp() {
  $("propdetail").classList.remove("open"); $("propdetail").setAttribute("aria-hidden", "true");
  document.documentElement.style.overflow = $("toplist").classList.contains("open") ? "hidden" : "";
  if (pdPrevFocus && pdPrevFocus.focus) pdPrevFocus.focus();
}

async function ensureDB() {
  if (dbw) return dbw;
  if (!dbwPromise) dbwPromise = (async () => {
    const mod = await import("https://cdn.jsdelivr.net/npm/sql.js-httpvfs@0.8.12/+esm");
    const createDbWorker = mod.createDbWorker || mod.default.createDbWorker;
    const abs = p => new URL(p, location.href).href;
    // The search DB is served from Supabase Storage, NOT GitHub Pages. sql.js-httpvfs reads the
    // DB via HTTP Range requests; GitHub Pages (and jsDelivr) gzip responses and serve ranges
    // against the COMPRESSED bytes, so SQLite reads garbage and every search returns nothing.
    // Supabase Storage serves raw byte-ranges (no transfer compression) with CORS — verified.
    // config.json's urlPrefix ("search.db.") resolves the chunks relative to this configUrl.
    const DB_CONFIG = "https://nxeasppmwvzcqbbgrdvf.supabase.co/storage/v1/object/public/valuations/b-2b502178f94f/config.json";
    const w = await createDbWorker([{ from: "jsonconfig", configUrl: DB_CONFIG }],
      abs("assets/vendor/sqlite.worker.js"), abs("assets/vendor/sql-wasm.wasm"));
    // Cold-start can hand back an empty wasm buffer — verify before caching. Then fault in the hot
    // pages the first real search / top-N will need, so they don't pay the whole cold B-tree descent
    // (the boot pre-warm ran only SELECT 1 before). Best-effort, in the background before any query.
    await w.db.query("SELECT 1");
    try {
      await w.db.query("SELECT rowid FROM psearch WHERE psearch MATCH ? LIMIT 1", ["a*"]);
      await w.db.query("SELECT value FROM prop WHERE value>0 ORDER BY value DESC LIMIT 1");
    } catch (_) { /* best-effort warm-up; an older-schema DB just stays cold */ }
    dbw = w; return w;
  })().catch(e => { dbwPromise = null; throw e; });   // never cache a broken worker; allow a clean retry
  return dbwPromise;
}
function resetDB() { dbw = null; dbwPromise = null; }
