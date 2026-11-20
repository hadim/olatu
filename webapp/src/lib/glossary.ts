// Open the Definitions slide-over from anywhere, optionally scrolled to one entry (spec 0023 §6).
//
// The glossary is a Radix sheet owned by the header; the chart headings are imperative DOM inside
// the uPlot host and cannot hold a React popover. A window event is the smallest bridge between
// the two — no context to thread through App, and a caller that fires it before the glossary
// mounts simply does nothing.

const EVENT = 'olatu:glossary';

/** DOM id of a glossary entry, shared by the entry itself and by whoever links to it. */
export const glossaryAnchorId = (anchor: string) => `gloss-${anchor}`;

export function openGlossary(anchor?: string): void {
  window.dispatchEvent(new CustomEvent<string | null>(EVENT, { detail: anchor ?? null }));
}

/** Subscribe to open requests; returns the unsubscribe. */
export function onGlossaryOpen(fn: (anchor: string | null) => void): () => void {
  const handler = (e: Event) => fn((e as CustomEvent<string | null>).detail ?? null);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
