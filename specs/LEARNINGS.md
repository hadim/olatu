# Learnings log

Running, append-only record of significant findings made while building Olatu —
things that were non-obvious, cost real debugging time, or invalidate an assumption
in the specs. Newest first. When a finding changes a decision, also fix the relevant
spec and link it here.

Format per entry: **date — title** · what we found · why it matters · resolution · refs.

---

## 2026-06-27 — Realtime CSV `Date` column is UTC (verified empirically)

**Finding.** The CANDHIS realtime export (`Candhis_06403_YYYY-MM-DD_reel.csv`) has a
single combined `Date` column (`2026-06-27 16:00:00`), **not** a separate `Heure (TU)`
field as the data dictionary claimed. Its values are **UTC**: a file downloaded at
18:34 CEST (16:34 UTC) had its newest row at `16:00:00` — ~34 min old in UTC, whereas
a local-Paris reading would have made the newest row ~2.5 h stale, which a live
"rolling 48 h" feed never is. Cross-checked in the app: a December daily bucket
(`00:00 UTC`) renders as `01:00` in the hover card (Europe/Paris = CET = UTC+1).

**Why it matters.** If the realtime `Date` were misread as local time, every live
reading + the staleness/age + the merged tail would be shifted +1/+2 h. The owner
flagged the doubt; confirming it closes a whole class of silent tz bugs.

**Resolution.** No code change — `REEL_MAP` already maps `Date → datetime_utc` as-is
and the frontend renders Europe/Paris via `Intl`. Corrected the wrong "splits Date +
`Heure (TU)`" note in [0002 §4.1](2026-06-27-0002-data-dictionary.md).

**Refs.** `ingest/schema.py` (`REEL_MAP`); `webapp/src/lib/format.ts`.

---

## 2026-06-27 — GitHub Pages gzips `.parquet`, which breaks HTTP range requests

**Finding.** GitHub Pages (Fastly) compresses `application/octet-stream` responses
with gzip when the browser sends `Accept-Encoding: gzip` (browsers always do), and
serves byte-ranges **against the compressed stream**. A ranged GET returns `206` with
`content-encoding: gzip` and a `content-range` total equal to the *gzipped* size
(e.g. `…/183086`) rather than the raw size (`221437`). `curl` without the header sees
no gzip, which is why a naive check looks fine.

**Why it matters.** hyparquet's `asyncBufferFromUrl` computes row-group/footer offsets
against the *raw* file and fetches them via ranges. Against gzipped ranges those
offsets are wrong → `parquet file invalid (footer != PAR1)` → the charts hung on
"loading". It worked locally because `vite preview` doesn't gzip. **This defeats the
whole "multi-row-group + range requests + column projection" optimization on GH
Pages** — you cannot control Pages' content-encoding.

**Resolution.** Fetch the **whole** Parquet file as an `ArrayBuffer`
(`fetch().arrayBuffer()` — the browser transparently decompresses gzip) and hand it
to hyparquet, which reads from memory. Column projection still applies in-memory (CPU,
not network). Tiers are sized to make this cheap (daily/hourly small; per-year ~1.5 MB,
gzipped in transit + browser-cached). Reproduced both failure (range) and fix
(whole-file) against the live URL before deploying.

**Spec impact.** Supersedes the range-request parts of
[0001 §5.1/§5.2](2026-06-27-0001-foundation.md#5-data-pipeline--storage-strategy):
keep Snappy + multi-row-group (harmless, good file hygiene) but **do not** rely on
range requests for loading; always fetch whole files. Revisit only if we put a CDN
(e.g. Cloudflare) in front that lets us disable gzip on `.parquet`.

**Refs.** `webapp/src/lib/parquet.ts`; commit `fdbd4a3`.

---

## 2026-06-27 — `vite-plugin-static-copy` v4 changed glob semantics; serve data from `public/`

**Finding.** After bumping `vite-plugin-static-copy` 3 → 4, copying `../data/*` into
the build produced a nested `dist/data/data/` and silently dropped the `year/`
subdirectory (only 5 of 6 items copied).

**Why it matters.** The per-year Parquet files were missing from the build with no
error — a silent data loss that only shows up at runtime.

**Resolution.** Dropped the plugin entirely and moved the generated tiers to
`webapp/public/data/`, which Vite serves natively in both dev and build (no plugin,
works under the `/olatu/` base). Ingest `--out` default updated accordingly.

**Spec impact.** Matches the `webapp/public/data` path already specified in
[0001 §5.1](2026-06-27-0001-foundation.md). **Refs.** `webapp/vite.config.js`; commit `746ee7a`.

---

## 2026-06-27 — `.gitignore`'s Python `lib/` pattern hid `webapp/src/lib/`

**Finding.** The inherited Python `.gitignore` had a generic `lib/` rule, which
matched the new frontend `webapp/src/lib/` and excluded the entire i18n/theme/data
layer from commits (no warning).

**Why it matters.** A whole code directory would have been missing from the repo /
deploy. Caught via `git status` showing the components but not `lib/`.

**Resolution.** Removed the stale `lib/` and `lib64/` Python-packaging patterns.
**Refs.** commit `440a7b6`.
