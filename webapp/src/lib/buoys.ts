// Static registry of the buoys Olatu can show. Kept tiny and dependency-free so the
// station picker + locator map can render BEFORE any manifest loads (instant first
// paint, and resilient if one buoy's data is briefly unavailable). The selected buoy's
// manifest still drives its detailed station facts; this only needs identity + position.
//
// lat/lon MUST match each buoy's manifest (ingest/schema.py BUOYS). See specs/0005.

export interface BuoyInfo {
  /** CANDHIS campaign id, e.g. "06403". */
  campaign_id: string;
  /** Display name (proper noun — not translated). */
  name: string;
  lat: number;
  lon: number;
}

export const BUOYS: BuoyInfo[] = [
  { campaign_id: '06403', name: 'Saint-Jean-de-Luz', lat: 43.408333, lon: -1.681667 },
  { campaign_id: '06402', name: 'Anglet', lat: 43.5322, lon: -1.615 },
  { campaign_id: '03302', name: 'Cap Ferret', lat: 44.6525, lon: -1.44667 },
];

export const DEFAULT_CAMPAIGN = '06403';
const STORAGE_KEY = 'olatu.campaign';
const URL_PARAM = 'buoy'; // ?buoy=06402 — a shareable deep-link to a specific buoy

const isKnown = (c: string | null): c is string => !!c && BUOYS.some((b) => b.campaign_id === c);

export function buoyInfo(campaign: string): BuoyInfo {
  return BUOYS.find((b) => b.campaign_id === campaign) ?? BUOYS[0];
}

/** Campaign requested via `?buoy=<id>` (a shared link), if it names a known buoy. */
export function campaignFromUrl(): string | null {
  try {
    const v = new URLSearchParams(window.location.search).get(URL_PARAM);
    return isKnown(v) ? v : null;
  } catch {
    return null;
  }
}

function storedCampaign(): string | null {
  try {
    return isKnown(localStorage.getItem(STORAGE_KEY)) ? localStorage.getItem(STORAGE_KEY) : null;
  } catch {
    return null;
  }
}

/** Initial buoy: a shared `?buoy=` link wins, then the persisted choice, then the default. */
export function initialCampaign(): string {
  return campaignFromUrl() ?? storedCampaign() ?? DEFAULT_CAMPAIGN;
}

export function persistCampaign(campaign: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, campaign);
  } catch {
    /* localStorage may be unavailable (privacy mode) — non-fatal */
  }
}

/** This page's URL with `?buoy=<campaign>` set (other params/hash preserved), for
 *  history.pushState/replaceState — keeps the address bar shareable, no reload. */
export function campaignUrl(campaign: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set(URL_PARAM, campaign);
  return url.pathname + url.search + url.hash;
}
