// A tiny external store counting the data loads in flight (spec 0019).
//
// Every tier fetch (lib/swr.ts) registers here, so one component — <DataStatus/> — can show
// honest progress without any loader knowing about the UI: a determinate bar on the cold
// first paint ("3 of 5 done"), and a discreet "updating" chip when a warm, cache-painted page
// revalidates in the background.
//
// Loads are grouped into a BURST: the counters reset on the first task started after a quiet
// gap, so the bar measures "this page load" / "this refresh", not the session's lifetime.

import { useSyncExternalStore } from 'react';

export interface LoadProgress {
  /** Tasks currently in flight. */
  active: number;
  /** Tasks settled in this burst (resolved or failed — the bar must always reach the end). */
  done: number;
  /** Tasks started in this burst. */
  total: number;
  /** True once any task in this burst brought bytes that differ from the cached copy. */
  changed: boolean;
  /** Bumped when a burst ends, so consumers can flash a completion state. */
  burst: number;
}

// A new task after this much idle time starts a fresh burst.
const BURST_GAP_MS = 800;

let active = 0;
let done = 0;
let total = 0;
let changed = false;
let burst = 0;
let idleSince = 0;

let snapshot: LoadProgress = { active: 0, done: 0, total: 0, changed: false, burst: 0 };
const listeners = new Set<() => void>();

function emit() {
  snapshot = { active, done, total, changed, burst };
  for (const l of listeners) l();
}

/**
 * Register one load. Call the returned function when it settles, passing whether the fetch
 * actually produced new content (used to decide if a background refresh is worth announcing).
 */
export function beginLoad(): (didChange?: boolean) => void {
  if (active === 0 && Date.now() - idleSince > BURST_GAP_MS) {
    done = 0;
    total = 0;
    changed = false;
  }
  active += 1;
  total += 1;
  emit();
  let settled = false;
  return (didChange = false) => {
    if (settled) return;
    settled = true;
    active -= 1;
    done += 1;
    if (didChange) changed = true;
    if (active === 0) {
      idleSince = Date.now();
      burst += 1;
    }
    emit();
  };
}

export function useLoadProgress(): LoadProgress {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snapshot,
    () => snapshot,
  );
}
