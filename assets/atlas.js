import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

/* ============================ config / tokens ============================ */
const W = 1000, H = 760, MAXK = 46;
const RAMP = ["#eef0e3", "#bcd9c7", "#6cab95", "#2f7d6b", "#16524a"];
const ACCENT = "#1f6f63";
const LAND = "#e6e0d3", NODATA = "#d9d2c2";
const YEAR = "2024 / 25";
const $ = s => document.getElementById(s);

const R = v => { v = +v; if (!isFinite(v)) return "—";
  if (v >= 1e12) return "R" + (v / 1e12).toFixed(2) + "tn";
  if (v >= 1e9) return "R" + (v / 1e9).toFixed(v >= 1e10 ? 0 : 1) + "bn";
  if (v >= 1e6) return "R" + (v / 1e6).toFixed(2) + "m";
  if (v >= 1e3) return "R" + Math.round(v / 1e3) + "k";
  return "R" + Math.round(v); };
const N = v => v == null ? "—" : (+v).toLocaleString("en-ZA").replace(/,/g, " ");
const norm = s => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/* ============================ state ============================ */
let STATS, TOWNS, PROV, DISTF, MUNIF;
let proj, path, gNode, gProv, gDist, gMuni, gLabel, defs, svg;
let DISTRICTS = {};            // name -> {feature, munis:[name]}
let muniByName = {};           // name -> feature
let curK = 1, statePath = [];
let dbw = null, areaIndex = null;

/* ============================ boot ============================ */
(async function () {
  try {
    [STATS, TOWNS, PROV, DISTF, MUNIF] = await Promise.all([
      fetch("data/stats.json").then(r => r.json()),
      fetch("data/towns.json").then(r => r.json()),
      fetch("data/geo/za-provinces.geojson").then(r => r.json()),
      fetch("data/geo/wc-districts.geojson").then(r => r.json()),
      fetch("data/geo/wc-municipalities.geojson").then(r => r.json()),
    ]);
  } catch (e) {
    $("loadingMsg").textContent = "Could not load the atlas data";
    return;
  }
  clipMainland(); toPlanar(); buildHierarchy(); initMap();
  $("loading").style.display = "none";
  navigate([], false);
  wireSearch(); $("reset").onclick = () => { $("search").value = ""; navigate([], true); };
  $("scrollcue").onclick = () => statePath.length && scrollTo({ top: innerHeight * 0.96, behavior: "smooth" });
})();

const name = f => f.properties.name;

