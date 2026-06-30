// Loads the static data tiers produced by the polars ingest (see specs §5).
//
// The tiers are served at runtime from the Hugging Face **bucket** `hadim/olatu`, laid
// out per campaign (`resolve/<campaign>/data/...`), so the deployed site and its data
// are decoupled: the every-30-min refresh re-uploads the data to HF without ever
// rebuilding or redeploying the webapp (specs/0004 §6, 0005). A *public* bucket's
// `resolve/<key>` URLs are anonymous, CORS-enabled and range-capable (same CDN as
// dataset repos), and being mutable they avoid the git-history bloat a versioned
// dataset accrued from the every-30-min refresh.
//
// Multi-buoy: the base is the bucket ROOT and `<campaign>/data/` is appended per call.
// Buckets are non-versioned, so there is NO `main` revision segment in the path.
// Override the root with VITE_DATA_BASE_URL (must end in `/`), e.g. a fork's bucket.

export const DATA_ROOT: string =
  import.meta.env.VITE_DATA_BASE_URL ??
  'https://huggingface.co/buckets/hadim/olatu/resolve/';

/** Base URL for one campaign's data tiers (ends in `/`). */
export function dataBase(campaign: string): string {
  return `${DATA_ROOT}${campaign}/data/`;
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
  generated_at: string;
  timezone: string;
  span: { start: string; end: string };
  rows: number;
  variables: VariableDef[];
  years: { year: number; file: string; rows: number; byteLength: number }[];
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
