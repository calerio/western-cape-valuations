async (page) => {
  // Task 11: the map page on a phone (390×844, DPR 3, touch), plain.html with the production ?db= build.
  // Before a click, the chrome (search, view/language bar, chips, brand, map controls) covers ≤ 25% of
  // the viewport height; #maphint is a pointer-events:none status line, not a control, and is reported
  // separately. Clicking the fixture parcel (Drakenstein erf 97) opens #ppanel as a bottom sheet in
  // data-sheet="peek" (≤ 40vh) with badge + address + value fully visible, #attribBtn above the sheet's
  // top edge, and the map panned so the parcel sits in the upper half (y < 422, target 30% ≈ 253). The
  // #pgrab handle (aria-label "Expand") toggles peek ↔ open (85vh); an upward drag > 40 px opens; a
  // downward drag from open returns to peek and from peek closes. No horizontal overflow throughout.
  // Serve the worktree on :8766 (python3 -m http.server 8766).
  const OUT = '/Users/valeriocosta/projects/western-cape-property-valuations/.playwright-mcp/perf/';
  const BASE = 'http://127.0.0.1:8766/';
  const DB = 'https://pub-dbe35b2129524bf1965d77e99d6989a6.r2.dev/b-93c01c0b6202/config.json';
  const FIX = { muni: 'Drakenstein', erf: '97', x: 18.996231, y: -33.673691 };
  const VW = 390, VH = 844;
  const ctx = await page.context().browser().newContext({
    viewport: { width: VW, height: VH }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'en-US' });
  await ctx.addInitScript(() => { try { localStorage.setItem('wcv-lang', 'en'); } catch (e) { } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 160)));
  const out = { errs };
  const overflow = () => p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  const noOverflow = o => o.sw === VW && o.cw === VW;

  await p.goto(BASE + 'plain.html?db=' + encodeURIComponent(DB) + '&t=mobilemap', { waitUntil: 'load' });
  await p.waitForFunction(() => window._map && window._map.isStyleLoaded(), null, { timeout: 30000 });
  await p.waitForTimeout(2000);

  // controls before a click: the union of the visible chrome's vertical extents
  out.controls = await p.evaluate(() => {
    const sels = ['#brand', '#topbar', '#searchWrap', '#chips', '#attribBtn', '.maplibregl-ctrl-top-right', '.maplibregl-ctrl-top-left',
      '.maplibregl-ctrl-bottom-left', '.maplibregl-ctrl-bottom-right'];
    const boxes = [];
    for (const s of sels) for (const el of document.querySelectorAll(s)) {
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      if (r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden') boxes.push({ s, top: Math.max(0, r.top), bottom: Math.min(innerHeight, r.bottom) });
    }
    const iv = boxes.map(b => [b.top, b.bottom]).sort((a, b) => a[0] - b[0]);
    let covered = 0, cur = null;
    for (const [a, b] of iv) { if (!cur || a > cur[1]) { if (cur) covered += cur[1] - cur[0]; cur = [a, b]; } else cur[1] = Math.max(cur[1], b); }
    if (cur) covered += cur[1] - cur[0];
    const h = document.getElementById('maphint'), hr = h.getBoundingClientRect();
    return { covered: Math.round(covered), share: +(covered / innerHeight).toFixed(3), boxes: boxes.map(b => `${b.s} ${Math.round(b.top)}-${Math.round(b.bottom)}`),
      hint: h.hidden ? null : `${Math.round(hr.top)}-${Math.round(hr.bottom)}` };
  });
  out.controlsOk = out.controls.share <= 0.25;
  out.overflow0 = await overflow();
  await p.screenshot({ path: OUT + 'mobile-map-idle.png' });

  // the fixture parcel: jump there, wait for its tile, click it
  await p.evaluate(([x, y]) => window._map.jumpTo({ center: [x, y], zoom: 18 }), [FIX.x, FIX.y]);
  await p.waitForFunction(([x, y]) => { const m = window._map; return m.queryRenderedFeatures(m.project([x, y]), { layers: ['parcels-fill'] }).length > 0; },
    [FIX.x, FIX.y], { timeout: 30000 });
  out.yBefore = await p.evaluate(([x, y]) => Math.round(window._map.project([x, y]).y), [FIX.x, FIX.y]);
  await p.evaluate(([x, y]) => { const m = window._map; const pp = m.project([x, y]); m.fire('click', { point: pp, lngLat: m.unproject(pp), originalEvent: {} }); }, [FIX.x, FIX.y]);
  try {
    await p.waitForFunction(() => { const b = document.querySelector('#pbody .badge'); const txt = (document.getElementById('pbody') || {}).innerText || '';
      return b && !/Looking up/.test(txt); }, null, { timeout: 45000 });
  } catch (e) { out.settleErr = String(e).slice(0, 120); }
  await p.waitForTimeout(700);   // the 300 ms pan + the sheet's max-height transition

  const sheet = () => p.evaluate(([x, y]) => {
    const P = document.getElementById('ppanel'), r = P.getBoundingClientRect();
    const vis = el => { if (!el) return null; const e = el.getBoundingClientRect();
      return { top: Math.round(e.top), bottom: Math.round(e.bottom), inside: e.height > 0 && e.top >= r.top - 0.5 && e.bottom <= r.bottom + 0.5 && e.bottom <= innerHeight }; };
    const a = document.getElementById('attribBtn').getBoundingClientRect();
    const g = document.getElementById('pgrab');
    return { hidden: P.hidden, state: P.dataset.sheet, top: Math.round(r.top), height: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right),
      bottom: Math.round(r.bottom), maxH: Math.round(0.4 * innerHeight),
      badge: vis(P.querySelector('#pbody .badge')), addr: vis(P.querySelector('#pbody .pAddr')), val: vis(P.querySelector('#pbody .pVal')),
      badgeText: (P.querySelector('#pbody .badge') || {}).textContent || null, addrText: (P.querySelector('#pbody .pAddr') || {}).textContent || null,
      valText: (P.querySelector('#pbody .pVal') || {}).textContent || null,
      attribBottom: Math.round(a.bottom), attribVisible: a.height > 0,
      grab: g ? { label: g.getAttribute('aria-label'), expanded: g.getAttribute('aria-expanded'), h: Math.round(g.getBoundingClientRect().height) } : null,
      parcelY: Math.round(window._map.project([x, y]).y), status: (document.getElementById('pstatus') || {}).textContent || null,
      statusOutside: !!document.getElementById('pstatus') && !P.contains(document.getElementById('pstatus')) };
  }, [FIX.x, FIX.y]);

  out.peek = await sheet();
  out.peekOk = !out.peek.hidden && out.peek.state === 'peek' && out.peek.height <= out.peek.maxH + 1 && out.peek.bottom === VH &&
    out.peek.left === 0 && out.peek.right === VW &&
    !!(out.peek.badge && out.peek.badge.inside && out.peek.addr && out.peek.addr.inside && out.peek.val && out.peek.val.inside) &&
    !!out.peek.grab && out.peek.grab.label === 'Expand' && out.peek.grab.expanded === 'false';
  out.attribOk = out.peek.attribVisible && out.peek.attribBottom <= out.peek.top;
  out.panOk = out.peek.parcelY < VH / 2 && out.peek.parcelY < out.peek.top;
  out.statusOk = !!out.peek.status && out.peek.statusOutside;
  out.overflowPeek = await overflow();
  await p.screenshot({ path: OUT + 'mobile-map-peek.png' });

  // handle: tap → open (85vh); tap again → peek
  await p.tap('#pgrab'); await p.waitForTimeout(400);
  out.open = await sheet();
  out.openOk = out.open.state === 'open' && out.open.height > out.peek.height && out.open.height <= Math.round(0.85 * VH) + 1 &&
    out.open.grab.label === 'Collapse' && out.open.grab.expanded === 'true' && out.open.attribBottom <= out.open.top;
  await p.screenshot({ path: OUT + 'mobile-map-open.png' });
  await p.tap('#pgrab'); await p.waitForTimeout(400);
  out.backToPeek = (await sheet()).state === 'peek';

  // drags: Pointer Events on #pgrab via page.mouse (works in Chromium and WebKit); the click that
  // follows a completed drag must not also toggle the handle
  const swipe = async (dy) => {
    const r = await p.locator('#pgrab').boundingBox();
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    await p.mouse.move(x, y); await p.mouse.down();
    await p.mouse.move(x, y + dy / 2, { steps: 3 }); await p.mouse.move(x, y + dy, { steps: 3 }); await p.mouse.up();
    await p.waitForTimeout(50);
    return p.evaluate(() => { const P = document.getElementById('ppanel'); return P.hidden ? 'closed' : P.dataset.sheet; });
  };
  out.swipeSmall = await swipe(-20); await p.waitForTimeout(300);          // ≤ 40 px: no change
  out.swipeUp = await swipe(-120); await p.waitForTimeout(400);            // → open
  out.swipeDown1 = await swipe(80); await p.waitForTimeout(400);           // open → peek
  out.swipeDown2 = await swipe(80); await p.waitForTimeout(400);           // peek → closed
  out.afterClose = await p.evaluate(() => ({ hidden: document.getElementById('ppanel').hidden,
    sheetH: getComputedStyle(document.documentElement).getPropertyValue('--sheet-h').trim(),
    attribBottom: Math.round(document.getElementById('attribBtn').getBoundingClientRect().bottom), sel: /[#&]s=/.test(location.hash) }));
  out.swipeOk = out.swipeSmall === 'peek' && out.swipeUp === 'open' && out.swipeDown1 === 'peek' && out.swipeDown2 === 'closed' &&
    out.afterClose.hidden && out.afterClose.sheetH === '0px' && !out.afterClose.sel && out.afterClose.attribBottom >= VH - 60;

  // reopening starts at peek again
  await p.evaluate(([x, y]) => { const m = window._map; const pp = m.project([x, y]); m.fire('click', { point: pp, lngLat: m.unproject(pp), originalEvent: {} }); }, [FIX.x, FIX.y]);
  try { await p.waitForFunction(() => !document.getElementById('ppanel').hidden, null, { timeout: 15000 }); } catch (e) { }
  await p.waitForTimeout(500);
  out.reopen = await p.evaluate(() => document.getElementById('ppanel').dataset.sheet);
  // closing mid-lookup: the panel must stay closed when the in-flight lookup lands
  // (click and close in the same evaluate: pickParcel awaits before rendering, so even a cached lookup
  // lands after the close — the race is exercised whether or not erf 97 is cached)
  out.midLookupOpenBefore = await p.evaluate(([x, y]) => { const m = window._map; const pp = m.project([x, y]);
    m.fire('click', { point: pp, lngLat: m.unproject(pp), originalEvent: {} });
    const wasOpen = !document.getElementById('ppanel').hidden;
    document.getElementById('pclose').click();
    return wasOpen; }, [FIX.x, FIX.y]);
  await p.waitForTimeout(3000);
  out.staysClosed = await p.evaluate(() => document.getElementById('ppanel').hidden);

  out.overflowEnd = await overflow();
  out.overflowOk = [out.overflow0, out.overflowPeek, out.overflowEnd].every(noOverflow);
  out.verdict = (out.controlsOk && out.peekOk && out.attribOk && out.panOk && out.statusOk && out.openOk && out.backToPeek &&
    out.swipeOk && out.reopen === 'peek' && out.staysClosed && out.midLookupOpenBefore && out.overflowOk && !errs.length) ? 'PASS' : 'FAIL';
  await ctx.close();
  return out;
}