function buildHierarchy() {
  DISTF.features.forEach(f => { DISTRICTS[name(f)] = { feature: f, munis: [] }; });
  MUNIF.features.forEach(f => {
    muniByName[name(f)] = f;
    const d = f.properties.district;
    if (DISTRICTS[d]) DISTRICTS[d].munis.push(name(f));
  });
  Object.values(DISTRICTS).forEach(d => d.munis.sort());
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
function toPlanar() {
  const conv = a => { if (typeof a[0] === "number") { const lng = a[0], lat = a[1];
      a[0] = lng * Math.PI / 180; a[1] = Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)); }
    else a.forEach(conv); };
  [PROV, DISTF, MUNIF].forEach(fc => fc.features.forEach(f => f.geometry && conv(f.geometry.coordinates)));
}
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
  gProv = g.append("g"); gDist = g.append("g"); gMuni = g.append("g"); gLabel = g.append("g");
  [gDist, gMuni].forEach(l => l.node().style.transition = "opacity .5s ease");

  const provExt = ext(Object.keys(DISTRICTS).map(d => med(distStat(d))));
  gProv.selectAll("path").data(PROV.features).join("path")
    .attr("d", path)
    .attr("fill", d => name(d) === "Western Cape" ? color(med(provStat()), provExt) : LAND)
    .attr("stroke", d => name(d) === "Western Cape" ? "#1a1714" : "none")
    .attr("stroke-width", 1.1).attr("vector-effect", "non-scaling-stroke")
    .attr("class", d => name(d) === "Western Cape" ? "o-clickable o-wc" : "o-other")
    .each(function (d) { if (name(d) === "Western Cape") d3.select(this)
      .on("click", () => navigate([wcCrumb()]))
      .on("mouseenter mousemove", e => tip(e, "Western Cape", provStat(), true))
      .on("mouseleave", tipHide); });
  $("legendBar").style.background = `linear-gradient(90deg,${RAMP.join(",")})`;
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
    .attr("stroke", "#fbf9f3").attr("stroke-width", 1.1).attr("vector-effect", "non-scaling-stroke")
    .attr("class", "o-clickable")
    .on("click", (ev, d) => navigate([wcCrumb(), { type: "district", name: name(d) }]))
    .on("mouseenter mousemove", (ev, d) => tip(ev, name(d), distStat(name(d)), true))
    .on("mouseleave", tipHide);
}
function drawMunis(district) {
  if (muniDistrict === district) return; muniDistrict = district;
  const munis = DISTRICTS[district].munis;
  const e = ext(munis.map(m => med(muniStat(m))));
  gMuni.selectAll("path").data(munis.map(m => muniByName[m]).filter(Boolean), d => name(d)).join("path")
    .attr("d", path)
    .attr("fill", d => color(med(muniStat(name(d))), e))
    .attr("stroke", "#fbf9f3").attr("stroke-width", 1).attr("vector-effect", "non-scaling-stroke")
    .attr("class", "o-clickable")
    .on("click", (ev, d) => navigate([wcCrumb(), { type: "district", name: district }, { type: "municipality", name: name(d) }]))
    .on("mouseenter mousemove", (ev, d) => tip(ev, name(d), muniStat(name(d)), true))
    .on("mouseleave", tipHide);
}
function setLayers(len) {
  gProv.style("opacity", len === 0 ? 1 : 0.5).style("pointer-events", len === 0 ? "auto" : "none");
  gProv.selectAll(".o-wc").attr("fill", len === 0 ? color(med(provStat()), ext(Object.keys(DISTRICTS).map(d => med(distStat(d))))) : "none");
  const set = (g, on, dim) => g.style("display", dim ? "block" : "none").style("opacity", on ? 1 : 0.16).style("pointer-events", on ? "auto" : "none");
  set(gDist, len === 1, len >= 1);
  if (muniDistrict) set(gMuni, len >= 2, len >= 2);   // municipalities clickable at district + terminal at municipality
}

/* ============================ zoom (CSS transform) ============================ */
function zoom(feats, animate) {
  let b = null; feats.forEach(f => { const bb = path.bounds(f); b = b ? [[Math.min(b[0][0], bb[0][0]), Math.min(b[0][1], bb[0][1])], [Math.max(b[1][0], bb[1][0]), Math.max(b[1][1], bb[1][1])]] : bb; });
  const dx = b[1][0] - b[0][0], dy = b[1][1] - b[0][1], cx = (b[0][0] + b[1][0]) / 2, cy = (b[0][1] + b[1][1]) / 2;
  let k = Math.max(1, Math.min(MAXK, 0.84 / Math.max(dx / W, dy / H)));
  curK = k;
  gNode.style.transition = animate ? "transform .95s cubic-bezier(.4,0,.2,1)" : "none";
  gNode.style.transform = `translate(${W / 2 - k * cx}px,${H / 2 - k * cy}px) scale(${k})`;
}

/* ============================ labels ============================ */
function labels(len, p) {
  gLabel.selectAll("*").remove();
  let items = [];
  if (len === 0) { const c = path.centroid(PROV.features.find(f => name(f) === "Western Cape")); items = [{ t: "WESTERN CAPE", x: c[0], y: c[1], wc: true }]; }
  else if (len === 1) items = DISTF.features.map(f => { const c = path.centroid(f); return { t: name(f), x: c[0], y: c[1] }; });
  else if (len === 2) items = DISTRICTS[p[1].name].munis.map(m => muniByName[m]).filter(Boolean).map(f => { const c = path.centroid(f); return { t: name(f), x: c[0], y: c[1] }; });
  else { const f = muniByName[p[2].name]; if (f) { const c = path.centroid(f); items = [{ t: name(f), x: c[0], y: c[1] }]; } }
  const k = curK, fs = (len === 0 ? 13 : 11) / k;
  gLabel.selectAll("text").data(items).join("text")
    .attr("x", d => d.x).attr("y", d => d.y).attr("text-anchor", "middle").attr("dy", ".32em")
    .attr("fill", d => d.wc ? "#1a1714" : "#231f1a")
    .attr("stroke", "#f6f2e9").attr("stroke-width", 3 / k).attr("paint-order", "stroke")
    .attr("letter-spacing", d => d.wc ? (2 / k) + "px" : null)
    .style("font-weight", d => d.wc ? 700 : 600).style("font-size", fs + "px")
    .style("opacity", d => d.wc ? .9 : .85).text(d => d.t);
}

