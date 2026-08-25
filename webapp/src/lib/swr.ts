// Stale-while-revalidate fetching for the data tiers (spec 0019).
//
// The shape every loader uses:
//
//   1. fire the network request immediately (nothing is ever delayed by the cache);
//   2. in parallel, read the last stored body (lib/cache.ts) and hand it to `onStale` —
//      the page paints the data you saw last time, typically within a frame;
//   3. when the network answers, store it and resolve. If the bytes are IDENTICAL to the
//      copy we just painted, resolve `null` instead: the caller keeps what it has, so an
//      unchanged tier never costs a re-parse or a chart rebuild.
//
// `null` therefore means "you already have this", never "no data" — a caller that passes no
// `onStale` never sees it. On a network failure with a painted stale copy the rejection is
// still propagated, but the caller can treat it as a soft, non-fatal refresh error.

import { cacheGet, cachePut, cacheSweep, hashBytes, hashText } from './cache';
import { beginLoad } from './progress';

export interface SwrOptions<T> {
  /** Called (at most once, before resolution) with the cached copy, when there is one. */
  onStale?: (value: T) => void;
}

// Sweep once per session, after the first burst of loads has been started.
let swept = false;
function sweepLater() {
  if (swept) return;
  swept = true;
  setTimeout(() => void cacheSweep(), 8_000);
}

// `no-cache` (revalidate, don't blind-trust the HTTP cache): HF serves the tiers without
// cache-control, so the browser would otherwise heuristically hold a stale copy. Our own
// cache is the one deciding what to paint early.
const FETCH_INIT: RequestInit = { cache: 'no-cache' };

/** Fetch a JSON tier, painting the cached copy first when there is one. */
export async function swrJSON<T>(url: string, opts: SwrOptions<T> = {}): Promise<T | null> {
  sweepLater();
  const net = fetch(url, FETCH_INIT);
  const end = beginLoad();

  // The cached entry is read even without `onStale`: its hash is what tells the progress
  // store whether this load actually brought anything new (a 5-min poll that finds the same
  // manifest must not announce itself as an update).
  const hit = await cacheGet(url).catch(() => null);
  let painted = false;
  if (opts.onStale && hit && typeof hit.body === 'string') {
    try {
      opts.onStale(JSON.parse(hit.body) as T);
      painted = true;
    } catch {
      /* corrupt entry — ignore it, the network copy is on its way */
    }
  }

  try {
    const res = await net;
    if (!res.ok) throw new Error(`Failed to load ${url} (${res.status})`);
    const text = await res.text();
    const hash = hashText(text);
    const unchanged = hit != null && hash === hit.hash;
    void cachePut(url, text, hash);
    end(!unchanged);
    return unchanged && painted ? null : (JSON.parse(text) as T);
  } catch (e) {
    end(false);
    throw e;
  }
}

/** Fetch a binary tier (parquet), painting the cached copy first when there is one. */
export async function swrBuffer(
  url: string,
  opts: SwrOptions<ArrayBuffer> = {},
): Promise<ArrayBuffer | null> {
  sweepLater();
  const net = fetch(url, FETCH_INIT);
  const end = beginLoad();

  const hit = await cacheGet(url).catch(() => null);
  let painted = false;
  if (opts.onStale && hit && hit.body instanceof ArrayBuffer) {
    opts.onStale(hit.body);
    painted = true;
  }

  try {
    const res = await net;
    if (!res.ok) throw new Error(`Failed to load ${url} (${res.status})`);
    const buf = await res.arrayBuffer();
    const hash = hashBytes(buf);
    const unchanged = hit != null && hash === hit.hash;
    void cachePut(url, buf, hash);
    end(!unchanged);
    return unchanged && painted ? null : buf;
  } catch (e) {
    end(false);
    throw e;
  }
}

/** The cached copy of a tier without touching the network — null when nothing is stored. */
export async function peekBuffer(url: string): Promise<ArrayBuffer | null> {
  const hit = await cacheGet(url).catch(() => null);
  return hit && hit.body instanceof ArrayBuffer ? hit.body : null;
}
