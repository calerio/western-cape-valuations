async (page) => {
  // Task 9: result panel error + loading states.
  //   (a) the DB config request is aborted → "⚠ Valuation data unavailable" badge (never the heuristic);
  //   (b) the build manifest answers {build_id:"bogus"} → build verification fails closed →
  //       "⚠ Data build could not be verified" badge + the verbatim "Not in this data build" heading;
  //   (c) loading: the "… Looking up valuation…" badge is in the panel within 100 ms of the click
  //       (a MutationObserver on #pbody timestamps it; measured on (b)'s click).
  const OUT = '/Users/valeriocosta/projects/western-cape-property-valuations/.playwright-mcp/perf/';
  const BASE = 'http://127.0.0.1:8766/';
  const DB = 'https://nxeasppmwvzcqbbgrdvf.supabase.co/storage/v1/object/public/valuations/b-2b502178f94f/config.json';
  const B = { x: 18.996231, y: -33.673691, erf: '97' };   // Drakenstein, accepted_high (test-race.js)
  const out = {};
  const open = async (tag, routeFn) => {
    const ctx = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(() => { try { localStorage.setItem('wcv-lang', 'en'); } catch (e) { } });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 160)));
    await routeFn(p);
    await p.goto(BASE + 'plain.html?db=' + encodeURIComponent(DB) + '&t=' + tag, { waitUntil: 'load' });
    await p.waitForFunction(() => window._map && window._map.isStyleLoaded());
    await p.waitForTimeout(2500);
    await p.evaluate(([x, y]) => window._map.jumpTo({ center: [x, y], zoom: 18 }), [B.x, B.y]);
    await p.waitForFunction(([x, y]) => { const m = window._map; return m.queryRenderedFeatures(m.project([x, y]), { layers: ['parcels-fill'] }).length > 0; }, [B.x, B.y], { timeout: 30000 });
    return { ctx, p, errs };
  };
  // fire the click from inside the page with a MutationObserver armed first: returns ms until the loading badge
  const fireTimed = (p) => p.evaluate(([x, y]) => new Promise(resolve => {
    const body = document.getElementById('pbody'); body.innerHTML = '';
    const t0 = performance.now(); let done = false;
    const check = () => {
      const b = body.querySelector('.badge');
      if (!done && b && b.textContent.includes('Looking up valuation')) { done = true; obs.disconnect(); resolve(Math.round(performance.now() - t0)); }
    };
    const obs = new MutationObserver(check); obs.observe(body, { childList: true, subtree: true, characterData: true });
    const m = window._map; const pp = m.project([x, y]); m.fire('click', { point: pp, lngLat: m.unproject(pp), originalEvent: {} });
    check();
    setTimeout(() => { if (!done) { done = true; obs.disconnect(); resolve(null); } }, 2000);
  }), [B.x, B.y]);
  const settled = async (p) => {
    try {
      await p.waitForFunction(() => { const b = document.querySelector('#pbody .badge'); return b && !/Looking up/.test(b.textContent); }, null, { timeout: 45000 });
    } catch (e) { }
    return p.evaluate(() => ({
      badge: ((document.querySelector('#pbody .badge') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
      text: document.getElementById('pbody').innerText.replace(/\s+/g, ' ').slice(0, 300),
      status: (document.getElementById('pstatus') || {}).textContent || null,
    }));
  };

  // (a) config aborted
  {
    const { ctx, p, errs } = await open('panelerr-a', p => p.route('**/b-2b502178f94f/config.json**', r => r.abort()));
    await p.evaluate(([x, y]) => { const m = window._map; const pp = m.project([x, y]); m.fire('click', { point: pp, lngLat: m.unproject(pp), originalEvent: {} }); }, [B.x, B.y]);
    const r = await settled(p);
    out.a = { ...r, errs };
    out.a.ok = r.badge === '⚠ Valuation data unavailable' && /Valuation data unavailable/.test(r.text)
      && !/municipal market value|portions or sectional|No town match/.test(r.text) && r.status === 'Valuation data unavailable';
    await p.screenshot({ path: OUT + 'panel-unavailable.png' });
    await ctx.close();
  }
  // (b) bogus manifest + (c) loading latency
  {
    const { ctx, p, errs } = await open('panelerr-b', p => p.route('**/b-2b502178f94f/manifest.json**',
      r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ build_id: 'bogus' }) })));
    const ms = await fireTimed(p);
    out.c = { loadingBadgeMs: ms, ok: ms != null && ms <= 100 };
    const r = await settled(p);
    out.b = { ...r, errs };
    out.b.ok = r.badge === '⚠ Data build could not be verified' && r.text.includes('Not in this data build')
      && !/municipal market value|Verified link/.test(r.text) && r.status === 'Data build could not be verified';
    await p.screenshot({ path: OUT + 'panel-integrity.png' });
    await ctx.close();
  }
  out.verdict = out.a.ok && out.b.ok && out.c.ok && !out.a.errs.length && !out.b.errs.length ? 'PASS' : 'FAIL';
  return out;
}
