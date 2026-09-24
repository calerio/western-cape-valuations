# Incident: Supabase Storage quota restriction took down live parcel lookups (2026-09-24)

Times are CEST.

## Summary

The site's search database (the chunked SQLite file behind parcel lookups and address search) was
hosted on Supabase Storage, free plan, which allows 1 GB of storage for the organisation. Three new
builds were uploaded on 2026-09-22 and 2026-09-23 and the superseded ones were never deleted, so the
bucket held 1.96 GB. At about 01:07 on 2026-09-24 Supabase applied a Fair Use restriction
(`exceed_storage_size_quota`) and every storage read returned HTTP 402. Live parcel lookups failed
closed. The superseded builds were deleted at 01:37, but reads stayed at 402, because Supabase lifts
a restriction with a delay it does not specify. The database was moved to Cloudflare R2, with the
bytes unchanged, and the site now reads it from there.

## Impact

- **What users saw:** clicking a parcel on the map showed "Valuation data unavailable". Address search
  could not read the database either. No wrong valuation was shown: the lookup gate fails closed when
  it cannot read or verify the database.
- **What kept working:** the Explore page (statistics come from `data/explore.json`, `stats.json` and
  `towns.json` on GitHub Pages), the map itself (basemap, satellite, cadastral parcels, place search),
  and every static municipality, district and guide page.
- **Data:** no data was lost. The live build, `b-93c01c0b6202`, was never deleted, and its archived
  manifest allows a byte-for-byte check of any copy.

## Timeline

| When (CEST) | Event |
|---|---|
| 2026-09-22 ~19:00 | Build `b-9dadc03c7f1f` uploaded to Supabase (19 objects, 538 MB). |
| 2026-09-22 ~20:30 | Build `b-2b502178f94f` (build D) uploaded (19 objects, 542 MB). |
| 2026-09-23 12:53 | Build `b-93c01c0b6202` (build E, Matzikama repair) uploaded (19 objects, 542,099,494 bytes). |
| 2026-09-23 14:4x | Site switched to `b-93c01c0b6202`; verified 131/131. The older namespaces, and `v9` from July (11 objects, 333 MB), stayed in the bucket: 1.96 GB against a 1 GB quota. |
| 2026-09-24 ~01:07 | Supabase applies the Fair Use restriction `exceed_storage_size_quota`. Every storage read returns HTTP 402; parcel lookups fail closed. |
| 2026-09-24 | The Storage API refuses deletes while the project is restricted. |
| 2026-09-24 01:37 | The three superseded namespaces are deleted by exact object name through SQL on `storage.objects`, with the guard flag `storage.allow_delete_query` set for that transaction only. Only `b-93c01c0b6202` remains (19 objects, 542,099,494 bytes). Their `config.json` and `manifest.json` had been archived in the data repo first (`extract/db-manifests-archive/`). |
| 2026-09-24, after 01:37 | Reads still return 402. Supabase's documented immediate lever is a plan upgrade; otherwise the restriction lifts after an unspecified delay. |
| 2026-09-24 ~01:53 | `b-93c01c0b6202` uploaded unchanged to Cloudflare R2 (bucket `wc-valuations-db`); size, ranged GET, CORS and cache headers checked. |
| 2026-09-24 | Front end pointed at `https://pub-dbe35b2129524bf1965d77e99d6989a6.r2.dev/b-93c01c0b6202/config.json`. |

## Root cause

The procedure for switching the site to a new build did not include deleting the superseded
namespace, and nothing enforced a storage budget. Each build is about 540 MB, so the free plan's 1 GB
holds one build with little room to spare; the second upload already put the project over the quota.
An earlier overrun (July to August 2026, cleaned on 2026-09-22) had the same cause and was handled by
hand, without a check that would stop it from happening again.

## What was done

Objects deleted from the Supabase bucket `valuations` on 2026-09-24 at 01:37, by exact name:

| Namespace | Objects | Size | Build |
|---|---|---|---|
| `v9` | 11 | 333 MB | pre-immutable build of 2026-07-19 |
| `b-9dadc03c7f1f` | 19 | 538 MB | build of 2026-09-22, extent-corrected roll DB |
| `b-2b502178f94f` | 19 | 542 MB | build D, sectional schemes |

The exact object names and sizes are in the data repo's
`extract/db-manifests-archive/storage-inventory-2026-09-24.json`.

Then:

- Created the R2 bucket `wc-valuations-db` (location WEUR) with its public development endpoint and a
  CORS policy for `https://calerio.github.io` and the local development origins (GET and HEAD; `Range`
  allowed; `Content-Range`, `Accept-Ranges`, `Content-Length` and `ETag` exposed).
- Uploaded `b-93c01c0b6202` with the bytes unchanged: chunks with
  `Cache-Control: public, max-age=31536000, immutable`, `config.json` and `manifest.json` with
  `public, max-age=300`.
- Pointed `DB_CONFIG_URL` (`assets/map.js`) and `DB_CONFIG` (`assets/atlas.js`) at the R2 config URL.
  The fail-closed check still compares the build id in `config.json`, `manifest.json` and the
  database's `link_meta`.
- Kept the Supabase copy of `b-93c01c0b6202` as a temporary rollback copy.

## What changed to prevent a recurrence

- **Host:** Cloudflare R2. Its free tier allows 10 GB-month of storage, 10 million reads and 1 million
  writes a month, with no egress charge. A build is about 542 MB.
- **Storage budget:** at most two builds in the bucket, the live one and the previous one. Prune after
  every verified switch. Written into `DATA_CONTRACT.md` §2 and §8.
- **Uploader** (`extract/match/upload_r2.sh`, data repo): refuses when the bucket would exceed 3 GB
  (`MAX_GB`) or when two namespaces already exist (`MAX_BUILDS`); after a verified upload it prints
  which namespace would be pruned; `--prune <namespace>` deletes exactly that namespace's objects and
  refuses the one the live site reads.
- **Pre-switch check** (`scripts/preflight_db.sh <config-url>`): config and manifest reachable and
  consistent, ranged reads, CORS and cache headers correct, and the bucket below 3 GB. Mandatory
  before any switch.
- **Verifier** (`scripts/verify_remote_db.sh`): can read the chunks from a different host than the one
  a manifest names (`--base`) and compares the three build ids after reconstruction.
- **Export** (`extract/export_site.py`): new manifests record the R2 location (`WC_DB_BASE` overrides).
- **Supabase uploader** (`extract/match/upload_supabase.sh`): marked legacy.

## Open items

- At the time of writing, the Supabase restriction is still in place and storage reads still return
  HTTP 402. The Supabase copy can serve as a rollback target only after the restriction is lifted.
- The Supabase copy of `b-93c01c0b6202` is retained as a temporary rollback copy. It is removed once
  production has run on R2; after that, only what is deliberately required stays on Supabase.
- The site reads R2 through the public development endpoint (`r2.dev`). A custom data hostname needs a
  Cloudflare zone, which this site does not have; it is the follow-up if one is added.
- The manifest of `b-93c01c0b6202` still names Supabase in `remote_prefix` and `chunks[].url`, because
  the bytes were copied unchanged. The front end does not use those URLs; verify the R2 copy with
  `scripts/verify_remote_db.sh data/db/manifest.json --base https://pub-dbe35b2129524bf1965d77e99d6989a6.r2.dev/b-93c01c0b6202/`.