/* ============================ tooltip ============================ */
function tip(e, nm, st, drill) { const t = $("tip");
  t.innerHTML = `<div style="font-family:'Newsreader',serif;font-size:16px;margin-bottom:7px">${nm}</div>` +
    (st ? `<div style="display:grid;grid-template-columns:auto auto;gap:2px 16px;font-size:12px">` +
      `<span style="opacity:.6">Median</span><span style="text-align:right;font-variant-numeric:tabular-nums">${R(st.median)}</span>` +
      `<span style="opacity:.6">Total roll</span><span style="text-align:right;font-variant-numeric:tabular-nums">${R(st.total)}</span>` +
      `<span style="opacity:.6">Parcels</span><span style="text-align:right;font-variant-numeric:tabular-nums">${N(st.parcels || st.valued)}</span></div>`
      : `<div style="font-size:12px;opacity:.7">No public roll (search-only)</div>`) +
    (drill && st ? `<div style="margin-top:8px;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:${ACCENT}">Click to explore →</div>` : "");
  t.style.opacity = 1;
  let x = e.clientX + 16, y = e.clientY + 16;
  if (x + 250 > innerWidth) x = e.clientX - 250; if (y + 130 > innerHeight) y = e.clientY - 130;
  t.style.left = x + "px"; t.style.top = y + "px";
}
const tipHide = () => $("tip").style.opacity = 0;

/* ============================ navigation ============================ */
function navigate(p, animate = true) {
  statePath = p; const len = p.length;
  if (len >= 2) drawMunis(p[1].name);
  drawDistricts();
  setLayers(len);
  let feats = len === 0 ? PROV.features : len === 1 ? [PROV.features.find(f => name(f) === "Western Cape")]
    : len === 2 ? [DISTRICTS[p[1].name].feature] : [muniByName[p[2].name]].filter(Boolean);
  if (!feats.length) feats = [PROV.features.find(f => name(f) === "Western Cape")];
  zoom(feats, animate);
  labels(len, p);
  document.body.style.overflow = len ? "auto" : "hidden";
  $("scrollcue").style.display = len ? "flex" : "none";
  $("dash").hidden = !len;
  if (!len) scrollTo({ top: 0 });
  hideResults();
  renderChrome(p);
}

/* ============================ chrome + dashboard ============================ */
function renderChrome(p) {
  const len = p.length;
  $("headline").textContent = len === 0 ? "South Africa" : len === 1 ? "Western Cape" : p[len - 1].name;
  $("subline").textContent = len === 0 ? "Tap the Western Cape to begin"
    : len === 1 ? "Six districts · " + YEAR : len === 2 ? "Local municipalities · " + YEAR : "Municipal valuation roll · " + YEAR;

  // breadcrumb
  const steps = [{ label: "South Africa", go: () => navigate([]) }];
  if (len >= 1) steps.push({ label: "Western Cape", go: () => navigate([wcCrumb()]) });
  if (len >= 2) steps.push({ label: p[1].name, go: () => navigate([wcCrumb(), p[1]]) });
  if (len >= 3) steps.push({ label: p[2].name, go: () => navigate(p) });
  $("crumbs").innerHTML = "";
  steps.forEach((s, i) => {
    if (i) { const sep = document.createElement("span"); sep.textContent = "›"; sep.style.cssText = "font-size:13px;color:#bdb6a8"; $("crumbs").appendChild(sep); }
    const a = document.createElement("span"); a.textContent = s.label; a.className = "o-clickable";
    a.style.cssText = "font-size:13px;font-weight:500;color:#1a1714;cursor:pointer"; a.onclick = s.go; $("crumbs").appendChild(a);
  });

  // legend (extent of currently displayed set)
  let e, lt;
  if (len >= 2) { e = ext(DISTRICTS[p[1].name].munis.map(m => med(muniStat(m)))); lt = "MEDIAN VALUE · MUNICIPALITY"; }
  else { e = ext(Object.keys(DISTRICTS).map(d => med(distStat(d)))); lt = "MEDIAN VALUE · DISTRICT"; }
  $("legendTitle").textContent = lt; $("legendMin").textContent = R(e[0]); $("legendMax").textContent = R(e[1]);

  if (len >= 1) renderDash(p);
}

