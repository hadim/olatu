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
import { swrBuffer } from './swr';

export interface Columnar {
  t: number[]; // epoch seconds
  [variable: string]: (number | null)[];
}

/** Decode the wanted columns of a parquet buffer into the columnar shape the charts plot. */
async function decode(file: ArrayBuffer, columns: string[]): Promise<Columnar> {
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

/** Load a Parquet tier from an explicit base URL, decoding only the wanted columns. Both buoy
 *  and wind-station tiers share the `datetime_utc` time column (ingest/build.py, ingest/wind.py),
 *  so the body is identical — only the base URL differs.
 *
 *  Stale-while-revalidate (spec 0019): with `onStale`, the last stored copy of this tier is
 *  decoded and handed over immediately, and the promise resolves `null` when the fresh bytes
 *  match it — the caller keeps the columnar it already has (no re-decode, no chart rebuild). */
export async function loadParquetTierFrom(
  base: string,
  name: string,
  columns: string[],
  onStale?: (cols: Columnar) => void,
): Promise<Columnar | null> {
  const url = `${base}${name}`;
  // Decoding the cached copy is itself async, so a very fast network can win the race.
  // `superseded` is set ONLY when a fresh copy is actually being returned — on an unchanged
  // tier or a failed fetch the stale paint is the data, and suppressing it would blank the
  // charts exactly when the cache is what's saving the page.
  let superseded = false;
  const buf = await swrBuffer(url, {
    onStale: onStale
      ? (b) => void decode(b, columns).then(
          (cols) => {
            if (!superseded) onStale(cols);
          },
          () => {
            /* a corrupt cached tier is simply not painted */
          },
        )
      : undefined,
  });
  if (buf == null) return null; // unchanged — the painted stale copy stands
  superseded = true;
  return decode(buf, columns);
}

/** Load a Parquet tier (e.g. "daily.parquet") for a buoy campaign. */
export function loadParquetTier(
  campaign: string,
  name: string,
  columns: string[],
  onStale?: (cols: Columnar) => void,
): Promise<Columnar | null> {
  return loadParquetTierFrom(dataBase(campaign), name, columns, onStale);
}

/** Load a Parquet tier for a wind station (`wind/<station>/data/…`) — spec 0012/0013. */
export function loadWindParquetTier(
  station: string,
  name: string,
  columns: string[],
  onStale?: (cols: Columnar) => void,
): Promise<Columnar | null> {
  return loadParquetTierFrom(windBase(station), name, columns, onStale);
}
