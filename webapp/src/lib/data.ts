// Loads the static data tiers produced by the polars ingest (see specs §5).
//
// The tiers are served at runtime from the Hugging Face **bucket** `hadim/olatu`, laid
// out per campaign under a `buoys/` root (`resolve/buoys/<campaign>/data/...`), so the deployed site and its data
// are decoupled: the every-30-min refresh re-uploads the data to HF without ever
// rebuilding or redeploying the webapp (specs/0004 §6, 0005). A *public* bucket's
// `resolve/<key>` URLs are anonymous, CORS-enabled and range-capable (same CDN as
// dataset repos), and being mutable they avoid the git-history bloat a versioned
// dataset accrued from the every-30-min refresh.
//
// Multi-buoy: the base is the bucket ROOT and `buoys/<campaign>/data/` is appended per call
// (spec 0009 — buoy data nests under a `buoys/` root, symmetric with the `tides/<port>/`
// root). Buckets are non-versioned, so there is NO `main` revision segment in the path.
// Override the root with VITE_DATA_BASE_URL (must end in `/`), e.g. a fork's bucket.

import { parquetReadObjects } from 'hyparquet';
import { swrBuffer, swrJSON } from './swr';
import { buildTides, type TideKind, type TideMeta, type TideRow, type Tides } from './tides';

export const DATA_ROOT: string =
  import.meta.env.VITE_DATA_BASE_URL ??
  'https://huggingface.co/buckets/hadim/olatu/resolve/';

/** Base URL for one campaign's data tiers (ends in `/`). Buoy data nests under `buoys/`
 *  (spec 0009), mirroring the `tides/<port>/` root below. */
export function dataBase(campaign: string): string {
  return `${DATA_ROOT}buoys/${campaign}/data/`;
}

/** Base URL for a shared tide port's tier (ends in `/`). Tides are keyed by PORT, not
 *  campaign (specs/0008 §8.2): `tides/<port>/data/…`, a bucket-root path, NOT campaign-relative. */
export function tidesBase(port: string): string {
  return `${DATA_ROOT}tides/${port}/data/`;
}

/** Base URL for a shared wind station's tier (ends in `/`). Wind is keyed by STATION, not
 *  campaign (spec 0012/0013): `wind/<station>/data/…`. A station is a full buoy-shaped tiered
 *  dataset, so its tiers load with the same code paths as a buoy — only this base URL differs. */
export function windBase(station: string): string {
  return `${DATA_ROOT}wind/${station}/data/`;
}

export interface Buoy {
  campaign_id: string;
  name: string;
  network: string;
  operator: string;
  lat: number;
  lon: number;
  coast: string;
  sensor: string;
  cadence_minutes: number;
  water_depth_m: number | null;
  timezone: string;
}

export interface VariableDef {
  name: string;
  unit: string;
  source: 'archive' | 'realtime' | 'both';
  headline: boolean;
}

/** Attribution block travelling with a data source (wind: Météo-France / Licence Ouverte). */
export interface SourceMeta {
  provider: string;
  dataset?: string;
  license: string;
  credit: string;
  url: string;
}

/** The buoy manifest's `wind` **pointer** (ingest/build.py): which station to pair, how far,
 *  + attribution. `null` when no station is within range → wind empty-state (mirror of `tide`). */
export interface WindMeta {
  station: string;
  num_poste: string;
  label: string;
  distance_km: number;
  source: SourceMeta;
}

/** A wind station's own identity (from its buoy-shaped manifest at `wind/<station>/data/`). */
export interface WindStation {
  id: string;
  num_poste: string;
  label: string;
  dept: string;
  lat: number;
  lon: number;
  altitude_m: number;
}

/** A wind station's manifest — buoy-shaped (spec 0012 §5) so it loads like a buoy. */
export interface WindManifest {
  station: WindStation;
  source: SourceMeta;
  generated_at: string;
  timezone: string;
  cadence: string;
  span: { start: string; end: string };
  rows: number;
  variables: { name: string; unit: string; headline: boolean }[];
  years: { year: number; file: string; rows: number; byteLength: number }[];
  hourly_files: { year: number; file: string; rows: number; byteLength: number }[];
  coverage: Record<string, { start: string; end: string } | null>;
  tiers: Record<string, string>;
}

export interface Manifest {
  buoy: Buoy;
  /** Nearest tide port for this buoy (ingest/build.py), or null if none within range. */
  tide: TideMeta | null;
  /** Nearest wind station for this buoy (ingest/build.py), or null if none within range. */
  wind: WindMeta | null;
  generated_at: string;
  timezone: string;
  span: { start: string; end: string };
  rows: number;
  variables: VariableDef[];
  years: { year: number; file: string; rows: number; byteLength: number }[];
  hourly_files: { year: number; file: string; rows: number; byteLength: number }[];
  coverage: Record<string, { start: string; end: string } | null>;
  tiers: Record<string, string>;
}

