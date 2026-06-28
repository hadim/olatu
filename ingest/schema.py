"""Canonical schema for CANDHIS Basque-coast buoys (06403 Saint-Jean-de-Luz, 06402 Anglet).

Single source of truth for: the archive/realtime -> canonical column mapping, units,
which variables are "headline", which are angular (need circular means when
aggregating), and the missing-value sentinel. The column maps/units are CANDHIS-wide
(shared by every campaign); only the per-buoy identity is keyed by campaign in BUOYS.
Mirrors specs/2026-06-27-0002-data-dictionary.md and 0005 -- keep them in sync.
"""

from __future__ import annotations

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
    # 03302 Cap Ferret (Gironde / Arcachon). Added realtime-only (no downloaded archive
    # yet) -- its history accumulates forward from the scraper's first run (spec 0005).
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

# Default campaign (back-compat for call-sites / CLIs that don't pass --campaign).
CAMPAIGN_ID = "06403"


def buoy(campaign: str = CAMPAIGN_ID) -> dict:
    """Return the identity dict for a campaign id (raises KeyError if unknown)."""
    return BUOYS[campaign]


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
