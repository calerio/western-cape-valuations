/* Reduced-motion helpers: every animation duration goes through dur(). */
export function reducedMotion() {
  try { return typeof matchMedia === 'function' && !!matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; }
}
export function dur(ms) { return reducedMotion() ? 0 : ms; }