/** Columnar series: epoch-seconds `t` plus one nullable array per variable. */
export interface Series {
  t: number[];
  [variable: string]: (number | null)[];
}

/** The paired wind station, resolved + loaded by App for a buoy (spec 0013). Aggregates the
 *  station's own manifest + latest readings with the buoy→station distance and whether the
 *  pairing is a user override (vs. the manifest default), so the UI can attribute it honestly. */
export interface WindData {
  /** Station id (bucket key), e.g. "socoa". */
  station: string;
  manifest: WindManifest;
  latest: Series;
  /** Buoy → station great-circle distance (km). */
  distanceKm: number;
  /** True when the user pinned a non-default station for this buoy. */
  isOverride: boolean;
}

// Every tier goes through the stale-while-revalidate layer (lib/swr.ts, spec 0019): the
// cached copy paints first, the network copy replaces it, and an unchanged tier resolves
// `null` so nothing re-renders for nothing. A call with no `onStale` never sees that null.

function tierURL(base: string, name: string): string {
  return `${base}${name}`;
}

/** Network-only load (no cached paint) — used by the periodic background refresh. */
async function loadJSONFrom<T>(base: string, name: string): Promise<T> {
  return (await swrJSON<T>(tierURL(base, name))) as T;
}

export function loadManifest(campaign: string) {
  return loadJSONFrom<Manifest>(dataBase(campaign), 'manifest.json');
}

export function loadLatest(campaign: string) {
  return loadJSONFrom<Series>(dataBase(campaign), 'latest.json');
}

export function loadRecent(campaign: string) {
  return loadJSONFrom<Series>(dataBase(campaign), 'recent.json');
}

/** Wind station tiers (buoy-shaped; spec 0012/0013). Keyed by STATION id, not campaign — a
 *  buoy resolves its paired station via `manifest.wind.station` (or a user override). */
export function loadWindManifest(station: string) {
  return loadJSONFrom<WindManifest>(windBase(station), 'manifest.json');
}

export function loadWindLatest(station: string) {
  return loadJSONFrom<Series>(windBase(station), 'latest.json');
}

export function loadWindRecent(station: string) {
  return loadJSONFrom<Series>(windBase(station), 'recent.json');
}

/** The three JSON tiers the page needs before it can render anything real. */
export interface Eager {
  manifest: Manifest;
  latest: Series;
  recent: Series;
}

/**
 * The buoy's eager tiers, loaded together (spec 0019). `onStale` fires ONCE, with the cached
 * set, and only when all three are cached — painting a mixed old-manifest/new-latest set
 * would be worse than waiting. Resolves `null` when the network copies are byte-identical to
 * the painted ones (nothing to re-render).
 */
export async function loadEager(campaign: string, onStale?: (e: Eager) => void): Promise<Eager | null> {
  const base = dataBase(campaign);
  const staged: Partial<Eager> = {};
  let painted = false;
  const paint = () => {
    if (painted || !onStale) return;
    if (staged.manifest && staged.latest && staged.recent) {
      painted = true;
      onStale({ manifest: staged.manifest, latest: staged.latest, recent: staged.recent });
    }
  };
  const stale = <K extends keyof Eager>(k: K) =>
    onStale
      ? (v: Eager[K]) => {
          staged[k] = v;
          paint();
        }
      : undefined;

  // allSettled, not all: a tier that fails FAST (an offline 503 beats the IndexedDB read)
  // would otherwise reject the group before the cached copies had a chance to paint — the
  // one case where the local cache matters most. Settle everything, paint, then rethrow.
  const settled = await Promise.allSettled([
    swrJSON<Manifest>(tierURL(base, 'manifest.json'), { onStale: stale('manifest') }),
    swrJSON<Series>(tierURL(base, 'latest.json'), { onStale: stale('latest') }),
    swrJSON<Series>(tierURL(base, 'recent.json'), { onStale: stale('recent') }),
  ]);
  const failed = settled.find((r) => r.status === 'rejected');
  if (failed) throw (failed as PromiseRejectedResult).reason;
  const [manifest, latest, recent] = settled.map((r) => (r as PromiseFulfilledResult<unknown>).value) as [
    Manifest | null,
    Series | null,
    Series | null,
  ];
  if (manifest == null && latest == null && recent == null) return null; // all three unchanged
  return {
    manifest: manifest ?? (staged.manifest as Manifest),
    latest: latest ?? (staged.latest as Series),
    recent: recent ?? (staged.recent as Series),
  };
}