function renderDash(p) {
  const len = p.length, isMuni = len >= 3;
  let scope, children = [], kindP, scopeName, kicker;
  if (len === 1) { scope = provStat(); scopeName = "Western Cape"; kicker = "WESTERN CAPE PROVINCE"; kindP = "Districts";
    children = DISTF.features.map(f => ({ name: name(f), s: distStat(name(f)), go: () => navigate([wcCrumb(), { type: "district", name: name(f) }]) })); }
  else if (len === 2) { const dl = p[1].name; scope = distStat(dl); scopeName = dl; kicker = dl.toUpperCase() + " DISTRICT"; kindP = "Municipalities";
    children = DISTRICTS[dl].munis.map(m => ({ name: m, s: muniStat(m), go: () => navigate([wcCrumb(), { type: "district", name: dl }, { type: "municipality", name: m }]) })); }
  else { const m = p[2].name; scope = muniStat(m); scopeName = m; kicker = m.toUpperCase() + " · " + p[1].name.toUpperCase(); }

  $("dashKicker").textContent = kicker;
  $("scopeLabel").textContent = scopeName;
  $("scopeSub").textContent = !scope ? "No public valuation roll"
    : isMuni ? "Municipal valuation roll · " + YEAR
    : children.filter(c => c.s).length + " " + kindP.toLowerCase() + " · valuation roll " + YEAR;
  $("statMedian").textContent = scope ? R(scope.median) : "—";
  $("statAvg").textContent = scope ? R(scope.mean ?? scope.avg) : "—";
  $("statTotal").textContent = scope ? R(scope.total) : "—";
  $("statParcels").textContent = scope ? N(scope.properties || scope.valued) : "—";

  renderHist(scope && scope.hist, scope ? (scope.properties || scope.valued) : 0);

  const rk = $("ranked"); rk.innerHTML = "";
  if (!isMuni && scope) {
    $("rankTitle").textContent = kindP + " ranked"; $("rankSub").textContent = "by median value";
    const sorted = children.filter(c => c.s && c.s.median != null).sort((a, b) => b.s.median - a.s.median);
    const maxMed = sorted.length ? sorted[0].s.median : 1, minMed = sorted.length ? sorted[sorted.length - 1].s.median : 0;
    sorted.forEach(c => {
      const row = document.createElement("div"); row.className = "o-clickable";
      row.style.cssText = "padding:13px 0;border-bottom:1px solid rgba(26,23,20,.09);cursor:pointer";
      row.innerHTML = `<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:8px">
          <span style="font-size:15px">${c.name}</span><span style="font-size:14px;font-variant-numeric:tabular-nums">${R(c.s.median)}</span></div>
        <div style="height:5px;background:rgba(26,23,20,.07);border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${Math.max(8, Math.round(c.s.median / maxMed * 100))}%;background:${color(c.s.median, [minMed, maxMed])};border-radius:3px"></div></div>`;
      row.onclick = () => { c.go(); scrollTo({ top: 0, behavior: "smooth" }); };
      rk.appendChild(row);
    });
  } else {
    $("rankTitle").textContent = "Valuation spread"; $("rankSub").textContent = scope ? (scope.cycle || "") : "";
    if (scope) [["Lower quartile (Q1)", R(scope.q1)], ["Median", R(scope.median)], ["Upper quartile (Q3)", R(scope.q3)],
      ["Average residential", R(scope.residential_avg)]]
      .forEach(([k, v]) => { const d = document.createElement("div");
        d.style.cssText = "display:flex;justify-content:space-between;padding:13px 0;border-bottom:1px solid rgba(26,23,20,.09);font-size:15px";
        d.innerHTML = `<span>${k}</span><span style="font-variant-numeric:tabular-nums">${v}</span>`; rk.appendChild(d); });
    else rk.innerHTML = `<div style="color:#9a9286;font-size:14px;padding-top:6px">City of Cape Town publishes valuations only via per-property online search.</div>`;
  }

  fillProp("hi", scope && scope.hi);
  fillProp("lo", scope && scope.lo);
  $("dashNote").textContent = !scope
    ? "The City of Cape Town does not publish a downloadable valuation roll — values are available only through its per-property online search, so it can't be aggregated here."
    : isMuni
    ? "Municipality is the finest level with reliable public boundaries — suburb/town borders aren't published as open data, so we don't subdivide further."
    : "Figures are recomputed live from the underlying valuation roll · refreshed for " + YEAR + ".";
}

