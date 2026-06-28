# Learnings log

Running, append-only record of significant findings made while building Olatu —
things that were non-obvious, cost real debugging time, or invalidate an assumption
in the specs. Newest first. When a finding changes a decision, also fix the relevant
spec and link it here.

Format per entry: **date — title** · what we found · why it matters · resolution · refs.

---

## 2026-06-28 — Paraglide lowercases message keys; use snake_case from the start

**Finding.** Migrating i18n to **Paraglide JS v2** (spec 0006), the first pass kept the
old dot-keys naively snaked to camelCase (`cc.waveHeight` → `cc_waveHeight`). The
messageFormat plugin **lowercases identifiers** and de-duplicates collisions by appending
numeric suffixes — so `picker.mapLabel`/`picker.mapHint` compiled to
`picker_maplabel1`/`picker_maphint1`, and only **56 of 90** message files survived
(camelCase keys collided when lowercased and silently overwrote each other). Export names
became unpredictable, breaking `m.cc_waveHeight()` call sites.

**Why it matters.** Silent message loss + non-deterministic export names would have
shipped missing/empty strings. The fix is to author keys as **lowercase snake_case**
(`cc_wave_height`), which is Paraglide's own convention — then export name === JSON key,
deterministically (verified: 90 files, exact match).

**Resolution.** Regenerated `messages/{en,fr,es}.json` with a `camelCase→snake_case`
transform + a build-time collision assert. Static calls use `m.cc_wave_height()`; the
few dynamic keys use `m[`cc_${fresh}_help` as MessageKey]()`. The generated
`src/paraglide/` is gitignored and recompiled by the Vite plugin (and `npm run paraglide`
for standalone `tsc`). Refs: [0006](2026-06-28-0006-stack-migration-a11y.md) §5.

## 2026-06-28 — Tailwind v4 `@theme inline` keeps runtime theme-switching working

**Finding.** The canvas charts, inline SVG tints, MapLibre markers and `iconSvg()` read
the **raw CSS variables** (`--accent`, `--c-height`, `--text-3`…) and switch via
`[data-theme]`. A naive Tailwind v4 `@theme { --color-bg: #… }` would freeze those at
build time and break the dark/light toggle for utility-styled markup. Using
**`@theme inline { --color-bg: var(--bg) }`** makes utilities emit `var(--bg)` (a
reference, not a copy), so `bg-surface` stays theme-aware and the canvas keeps reading the
same raw vars. Consequence: components almost never need a `dark:` variant — the *token*
is theme-aware, so the whole dual-theme behaviour lives in ~40 lines of token defs.

**AA contrast.** The faint token `--text-3` failed WCAG AA for normal text (≈3.2–4.1 on
both themes). Nudged to `#7593a3` (dark) / `#566b78` (light) to clear 4.5 on every
surface, keeping it visibly secondary. The brand `--accent` (spec-chosen) is used for
large numbers / dots / borders (AA-large/UI thresholds) and is left as-is. Refs:
[0006](2026-06-28-0006-stack-migration-a11y.md) §3/§6.

## 2026-06-28 — HF **datasets** serve the browser (CORS + range); **buckets** don't (yet)

**Finding.** To get the churning data off git (a 30-min refresh would otherwise bloat
history with binary parquets), we moved all data to Hugging Face. The owner's instinct
was a **bucket** (`hadim/olatu`). But buckets are *working storage*: access is only via
`hf://`/mount/CLI/Python — "S3 API not supported", **no public browser URL**. A static
webapp needs a public HTTPS URL with **CORS** (hyparquet also wants range). Verified
empirically that a **dataset** `resolve/main/...` URL returns `200/206` with
`access-control-allow-origin` echoing the GH Pages origin and `accept-ranges: bytes` —
so datasets are browser-fetchable, buckets are not. HF's own docs say exactly this:
"promote final artifacts to a dataset for consumers." Trusted-publisher **OIDC supports
both** (`resource: datasets/…` or `buckets/…`), so CI auth doesn't force the choice.

