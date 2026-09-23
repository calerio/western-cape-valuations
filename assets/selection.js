/* Selection + probe guards for the map click path (DATA_CONTRACT §9). Pure, DOM-free, unit-tested in
 * tests/selection.test.mjs (`node --test tests/`).
 *
 * createSelectionGuard — a monotonically increasing selection token. Every parcel selection begins a
 *   new token; an async lookup may only touch the panel while its token is still the current one, so
 *   a slow result for parcel A can never overwrite parcel B.
 * createProbeGate — caches a fact about the hosted DB ('present' | 'absent') only when the probe
 *   SUCCEEDED. A throwing probe (network, worker, integrity) yields 'error' and is never cached, so the
 *   next click probes again. There is no path from an error to a cached "absent".
 * lookupPath — the single decision of which lookup may run. Anything but a proven 'present'/'absent'
 *   fails closed to 'unavailable' (explicit state, never the legacy heuristic).
 */
export function createSelectionGuard() {
  let seq = 0;
  return {
    begin() { return ++seq; },
    isCurrent(token) { return token === seq; },
    current() { return seq; },
  };
}

export function createProbeGate(probe) {
  let cached = null, inflight = null;
  return {
    async state() {
      if (cached) return cached;
      if (!inflight) inflight = (async () => {
        try { cached = (await probe()) ? 'present' : 'absent'; return cached; }
        catch (_) { return 'error'; }
        finally { inflight = null; }
      })();
      return inflight;
    },
    reset() { cached = null; },
  };
}

export function lookupPath(gateState, linkDisabled) {
  if (linkDisabled) return 'heuristic';          // ?nolink=1 — explicit, intentional
  if (gateState === 'present') return 'link';
  if (gateState === 'absent') return 'heuristic'; // proven older DB without a link table
  return 'unavailable';                          // 'error' or anything unexpected: fail closed
}
