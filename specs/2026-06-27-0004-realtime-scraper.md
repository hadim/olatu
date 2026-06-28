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

## 3. Artifact: one accumulating per-year reel CSV

- The scraper writes `Candhis_06403_<YEAR>_reel.csv` under `--src` — **one growing file
  per year**, mirroring the archive's per-year files and keeping each bounded.
- *Not* a dated-per-run file: that produces ~365 overlapping files/year, date-boundary
  filename churn, and pushes dedup onto `build.py`. One file per year is idempotent and
  diff-friendly.
- A cross-year scrape (Dec 31 ↔ Jan 1) is split into both year files.
- **Migration:** the first run folds any legacy dated snapshot
  (`Candhis_06403_<YEAR>-*_reel.csv`, e.g. the original manual `…_2026-06-27_reel.csv`)
  into the year file and removes it.

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

- **Tasks:** `pixi run scrape` (fetch + grow the reel CSVs) and
  `pixi run update` (= `scrape` then `ingest`). `build.py` stays pure / network-free so
  CI's row-group asserts and determinism hold.
- **Cadence:** run **≤ ~36 h apart**. The feed is a rolling 48 h window; consecutive
  scrapes must overlap or a gap opens that the live feed can never backfill.
- **Where data lives / git:** the reel CSVs live in the external raw dir
  (`/Users/hadim/Data/olatu`, default `--src`), exactly like the archive CSVs — they are
  source, not committed to the repo. `ingest` regenerates the committed tiers under
  `webapp/public/data/`; the scraper does **not** auto-commit or auto-push. The built
  year parquets are the persistent, committed snapshot of accumulated temperature.

## 7. Open questions / future

- **CI automation & persistence.** For an unattended cron (vs. the owner's local runs),
  the raw reel accumulator must persist between runs (the live feed only holds 48 h). The
  documented path is 0001 §5.3 (immutable backfill on `main` + force-pushed orphan data
  branch); the accumulator would ride along there. Until then this runs locally.
- **Multi-buoy.** `--campaign` is already parameterised (base64 `camp=<id>`); the schema
  is `campaign_id`-keyed, so extending beyond 06403 is a loop, not a redesign.