**Why it matters.** It flips the data-ops design: the webapp reads tiers **at runtime**
from the dataset, so the every-30-min job is Python-only (pull → scrape → build →
upload) and **never rebuilds/redeploys the site**. The repo becomes code-only; foundation
§5.3's git-churn risk is dissolved. Keyless via OIDC — no `HF_TOKEN` secret.

**Resolution.** Data → dataset `hadim/olatu`, campaign-prefixed (`06403/raw`, `06403/data`).
`ingest/update.py` orchestrates it (OIDC token exchange for CI); webapp `DATA_BASE`
points at the dataset; `.github/workflows/refresh-data.yml` runs `*/30`. Switch `raw/`
to a bucket if/when bucket browser access lands. See [0004](2026-06-27-0004-realtime-scraper.md) §3/§6.

**Refs.** `ingest/update.py`; `webapp/src/lib/data.ts` (`DATA_BASE`); `.github/workflows/refresh-data.yml`.

---

## 2026-06-27 — The CANDHIS realtime "browser table" *is* the API (one GET, no Valider/POST)

**Finding.** `campagne.php` looks hostile to automate — PHP, a campaign must be
"selected", and the UI tells you to click **Valider** then **Télécharger**. None of
that is needed for realtime. Reverse-engineered live with a browser + a cold `httpx`
client: (1) the campaign is chosen by a **base64 query string**, not a session POST —
`campagne.php?Y2FtcD0wNjQwMw==` is literally `base64("camp=06403")`; (2) that single GET
**server-renders the full last-~48 h realtime table in the HTML** (≈97 rows incl.
`Temp. mer`), with no cookies/session priming; (3) the `Valider`→`Télécharger` dance
belongs to the *Archives* date-range CSV export (`?datA=YYYY-MM-DD+YYYY-MM-DD`), and the
form's `BtnTeleReel`/`BtnTeleArch` buttons have no JS — a bare POST just re-renders the
page; (4) the HTML values are **lossless** vs. the CSV (realtime is quantized — H 0.1 m,
period 0.1 s, dir 1°, temp 0.1 °C — so `0.6` == `0.6000`).

**Why it matters.** The whole "live-growing tail" (0001 §2.4) — and therefore *all*
sea-temperature history — hinges on automating this page. It turns out to be a trivial
`GET` + table parse, not a fragile multi-step form/session scrape.

**Resolution.** Built `ingest/scrape.py` (`pixi run scrape` / `pixi run update`): GET the
base64 URL → parse the HTML table → coalesce-merge into per-year `Candhis_06403_<YEAR>_reel.csv`.
Also hardened `build.py assemble()` from realtime-last-wins to **archive-preferred
column coalesce**, so accumulated realtime never clobbers the archive's rich/QC'd columns
once they overlap. Full design + safety rules in
[0004 — Realtime scraper](2026-06-27-0004-realtime-scraper.md).

**Refs.** `ingest/scrape.py`; `ingest/build.py` (`assemble`); spec 0004.

---

## 2026-06-27 — uPlot places ticks in the *browser's* timezone unless you set `tzDate`

**Finding.** Our axis tick labels are formatted via `Intl.DateTimeFormat({timeZone:
'Europe/Paris'})`, but uPlot chooses *where* to put ticks (the split instants) using
the **browser's** local timezone by default. For a viewer already in Paris (or in our
test env) the two agree and labels look round (`00:00`, `06:00`). For a viewer in
another zone, ticks land on *their* local midnights but get *labelled* in Paris time →
non-round labels (`01:30`, `07:30`).

**Why it matters.** Times across the app are deliberately shown in the buoy's local
zone (Europe/Paris), not the visitor's. The axis is the one place where uPlot's own
split logic could leak the visitor's zone and desync from our labels.

**Resolution.** Set `opts.tzDate = (ts) => uPlot.tzDate(new Date(ts * 1000), tz)` so
uPlot computes splits in Europe/Paris for everyone. Also added a small `◷ Europe/Paris`
label on the hover card so the display zone is explicit. (Decision confirmed with the
owner: keep buoy-local time, not the visitor's.)

**Refs.** `webapp/src/components/TimeSeries.tsx` (uPlot opts `tzDate`).

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
