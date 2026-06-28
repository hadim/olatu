// Read a Parquet tier in the browser via hyparquet (zero-dep, no WASM).
//
// Tiers are served from the HF dataset (see data.ts / DATA_BASE). We fetch the WHOLE
// file as an ArrayBuffer rather than using HTTP range requests: a CDN may transparently
// gzip the response and serve byte-ranges against the *compressed* stream, which
// corrupts hyparquet's offset-based reads ("footer != PAR1"). A full fetch lets the
// browser decompress; hyparquet then reads from the in-memory buffer (column projection
// still applies). The tiers we load this way (daily/hourly/year) are small and plotted
// in full anyway.

import { parquetReadObjects } from 'hyparquet';
import { DATA_BASE } from './data';

export interface Columnar {
  t: number[]; // epoch seconds
  [variable: string]: (number | null)[];
}

/** Load a Parquet tier (e.g. "daily.parquet"), decoding only the wanted columns. */
export async function loadParquetTier(name: string, columns: string[]): Promise<Columnar> {
  const res = await fetch(`${DATA_BASE}${name}`);
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