/** A station's eager tiers — the wind mirror of `loadEager` (same stale/unchanged contract). */
export async function loadWindEager(
  station: string,
  onStale?: (e: { manifest: WindManifest; latest: Series }) => void,
): Promise<{ manifest: WindManifest; latest: Series } | null> {
  const base = windBase(station);
  const staged: { manifest?: WindManifest; latest?: Series } = {};
  let painted = false;
  const paint = () => {
    if (painted || !onStale) return;
    if (staged.manifest && staged.latest) {
      painted = true;
      onStale({ manifest: staged.manifest, latest: staged.latest });
    }
  };
  const settled = await Promise.allSettled([
    swrJSON<WindManifest>(tierURL(base, 'manifest.json'), {
      onStale: onStale
        ? (v) => {
            staged.manifest = v;
            paint();
          }
        : undefined,
    }),
    swrJSON<Series>(tierURL(base, 'latest.json'), {
      onStale: onStale
        ? (v) => {
            staged.latest = v;
            paint();
          }
        : undefined,
    }),
  ]);
  const failed = settled.find((r) => r.status === 'rejected');
  if (failed) throw (failed as PromiseRejectedResult).reason; // see the note in loadEager
  const [manifest, latest] = settled.map((r) => (r as PromiseFulfilledResult<unknown>).value) as [
    WindManifest | null,
    Series | null,
  ];
  if (manifest == null && latest == null) return null; // unchanged
  return {
    manifest: manifest ?? (staged.manifest as WindManifest),
    latest: latest ?? (staged.latest as Series),
  };
}

/** Tide extrema for a buoy: reads its manifest's `tide` block for the port + attribution,
 *  then fetches the shared `tides/<port>/data/tides.parquet` (spec 0008 §8.2).
 *  `null` = this buoy has no tides (no port in range, or the tier is unavailable → empty-state);
 *  `undefined` = the fresh tier is byte-identical to the cached one already painted via
 *  `onStale`, so the caller must keep what it has (spec 0019). */
export async function loadTidesForManifest(
  manifest: Manifest,
  onStale?: (t: Tides) => void,
): Promise<Tides | null | undefined> {
  const meta: TideMeta | null = manifest.tide;
  if (!meta) return null;
  const url = `${tidesBase(meta.port)}tides.parquet`;
  // Parsing the stale copy is async, so the network can win the race. `superseded` is set only
  // when a fresh copy is actually returned — see the same note in lib/parquet.ts.
  let superseded = false;
  let painted = false;
  // The parse is async while `swrBuffer` reports "unchanged" the moment the bytes match, so the
  // network can beat the stale paint. Every `return` below therefore waits for that paint first:
  // answering "unchanged, keep what you have" before the caller HAS it leaves the tide UI empty.
  let stalePaint: Promise<void> | null = null;
  let buf: ArrayBuffer | null;
  try {
    buf = await swrBuffer(url, {
      onStale: onStale
        ? (b) => {
            stalePaint = parseTides(meta, b).then((t) => {
              if (t && !superseded) {
                painted = true;
                onStale(t);
              }
            });
          }
        : undefined,
    });
  } catch {
    // Unavailable tier: keep a painted stale copy (undefined), else show the empty-state.
    await stalePaint;
    return painted ? undefined : null;
  }
  if (buf == null) {
    await stalePaint;
    return painted ? undefined : null; // unchanged (or an unusable cached copy → empty-state)
  }
  superseded = true;
  return parseTides(meta, buf);
}

async function parseTides(meta: TideMeta, file: ArrayBuffer): Promise<Tides | null> {
  try {
    // No column projection: the tier is a few kB, and `c` (coefficient, spec §11) only
    // appears once ingest has republished a port — projecting a column the deployed tier
    // may not have yet would break the whole strip for that window.
    const raw = (await parquetReadObjects({ file })) as Record<string, unknown>[];
    const rows: TideRow[] = raw.map((r) => ({
      t: Number(r.t),
      h: Number(r.h),
      k: r.k as TideKind,
      c: r.c == null ? null : Number(r.c),
    }));
    return buildTides(meta, rows);
  } catch {
    return null;
  }
}

/** Latest non-null value of a variable in a columnar series, with its timestamp (ms). */
export function lastValue(series: Series, key: string): { value: number; at: number } | null {
  const col = series[key];
  if (!col) return null;
  for (let i = col.length - 1; i >= 0; i--) {
    const v = col[i];
    if (v != null) return { value: v, at: series.t[i] * 1000 };
  }
  return null;
}

/** Most recent timestamp (ms) present in a series. */
export function latestTimestamp(series: Series): number | null {
  return series.t.length ? series.t[series.t.length - 1] * 1000 : null;
}
