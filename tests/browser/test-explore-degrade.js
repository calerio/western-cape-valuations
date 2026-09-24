async (page) => {
  // Task 10: explore.json unavailable → the headline figures and the ledger table still render from
  // stats.json; the explore-only sections (spread, contents, dates, findings) and the coverage strip hide.
  // The aborted request itself logs a "Failed to load resource" console line; that one is expected and
  // filtered — any other console error or page error fails the test.
  const BASE = 'http://127.0.0.1:8766/';
  const ctx = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
  await ctx.route('**/data/explore.json*', r => r.abort());
  const p = await ctx.newPage();
  const errs = [], expected = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 160)));
  p.on('console', m => { if (m.type() !== 'error') return; const s = m.text().slice(0, 160);
    (/Failed to load resource|ERR_FAILED/.test(s) ? expected : errs).push(s); });
  const out = { errs, expected };
  await p.goto(BASE + 'index.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => { const l = document.getElementById('loading'); return l && getComputedStyle(l).display === 'none'; }, null, { timeout: 10000 });
  await p.waitForTimeout(500);
  const txt = sel => p.evaluate(s => { const e = document.querySelector(s); return e ? e.textContent.trim() : null; }, sel);
  const hidden = id => p.evaluate(i => { const e = document.getElementById(i); return !e || e.hidden || getComputedStyle(e).display === 'none'; }, id);
  out.statTotal = await txt('#statTotal'); out.statMedian = await txt('#statMedian'); out.statParcels = await txt('#statParcels');
  out.headlineOk = [out.statTotal, out.statMedian, out.statParcels].every(v => v && v !== '—');
  out.rows = await p.evaluate(() => document.querySelectorAll('#secValue table tbody tr').length);
  out.hidden = { spread: await hidden('secSpread'), mix: await hidden('secMix'), dates: await hidden('secDates'), findings: await hidden('secFindings'), coverage: await hidden('coverage') };
  out.verdict = (out.headlineOk && out.rows >= 8 && Object.values(out.hidden).every(Boolean) && !errs.length) ? 'PASS' : 'FAIL';
  await ctx.close(); return out;
}
