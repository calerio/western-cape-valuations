async (page) => {
  // Matzikama suppression LIFTED (2026-09-24, DATA_CONTRACT §7b; gate: extract/tests/test_no_owner_names_in_exports.py
  // in the data repo): Matzikama rows show their street address again (map panel, Explore cards, search) and never
  // "Address unavailable" when the roll has one; other municipalities unchanged. BASE is set per run.
  const BASE = '__BASE__';
  const DB = 'https://pub-dbe35b2129524bf1965d77e99d6989a6.r2.dev/b-93c01c0b6202/config.json';
  const MZ = { x: 18.241641, y: -31.584797, erf: '24' }, DK = { x: 18.996231, y: -33.673691, erf: '97' };
  const ctx = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 120)));
  const out = { errs };
  const jumpAndLoad = async (pt) => { await p.evaluate(([x, y]) => window._map.jumpTo({ center: [x, y], zoom: 18 }), [pt.x, pt.y]); await p.waitForFunction(([x, y]) => { const m = window._map; return m.queryRenderedFeatures(m.project([x, y]), { layers: ['parcels-fill'] }).length > 0; }, [pt.x, pt.y], { timeout: 30000 }); };
  const fire = (pt) => p.evaluate(([x, y]) => { const m = window._map; const pp = m.project([x, y]); m.fire('click', { point: pp, lngLat: m.unproject(pp), originalEvent: {} }); return 'ok'; }, [pt.x, pt.y]);
  const settled = async () => { try { await p.waitForFunction(() => { const t = (document.getElementById('pbody') || {}).innerText || ''; return t.length > 10 && !/Looking up|Slaan waardasie/.test(t); }, null, { timeout: 40000 }); } catch (e) { } return (await p.evaluate(() => (document.getElementById('pbody') || {}).innerText || '')).replace(/\s+/g, ' '); };
  await p.goto(BASE + 'plain.html?db=' + encodeURIComponent(DB) + '&t=hotfix', { waitUntil: 'load' });
  await p.waitForFunction(() => window._map && window._map.isStyleLoaded()); await p.waitForTimeout(2000);
  await jumpAndLoad(MZ); await fire(MZ); const mz = await settled();
  out.mapMatzikama = mz.slice(0, 140); out.mapMatzikamaOk = /Walvisstraat/.test(mz) && !/Address unavailable/.test(mz) && /municipal market value/.test(mz);
  await jumpAndLoad(DK); await fire(DK); const dk = await settled();
  out.mapDrakenstein = dk.slice(0, 90); out.mapDrakensteinOk = /Mafilastraat/.test(dk) && !/Address unavailable/.test(dk);
  await p.screenshot({ path: '/Users/valeriocosta/projects/western-cape-property-valuations/.playwright-mcp/perf/hotfix-map.png' });
  // Explore: municipality page cards + search results + dialog
  await p.goto(BASE + 'index.html#m/matzikama', { waitUntil: 'load' });
  await p.waitForFunction(() => { const l = document.getElementById('loading'); return l && getComputedStyle(l).display === 'none'; }, null, { timeout: 60000 });
  await p.waitForTimeout(2500);
  out.hiLo = await p.evaluate(() => ['hiAddr', 'loAddr'].map(i => (document.getElementById(i) || {}).textContent));
  out.hiLoOk = out.hiLo.length === 2 && out.hiLo.every(x => !!x && x.trim().length > 2 && x !== 'Address unavailable' && /[A-Za-z]{3,}/.test(x));
  await p.fill('#search', 'Vredendal'); await p.waitForTimeout(4000);
  out.search = await p.evaluate(() => Array.from(document.querySelectorAll('#results [role=option] > span:first-child')).slice(0, 6).map(e => e.textContent.trim()));
  out.searchOk = out.search.length > 0 && !out.search.every(x => x === 'Address unavailable');
  await p.screenshot({ path: '/Users/valeriocosta/projects/western-cape-property-valuations/.playwright-mcp/perf/hotfix-explore.png' });
  out.verdict = (out.mapMatzikamaOk && out.mapDrakensteinOk && out.hiLoOk && out.searchOk) ? 'PASS' : 'FAIL';
  await ctx.close(); return out;
}
