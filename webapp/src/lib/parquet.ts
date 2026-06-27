// Read a committed Parquet tier in the browser via hyparquet (zero-dep, no WASM).
//
// NOTE: we fetch the WHOLE file as an ArrayBuffer rather than using HTTP range
// requests. GitHub Pages (Fastly) gzips `application/octet-stream` when the browser
// sends `Accept-Encoding: gzip`, and serves byte-ranges against the *compressed*
// stream — which corrupts hyparquet's offset-based reads ("footer != PAR1"). Fetching
// the full file lets the browser transparently decompress; hyparquet then reads from
// the in-memory buffer (column projection still applies in-memory). The tiers we load
// this way (daily/hourly) are small and plotted in full anyway.

import { parquetReadObjects } from 'hyparquet';

const BASE = import.meta.env.BASE_URL;

export interface Columnar {
  t: number[]; // epoch seconds
  [variable: string]: (number | null)[];
}

/** Load a Parquet tier (e.g. "daily.parquet"), decoding only the wanted columns. */
export async function loadParquetTier(name: string, columns: string[]): Promise<Columnar> {
  const res = await fetch(`${BASE}data/${name}`);
  if (!res.ok) throw new Error(`Failed to load ${name} (${res.status})`);
  const file = await res.arrayBuffer();

  const rows = (await parquetReadObjects({
    file,
    columns: ['datetime_utc', ...columns],
  })) as Record<string, unknown>[];

  const out: Columnar = { t: [] };
  for (const c of columns) out[c] = [];

  for (const r of rows) {
    const dt = r.datetime_utc;
    const ms = dt instanceof Date ? dt.getTime() : Number(dt);
    out.t.push(Math.floor(ms / 1000));
    for (const c of columns) {
      const v = r[c];
      out[c].push(v == null ? null : Number(v));
    }
  }
  return out;
}
