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

## When does work need a spec?

Ask this for **every** request or task (and when in doubt, **ask the owner**):

- **Write/update a spec** for: a new feature or capability, an architecture or
  tech-stack decision, a data-model/schema change, a UX direction, or anything with
  non-trivial scope or real trade-offs — i.e. anything a future session would need
  to understand the *intent* behind.
- **No spec needed** for: trivial/mechanical edits, small bug fixes, cosmetic tweaks,
  dependency bumps. (If a fix revealed a non-obvious *learning*, log it in
  [LEARNINGS](LEARNINGS.md) instead.)
- A single request that bundles **several things** can map to **one or several**
  specs — split by coherent topic.
- Update the spec *as part of* the task, not after; keep code and spec in sync.

## Index

| Spec | Status | Summary |
|------|--------|---------|
| [0001 — Foundation](2026-06-27-0001-foundation.md) | Draft | Vision, data reality, tech stack, data-ops, features, UX, roadmap |
| [0002 — Data dictionary](2026-06-27-0002-data-dictionary.md) | Draft | Buoy identity + canonical schema + plain-language definition of every variable |
| [0003 — UX refinement](2026-06-27-0003-ux-refinement.md) | Draft | First owner-feedback polish pass: chart fixes, banner/staleness, terminology (vague/houle), definitions, time nav |
| [0004 — Realtime scraper](2026-06-27-0004-realtime-scraper.md) | Accepted | The live-growing tail: scrape CANDHIS realtime HTML (single GET, no Valider/POST) → per-year reel CSV; coalesce merge so temperature history accumulates without clobbering the archive |
| [LEARNINGS](LEARNINGS.md) | Living | Running log of significant findings (gzip/parquet, etc.) — update on every big finding |

## Conventions

- **Name:** the project is **Olatu** (Basque for "wave"). GitHub repo `hadim/olatu`,
  GH Pages base `/olatu/`. (Local working dir may still be `wave-buoys-viewer`.)
- **Language:** everything in this repo is in **English** (code, comments, specs,
  UI source strings). User-facing copy is then translated (EN / FR / ES).
- **Units & time:** SI-ish marine units (m, s, °, °C). All timestamps are stored
  **UTC** and rendered in the buoy's local zone (**Europe/Paris**).
- **One buoy for now:** CANDHIS campaign **06403 — Saint-Jean-de-Luz**. The schema
  is multi-buoy ready (`campaign_id` is a column) but the app ships single-buoy.
