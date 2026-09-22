#!/bin/bash
# Verify that a search.db version can be reconstructed ENTIRELY from Supabase + a tracked manifest:
#   scripts/verify_remote_db.sh data/db/manifest-v9.json      (or data/db/manifest.json = current)
# Downloads every chunk listed in the manifest to a temp dir, checks each chunk's size + sha256,
# concatenates in manifest order, checks the whole-file sha256 and size, then PRAGMA integrity_check.
set -euo pipefail
MAN="${1:?manifest path}"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
python3 - "$MAN" "$TMP" <<'PY'
import hashlib, json, os, sqlite3, subprocess, sys
man, tmp = json.load(open(sys.argv[1])), sys.argv[2]
whole = hashlib.sha256(); out = os.path.join(tmp, 'search.db')
with open(out, 'wb') as o:
    for ch in man['chunks']:
        p = os.path.join(tmp, ch['name'])
        subprocess.run(['curl', '-fsS', '-o', p, ch['url']], check=True)
        data = open(p, 'rb').read()
        assert len(data) == ch['size_bytes'] and hashlib.sha256(data).hexdigest() == ch['sha256'], f"chunk {ch['name']} mismatch"
        o.write(data); whole.update(data); os.remove(p)
        print(f"  ok {ch['name']} {len(data)} bytes")
assert os.path.getsize(out) == man['size_bytes'] and whole.hexdigest() == man['sha256'], 'whole-file mismatch'
con = sqlite3.connect(f'file:{out}?mode=ro', uri=True)
assert con.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
print('reconstructed OK:', man.get('schema'), '| prop rows', con.execute('SELECT COUNT(*) FROM prop').fetchone()[0],
      '| link rows', con.execute('SELECT COUNT(*) FROM link').fetchone()[0] if con.execute("SELECT 1 FROM sqlite_master WHERE name='link'").fetchone() else 0)
PY
