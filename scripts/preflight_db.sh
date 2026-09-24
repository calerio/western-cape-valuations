#!/bin/bash
# Pre-switch check for a published search-DB build. Run it on the config URL BEFORE pointing the site
# at a build (scripts/rollback_db.sh) and before merging a branch that changes the config URL.
#
#   scripts/preflight_db.sh <config-url>
#   scripts/preflight_db.sh https://pub-dbe35b2129524bf1965d77e99d6989a6.r2.dev/b-93c01c0b6202/config.json
#
# Fails (exit 1, with the reason) unless:
#   1. config.json answers 200 and has serverMode "chunked";
#   2. manifest.json next to it answers 200 with the same build_id and sha256 as config.json;
#   3. a ranged GET of the first chunk answers 206 with Accept-Ranges: bytes, and the response exposes
#      Content-Range, Accept-Ranges, Content-Length and ETag to the browser;
#   4. a request with Origin: https://calerio.github.io gets Access-Control-Allow-Origin;
#   5. Cache-Control on a chunk contains "immutable";
#   6. on r2.dev, when wrangler is logged in: `wrangler r2 bucket info wc-valuations-db` reports a size
#      below MAX_GB (default 3). Wrangler 4.137 has no object-list command, so the namespace count is not
#      checked here; the uploader (extract/match/upload_r2.sh) probes the known namespaces instead.
#      R2 bucket metrics lag uploads by a while, so a just-uploaded build may not be counted yet.
#      A size wrangler reports in an unexpected form prints a WARN line instead of counting as 0.
# Whole-build byte verification is separate: scripts/verify_remote_db.sh <manifest> --base <prefix>.
set -euo pipefail
CFG="${1:?usage: preflight_db.sh <config-url>}"
MAX_GB="${MAX_GB:-3}"
ORIGIN="https://calerio.github.io"
BUCKET="wc-valuations-db"
case "$CFG" in */config.json|*/config.json\?*) ;; *) echo "FAIL: expected a URL ending in /config.json"; exit 1 ;; esac
BASE="${CFG%%\?*}"; BASE="${BASE%config.json}"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*"; exit 1; }

code=$(curl -s -o "$TMP/config.json" -w '%{http_code}' --max-time 30 "$CFG") || code=000
[ "$code" = 200 ] || fail "config.json answered HTTP $code ($CFG)"
code=$(curl -s -o "$TMP/manifest.json" -w '%{http_code}' --max-time 30 "${BASE}manifest.json") || code=000
[ "$code" = 200 ] || fail "manifest.json answered HTTP $code (${BASE}manifest.json)"

read -r FIRST BUILD SHA < <(python3 - "$TMP/config.json" "$TMP/manifest.json" <<'PY'
import json, sys
try:
    cfg, man = json.load(open(sys.argv[1])), json.load(open(sys.argv[2]))
except ValueError as e:
    print('ERR', 'unparseable', str(e).replace(' ', '_')); sys.exit()
errs = []
if cfg.get('serverMode') != 'chunked': errs.append('config_serverMode_is_not_chunked')
if not cfg.get('buildId') or cfg.get('buildId') != man.get('build_id'): errs.append('build_id_differs_between_config_and_manifest')
if not cfg.get('sha256') or cfg.get('sha256') != man.get('sha256'): errs.append('sha256_differs_between_config_and_manifest')
if errs: print('ERR', ','.join(errs), '-'); sys.exit()
first = cfg.get('urlPrefix', 'search.db.') + '0' * int(cfg.get('suffixLength', 3))
print(first, cfg['buildId'], cfg['sha256'])
PY
)
[ "$FIRST" != ERR ] || fail "$(echo "$BUILD" | tr '_,' ' ;')"
echo "ok config.json + manifest.json: build_id $BUILD, sha256 ${SHA:0:12}"

CHUNK="${BASE}${FIRST}"
hdr=$(curl -s -D - -o /dev/null --max-time 60 -r 0-65535 -H "Origin: $ORIGIN" "$CHUNK" | tr -d '\r') || fail "ranged GET of $FIRST failed"
status=$(echo "$hdr" | awk 'NR==1{print $2}')
h() { echo "$hdr" | awk -v k="$1" 'tolower($0) ~ "^"k":" {sub(/^[^:]*:[ ]*/, ""); print; exit}'; }
[ "$status" = 206 ] || fail "ranged GET of $FIRST answered HTTP $status, expected 206"
[ "$(h accept-ranges)" = bytes ] || fail "Accept-Ranges is '$(h accept-ranges)', expected 'bytes'"
[ -n "$(h content-range)" ] || fail "no Content-Range on the ranged response"
acao=$(h access-control-allow-origin)
[ "$acao" = "$ORIGIN" ] || [ "$acao" = "*" ] || fail "no Access-Control-Allow-Origin for $ORIGIN (got '$acao')"
expose=$(h access-control-expose-headers | tr 'A-Z' 'a-z')
if [ "$acao" != "*" ]; then
  for want in content-range accept-ranges content-length etag; do
    echo "$expose" | tr ', ' '\n\n' | grep -qx "$want" || fail "Access-Control-Expose-Headers lacks $want (got '$expose')"
  done
fi
echo "$(h cache-control)" | grep -q immutable || fail "Cache-Control on $FIRST is '$(h cache-control)', expected immutable"
echo "ok $FIRST: 206, Accept-Ranges bytes, CORS $acao, exposes [$expose], $(h cache-control)"

case "$BASE" in
  https://*.r2.dev/*)
    info=$(cd "$TMP" && npx --no-install wrangler@4.137.0 r2 bucket info "$BUCKET" --json 2>/dev/null) || info=""
    if [ -z "$info" ]; then
      echo "skip bucket size: wrangler not logged in or not installed (npx wrangler login)"
    else
      INFO="$info" python3 - "$MAX_GB" <<'PY' || fail "bucket $BUCKET is at or above ${MAX_GB} GB"
import json, os, re, sys
raw = os.environ['INFO']
try:
    d = json.loads(raw[raw.index('{'):raw.rindex('}') + 1])
except ValueError:
    print(f"WARN: bucket size unknown (wrangler output not JSON); the {sys.argv[1]} GB limit is not checked"); sys.exit(0)
m = re.match(r'\s*([\d.]+)\s*([KMGT]?i?B)\s*$', str(d.get('bucket_size') or ''), re.I)
if not m:
    print(f"WARN: bucket {d.get('name')}: size unknown ({d.get('bucket_size')!r}); the {sys.argv[1]} GB limit is not checked")
    sys.exit(0)
mult = {'b': 1, 'kb': 1e3, 'mb': 1e6, 'gb': 1e9, 'tb': 1e12, 'kib': 1024, 'mib': 1024**2, 'gib': 1024**3, 'tib': 1024**4}
size = float(m.group(1)) * mult[m.group(2).lower()]
print(f"ok bucket {d.get('name')}: {d.get('bucket_size')} in {d.get('object_count')} objects (limit {sys.argv[1]} GB); namespace count not checked (no list command in wrangler 4.137)")
sys.exit(0 if size < float(sys.argv[1]) * 1e9 else 1)
PY
    fi ;;
esac
echo "PREFLIGHT OK: $CFG"
