"""Canonical schema for CANDHIS Basque-coast buoys (06403 Saint-Jean-de-Luz, 06402 Anglet).

Single source of truth for: the archive/realtime -> canonical column mapping, units,
which variables are "headline", which are angular (need circular means when
aggregating), and the missing-value sentinel. The column maps/units are CANDHIS-wide
(shared by every campaign); only the per-buoy identity is keyed by campaign in BUOYS.
Mirrors specs/2026-06-27-0002-data-dictionary.md and 0005 -- keep them in sync.
"""

from __future__ import annotations

import math

# CANDHIS encodes "no valid measurement" as 999.999. A 999.999 m height / s period /
# deg direction is physically impossible, so we null any value at/above the threshold
# across every numeric column. (Threshold, not exact equality, to be float-repr-safe;
# no real variable here -- heights <20 m, periods <30 s, directions 0..360, spread
# <180, temp <40, counts ~hundreds -- ever legitimately reaches 999.99.)
SENTINEL = 999.999
SENTINEL_MIN = 999.99

# Per-buoy identity, keyed by CANDHIS campaign id. The default campaign is 06403 (the
# original Saint-Jean-de-Luz buoy); 06402 (Anglet) was added in spec 0005. The CANDHIS
# data dialect is identical across campaigns, so only this table differs per buoy.
# Tide config is NOT here: a tide is a property of a PORT, not a buoy (see TIDE_PORTS +
# resolve_tide_port below and specs/0008 §8.2). Each buoy resolves to its nearest port.
BUOYS = {
    "06403": {
        "campaign_id": "06403",
        "name": "Saint-Jean-de-Luz",
        "network": "CANDHIS",
        "operator": "Cerema",
        "lat": 43.408333,
        "lon": -1.681667,
        "coast": "Atlantic / Basque coast (Bay of Biscay)",
        "sensor": "Datawell directional Waverider",
        "cadence_minutes": 30,
        "water_depth_m": None,  # not published in open docs
        "timezone": "Europe/Paris",
    },
    "06402": {
        "campaign_id": "06402",
        "name": "Anglet",
        "network": "CANDHIS",
        "operator": "Cerema",
        "lat": 43.5322,
        "lon": -1.6150,
        "coast": "Atlantic / Basque coast (Anglet, Adour estuary)",
        "sensor": "Datawell directional Waverider",
        "cadence_minutes": 30,
        "water_depth_m": None,  # not published in open docs
        "timezone": "Europe/Paris",
    },
    # 03302 Cap Ferret (Gironde / Arcachon). Added realtime-only, then its archive was
    # backfilled (CSVs dropped into raw/, coalesced) -- now full history from 2010 (spec 0005).
    "03302": {
        "campaign_id": "03302",
        "name": "Cap Ferret",
        "network": "CANDHIS",
        "operator": "Cerema",
        "lat": 44.6525,
        "lon": -1.44667,
        "coast": "Atlantic coast (Gironde, off Cap Ferret / Arcachon)",
        "sensor": "Datawell directional Waverider",
        "cadence_minutes": 30,
        "water_depth_m": None,  # not published in open docs
        "timezone": "Europe/Paris",
    },
}

# ------------------------------------------------------------------------- tides / ports
#
# Tide (marée) predictions come per-PORT, shared across buoys (specs/0008 §8.2). This is
# the curated set of api-maree.fr `/water-levels` site ids we actually fetch -- validated
# against `/sites` (2026-07-05) with lat/lon copied from that catalog. A buoy resolves to
# its nearest port here (resolve_tide_port); beyond TIDE_MAX_KM it has no tide -> the webapp
# shows the empty-state. `range_ref` is the neap->spring marnage envelope (metres) for the
# "big tide?" gauge -- a REGIONAL constant (not derived from the ~one-cycle J±30 window),
# retune once real extrema are observed.
TIDE_PORTS = {
    "saint-jean-de-luz": {
        "label": "Saint-Jean-de-Luz",
        "lat": 43.407542,
        "lon": -1.691879,
        "range_ref": {"neap": 1.2, "spring": 4.5},
    },
    "boucau-bayonne-biarritz": {
        "label": "Boucau-Bayonne (Anglet)",
        "lat": 43.528037,
        "lon": -1.542334,
        "range_ref": {"neap": 1.2, "spring": 4.5},
    },
    "cap-ferret": {
        "label": "Cap Ferret",
        "lat": 44.632333,
        "lon": -1.239067,
        "range_ref": {"neap": 1.3, "spring": 4.6},
    },
}

# A buoy farther than this from every curated port has no meaningful tide reference ->
# tide empty-state. 40 km comfortably covers our buoys (max is Cap Ferret at ~16.6 km).
TIDE_MAX_KM = 40.0

# CC-BY attribution, required by the source (confirmed on api-maree.fr /mentions-legales:
# IFREMER / PREVIMER harmonic components referenced in Sextant). Travels into each buoy's
# manifest tide block so the webapp can surface it. Re-check the CGU wording before launch.
TIDE_SOURCE = {
    "provider": "api-maree.fr",
    "upstream": "IFREMER / PREVIMER",
    "license": "CC-BY",
    "credit": (
        "Hauteurs d'eau diffusées par api-maree.fr, calculées à partir de "
        "composantes harmoniques IFREMER / PREVIMER."
    ),
    "url": "https://api-maree.fr",
}

# Default campaign (back-compat for call-sites / CLIs that don't pass --campaign).
CAMPAIGN_ID = "06403"