function fillProp(id, pr) {
  if (!pr) { $(id + "Addr").textContent = "—"; $(id + "Sub").textContent = ""; $(id + "Val").textContent = ""; $(id + "Meta").textContent = ""; return; }
  $(id + "Addr").textContent = pr.address || "Unnamed erf";
  $(id + "Sub").textContent = [pr.suburb, pr.muni].filter(Boolean).join(" · ");
  $(id + "Val").textContent = R(pr.value);
  const ppm = pr.extent ? " · R" + N(Math.round(pr.value / pr.extent)) + "/m²" : "";
  $(id + "Meta").textContent = (pr.extent ? N(pr.extent) + " m²" : "extent n/a") + ppm;
}

function renderHist(hist, total) {
  const el = $("distChart"); el.innerHTML = "";
  if (!hist) { el.innerHTML = `<div style="color:#9a9286;font-size:14px;padding:24px 0">No distribution data for this area.</div>`; return; }
  const labels = STATS.buckets, n = hist.length, max = Math.max(...hist, 1);
  const VW = 1000, VH = 230, padL = 6, padR = 6, padT = 22, padB = 46, gap = 9;
  const chartW = VW - padL - padR, chartH = VH - padT - padB, bw = chartW / n - gap;
  const compact = v => v >= 1e6 ? (v / 1e6).toFixed(1).replace(/\.0$/, "") + "m" : v >= 1e3 ? Math.round(v / 1e3) + "k" : "" + v;
  const s = d3.select(el).append("svg").attr("viewBox", `0 0 ${VW} ${VH}`).attr("preserveAspectRatio", "xMidYMid meet").style("width", "100%").style("display", "block");
  s.append("line").attr("x1", padL).attr("x2", VW - padR).attr("y1", padT + chartH).attr("y2", padT + chartH).attr("stroke", "rgba(26,23,20,.18)");
  hist.forEach((cnt, i) => {
    const x = padL + i * (bw + gap) + gap / 2, bh = cnt / max * chartH, y = padT + chartH - bh;
    const g = s.append("g");
    g.append("rect").attr("x", x).attr("y", y).attr("width", bw).attr("height", Math.max(0, bh)).attr("rx", 1.5)
      .attr("fill", d3.interpolateRgbBasis(RAMP)(n > 1 ? i / (n - 1) : .5))
      .on("mouseenter mousemove", e => tipHist(e, labels[i], cnt, total)).on("mouseleave", tipHide);
    if (cnt) g.append("text").attr("x", x + bw / 2).attr("y", y - 6).attr("text-anchor", "middle")
      .style("font-size", "11px").style("font-variant-numeric", "tabular-nums").attr("fill", "#6f685c").text(compact(cnt));
    g.append("text").attr("x", x + bw / 2).attr("y", padT + chartH + 18).attr("text-anchor", "middle")
      .style("font-size", "10.5px").attr("fill", "#9a9286").text(labels[i]);
  });
}
function tipHist(e, label, cnt, total) {
  const t = $("tip"), pct = total ? (cnt / total * 100) : 0;
  t.innerHTML = `<div style="font-family:'Newsreader',serif;font-size:15px;margin-bottom:4px">${label}</div>` +
    `<div style="font-size:12px"><span style="opacity:.6">Parcels </span><span style="font-variant-numeric:tabular-nums">${N(cnt)}</span> · ${pct.toFixed(1)}%</div>`;
  t.style.opacity = 1; let x = e.clientX + 16, y = e.clientY + 16;
  if (x + 220 > innerWidth) x = e.clientX - 220; if (y + 80 > innerHeight) y = e.clientY - 80;
  t.style.left = x + "px"; t.style.top = y + "px";
}

