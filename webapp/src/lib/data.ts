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

export interface Manifest {
  buoy: Buoy;
  /** Nearest tide port for this buoy (ingest/build.py), or null if none within range. */
  tide: TideMeta | null;
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

async function loadJSON<T>(campaign: string, name: string): Promise<T> {
  const res = await fetch(`${dataBase(campaign)}${name}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Failed to load ${campaign}/${name} (${res.status})`);
  return (await res.json()) as T;
}

export function loadManifest(campaign: string) {
  return loadJSON<Manifest>(campaign, 'manifest.json');
}

export function loadLatest(campaign: string) {
  return loadJSON<Series>(campaign, 'latest.json');
}

export function loadRecent(campaign: string) {
  return loadJSON<Series>(campaign, 'recent.json');
}

/** Tide extrema for a buoy: reads its manifest's `tide` block for the port + attribution,
 *  then fetches the shared `tides/<port>/data/tides.parquet` (spec 0008 §8.2). Returns null
 *  when the buoy has no port in range, or when the tier is unavailable (→ empty-state). */
export async function loadTidesForManifest(manifest: Manifest): Promise<Tides | null> {
  const meta: TideMeta | null = manifest.tide;
  if (!meta) return null;
  const res = await fetch(`${tidesBase(meta.port)}tides.parquet`, { cache: 'no-cache' });
  if (!res.ok) return null;
  const file = await res.arrayBuffer();
  const raw = (await parquetReadObjects({ file, columns: ['t', 'h', 'k'] })) as Record<string, unknown>[];
  const rows: TideRow[] = raw.map((r) => ({ t: Number(r.t), h: Number(r.h), k: r.k as TideKind }));
  return buildTides(meta, rows);
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
