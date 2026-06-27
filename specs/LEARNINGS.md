# Learnings log

Running, append-only record of significant findings made while building Olatu —
things that were non-obvious, cost real debugging time, or invalidate an assumption
in the specs. Newest first. When a finding changes a decision, also fix the relevant
spec and link it here.

Format per entry: **date — title** · what we found · why it matters · resolution · refs.

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
