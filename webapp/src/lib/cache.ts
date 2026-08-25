// A small IndexedDB byte-cache for the HF data tiers (spec 0019).
//
// Why: every tier is fetched from the Hugging Face bucket at runtime, so a reload used to
// show an empty shell until the network answered — a visible "nothing, nothing, everything"
// blink. We now keep the last body of each tier URL locally and paint it immediately
// (stale-while-revalidate, see lib/swr.ts): the page comes back with the data you last saw,
// and the network copy replaces it in place once it lands.
//
// This is deliberately a *byte* cache, not a parsed one: the parse (JSON.parse / hyparquet)
// is milliseconds, the network is not, and storing bytes keeps the cache honest — one entry
// per URL, byte-comparable against the fresh response so an unchanged tier never triggers a
// re-render (a chart rebuild is expensive; see the TimeSeries note in CLAUDE.md).
//
// It is a *cache*, never a source of truth: every failure path (no IndexedDB, private mode,
// quota, corrupt entry) degrades to "no cache" and the app behaves exactly as before.

const DB_NAME = 'olatu-cache';
const DB_VERSION = 1;
const STORE = 'tiers';

// Bump to invalidate every stored entry (record shape / semantics change).
const SCHEMA = 'v1';

// Eviction budget. The heavy entries are the per-year 30-min parquet tiles (a few hundred kB
// each); the JSON tiers are a few kB. Sweeping is opportunistic and never blocks a load.
const MAX_ENTRIES = 48;
const MAX_BYTES = 48 * 1024 * 1024;
const MAX_ENTRY_BYTES = 12 * 1024 * 1024;
const MAX_AGE_MS = 21 * 24 * 60 * 60 * 1000;

export interface CacheEntry {
  key: string;
  /** Response body: a string for JSON tiers, an ArrayBuffer for parquet ones. */
  body: string | ArrayBuffer;
  /** Cheap content hash — lets a revalidation prove "nothing changed" without a re-parse. */
  hash: string;
  bytes: number;
  /** When this entry was last written (ms epoch). Eviction is oldest-write-first. */
  ts: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDB(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null); // private mode / disabled storage — the app just runs uncached
    }
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDB().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const t = db.transaction(STORE, mode);
          const req = run(t.objectStore(STORE));
          req.onsuccess = () => resolve(req.result as T);
          req.onerror = () => resolve(null);
          t.onabort = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

const keyOf = (url: string) => `${SCHEMA}:${url}`;

/** Read the stored body for a tier URL, or null when absent/unusable. */
export async function cacheGet(url: string): Promise<CacheEntry | null> {
  const rec = await tx<CacheEntry | undefined>('readonly', (s) => s.get(keyOf(url)) as IDBRequest<CacheEntry | undefined>);
  if (!rec || rec.body == null) return null;
  if (Date.now() - rec.ts > MAX_AGE_MS) return null; // too old to be worth painting
  return rec;
}

/** Store (overwrite) a tier body. Oversized bodies are skipped rather than evicting everything. */
export async function cachePut(url: string, body: string | ArrayBuffer, hash: string): Promise<void> {
  const bytes = typeof body === 'string' ? body.length : body.byteLength;
  if (bytes > MAX_ENTRY_BYTES) return;
  const rec: CacheEntry = { key: keyOf(url), body, hash, bytes, ts: Date.now() };
  await tx('readwrite', (s) => s.put(rec) as IDBRequest<IDBValidKey>);
}

/** Drop expired / over-budget entries (oldest write first). Best-effort, fire-and-forget. */
export async function cacheSweep(): Promise<void> {
  const all = await tx<CacheEntry[]>('readonly', (s) => s.getAll() as IDBRequest<CacheEntry[]>);
  if (!all || all.length === 0) return;
  const now = Date.now();
  const live = all
    .filter((r) => {
      // Anything from an older record schema is dead weight — drop it on sight.
      if (!r.key?.startsWith(`${SCHEMA}:`)) return false;
      return now - r.ts <= MAX_AGE_MS;
    })
    .sort((a, b) => b.ts - a.ts); // newest first
  const doomed = all.filter((r) => !live.includes(r));
  let total = 0;
  for (const [i, r] of live.entries()) {
    total += r.bytes ?? 0;
    if (i >= MAX_ENTRIES || total > MAX_BYTES) doomed.push(r);
  }
  if (doomed.length === 0) return;
  await tx('readwrite', (s) => {
    let last: IDBRequest = s.delete(doomed[0].key);
    for (const r of doomed.slice(1)) last = s.delete(r.key);
    return last as IDBRequest<undefined>;
  });
}

/** FNV-1a over the bytes, salted with the length — enough to answer "did this tier change?". */
export function hashBytes(buf: ArrayBuffer): string {
  const v = new Uint8Array(buf);
  let h = 0x811c9dc5;
  for (let i = 0; i < v.length; i++) {
    h ^= v[i];
    h = Math.imul(h, 0x01000193);
  }
  return `${v.length.toString(36)}-${(h >>> 0).toString(36)}`;
}

/** FNV-1a over a string's code units (same role as hashBytes, for the JSON tiers). */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193);
  }
  return `${s.length.toString(36)}-${(h >>> 0).toString(36)}`;
}
