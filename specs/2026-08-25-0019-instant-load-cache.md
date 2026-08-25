# 0019 — Instant load: local tier cache + visible loading progress

**Status:** Accepted
**Date:** 2026-08-25
**Supersedes / relates:** refines the data-loading path of
[0004 — Realtime scraper](2026-06-27-0004-realtime-scraper.md) §6 / [0005 — Multi-buoy](2026-06-27-0005-multi-buoy.md)
(the runtime tier fetch), complements the PWA runtime caching of
[0010 — Installable PWA](2026-07-05-0010-pwa.md) §4, and keeps the freshness contract of
[0015 — Current Conditions density](2026-08-07-0015-current-conditions-density.md) §7 (per-realm badges)
unchanged.

## 1. Why

Owner report: *"quand je charge la page, il y a toujours un petit temps d'attente avant de voir les
données"* — a second or so of skeletons, then everything appears at once.

That wait is structural, not a bug: the webapp is a static bundle and **every** number on it comes
from the HF bucket at runtime (`manifest.json`, `latest.json`, `recent.json`, `daily.parquet`, the
tide tier, the station's tiers, then the per-year detail tile the default 5 D range needs). Nothing
can render before the first of those lands, and they are cross-origin over a CDN.

Two separate problems hide in that one second:

1. **Nothing tells you how far along the load is.** The skeletons (spec 0006 §6) say "something is
   coming" but not "3 of 5 tiers are in" — and they say nothing at all about the background refresh
   that already ran every 5 minutes.
2. **The page throws away what it knew.** The data changes every ~30 min; a reload two minutes later
   re-fetches, re-parses and re-renders bytes the browser had already seen. The visitor watches a
   blank shell to be told what they were already being told.

## 2. Decision

**Stale-while-revalidate over a local byte cache, plus one honest progress widget.**

- Every tier body is stored on the device, keyed by its URL (IndexedDB).
- On load, the cached copy paints **immediately** — Current Conditions, tide strip and the whole
  chart stack come back as you left them — while the network copy is fetched in parallel.
- When the fresh copy lands it replaces the painted one **in place**; when it is byte-identical
  (the common case: nothing new since your last visit) *nothing re-renders at all*.
- A single widget makes both phases visible: a determinate rail + pill on a cold load, a discreet
  "refreshing" chip on a warm one, and a short "updated" confirmation when a refresh actually
  brought something new.

### 2.1 Why a byte cache and not a parsed one

The parse (JSON.parse, hyparquet decode) costs milliseconds; the network costs hundreds. Storing
raw bodies keeps one entry per URL and — the real reason — makes the fresh response **byte
comparable** against what we painted. That comparison is what lets an unchanged tier cost zero
re-renders, which matters because rebuilding the chart stack destroys and re-creates every uPlot
(see the `TimeSeries` note in CLAUDE.md).

### 2.2 Why not lean on the service worker

The PWA already caches the tiers (spec 0010 §4) with **NetworkFirst**, which is right for what it
does — keep the live refresh authoritative and give the installed app an offline shell — but it is
invisible to the app: a NetworkFirst hit still waits for the network before rendering, and the app
can never say "here is what I had, hold on for the new one". Switching Workbox to
StaleWhileRevalidate would paint faster but leave the app unable to tell the two apart, so the SW
policy is unchanged and the app owns its own cache.

## 3. Shape

| module | role |
|---|---|
| `webapp/src/lib/cache.ts` | IndexedDB byte store: `cacheGet` / `cachePut` / `cacheSweep` + the FNV-1a content hash. Degrades to "no cache" on any failure (private mode, quota, corrupt entry). |
| `webapp/src/lib/swr.ts` | `swrJSON` / `swrBuffer`: fire the network, read the cache in parallel, hand the cached copy to `onStale`, resolve `null` when the fresh bytes match it. |
| `webapp/src/lib/progress.ts` | External store every fetch registers with (`beginLoad`), grouped into **bursts** (a new task after 800 ms of quiet starts a new one). |
| `webapp/src/components/DataStatus.tsx` | The one widget: fixed top rail + pill, cold vs warm vs failed. |

`null` from a loader means **"you already have this"**, never "no data". Loaders called without
`onStale` (the 5-min poll) never see it. The tide loader needs a third state, so it uses
`undefined` = unchanged and `null` = *this buoy has no tides*.

### 3.1 Eviction

One entry per tier URL: ~10 small JSON/parquet tiers per buoy plus the per-year detail tiles the
charts pull. Budget: 48 entries / 48 MB / 21 days, single entries over 12 MB skipped, swept once per
session 8 s after the first load. A bumped `SCHEMA` constant invalidates everything.

## 4. Rules the implementation must keep

- **A fast failure must not beat the cache.** An offline 503 answers before IndexedDB does, so
  `loadEager`/`loadWindEager` use `Promise.allSettled` — `Promise.all` rejected the group before the
  cached copies had painted, which blanked the page in exactly the case the cache exists for.
- **Suppress a late stale paint only when a fresh copy actually replaces it.** The stale *decode* is
  async and can land after the network resolves; suppressing it on failure or on an unchanged tier
  blanks the charts when the cache is what is saving the page.
- **A mixed stale set is a lie.** The eager triple (manifest + latest + recent) paints only when all
  three are cached, and a multi-year detail merge only when every tile is; an old manifest paired
  with a new `latest` is worse than waiting.
- **Never announce a refresh that changed nothing.** The cached hash is compared even when no
  `onStale` was passed, purely so the progress store knows whether the burst was real.
- **A network failure with data on screen is not fatal.** `error` (nothing to show) and
  `refreshError` (showing saved data) are different states; only the first replaces the page.

## 5. The loading UX

**Cold** (nothing stored): the existing skeletons, plus a 3 px accent rail across the top of the
viewport and a centred pill — *"Loading data… 45 %"*, counting settled tiers. The rail never sits at
0 % (a still bar reads as broken) and always finishes at 100 %.

**Warm** (cached data already on screen): the same rail, but the pill waits 500 ms before appearing
so a quick poll doesn't blink at you, and it reads *"Refreshing…"*.

**Confirmation**: *"Data updated"* for 2.2 s — only for a burst that started with data already on
screen **and** more than 6 s after the page opened (the detail tiers a fresh page pulls are part of
opening it, not a refresh), **and** that actually changed something.

**Failed**: *"Could not refresh — showing your saved data"*, in the danger tone, until the next
successful load. The per-realm freshness badges (spec 0015 §7) keep telling the truth about the
data's age underneath — that contract is unchanged and is what makes painting a stale copy honest.

The widget is `role="status" aria-live="polite"`; the rail is `aria-hidden`.

## 6. Measured

Local mock bucket, 600 ms simulated latency per tier, Chromium:

| | first paint of real data | at +250 ms |
|---|---|---|
| cold (empty cache) | ~900 ms, skeletons + progress until then | skeletons |
| warm (primed cache) | **~250 ms** | Current Conditions + 7 plots already drawn |
| backend down (503) | ~250 ms, from cache | full page + "could not refresh" |

A warm reload against unchanged data performs **zero** state swaps (no chart rebuild); when the
mock published new numbers, the cached values painted at 250 ms and were replaced by the fresh ones
by ~1.6 s. Sitting on the page, a refresh swaps the values in place and flashes the confirmation.

## 7. Not doing

- Caching *parsed* columnar arrays (bigger, fiddlier, saves milliseconds).
- Showing an explicit "this data is from your cache" banner: the freshness badges already state the
  reading's age, which is the honest version of that claim.
- Any change to the Workbox runtime caching (§2.2).
