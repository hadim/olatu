// Loads the static data tiers produced by the polars ingest (see specs §5).
//
// The tiers are served at runtime from the Hugging Face dataset `hadim/olatu`
// (resolve/main/<campaign>/data/...), so the deployed site and its data are
// decoupled: the every-30-min refresh re-uploads the data to HF without ever
// rebuilding or redeploying the webapp (specs/0004 §6). HF dataset URLs are public
// with CORS, which a bucket is not — hence a dataset. Override the source with
// VITE_DATA_BASE_URL (must end in `/`), e.g. a fork's dataset or a local `…/data/`.

export const DATA_BASE: string =
  import.meta.env.VITE_DATA_BASE_URL ??
  'https://huggingface.co/datasets/hadim/olatu/resolve/main/06403/data/';

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

async function loadJSON<T>(name: string): Promise<T> {
  const res = await fetch(`${DATA_BASE}${name}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Failed to load ${name} (${res.status})`);
  return (await res.json()) as T;
}

export function loadManifest() {
  return loadJSON<Manifest>('manifest.json');
}

export function loadLatest() {
  return loadJSON<Series>('latest.json');
}

export function loadRecent() {
  return loadJSON<Series>('recent.json');
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
