// Tiny hash router (spec 0011). Olatu is a single dashboard plus a few static legal pages
// (mentions légales / privacy / contact). A full router is overkill, and PATH routing would
// fight the relative Vite base (`./`, chosen so one build works at both olatu.io and
// hadim.github.io/olatu/) and need a 404.html fallback on GitHub Pages. Hash routes
// (`#/privacy`) need no server config, resolve every asset against the single precached
// index.html, and therefore work offline in the PWA too.

import { useSyncExternalStore } from 'react';

export type Route = 'home' | 'legal' | 'privacy' | 'contact';

const PAGES: readonly Route[] = ['legal', 'privacy', 'contact'];

export function parseRoute(): Route {
  const h = window.location.hash.replace(/^#\/?/, '').toLowerCase();
  return (PAGES as readonly string[]).includes(h) ? (h as Route) : 'home';
}

// Path for a link/anchor: '#' returns to the dashboard (top of page), '#/<page>' opens a
// legal page. Used by the footer links and the "back to Olatu" link.
export function routeHref(route: Route): string {
  return route === 'home' ? '#' : `#/${route}`;
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, parseRoute, () => 'home');
}
