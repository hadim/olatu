// Read a Parquet tier in the browser via hyparquet (zero-dep, no WASM).
//
// Tiers are served from the HF dataset (see data.ts / dataBase). We fetch the WHOLE
// file as an ArrayBuffer rather than using HTTP range requests: a CDN may transparently
// gzip the response and serve byte-ranges against the *compressed* stream, which
// corrupts hyparquet's offset-based reads ("footer != PAR1"). A full fetch lets the
// browser decompress; hyparquet then reads from the in-memory buffer (column projection
// still applies). The tiers we load this way (daily/hourly/year) are small and plotted
// in full anyway.

import { parquetReadObjects } from 'hyparquet';
import { dataBase, windBase } from './data';

export interface Columnar {
  t: number[]; // epoch seconds
  [variable: string]: (number | null)[];
}

/** Load a Parquet tier from an explicit base URL, decoding only the wanted columns. Both buoy
 *  and wind-station tiers share the `datetime_utc` time column (ingest/build.py, ingest/wind.py),
 *  so the body is identical — only the base URL differs. */
export async function loadParquetTierFrom(base: string, name: string, columns: string[]): Promise<Columnar> {
  // Revalidate every load: HF serves parquet with no cache-control, so the browser
  // would heuristically cache a stale copy — making the chart lag the (no-cache) JSON
  // banner by a refresh cycle. `no-cache` returns a cheap 304 when unchanged.
  const res = await fetch(`${base}${name}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Failed to load ${base}${name} (${res.status})`);
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

/** Load a Parquet tier (e.g. "daily.parquet") for a buoy campaign. */
export function loadParquetTier(campaign: string, name: string, columns: string[]): Promise<Columnar> {
  return loadParquetTierFrom(dataBase(campaign), name, columns);
}

/** Load a Parquet tier for a wind station (`wind/<station>/data/…`) — spec 0012/0013. */
export function loadWindParquetTier(station: string, name: string, columns: string[]): Promise<Columnar> {
  return loadParquetTierFrom(windBase(station), name, columns);
}
