#!/bin/bash
# One-step switch of the search DB the live site reads: point map.js + atlas.js at the given
# Supabase version prefix, bump the cache-busting ?v= on the pages, commit and push.
#   scripts/rollback_db.sh v9        # roll back to v9
#   scripts/rollback_db.sh v10       # forward again
# The chunks themselves stay on Supabase (valuations/<version>/); nothing is re-uploaded.
set -euo pipefail
VER="${1:?version prefix, e.g. v9}"
cd "$(dirname "$0")/.."
python3 - "$VER" <<'PY'
import re, sys
ver = sys.argv[1]
for f in ('assets/map.js', 'assets/atlas.js'):
    s = open(f).read()
    s2 = re.sub(r'(supabase\.co/storage/v1/object/public/valuations/)v\d+(/config\.json)', rf'\g<1>{ver}\g<2>', s)
    assert s2 != s or ver in s, f'{f}: configUrl not found'
    open(f, 'w').write(s2)
for f in ('map.html', 'plain.html', 'index.html'):
    s = open(f).read()
    open(f, 'w').write(re.sub(r'((?:map|atlas)\.js\?v=)(\d+)', lambda m: m.group(1) + str(int(m.group(2)) + 1), s))
print('configUrl ->', ver)
PY
grep -n "valuations/v" assets/map.js assets/atlas.js | head -4
git add assets/map.js assets/atlas.js map.html plain.html index.html
git -c user.name="$(git log -1 --format=%an)" -c user.email="$(git log -1 --format=%ae)" commit -qm "Search DB: point the site at ${VER}"
git push -q && echo "pushed: live site reads ${VER} once Pages deploys (~1 min)"
