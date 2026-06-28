// A ticking "now" (ms). Drives the relative-time / freshness readouts so "12 minutes
// ago" advances on its own without a manual reload. Keep the interval local to the
// component that displays time so the rest of the tree doesn't re-render on each tick.

import { useEffect, useState } from 'react';

export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
