async (page) => {
  // Regression: stale-click race. Parcel A (Cape Town, scheme route → delayed City layer fetch) is clicked,
  // then parcel B (Drakenstein, accepted_high). A's late result must never replace B's panel.
  const OUT = '/Users/valeriocosta/projects/western-cape-property-valuations/.playwright-mcp/perf/';
  const DB = 'https://nxeasppmwvzcqbbgrdvf.supabase.co/storage/v1/object/public/valuations/b-93c01c0b6202/config.json';
  const A = { x: 18.444501, y: -33.985471, erf: '49888' }, B = { x: 18.996231, y: -33.673691, erf: '97' };
  const ctx = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 120)));
  await p.route('**/citymaps.capetown.gov.za/**', async route => { await p.waitForTimeout(9000); try { await route.abort(); } catch (e) { } });
  await p.goto('http://127.0.0.1:8765/plain.html?db=' + encodeURIComponent(DB) + '&t=race', { waitUntil: 'load' });
  await p.waitForFunction(() => window._map && window._map.isStyleLoaded());
  await p.waitForTimeout(2500);
  const jumpAndLoad = async (pt) => {
    await p.evaluate(([x, y]) => window._map.jumpTo({ center: [x, y], zoom: 18 }), [pt.x, pt.y]);
    await p.waitForFunction(([x, y]) => { const m = window._map; const q = m.queryRenderedFeatures(m.project([x, y]), { layers: ['parcels-fill'] }); return q.length > 0; }, [pt.x, pt.y], { timeout: 30000 });
  };
  const fire = (pt) => p.evaluate(([x, y]) => { const m = window._map; const pp = m.project([x, y]); m.fire('click', { point: pp, lngLat: m.unproject(pp), originalEvent: {} }); return 'ok'; }, [pt.x, pt.y]);
  const panel = () => p.evaluate(() => (document.getElementById('pbody') || {}).innerText || '');
  const out = { errs };
  await jumpAndLoad(A); await fire(A); out.tClickA = Date.now();
  await p.waitForTimeout(400);
  await jumpAndLoad(B); await fire(B); out.tClickB = Date.now();
  try { await p.waitForFunction(() => /municipal market value/.test((document.getElementById('pbody') || {}).innerText || ''), null, { timeout: 15000 }); } catch (e) { }
  out.panelAfterB = (await panel()).replace(/\s+/g, ' ').slice(0, 160);
  out.bShownMs = Date.now() - out.tClickB;
  await p.waitForTimeout(11000);   // A's chain (6 s abort + render) has certainly finished
  const later = (await panel()).replace(/\s+/g, ' ');
  out.panelLater = later.slice(0, 160);
  out.stillB = /municipal market value/.test(later) && new RegExp('Erf(?: / unit)? ' + B.erf + '\\b').test(later) && !/No valuation found|sectional|Could not link|Erf 49888/.test(later);
  out.stats = await p.evaluate(() => window._integrity.stats ? window._integrity.stats() : null);
  out.verdict = out.stillB ? 'PASS: B kept' : 'FAIL: A overwrote B';
  await p.screenshot({ path: OUT + 'race-after.png' });
  await ctx.close();
  return out;
}
