# Specs

This project is **spec-driven**. Before a phase is implemented, the decisions
behind it are written down here so the work stays coherent across many sessions.

## How it works

- Specs are **timestamped and numbered**: `YYYY-MM-DD-NNNN-slug.md`.
- A spec is the source of truth for *intent and decisions*; the code is the source
  of truth for *implementation*. When they disagree, fix one of them on purpose.
- Specs are append-mostly. We don't silently rewrite history — if a decision
  changes, add a new spec (or a dated "Revision" section) that **supersedes** the
  old one and link both ways.
- Each spec carries a `Status:` (`Draft` → `Accepted` → `Implemented` /
  `Superseded`).

## Index

| Spec | Status | Summary |
|------|--------|---------|
| [0001 — Foundation](2026-06-27-0001-foundation.md) | Draft | Vision, data reality, tech stack, data-ops, features, UX, roadmap |
| [0002 — Data dictionary](2026-06-27-0002-data-dictionary.md) | Draft | Buoy identity + canonical schema + plain-language definition of every variable |

## Conventions

- **Name:** the project is **Olatu** (Basque for "wave"). GitHub repo `hadim/olatu`,
  GH Pages base `/olatu/`. (Local working dir may still be `wave-buoys-viewer`.)
- **Language:** everything in this repo is in **English** (code, comments, specs,
  UI source strings). User-facing copy is then translated (EN / FR / ES).
- **Units & time:** SI-ish marine units (m, s, °, °C). All timestamps are stored
  **UTC** and rendered in the buoy's local zone (**Europe/Paris**).
- **One buoy for now:** CANDHIS campaign **06403 — Saint-Jean-de-Luz**. The schema
  is multi-buoy ready (`campaign_id` is a column) but the app ships single-buoy.
