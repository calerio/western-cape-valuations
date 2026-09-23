/* Map URL hash: which place / municipality, basemap, camera and selected parcel.
 *   #p/<place>&b=<map|sat>&c=<lng>,<lat>,<z>&s=<PRCL_KEY>
 *   #m/<slug>&…            (municipality deep link, e.g. from Explore)
 * <place> is the opaque key places.js emits (t<mp> | s<sp_sp…> | m<normname>).
 * Legacy forms (#p/<place>, #m/<slug>) parse unchanged. Pure: no DOM access. */

const BASEMAPS = ['map', 'sat'];
const PRCL_KEY = /^[A-Z0-9]+$/;

function parseCamera(v) {
  const parts = (v || '').split(',');
  if (parts.length !== 3) return undefined;
  const [lng, lat, z] = parts.map(p => (p.trim() === '' ? NaN : Number(p)));
  if (![lng, lat, z].every(Number.isFinite)) return undefined;
  return { lng, lat, z };
}

export function parseMapHash(hash, defaults = { b: 'map' }) {
  const fallbackB = BASEMAPS.includes(defaults && defaults.b) ? defaults.b : 'map';
  const out = {};
  const tokens = String(hash || '').replace(/^#/, '').split('&');
  const head = tokens[0] || '';
  let b, c, s, rest = tokens;
  if (/^[pm]\//.test(head)) {
    rest = tokens.slice(1);
    if (head.length > 2) out[head[0] === 'p' ? 'place' : 'muni'] = head.slice(2);
  }
  for (const tok of rest) {
    const eq = tok.indexOf('=');
    if (eq < 0) continue;
    const k = tok.slice(0, eq), v = tok.slice(eq + 1);
    if (k === 'b' && BASEMAPS.includes(v)) b = v;
    else if (k === 'c') c = parseCamera(v);
    else if (k === 's' && PRCL_KEY.test(v)) s = v;
  }
  out.b = b || fallbackB;
  if (c) out.c = c;
  if (s) out.s = s;
  return out;
}

export function buildMapHash(state = {}) {
  const parts = [];
  if (state.place) parts.push('p/' + state.place);
  else if (state.muni) parts.push('m/' + state.muni);
  if (state.b !== undefined) parts.push('b=' + state.b);
  const c = state.c;
  if (c && [c.lng, c.lat, c.z].every(Number.isFinite)) parts.push(`c=${c.lng},${c.lat},${c.z}`);
  if (state.s !== undefined) parts.push('s=' + state.s);
  return parts.length ? '#' + parts.join('&') : '';
}