/* ============================ search (area names + addresses) ============================ */
function buildAreaIndex() {
  const out = [];
  for (const d in DISTRICTS) {
    out.push({ label: d, sub: "District", go: () => navigate([wcCrumb(), { type: "district", name: d }]) });
    DISTRICTS[d].munis.forEach(m => {
      out.push({ label: m, sub: d, go: () => navigate([wcCrumb(), { type: "district", name: d }, { type: "municipality", name: m }]) });
      townsOf(m).forEach(t => out.push({ label: t.name, sub: m, go: () => navigate([wcCrumb(), { type: "district", name: d }, { type: "municipality", name: m }]) }));
    });
  }
  return out;
}
function wireSearch() {
  const inp = $("search"); let timer;
  inp.addEventListener("input", () => { clearTimeout(timer); const q = inp.value.trim(); if (q.length < 2) return hideResults(); timer = setTimeout(() => runSearch(q), 150); });
  inp.addEventListener("focus", () => { if (inp.value.trim().length >= 2) runSearch(inp.value.trim()); });
  document.addEventListener("click", e => { if (!e.target.closest("#search,#results")) hideResults(); });
}
function hideResults() { const r = $("results"); r.hidden = true; r.innerHTML = ""; }
async function runSearch(q) {
  if (!areaIndex) areaIndex = buildAreaIndex();
  const nq = norm(q);
  const areas = areaIndex.filter(x => norm(x.label).includes(nq)).slice(0, 6);
  let addrs = [];
  try { const db = (await ensureDB()).db;
    addrs = await db.query("SELECT muni,suburb,address,value FROM prop WHERE address LIKE ? COLLATE NOCASE AND value>0 ORDER BY value DESC LIMIT 6", [q + "%"]);
  } catch (e) { /* address search optional */ }
  const box = $("results"); box.innerHTML = "";
  const row = (label, sub, onClick, right) => {
    const d = document.createElement("div"); d.className = "o-clickable";
    d.style.cssText = "display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:10px 14px;border-bottom:1px solid rgba(26,23,20,.06);cursor:pointer";
    d.innerHTML = `<span style="font-size:13.5px;color:#1a1714">${label}</span><span style="font-size:10.5px;letter-spacing:.04em;color:#9a9286;text-transform:uppercase;white-space:nowrap">${right || sub}</span>`;
    d.onmousedown = onClick; box.appendChild(d);
  };
  areas.forEach(a => row(a.label, a.sub, () => { $("search").value = a.label; a.go(); }, a.sub));
  addrs.forEach(a => { const m = a.muni; row(a.address || "(erf)", m, () => {
    const f = muniByName[m]; if (f) navigate([wcCrumb(), { type: "district", name: f.properties.district }, { type: "municipality", name: m }]);
  }, R(a.value)); });
  if (!box.children.length) row("No matches", "", () => {}, "");
  box.hidden = false;
}
async function ensureDB() {
  if (dbw) return dbw;
  const mod = await import("https://cdn.jsdelivr.net/npm/sql.js-httpvfs@0.8.12/+esm");
  const createDbWorker = mod.createDbWorker || mod.default.createDbWorker;
  const abs = p => new URL(p, location.href).href;
  dbw = await createDbWorker([{ from: "jsonconfig", configUrl: abs("data/db/config.json") }],
    abs("assets/vendor/sqlite.worker.js"), abs("assets/vendor/sql-wasm.wasm"));
  return dbw;
}
