#!/bin/bash
# One-step switch of the search DB the live site reads: point map.js + atlas.js at the given
# Supabase version prefix, bump the cache-busting ?v= on the pages, commit and push.
#   scripts/rollback_db.sh v9                 # roll back to v9
#   scripts/rollback_db.sh b-01aecf1bac29     # forward to an immutable, content-addressed build (Supabase)
#   scripts/rollback_db.sh https://pub-xxxx.r2.dev/b-93c01c0b6202/config.json   # any host: full config URL
# The chunks themselves stay on Supabase (valuations/<version>/); nothing is re-uploaded.
set -euo pipefail
VER="${1:?version prefix, e.g. v9}"
cd "$(dirname "$0")/.."
python3 - "$VER" <<'PY'
import re, sys
ver = sys.argv[1]
# VER is either a Supabase namespace (v9, b-<sha12>) or a FULL https://.../config.json URL (e.g. Cloudflare R2).
new_url = ver if ver.startswith('https://') else f'https://nxeasppmwvzcqbbgrdvf.supabase.co/storage/v1/object/public/valuations/{ver}/config.json'
for f in ('assets/map.js', 'assets/atlas.js'):
    s = open(f).read()
    s2, n = re.subn(r"https://[A-Za-z0-9./_-]+/config\.json", new_url, s)
    assert n >= 1, f'{f}: configUrl not found'
    open(f, 'w').write(s2)
for f in ('map.html', 'plain.html', 'index.html'):
    s = open(f).read()
    open(f, 'w').write(re.sub(r'((?:map|atlas)\.js\?v=)(\d+)', lambda m: m.group(1) + str(int(m.group(2)) + 1), s))
print('configUrl ->', new_url)
PY
grep -n -E "config\\.json" assets/map.js assets/atlas.js | head -4
git add assets/map.js assets/atlas.js map.html plain.html index.html
git -c user.name="$(git log -1 --format=%an)" -c user.email="$(git log -1 --format=%ae)" commit -qm "Search DB: point the site at ${VER}"
git push -q && echo "pushed: live site reads ${VER} once Pages deploys (~1 min)"
