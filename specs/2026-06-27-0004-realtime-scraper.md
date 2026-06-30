# 0004 — Realtime scraper (the live-growing tail)

- **Status:** Accepted (implemented)
- **Date:** 2026-06-27
- **Authors:** Hadrien Mary (owner) + implementation
- **Relates to:** [0001 — Foundation](2026-06-27-0001-foundation.md) (§2.4 append-only
  store, §5 data pipeline), [0002 — Data dictionary](2026-06-27-0002-data-dictionary.md)
  (§4.7 sea temperature, realtime column names), [LEARNINGS](LEARNINGS.md)

> Foundation §2.4 calls for a job that scrapes the CANDHIS realtime feed and **grows**
> the series forward — the only way sea-temperature history ever accumulates, since
> temperature exists *only* in the realtime feed and never in the archive. This spec
> pins how that scraper works and the merge-safety changes it requires. It refines
> 0001 §5; it does not supersede it.

> **Revision 2026-06-28 — data lives in a Hugging Face dataset, not git.** The original
> draft kept the reel CSVs + built tiers in the repo and committed them. To support a
> 30-min refresh without git churn (foundation §5.3's #1 risk) and to decouple the data
> from the site build, **all data now lives in the HF dataset `hadim/olatu`** and the
> webapp fetches the tiers at runtime. The scraper/merge/validation mechanics (§1–§5)
> are unchanged; the artifact location and operations (§3, §6, §7) are revised below.

> **Revision 2026-06-30 — the store is now a Hugging Face *bucket*, not a dataset repo.**
> §3 chose a dataset over a bucket because, at the time, buckets exposed no public browser
> URL. That is no longer true: HF shipped **S3-compatible Storage Buckets**, and a *public*
> bucket serves `…/buckets/<ns>/<name>/resolve/<key>` URLs that are **anonymous, CORS-enabled
> and range-capable** off the same CDN as dataset repos (verified against the GH Pages
> origin: `200`/`206`, `access-control-allow-origin: *`, `content-range`, preflight OK). So
> the data now lives in the **bucket `hadim/olatu`** with the *same* per-campaign layout, and
> the webapp reads it with a plain `fetch` (no S3 client; the S3 API itself needs SigV4 and
> is used only for writes). **Motivation:** buckets are mutable (overwrite-in-place), which
> removes the unbounded git-history growth the */30 commit stream caused on the dataset repo.
> **Cost:** buckets are *non-versioned*, so the forward-only reel has no rollback —
> `update.snapshot_reel` adds dated daily reel backups (`<campaign>/backup/<UTC-date>/`,
> 14-day retention) as the recovery net. **CI auth** is unchanged in spirit: OIDC Trusted
> Publishers support buckets, so only the exchange `resource` moves `datasets/hadim/olatu` →
> `buckets/hadim/olatu` (publisher reconfigured on the bucket's Settings, claims
> `repository=hadim/olatu` + `workflow_ref` starts-with the refresh workflow). The ingest's
> pull/upload switch from `snapshot_download`/`upload_folder` to the `huggingface_hub`
> bucket API (`sync_bucket`, `batch_bucket_files`). Existing data was carried over with a
> server-side Xet copy (`HfApi.copy_files`, reels verified byte-for-byte); the old dataset
> repo is left in place as a frozen pre-migration snapshot. This supersedes §3's "Why a
> dataset, not a bucket" and the dataset-specific details in §6.

---

## 1. The discovery (so a future session need not re-derive it)

The realtime page is `https://candhis.cerema.fr/_public_/campagne.php`. It looks
hostile to automate (PHP, a campaign must be "selected", the UI suggests clicking
**Valider** then **Télécharger**). Reverse-engineered live with a browser:

1. **The campaign is selected by a base64 query string, not a session POST.** Each
   campaign link is `campagne.php?<base64("camp=<id>")>`; for 06403 that is
   `campagne.php?Y2FtcD0wNjQwMw==` (`base64("camp=06403")`).
2. **The realtime table is server-rendered in the HTML of that one GET.** A cold
   `httpx` client with no cookies gets the full last-~48 h table (≈97 rows @ 30 min,
   incl. `Temp. mer`). No session priming, no `Valider`, no `Télécharger`.
3. **The `Valider`→`Télécharger` flow is for the *Archives* CSV export** (a date-range
   picker that navigates to `?datA=YYYY-MM-DD+YYYY-MM-DD`), not for realtime. The
   form's `BtnTeleReel`/`BtnTeleArch` submit buttons have no JS and a bare POST just
   re-renders the page — so we ignore them entirely.
4. **The HTML values are lossless vs. the CSV download.** Realtime is quantized
   (H to 0.1 m, period to 0.1 s, direction to 1°, spread to 1°, temp to 0.1 °C), so
   the table's `0.6` equals the CSV's `0.6000`. The browser table *is* the realtime API.

→ The scraper is a single `GET` + HTML-table parse. See [LEARNINGS](LEARNINGS.md).

## 2. HTML table → CANDHIS CSV mapping

The table has 8 columns; we map them **by header text** (order-independent) to the
realtime CSV dialect `build.py` already reads (`REEL_MAP` in `ingest/schema.py`):

| HTML header        | CSV column | Canonical (`REEL_MAP`)        |
|--------------------|------------|-------------------------------|
| `Date` + `Heure (TU)` | `Date`  | `datetime_utc` (UTC)          |
| `H1/3 (m)`         | `H1/3`     | `significant_wave_height_m`   |
| `Hmax (m)`         | `Hmax`     | `max_wave_height_m`           |
| `Th1/3 (s)`        | `Th1/3`    | `significant_period_s`        |
| `Dir. au pic (°)`  | `DirPic`   | `peak_direction_deg`          |
| `Etal. au pic (°)` | `EtalPic`  | `peak_directional_spread_deg` |
| `Temp. mer (°C)`   | `TempMer`  | `sea_temperature_c` (only source) |

`Heure (TU)` is UTC (TU = *Temps Universel*; see LEARNINGS). The page splits date and
time into two cells; the CSV recombines them into one `Date` field `YYYY-MM-DD HH:MM:00`.

## 3. Artifact: one accumulating per-year reel CSV (stored in the HF dataset)

- The scraper writes `Candhis_06403_<YEAR>_reel.csv` — **one growing file per year**,
  mirroring the archive's per-year files and keeping each bounded. *Not* a dated-per-run
  file (that produces ~365 overlapping files/year and pushes dedup onto `build.py`); one
  file per year is idempotent and diff-friendly. A cross-year scrape (Dec 31 ↔ Jan 1) is
  split into both year files.
- **It lives in the HF bucket, not git** (see Revisions above; bucket since 2026-06-30,
  dataset before). The canonical store is `hadim/olatu`, laid out per campaign so it is
  multi-buoy ready:

  ```
  <campaign>/raw/Candhis_<campaign>_<YEAR>_arch.csv   immutable archive (seeded once)
  <campaign>/raw/Candhis_<campaign>_<YEAR>_reel.csv   the growing realtime accumulator
  <campaign>/data/manifest.json | latest.json | recent.json | year/*.parquet | hourly|daily.parquet
  ```

- **Why a dataset, not a bucket** (the owner's first instinct) — **⚠ superseded 2026-06-30
  (see Revision above): public buckets now expose CORS+range `resolve/<key>` URLs, so the
  store moved to a bucket. Kept below for the rationale as it stood.** the webapp is a static
  browser app and needs a public HTTPS URL with **CORS** (and range) to read the tiers.
  Dataset `resolve/main/<campaign>/data/...` URLs provide exactly that (verified against
  the GH Pages origin); HF **buckets** do not expose a public browser URL yet ("S3 API
  not supported"; docs say *promote final artifacts to a dataset for consumers*). Switch
  to a bucket if/when its S3/HTTP access lands — the `update` flow is the only thing to
  repoint. Trusted-publisher OIDC supports both, so CI auth is unaffected by the choice.
  *(That switch landed — see Revision 2026-06-30.)*
- **Migration:** done. The original local per-day/per-year reel files were folded into
  the dataset's `06403/raw/` during the one-time seed (`update --seed-src …`).

## 4. Merge safety (the part that matters)

Realtime is a 6-column quantized quick-look; the archive is the 30-column QC'd record.
Two independent coalesce rules keep the growing tail from ever destroying good data:

1. **Scraper merge — coalesce, never clobber.** New scrape ∪ existing file, one row per
   timestamp; a scraped value wins *only when non-null*, else the prior value is kept.
   So a transient partial/empty scrape can never null out previously-good data — vital
   for temperature, which has no other source.
2. **`build.py assemble()` — archive-preferred coalesce (changed).** Previously realtime
   *entirely replaced* the archive row on a timestamp tie (`unique(keep="last")`). That
   was safe only while realtime never overlapped the archive. Once the scraper persists
   realtime and the archive later refreshes to cover those timestamps, last-wins would
   **permanently discard** the archive's rich columns (`peak_period_s`/Tp, Hm0, spectral,
   mean direction) and QC'd values. Fixed to a **column-wise coalesce, archive-preferred**:
   archive wins per column where present; realtime only fills gaps (sea temperature, and
   the live tail the archive has not yet published). No output change today (zero overlap),
   but the scraper is unsafe to ship without it.

## 5. Validation — the scraper is the loud gate

`build.py` trusts its CSV input blindly (`infer_schema_length=0`, `strict=False`,
`drop_nulls`), so bad data *disappears* rather than throwing. The scraper therefore
validates before writing and **aborts (nonzero exit, keep last-good file)** on:

- non-HTML / too-short body, PHP-error signatures, or the "choose a campaign" page;
- not exactly one realtime table, header not the exact 8 columns, or any row ≠ 8 cells;
- the time column header no longer containing `TU` (guards a UTC→legal-time flip);
- a `DD/MM` ↔ `MM/DD` locale flip (month > 12);
- timestamps not unique / not on the `:00`/`:30` grid (interior gaps are allowed —
  real outages exist and must never be interpolated);
- fewer than ~40 rows, or the newest row > 3 h in the future (clock/tz fault);
- more than 20 % of rows out of plausible physical range (the `999.999` sentinel is
  left intact for `build.py` to null — not pre-stripped here).

**Never-shrink invariant:** before the atomic replace, the merged result must cover the
existing file's time span and have ≥ as many rows, else abort. Writes are atomic
(tmp on the same filesystem + `os.replace`) under an exclusive `flock`, so overlapping
runs can't race. A non-advancing newest timestamp logs a staleness warning.

## 6. Operations

> **§6 update 2026-06-30:** the store is a *bucket* now (Revision above) — `dataset` →
> `bucket`, resource `datasets/hadim/olatu` → `buckets/hadim/olatu`, the webapp URL drops
> the `main` revision, and `update` adds a daily reel snapshot. Specifics below kept for
> history; the live values are in CLAUDE.md and `ingest/update.py`.

- **One command, local and CI:** `pixi run update [--campaign 06403]` orchestrates
  **pull → scrape → build → upload** (`ingest/update.py`): pull the accumulator from the
  store (HF is canonical, so a local run can't regress what the cron advanced), scrape
  the live feed, rebuild the tiers, upload tiers + reel back, then snapshot the reel.
  `scrape`/`ingest` remain as lower-level steps over the local mirror
  `./hfdata/<campaign>/{raw,data}` (gitignored).
- **Auth — keyless OIDC.** No `HF_TOKEN` secret. `update.py` resolves a token in order:
  `HF_TOKEN` env → GitHub Actions OIDC exchange (Trusted Publishers, resource
  `buckets/hadim/olatu`) → local `hf` login. The bucket's trusted publisher is pinned
  to claims `repository=hadim/olatu` + `workflow_ref` starts-with `…/refresh-data.yml@`.
- **CI:** `.github/workflows/refresh-data.yml` runs `*/30` via `setup-pixi` + `pixi run
  update`. It is Python-only (~1 min): no `npm`/`vite`, **no Pages redeploy** — the webapp
  reads the tiers at runtime, so fresh data appears without rebuilding the site. The
  immutable archive is cached so it isn't re-downloaded each run. `deploy.yml` is
  unchanged and only fires on webapp **code** changes.
- **Webapp:** reads `https://huggingface.co/buckets/hadim/olatu/resolve/06403/data/…`
  (no `main` revision — buckets are unversioned) via `dataBase()` in
  `webapp/src/lib/data.ts`; override with `VITE_DATA_BASE_URL`.
- **Cadence:** `*/30` is purely a freshness choice — the rolling 48 h window means any
  cadence **≤ ~36 h apart** loses no data. On a public repo Actions minutes are free;
  even private it is cheap (Python-only, no build).
- **Git:** the repo is **code only**. The data tiers + raw CSVs are not committed
  (`webapp/public/data/` and `hfdata/` are gitignored); the old committed tiers were
  removed (`git rm --cached`). The built year parquets in the dataset are the persistent
  snapshot of accumulated temperature.

## 7. Open questions / future

- **Archive refresh.** The dataset's `*_arch.csv` are seeded once and treated as
  immutable (CI caches them). CANDHIS extends the archive ~6-weekly with QC'd values;
  re-seed periodically (`update --seed-src <local arch dir>`, bump the CI cache key) so
  the archive's authoritative values supersede the realtime quick-look for that span
  (the archive-preferred coalesce in §4 then does the right thing).
- **Buckets when ready.** Move `raw/` (mutable working data) to a HF **bucket** once its
  S3/HTTP access supports browser reads; the tiers stay in the dataset (browser-served).
- **Multi-buoy.** The dataset and `update.py` are campaign-prefixed; the local raw dir is
  already per-buoy (`06402` Anglet is staged). Remaining work is parametrising `build.py`
  (today single-buoy via `schema.CAMPAIGN_ID`) and a campaign switch in the webapp.
