// Consent + Google Analytics 4 (spec 0011). Olatu is EU-facing, so analytics is OFF by
// default and only ever runs after an explicit "Accept": the gtag script is not even
// fetched until then (no Google request at all before consent). The choice is persisted in
// localStorage and reflected as a Consent Mode v2 signal so a returning visitor's decision
// sticks. Nothing here is a tracking cookie of our own — the store is a plain preference.
//
// Used by:
//   • initAnalytics()          — call once at startup to restore analytics for a returning
//                                visitor who already granted.
//   • useConsent()/setConsent()— the banner (ConsentBanner) and the privacy page's
//                                "your choice" controls read/toggle the decision reactively.

import { useSyncExternalStore } from 'react';

export const GA_MEASUREMENT_ID = 'G-XWQEVH6TD8';

export type ConsentChoice = 'granted' | 'denied';
type ConsentState = ConsentChoice | null; // null = no decision yet → banner shows

const STORAGE_KEY = 'olatu.consent';

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

// The canonical gtag shim: GA's processor consumes the raw `arguments` object, not a
// plain array — so push `arguments`, don't spread. The cast gives it the variadic call
// signature callers use while keeping that `arguments` behaviour.
function pushToDataLayer() {
  (window.dataLayer ||= []).push(arguments);
}
const gtag = pushToDataLayer as (...args: unknown[]) => void;

let gaLoaded = false;

// Inject GA4 the first time consent is granted; on later grants just flip the Consent Mode
// signal back on (the script is already in the page).
function enableGa() {
  if (gaLoaded) {
    gtag('consent', 'update', { analytics_storage: 'granted' });
    return;
  }
  gaLoaded = true;
  // Consent Mode v2: analytics on (the user just granted it), advertising firmly off —
  // Olatu shows no ads and sells no data.
  gtag('consent', 'default', {
    analytics_storage: 'granted',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  });
  // argless `new Date()` is the timestamp gtag itself expects — not a parsed buoy reading,
  // so the project's "no bare new Date(value)" rule doesn't apply here.
  gtag('js', new Date());
  gtag('config', GA_MEASUREMENT_ID, { anonymize_ip: true });

  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  document.head.appendChild(s);
}

// Withdraw: tell GA to stop using analytics storage. If the script was never loaded this is
// a no-op (nothing to disable), which is the common case for a first-visit decline.
function disableGa() {
  if (gaLoaded) gtag('consent', 'update', { analytics_storage: 'denied' });
}

// ---- reactive store (plain listeners → useSyncExternalStore) ----

const listeners = new Set<() => void>();
let state: ConsentState = readStored();

function readStored(): ConsentState {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'granted' || v === 'denied' ? v : null;
  } catch {
    return null; // storage blocked (private mode) — treat as "undecided"
  }
}

export function getConsent(): ConsentState {
  return state;
}

export function setConsent(choice: ConsentChoice): void {
  state = choice;
  try {
    localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    /* private mode — the choice just won't persist across sessions */
  }
  if (choice === 'granted') enableGa();
  else disableGa();
  listeners.forEach((l) => l());
}

// Restore analytics on load for a returning visitor who already accepted.
export function initAnalytics(): void {
  if (state === 'granted') enableGa();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useConsent(): ConsentState {
  return useSyncExternalStore(subscribe, getConsent, getConsent);
}
