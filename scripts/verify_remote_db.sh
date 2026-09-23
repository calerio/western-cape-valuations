#!/bin/bash
# Verify that a search.db build can be reconstructed ENTIRELY from its public host + a tracked manifest.
#
#   scripts/verify_remote_db.sh <manifest.json> [--base <url-prefix>]
#   scripts/verify_remote_db.sh <manifest.json> [<url-prefix>]            (same, positional form)
#
#   scripts/verify_remote_db.sh data/db/manifest.json
#       downloads every chunk from the URL written in the manifest (chunks[].url)
#   scripts/verify_remote_db.sh data/db/manifest.json \
#       --base https://pub-dbe35b2129524bf1965d77e99d6989a6.r2.dev/b-93c01c0b6202/
#       replaces the directory of every chunk URL with <url-prefix>, so a manifest whose bytes still name
#       another host (e.g. Supabase) can be verified against the copy on Cloudflare R2.
#
# Checks: each chunk's size + sha256, concatenation in manifest order, the whole-file sha256 and size,
# PRAGMA integrity_check. It then fetches config.json and manifest.json from the same base (the base
# given, or the manifest's remote_prefix / the directory of the first chunk URL) and requires
# config.buildId == manifest.build_id == link_meta.build_id inside the reconstructed DB, plus
# config.sha256 == the local manifest's sha256. Exit status is non-zero on any mismatch.
set -euo pipefail
MAN="${1:?usage: verify_remote_db.sh <manifest.json> [--base <url-prefix>]}"; shift
BASE=""
if [ $# -gt 0 ]; then
  case "$1" in
    --base) BASE="${2:?--base needs a url prefix}" ;;
    --base=*) BASE="${1#--base=}" ;;
    *) BASE="$1" ;;
  esac
fi
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
python3 - "$MAN" "$TMP" "$BASE" <<'PY'
import hashlib, json, os, sqlite3, subprocess, sys
man, tmp, base = json.load(open(sys.argv[1])), sys.argv[2], sys.argv[3]
if base and not base.endswith('/'):
    base += '/'
def url_of(ch):
    return base + ch['name'] if base else ch['url']
if not base:
    base = man.get('remote_prefix') or man['chunks'][0]['url'].rsplit('/', 1)[0] + '/'
print('chunks from:', base if sys.argv[3] else '(manifest chunk URLs)')
whole = hashlib.sha256(); out = os.path.join(tmp, 'search.db')
with open(out, 'wb') as o:
    for ch in man['chunks']:
        p = os.path.join(tmp, ch['name'])
        subprocess.run(['curl', '-fsS', '-o', p, url_of(ch)], check=True)
        data = open(p, 'rb').read()
        assert len(data) == ch['size_bytes'] and hashlib.sha256(data).hexdigest() == ch['sha256'], f"chunk {ch['name']} mismatch"
        o.write(data); whole.update(data); os.remove(p)
        print(f"  ok {ch['name']} {len(data)} bytes")
assert os.path.getsize(out) == man['size_bytes'] and whole.hexdigest() == man['sha256'], 'whole-file mismatch'
con = sqlite3.connect(f'file:{out}?mode=ro', uri=True)
assert con.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
has_link = bool(con.execute("SELECT 1 FROM sqlite_master WHERE name='link'").fetchone())
print('reconstructed OK:', man.get('schema'), '| prop rows', con.execute('SELECT COUNT(*) FROM prop').fetchone()[0],
      '| link rows', con.execute('SELECT COUNT(*) FROM link').fetchone()[0] if has_link else 0)

def fetch_json(name):
    r = subprocess.run(['curl', '-fsS', '--max-time', '60', base + name], capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f'FAIL: could not fetch {base}{name} ({r.stderr.strip()})')
    return json.loads(r.stdout)
cfg, rman = fetch_json('config.json'), fetch_json('manifest.json')
has_meta = bool(con.execute("SELECT 1 FROM sqlite_master WHERE name='link_meta'").fetchone())
db_build = con.execute("SELECT value FROM link_meta WHERE key='build_id'").fetchone() if has_meta else None
db_build = db_build[0] if db_build else None
print(f"build_id  config.json {cfg.get('buildId')} | manifest.json {rman.get('build_id')} | link_meta {db_build}")
problems = []
if not (cfg.get('buildId') == rman.get('build_id') == db_build):
    problems.append('build_id differs between config.json, manifest.json and link_meta')
if cfg.get('sha256') != man['sha256'] or rman.get('sha256') != man['sha256']:
    problems.append('remote config/manifest sha256 differs from the local manifest')
if cfg.get('databaseLengthBytes') != man['size_bytes']:
    problems.append('config.databaseLengthBytes differs from the manifest size_bytes')
if problems:
    sys.exit('FAIL: ' + '; '.join(problems))
print('build identity OK')
PY