def buoy(campaign: str = CAMPAIGN_ID) -> dict:
    """Return the identity dict for a campaign id (raises KeyError if unknown)."""
    return BUOYS[campaign]


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance (km) between two lat/lon points."""
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def resolve_tide_port(campaign: str = CAMPAIGN_ID) -> dict | None:
    """Nearest curated tide port to a buoy, or None if none is within TIDE_MAX_KM.

    Returns `{id, label, lat, lon, range_ref, distance_km}` -- the per-buoy tide reference
    used to fetch (ingest) and to fill the manifest tide block (build). A buoy too far from
    every port gets None -> the webapp shows the tide empty-state ("marée indisponible").
    """
    b = BUOYS[campaign]
    best_id, best_km = None, math.inf
    for pid, p in TIDE_PORTS.items():
        km = _haversine_km(b["lat"], b["lon"], p["lat"], p["lon"])
        if km < best_km:
            best_id, best_km = pid, km
    if best_id is None or best_km > TIDE_MAX_KM:
        return None
    p = TIDE_PORTS[best_id]
    return {
        "id": best_id,
        "label": p["label"],
        "lat": p["lat"],
        "lon": p["lon"],
        "range_ref": p["range_ref"],
        "distance_km": round(best_km, 1),
    }


# Archive CSV column -> canonical name. `DateHeure` is handled separately.
# The 43 columns that are 100% empty for 06403 (QUALITE, NBSYS, *_S1..S4) are simply
# absent from this map, so they are dropped at ingest.
ARCH_MAP = {
    "H13D": "significant_wave_height_m",
    "H110D": "significant_wave_height_tenth_m",
    "HMAXD": "max_wave_height_m",
    "HSIGMA": "significant_wave_height_sigma_m",
    "HRMSD": "rms_wave_height_m",
    "H2%D": "wave_height_2pct_m",
    "TH13D": "significant_period_s",
    "TH110D": "period_h110_s",
    "TAVGD": "mean_period_s",
    "THMAXD": "period_of_hmax_s",
    "TMAXD": "max_period_s",
    "ETAMAX": "eta_max_m",
    "ETAMIN": "eta_min_m",
    "SZ13D": "significant_steepness",
    "SZMAXD": "max_steepness",
    "TSZMAXD": "period_of_max_steepness_s",
    "NBRE_VAG": "n_waves",
    "SKEW": "skewness",
    "KURT": "kurtosis",
    "RHH": "height_correlation_rhh",
    "HM0": "spectral_significant_height_hm0_m",
    "TP": "peak_period_s",
    "T02": "mean_period_t02_s",
    "TE": "energy_period_s",
    "EPS2": "spectral_narrowness_eps2",
    "KAPA": "spectral_width_kappa",
    "THETAP": "peak_direction_deg",
    "THETAM": "mean_direction_deg",
    "SIGMAP": "peak_directional_spread_deg",
    "SIGMAM": "mean_directional_spread_deg",
}

# Realtime CSV column -> canonical name. `Date` is handled separately.
# Realtime is the ONLY source of sea_temperature_c.
REEL_MAP = {
    "H1/3": "significant_wave_height_m",
    "Hmax": "max_wave_height_m",
    "Th1/3": "significant_period_s",
    "DirPic": "peak_direction_deg",
    "EtalPic": "peak_directional_spread_deg",
    "TempMer": "sea_temperature_c",
}

# Units, keyed by canonical name. Drives the manifest variable dictionary.
UNITS = {
    "significant_wave_height_m": "m",
    "significant_wave_height_tenth_m": "m",
    "max_wave_height_m": "m",
    "significant_wave_height_sigma_m": "m",
    "rms_wave_height_m": "m",
    "wave_height_2pct_m": "m",
    "significant_period_s": "s",
    "period_h110_s": "s",
    "mean_period_s": "s",
    "period_of_hmax_s": "s",
    "max_period_s": "s",
    "eta_max_m": "m",
    "eta_min_m": "m",
    "significant_steepness": "",
    "max_steepness": "",
    "period_of_max_steepness_s": "s",
    "n_waves": "count",
    "skewness": "",
    "kurtosis": "",
    "height_correlation_rhh": "",
    "spectral_significant_height_hm0_m": "m",
    "peak_period_s": "s",
    "mean_period_t02_s": "s",
    "energy_period_s": "s",
    "spectral_narrowness_eps2": "",
    "spectral_width_kappa": "",
    "peak_direction_deg": "deg",
    "mean_direction_deg": "deg",
    "peak_directional_spread_deg": "deg",
    "mean_directional_spread_deg": "deg",
    "sea_temperature_c": "degC",
}

# The ~8 variables surfaced prominently (banner, default charts, hourly/daily tiers).
HEADLINE = [
    "significant_wave_height_m",
    "max_wave_height_m",
    "peak_period_s",
    "significant_period_s",
    "peak_direction_deg",
    "peak_directional_spread_deg",
    "spectral_significant_height_hm0_m",
    "sea_temperature_c",
]

# Compass directions are circular (0 deg == 360 deg): they need a circular mean when
# aggregating, NOT an arithmetic one (mean of 350 and 10 must be 0, not 180).
DIRECTION_VARS = ["peak_direction_deg", "mean_direction_deg"]

# Canonical column order in the Parquet/JSON output.
CANONICAL_ORDER = ["datetime_utc", "campaign_id"] + list(UNITS.keys())

# All numeric canonical columns (everything except the two identity columns).
NUMERIC_COLS = list(UNITS.keys())


def variable_source(canonical: str) -> str:
    """Which feed provides a canonical variable: 'archive', 'realtime', or 'both'."""
    in_arch = canonical in ARCH_MAP.values()
    in_reel = canonical in REEL_MAP.values()
    if in_arch and in_reel:
        return "both"
    if in_reel:
        return "realtime"
    return "archive"
