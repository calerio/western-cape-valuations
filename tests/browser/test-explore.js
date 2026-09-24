async (page) => {
  // Task 10: Explore lands on the province with no click; the ledger table sorts; the histogram, date
  // dots and SQL disclosures render from data/explore.json; #m/<slug> drills to the same sections
  // with towns; the map tooltip works (B3); the property dialog names the roll's own cycle (B4).
  // Serve the worktree on :8766 (python3 -m http.server 8766). The top-N list needs the search DB from the search-DB host (Cloudflare R2; see DATA_CONTRACT §8).
  const BASE = 'http://127.0.0.1:8766/';
  const ctx = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 160)));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)); });
  const out = { errs };
  const txt = sel => p.evaluate(s => { const e = document.querySelector(s); return e ? e.textContent.trim() : null; }, sel);
  const count = sel => p.evaluate(s => document.querySelectorAll(s).length, sel);
  const firstRow = () => txt('#secValue table tbody tr td.c-name');

  const t0 = Date.now();
  await p.goto(BASE + 'index.html', { waitUntil: 'domcontentloaded' });
  try {
    await p.waitForFunction(() => { const l = document.getElementById('loading'); return l && getComputedStyle(l).display === 'none'; }, null, { timeout: 2000 });
    out.loadingMs = Date.now() - t0;
  } catch (e) { out.loadingMs = null; }
  out.loadingOk = out.loadingMs != null && out.loadingMs <= 2000;
  await p.waitForFunction(() => document.querySelectorAll('#secValue table tbody tr').length > 0, null, { timeout: 10000 });

  // headline without any click
  out.hash = await p.evaluate(() => location.hash);
  out.scope = await txt('#scopeLabel');
  out.statTotal = await txt('#statTotal');
  out.headlineOk = !!out.statTotal && out.statTotal !== '—' && /^R/.test(out.statTotal) && out.scope === 'Western Cape';

  // ledger table: ≥ 8 rows, header sort changes the first row
  out.rows = await count('#secValue table tbody tr');
  out.first0 = await firstRow();
  await p.click('#secValue th[data-sort="median"]');
  out.first1 = await firstRow();
  out.sortAria = await p.evaluate(() => document.querySelector('#secValue th[data-sort="median"]').getAttribute('aria-sort'));
  out.tableOk = out.rows >= 8 && out.first0 !== out.first1 && out.sortAria === 'descending';
  await p.click('#secValue button.more');
  out.rowsAll = await count('#secValue table tbody tr');

  // histogram, date dots (one per roll WITH a stated date — explore.json has 12 dated + 13 "date not stated";
  // the brief's "≥ 20" cannot hold without inventing dates, so the check is: dots === dated rolls)
  out.bins = await count('#secSpread svg rect.bin');
  out.circles = await count('#secDates circle');
  out.dated = await p.evaluate(async () => (await (await fetch('data/explore.json?v=1')).json()).dates.filter(d => d.valued_as_at).length);
  out.undatedListed = await p.evaluate(() => { const u = document.querySelector('#secDates .c-undated'); return u ? u.querySelectorAll('span').length : 0; });
  out.chartsOk = out.bins === 22 && out.circles === out.dated && out.circles >= 10 && out.undatedListed >= 1;

  // "How this is computed" opens and shows SQL
  await p.click('#secSpread details.how summary');
  out.howOpen = await p.evaluate(() => document.querySelector('#secSpread details.how').open);
  out.howSql = /SELECT/.test(await txt('#secSpread details.how pre') || '');
  out.findings = await count('#secFindings ol.findings li');

  // B3: hovering a municipality shows the tooltip (no ReferenceError from the shadowed t)
  const pt = await p.evaluate(() => {
    for (const el of document.querySelectorAll('#map svg path.o-clickable')) {
      const b = el.getBoundingClientRect(); if (b.width < 20) continue;
      const x = b.left + b.width / 2, y = b.top + b.height / 2;
      if (document.elementFromPoint(x, y) === el) return { x, y };
    }
    return null;
  });
  if (pt) { await p.mouse.move(pt.x - 2, pt.y); await p.mouse.move(pt.x, pt.y); await p.waitForTimeout(250); }
  out.tip = await p.evaluate(() => { const t = document.getElementById('tip'); return { op: getComputedStyle(t).opacity, text: t.textContent.trim().slice(0, 60) }; });
  out.tipOk = !!pt && +out.tip.op > 0.5 && out.tip.text.length > 3;
  await p.mouse.move(5, 5);

  // drill: #m/stellenbosch → same sections, towns table
  await p.evaluate(() => { location.hash = '#m/stellenbosch'; });
  await p.waitForFunction(() => document.getElementById('scopeLabel').textContent === 'Stellenbosch', null, { timeout: 5000 });
  await p.waitForTimeout(300);
  out.muni = {
    nameHead: await txt('#secValue th[data-sort="name"]'), rows: await count('#secValue table tbody tr'),
    bins: await count('#secSpread svg rect.bin'), mix: await count('#secMix svg rect.seg'), dots: await count('#secDates circle'),
    findings: await count('#secFindings ol.findings li'), crumbs: await txt('#crumbs'), sub: await txt('#scopeSub'),
  };
  out.drillOk = out.muni.nameHead === 'Town or suburb' && out.muni.rows >= 8 && out.muni.bins === 22 && out.muni.mix > 0 && out.muni.dots > 0 && out.muni.findings > 0;

  // capped municipality: towns.json keeps at most 40 places, so a share must divide by the
  // municipality's stats.json total, not by the sum of the listed towns; the unlisted remainder shows
  await p.evaluate(() => { location.hash = '#m/swellendam'; });
  await p.waitForFunction(() => document.getElementById('scopeLabel').textContent === 'Swellendam', null, { timeout: 5000 });
  await p.waitForTimeout(300);
  out.capped = await p.evaluate(async () => {
    const [T, S] = await Promise.all([fetch('data/towns.json').then(r => r.json()), fetch('data/stats.json').then(r => r.json())]);
    let mt = null; Object.values(S.districts).forEach(d => { if (d.municipalities.Swellendam) mt = d.municipalities.Swellendam.total; });
    const towns = T.Swellendam || [], top = towns.slice().sort((a, b) => b.total - a.total)[0];
    const listed = towns.reduce((a, t) => a + t.total, 0);
    const bar = document.querySelector('#secValue table tbody tr svg.c-share');
    return {
      topName: top && top.name, rowName: (document.querySelector('#secValue table tbody tr td.c-name') || {}).textContent,
      expected: top && mt ? (top.total / mt * 100).toFixed(1) + '%' : null,
      wrongListedShare: top ? (top.total / listed * 100).toFixed(1) + '%' : null,
      aria: bar && bar.getAttribute('aria-label'),
      // collapsed list: no remainder row (it would read as "the rows below"); expanded: the row is there
      restRowCollapsed: !!document.querySelector('#secValue table tfoot tr.rest'),
      restRow: await (async () => { const b = document.querySelector('#secValue button.more'); if (!b) return false;
        b.click(); await new Promise(r => requestAnimationFrame(r));
        const ok = !!document.querySelector('#secValue table tfoot tr.rest svg.c-share');
        const b2 = document.querySelector('#secValue button.more'); if (b2) b2.click(); return ok; })(),
      restNote: [...document.querySelectorAll('#secValue p.note')].some(n => /not listed/.test(n.textContent)),
      more: (document.querySelector('#secValue button.more') || {}).textContent || null,
    };
  });
  out.cappedOk = !!out.capped.expected && out.capped.aria === out.capped.expected && out.capped.aria !== out.capped.wrongListedShare &&
    out.capped.rowName === out.capped.topName && !out.capped.restRowCollapsed && out.capped.restRow && out.capped.restNote && !/Show all/.test(out.capped.more || '');

  // fonts
  out.plex = await p.evaluate(async () => { await document.fonts.ready; return document.fonts.check('16px "IBM Plex Sans"'); });

  // B4: the property dialog names the municipality's own cycle (Witzenberg 2023-2027), never "2024 / 25"
  await p.evaluate(() => { location.hash = '#m/witzenberg'; });
  await p.waitForFunction(() => document.getElementById('scopeLabel').textContent === 'Witzenberg', null, { timeout: 5000 });
  await p.click('#hiCard');
  try {
    await p.waitForSelector('#tlBody .tlRow', { timeout: 45000 });
    await p.click('#tlBody .tlRow');
    await p.waitForSelector('#propdetail.open', { timeout: 5000 });
    out.pdCycle = await txt('#pdBody .pdCycle');
    out.pdText = (await txt('#pdBody')).slice(0, 160);
  } catch (e) { out.pdErr = String(e).slice(0, 120); }
  out.cycleOk = /2023.2027/.test(out.pdCycle || '') && !/2024 \/ 25/.test(out.pdText || '');

  out.verdict = (out.loadingOk && out.headlineOk && out.tableOk && out.chartsOk && out.howOpen && out.howSql && out.findings >= 3 &&
    out.tipOk && out.drillOk && out.cappedOk && out.plex && out.cycleOk && !errs.length) ? 'PASS' : 'FAIL';
  await ctx.close(); return out;
}
