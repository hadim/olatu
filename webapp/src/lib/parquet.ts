// Read a committed Parquet tier in the browser via hyparquet (zero-dep, no WASM).
// Uses HTTP range requests + column projection, returning compact columnar arrays.

import { asyncBufferFromUrl, parquetReadObjects } from 'hyparquet';

const BASE = import.meta.env.BASE_URL;

export interface Columnar {
  t: number[]; // epoch seconds
  [variable: string]: (number | null)[];
}

/** Load a Parquet tier (e.g. "daily.parquet") projecting only the wanted columns. */
export async function loadParquetTier(name: string, columns: string[]): Promise<Columnar> {
  const file = await asyncBufferFromUrl({ url: `${BASE}data/${name}` });
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
