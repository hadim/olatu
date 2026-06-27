"""Olatu data ingest: CANDHIS CSV -> cleaned, tiered Parquet/JSON for the static webapp.

This is intentionally NOT an installable package -- it is a small set of scripts
run via pixi tasks (`pixi run ingest`). See specs/2026-06-27-0001-foundation.md §5.
"""
