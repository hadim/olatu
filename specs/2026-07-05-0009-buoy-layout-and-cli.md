# 0009 — Bucket buoy-layout + pipeline CLI

- **Status:** Accepted
- **Date:** 2026-07-05
- **Authors:** Hadrien Mary (+ Claude)
- **Relates to:** [0004 realtime scraper](2026-06-27-0004-realtime-scraper.md) (the bucket +
  accumulator model), [0005 multi-buoy](2026-06-27-0005-multi-buoy.md) (per-campaign layout),
  [0008 tides §8.2](2026-07-05-0008-tides.md) (the port-keyed `tides/<port>/` root this mirrors).

> Two owner requests, both about the data pipeline: (1) reorganise the HF bucket so buoy data
> nests under a `buoys/` root — symmetric with the `tides/<port>/` root shipped in 0008 §8.2;
> (2) give `ingest/update.py` a pretty, legible CLI (Typer + Rich) that clearly separates
> **buoy** work from **tide** work and reads well both in a terminal and in CI logs.

---

## 1. Bucket layout: `<campaign>/` → `buoys/<campaign>/`

### 1.1 Why
0008 §8.2 moved tides to a shared, port-keyed root `tides/<port>/…`. That left the bucket
lopsided: tides nested, buoys at the root (`06403/`, `06402/`, `03302/`). Nesting buoy data
under a `buoys/` root restores symmetry and makes the bucket self-describing:

```
buoys/<campaign>/raw/…     archive (immutable) + reel accumulator
buoys/<campaign>/data/…    manifest/latest/recent.json, year/*.parquet, hourly/*.parquet, daily.parquet
buoys/<campaign>/backup/…  daily reel snapshots (14-day retention)
tides/<port>/raw|data/…    (unchanged)
```

### 1.2 Decisions
1. **Only the *bucket* layout changes.** The local working mirror stays flat at
   `hfdata/<campaign>/{raw,data}` and the `tides/` root is untouched. Ingest maps the local
   mirror → the nested bucket prefix via one helper, `update._buoy_prefix(campaign)` →
   `"buoys/<campaign>"`; every `hf://buckets/<repo>/…` string and the backup prefix routes
   through it. Keeping the local mirror flat means **no change** to the `scrape`/`ingest`
   pixi tasks or the CI archive-cache paths (`hfdata/<campaign>/raw`).
2. **Webapp** appends `buoys/<campaign>/data/` instead of `<campaign>/data/`
   (`lib/data.ts` `dataBase`). `tidesBase(port)` is unchanged. `VITE_DATA_BASE_URL` still
   overrides the root.
3. **Migration is a one-shot, two-phase, non-destructive tool** (`ingest/migrate_layout.py`,
   `pixi run migrate`): `copy` downloads each old `<campaign>/` prefix and re-uploads it to
   `buoys/<campaign>/` (leaving the old prefix in place so the live site keeps working);
   after the redeployed site is confirmed reading `buoys/`, `delete --yes` removes the old
   root prefixes. `copy` is idempotent; `delete` dry-runs without `--yes`; neither touches
   `tides/`.

### 1.3 Migration order (why it's safe)
`copy` → flip code (ingest + webapp) → deploy → verify the live site on `buoys/` →
`delete --yes`. No data-loss window: the copied `raw/` carries the immutable archive **and**
the full forward-grown reel (sea-temperature history, Cap Ferret's whole history) up to copy
time; anything the reel gained *after* copy is < 48 h old and is re-captured by the first
new-code refresh (the scraper overlaps the last 48 h). `data/` is copied too, so the site is
servable the instant it redeploys — before any refresh runs. Buckets are non-versioned, so
the old prefixes are the only rollback until `delete` — hence delete is gated + confirmed.

## 2. Pipeline CLI (Typer + Rich)

### 2.1 Why
`update.py` printed flat, uncoloured lines; buoy and tide progress blurred together. The
owner wanted to *see what's happening*, with the two kinds of work visually distinct.

### 2.2 Decisions
1. **One shared console module `ingest/ui.py`** — a single Rich `Console` + semantic helpers
   (`banner`, `section`/`phase`, `step`, `detail`, `ok`/`warn`/`err`, `summary_table`). All
   ingest modules (`update`, `scrape`, `build`, `tides`) print through it, so the whole
   pipeline is consistent and standalone `pixi run scrape`/`ingest` are pretty too.
2. **Buoys read cyan, tides read blue.** Each buoy is a titled section; its steps
   (pull ↓ / scrape ⟳ / build ⚙ / upload ↑) are cyan, the tide step (🌙) is blue — the
   "separate buoys from tides" the owner asked for. Two end-of-run **summary tables** keep
   the split: `Buoys` (campaign, rows, through, uploaded) and `Tides` (port, buoy, distance,
   status). `refresh_port` returns its real outcome (`refreshed`/`up to date`/`no key`/…) so
   the table is honest.
3. **CI-safe.** Dynamic values are passed as `style=`-styled plain text (never inline Rich
   `[markup]`), so a `[` in a path can't be mis-parsed; line output uses `soft_wrap=True` so
   long paths/spans aren't hard-wrapped at the non-terminal 80-col default. With no TTY (a
   GitHub Actions log) Rich auto-drops colour + animation → plain, grep-able text.
4. **Typer replaces argparse.** `--campaign/-c` is now a **repeatable** option
   (`-c 06403 -c 06402 -c 03302`) instead of argparse `nargs="+"` (space-separated) — the
   one behaviour change; `refresh-data.yml` was updated to repeat the flag. Single-buoy
   `--campaign 06403` is unchanged. One shared OIDC token exchange across campaigns is
   preserved. Exit is non-zero if any buoy failed (`typer.Exit(1)`), as before.

## 3. Verification
- **Layout:** `pixi run migrate copy`, then `curl` `resolve/buoys/<c>/data/manifest.json`
  for all three campaigns → 200 with correct name/rows; a `daily.parquet` range-read → 200.
  Webapp + ingest typecheck/lint. (Done 2026-07-05.) `delete --yes` only after the deployed
  site is confirmed on `buoys/`.
- **CLI:** `pixi run update -c 06403 --no-pull --no-scrape --no-upload` renders the sectioned
  buoy/tide steps + both summary tables; run under a non-TTY pipe to confirm the CI-plain
  rendering. `pixi run update --help` shows the Typer usage.

## 4. Open items
1. Run `pixi run migrate delete --yes` once the deployed site is confirmed reading `buoys/`
   (removes the orphaned root `<campaign>/` prefixes — the only rollback until then).
2. If a fork sets `VITE_DATA_BASE_URL`, its bucket must also use the `buoys/<campaign>/` layout.
