async (page) => {
  // Regression: fail-open link-table gate. While the DB config is unreachable a click must render an explicit
  // unavailable state (never the legacy heuristic); once reachable again, the next click must use the link table.
  const OUT = '/Users/valeriocosta/projects/western-cape-property-valuations/.playwright-mcp/perf/';
  const DB = 'https://pub-dbe35b2129524bf1965d77e99d6989a6.r2.dev/b-93c01c0b6202/config.json';
  const B = { x: 18.996231, y: -33.673691, erf: '97' };
  const ctx = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 120)));
  let blocked = 0;
  const blocker = route => { blocked++; return route.abort(); };
  await p.route('**/b-93c01c0b6202/config.json**', blocker);
  await p.goto('http://127.0.0.1:8765/plain.html?db=' + encodeURIComponent(DB) + '&t=failopen', { waitUntil: 'load' });
  await p.waitForFunction(() => window._map && window._map.isStyleLoaded());
  await p.waitForTimeout(2500);
  const jumpAndLoad = async (pt) => {
    await p.evaluate(([x, y]) => window._map.jumpTo({ center: [x, y], zoom: 18 }), [pt.x, pt.y]);
    await p.waitForFunction(([x, y]) => { const m = window._map; return m.queryRenderedFeatures(m.project([x, y]), { layers: ['parcels-fill'] }).length > 0; }, [pt.x, pt.y], { timeout: 30000 });
  };
  const fire = (pt) => p.evaluate(([x, y]) => { const m = window._map; const pp = m.project([x, y]); m.fire('click', { point: pp, lngLat: m.unproject(pp), originalEvent: {} }); return 'ok'; }, [pt.x, pt.y]);
  const settled = async () => { try { await p.waitForFunction(() => { const t = (document.getElementById('pbody') || {}).innerText || ''; return t.length > 10 && !/Looking up|Slaan waardasie/.test(t); }, null, { timeout: 40000 }); } catch (e) { } return (await p.evaluate(() => (document.getElementById('pbody') || {}).innerText || '')).replace(/\s+/g, ' '); };
  const out = { errs };
  await jumpAndLoad(B); await fire(B);
  out.panelWhileBlocked = await settled();
  out.blockedRequests = blocked;
  out.gateWhileBlocked = await p.evaluate(async () => { try { return String(await window._integrity.hasLinkTable()); } catch (e) { return 'ERR:' + (e && e.message); } });
  await p.screenshot({ path: OUT + 'failopen-blocked.png' });
  await p.unroute('**/b-93c01c0b6202/config.json**', blocker);
  await p.waitForTimeout(500);
  await p.evaluate(() => { document.getElementById('pbody').innerHTML = ''; });
  await fire(B);
  out.panelAfterRecovery = await settled();
  out.gateAfterRecovery = await p.evaluate(async () => { try { return String(await window._integrity.hasLinkTable()); } catch (e) { return 'ERR:' + (e && e.message); } });
  out.usedLinkTable = /Verified link/.test(out.panelAfterRecovery);
  out.panelWhileBlocked = out.panelWhileBlocked.slice(0, 200); out.panelAfterRecovery = out.panelAfterRecovery.slice(0, 120) + ' … ' + out.panelAfterRecovery.slice(-90);
  out.heuristicWhileBlocked = /municipal market value|portions or sectional|same erf number, other townships|No town match/.test(out.panelWhileBlocked);
  out.verdict = (!out.heuristicWhileBlocked && out.usedLinkTable && out.gateAfterRecovery === 'true') ? 'PASS' : 'FAIL';
  await p.screenshot({ path: OUT + 'failopen-recovered.png' });
  await ctx.close();
  return out;
}
