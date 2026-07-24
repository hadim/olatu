// Static registry of the curated Météo-France wind stations Olatu can pair with a buoy
// (mirror of ingest/schema.py WIND_STATIONS). Kept tiny + dependency-free so the station
// picker renders before any manifest loads. lat/lon/altitude MUST match the ingest registry.
//
// A buoy's DEFAULT station is its manifest `wind` pointer (nearest curated station ≤ 25 km,
// resolved by ingest/schema.resolve_wind_station). This registry powers the OVERRIDE picker —
// the user may pair any curated station — plus honest per-option distances. See specs/0012,
// 0013. The per-buoy override is persisted in `olatu.station` (default wins when unset).

export type StationKind = 'coastal-semaphore' | 'airport-plateau' | 'coastal';

export interface StationInfo {
  /** Station id (bucket key), e.g. "socoa". */
  id: string;
  num_poste: string;
  /** Display name (proper noun — not translated). */
  label: string;
  /** Character → an i18n label; surfaced for honesty (station ≠ offshore, spec 0012 §4). */
  kind: StationKind;
  altitude_m: number;
  lat: number;
  lon: number;
}

export const STATIONS: StationInfo[] = [
  { id: 'socoa', num_poste: '64189001', label: 'Socoa', kind: 'coastal-semaphore', altitude_m: 21, lat: 43.3945, lon: -1.6865 },
  { id: 'biarritz-pays-basque', num_poste: '64024001', label: 'Biarritz-Pays-Basque', kind: 'airport-plateau', altitude_m: 71, lat: 43.469333, lon: -1.534333 },
  { id: 'cap-ferret', num_poste: '33236002', label: 'Cap-Ferret', kind: 'coastal', altitude_m: 8, lat: 44.6305, lon: -1.251667 },
];

const STORAGE_KEY = 'olatu.station'; // JSON map { [campaign]: stationId } — per-buoy override

export const isKnownStation = (id: string | null | undefined): id is string =>
  !!id && STATIONS.some((s) => s.id === id);

export function stationInfo(id: string | null | undefined): StationInfo | undefined {
  return id ? STATIONS.find((s) => s.id === id) : undefined;
}

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export interface StationChoice extends StationInfo {
  distanceKm: number;
}

/** Every curated station with its distance from a buoy, nearest first — powers the picker list. */
export function stationsForBuoy(lat: number, lon: number): StationChoice[] {
  return STATIONS.map((s) => ({ ...s, distanceKm: haversineKm(lat, lon, s.lat, s.lon) })).sort(
    (a, b) => a.distanceKm - b.distanceKm,
  );
}

function overrides(): Record<string, string> {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as unknown;
    return v && typeof v === 'object' ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** The station id to pair with a buoy: the user's per-buoy override (if set + still known),
 *  else the manifest default. `null` propagates the buoy's "no station in range" state. */
export function stationForBuoy(campaign: string, defaultStation: string | null): string | null {
  const ov = overrides()[campaign];
  return isKnownStation(ov) ? ov : defaultStation;
}

/** Whether a buoy currently has a user override (vs. running on its manifest default). */
export function hasStationOverride(campaign: string): boolean {
  return isKnownStation(overrides()[campaign]);
}

export function persistStation(campaign: string, stationId: string): void {
  try {
    const all = overrides();
    all[campaign] = stationId;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* localStorage may be unavailable (privacy mode) — non-fatal */
  }
}

/** Forget a buoy's override → it falls back to the manifest default station. */
export function clearStation(campaign: string): void {
  try {
    const all = overrides();
    delete all[campaign];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* non-fatal */
  }
}
