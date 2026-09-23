async (page) => {
  // Task 9: result panel states. One fixture parcel per link decision (the first `ok` case per decision in
  // extract/match/reports/smoke-final-b-93c01c0b6202/smoke.json). Per parcel: the badge (glyph + label per
  // STATE_BADGES), the smoke matrix's EN substrings (must / must-not), the "Why this result?" disclosure
  // (summary text; opened: <code> with the raw reason codes, a plain <p> without underscores), the
  // accepted_group sum line only when the link row's `complete` flag is 1, dialog semantics (role,
  // aria-labelledby → #pTitle, #pstatus aria-live polite carrying the badge label), focus on #pclose when
  // the panel opens, and Escape closing it with focus back on #map. Also: no middle dot in the kicker, the
  // singular "1 valuation", and the selection's `verified` feature-state for the accepted decisions.
  const OUT = '/Users/valeriocosta/projects/western-cape-property-valuations/.playwright-mcp/perf/';
  const BASE = 'http://127.0.0.1:8766/';
  const DB = 'https://nxeasppmwvzcqbbgrdvf.supabase.co/storage/v1/object/public/valuations/b-93c01c0b6202/config.json';
  const FIX = [
    { decision: 'accepted_high', muni: 'Beaufort West', prcl_key: 'W053C009000100000688000000', x: 22.58741, y: -32.364945, erf: '688' },
    { decision: 'review', muni: 'Beaufort West', prcl_key: 'W053C009000400000206000000', x: 23.00786, y: -32.092625, erf: '206' },
    { decision: 'ambiguous', muni: 'Beaufort West', prcl_key: 'W053C052000100000111000000', x: 23.759683, y: -31.963608, erf: '111' },
    { decision: 'not_in_roll', muni: 'Beaufort West', prcl_key: 'W053C009000100008595000000', x: 22.581325, y: -32.343101, erf: '8595' },
    { decision: 'abstain', muni: 'Beaufort West', prcl_key: 'W053C009000100001385000000', x: 22.59029, y: -32.365203, erf: '1385' },
    { decision: 'accepted_group', muni: 'Bitou', prcl_key: 'W047C039000800003359000000', x: 23.372927, y: -34.056917, erf: '3359' },
  ];
  // badge textContent = glyph + ' ' + label (assets/map/panel.js STATE_BADGES)
  const BADGE = {
    accepted_high: '✓ Verified', accepted_group: '✓ Verified property group (sectional scheme)',
    review: '? Possible match', ambiguous: '≡ Several entries fit', not_in_roll: '⊘ No valuation found',
    abstain: '⚠ Could not link',
  };
  // extract/match/smoke_matrix.py EXPECT
  const EXPECT = {
    accepted_high: [['municipal market value'], ['unverified', 'Could not link', 'Not in this data build']],
    accepted_group: [['sectional-title units'], ['municipal market value', 'Could not link']],
    review: [['possible match', 'Could not link'], ['Verified link']],
    ambiguous: [['several entries fit'], ['municipal market value', 'Verified link']],
    not_in_roll: [['No valuation found'], ['municipal market value', 'unverified']],
    abstain: [['Could not link'], ['municipal market value', 'Verified link']],
  };
  const ctx = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('wcv-lang', 'en'); } catch (e) { } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 160)));
  await p.goto(BASE + 'plain.html?db=' + encodeURIComponent(DB) + '&t=panelstates', { waitUntil: 'load' });
  await p.waitForFunction(() => window._map && window._map.isStyleLoaded());
  await p.waitForTimeout(2500);
  const jumpAndLoad = async (pt) => {
    await p.evaluate(([x, y]) => window._map.jumpTo({ center: [x, y], zoom: 18 }), [pt.x, pt.y]);
    await p.waitForFunction(([x, y]) => { const m = window._map; return m.queryRenderedFeatures(m.project([x, y]), { layers: ['parcels-fill'] }).length > 0; }, [pt.x, pt.y], { timeout: 30000 });
  };
  const fire = (pt) => p.evaluate(([x, y]) => { const m = window._map; const pp = m.project([x, y]); m.fire('click', { point: pp, lngLat: m.unproject(pp), originalEvent: {} }); return 'ok'; }, [pt.x, pt.y]);
  const settled = async () => {
    try {
      await p.waitForFunction(() => {
        const b = document.querySelector('#pbody .badge'); const txt = (document.getElementById('pbody') || {}).innerText || '';
        return b && !/Looking up/.test(b.textContent) && !/Looking up/.test(txt);
      }, null, { timeout: 45000 });
    } catch (e) { }
  };
  const out = { errs, cases: [] };
  for (const f of FIX) {
    const c = { decision: f.decision, erf: f.erf };
    await jumpAndLoad(f);
    await p.evaluate(() => { document.getElementById('pbody').innerHTML = ''; });
    const wasHidden = await p.evaluate(() => document.getElementById('ppanel').hidden);
    await fire(f); await settled();
    await p.waitForTimeout(300);   // the evidence disclosure is appended with the final render
    const r = await p.evaluate(async (key) => {
      const pbody = document.getElementById('pbody'), panel = document.getElementById('ppanel');
      const text = pbody.innerText.replace(/\s+/g, ' ');
      const badge = (pbody.querySelector('.badge') || {}).textContent || '';
      const det = pbody.querySelector('details.why');
      const summary = det ? det.querySelector('summary').textContent.trim() : null;
      let code = null, plain = null;
      if (det) { det.open = true; code = (det.querySelector('code') || {}).textContent || null; plain = (det.querySelector('p') || {}).textContent || null; }
      const link = await window._integrity.lookupLink(key);
      const status = document.getElementById('pstatus');
      const sel = (location.hash.match(/[#&]s=([A-Z0-9]+)/) || [])[1] || null;
      const fs = window._map.getFeatureState({ source: 'parcels', id: key });
      return {
        text: text.slice(0, 400), badge: badge.replace(/\s+/g, ' ').trim(), summary, code, plain,
        reasons: link && link.reasons, complete: link && link.complete, linkDecision: link && link.decision,
        role: panel.getAttribute('role'), labelledby: panel.getAttribute('aria-labelledby'),
        titleText: (document.getElementById('pTitle') || {}).textContent || null,
        statusLive: status && status.getAttribute('aria-live'), statusText: status && status.textContent,
        kickers: [...pbody.querySelectorAll('.pKick')].map(k => k.textContent),
        badgeCount: pbody.querySelectorAll('.badge').length, whyCount: pbody.querySelectorAll('details.why').length,
        active: document.activeElement && document.activeElement.id, selected: sel, featureState: fs,
      };
    }, f.prcl_key);
    Object.assign(c, r);
    const [must, mustNot] = EXPECT[f.decision];
    c.smokeOk = must.some(s => r.text.includes(s)) && !mustNot.some(s => r.text.includes(s));
    c.badgeOk = r.badge === BADGE[f.decision] && r.badgeCount === 1;
    const codes = String(r.reasons || '').split(',').map(s => s.trim()).filter(Boolean);
    c.whyOk = r.whyCount === 1 && r.summary === 'Why this result?' && !!r.code && codes.every(k => r.code.includes(k))
      && !!r.plain && !/_/.test(r.plain) && !/Evidence:/.test(r.text);
    c.sumOk = f.decision !== 'accepted_group' || (Number(r.complete) === 1) === /sum of the \d+ unit valuations/.test(r.text);
    c.dialogOk = r.role === 'dialog' && r.labelledby === 'pTitle' && !!r.titleText && r.statusLive === 'polite'
      && r.statusText === BADGE[f.decision].slice(2);
    c.focusOk = !wasHidden || r.active === 'pclose';
    c.kickerOk = r.kickers.length === 1 && !r.kickers.some(k => k.includes('·'));
    c.grammarOk = !/: 1 valuations/.test(r.text);
    c.verifiedOk = (f.decision === 'accepted_high' || f.decision === 'accepted_group') === !!(r.featureState && r.featureState.verified);
    c.selectedOk = r.selected == null || r.selected === f.prcl_key;
    if (f.decision === 'accepted_high') {
      await p.screenshot({ path: OUT + 'panel-accepted_high-map.png' });
      await p.click('button[data-basemap="sat"]'); await p.waitForTimeout(2500);
      await p.screenshot({ path: OUT + 'panel-accepted_high-sat.png' });   // judge the dense hatch at 0.55
      await p.click('button[data-basemap="map"]'); await p.waitForTimeout(1500);
    } else {
      await p.screenshot({ path: OUT + 'panel-' + f.decision + '.png' });
    }
    // Escape closes; focus returns to the map
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    const esc = await p.evaluate(() => ({ hidden: document.getElementById('ppanel').hidden,
      onMap: !!(document.activeElement && document.activeElement.closest && document.activeElement.closest('#map')) }));
    c.escapeOk = esc.hidden && esc.onMap;
    c.ok = c.smokeOk && c.badgeOk && c.whyOk && c.sumOk && c.dialogOk && c.focusOk && c.kickerOk && c.grammarOk && c.verifiedOk && c.selectedOk && c.escapeOk;
    c.text = c.text.slice(0, 200);
    out.cases.push(c);
  }
  out.passed = out.cases.filter(c => c.ok).length + '/' + out.cases.length;
  out.verdict = out.cases.every(c => c.ok) && !errs.length ? 'PASS' : 'FAIL';
  await ctx.close();
  return out;
}
