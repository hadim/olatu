# 0011 — Analytics, consent & legal pages

- **Status:** Implemented
- **Date:** 2026-07-07
- **Authors:** Hadrien Mary (+ Claude)
- **Relates to:** [0006 stack & a11y](2026-06-28-0006-stack-migration-a11y.md) (Paraglide
  i18n, Radix/Tailwind, the `Button` primitive reused here), [0010 PWA](2026-07-05-0010-pwa.md)
  (the single precached `index.html` the hash routes ride on; the SW must not stale-serve
  the new build).

> Owner request: *"add my Google Analytics (G-XWQEVH6TD8), a consent banner, and the
> generated legal/privacy/contact pages."* Olatu is EU-facing (French coast, French/EU
> audience), so analytics has to be consent-gated and the site needs the usual
> mentions-légales / privacy / contact set.

---

## 1. Goal & scope

Give Olatu **privacy-first, GDPR-compliant** audience measurement plus the static legal
surface a public French site is expected to carry.

**In scope:**

- Google Analytics 4 (`G-XWQEVH6TD8`) wired with **Consent Mode v2**, loaded **only after an
  explicit Accept** — no request to Google before consent.
- A **consent banner** (Accept / Decline, equal prominence), choice persisted, revocable.
- Three static, fully-translated (EN/FR/ES) pages: **Legal notice** (mentions légales),
  **Privacy policy**, **Contact**, reachable from the footer.
- A tiny **hash router** to host those pages inside the existing SPA.

**Out of scope (deliberately):** a cookie *category* manager (there is exactly one optional
cookie family — GA), server-side tagging, ad/marketing tags (Consent Mode keeps
`ad_storage`/`ad_user_data`/`ad_personalization` denied permanently), and any first-party
analytics of our own.

---

## 2. Decisions

- **Consent gate = don't load, not just don't track.** The gtag script is injected
  dynamically the first time consent is `granted`; a first-visit *Decline* (or no decision)
  loads **nothing** from Google. This is stronger than the default Consent Mode "load but
  ping cookielessly" and matches the owner's "runs only if you accept" intent. Consent Mode
  v2 signals are still set (`analytics_storage` granted; all ad signals denied) so GA behaves
  correctly and future changes stay compliant. `anonymize_ip` is on.
- **Editor identity.** The publisher is an individual, **Hadrien Mary** (personal,
  non-commercial project) — named in the mentions légales and as publication director, as
  French law requires an identifiable editor. **Contact is routed through GitHub** (issues +
  profile), no email exposed. Host is GitHub Pages / GitHub, Inc. (US address published).
- **Hash routing, not path routing.** The Vite `base` is relative (`./`) so one build works
  at both `olatu.io` and `hadim.github.io/olatu/` (spec 0010). Path routes (`/privacy`) would
  break relative asset resolution and need a GitHub-Pages `404.html` SPA fallback; hash routes
  (`#/privacy`) need zero server config, resolve every asset against the single precached
  `index.html`, and therefore also work offline in the PWA. Legal pages don't need their own
  SEO, so the hash-URL trade-off is free.
- **Reactive consent store.** A plain module-level store (`localStorage` key
  `olatu.consent` ∈ {`granted`,`denied`,unset}) exposed via `useSyncExternalStore`, so the
  banner and the privacy page's "your choice" controls stay in sync and the banner never
  reappears once answered.

## 3. Shape

- `webapp/src/lib/analytics.ts` — consent store + GA4 loader. `initAnalytics()` (called once
  on mount) restores GA for a returning granter; `setConsent()` / `useConsent()` drive the
  UI. The gtag shim pushes the raw `arguments` object (GA requirement), typed via a cast.
- `webapp/src/lib/route.ts` — `useRoute()` / `routeHref()` over `window.location.hash`
  (`home` | `legal` | `privacy` | `contact`).
- `webapp/src/components/ConsentBanner.tsx` — fixed bottom bar, Decline as prominent as
  Accept, links to the privacy page. Rendered on every route; returns null once decided.
- `webapp/src/pages/LegalPage.tsx` — one component switching on the route; shared prose
  layout, back-to-Olatu link, scroll-to-top. The privacy page embeds live consent controls.
- `webapp/src/App.tsx` — when the route isn't `home`, render `<LegalPage>` instead of the
  dashboard (Header/Footer/ConsentBanner shared); calls `initAnalytics()` once.
- `webapp/src/components/Footer.tsx` — a Legal · Privacy · Contact row (hash links).
- `webapp/messages/{en,fr,es}.json` — all consent + legal copy (prefixes `consent_`,
  `legal_`, `privacy_`, `contact_`, plus `footer_legal/privacy/contact`, `nav_back_home`).

## 4. Verification

Built + driven end-to-end (Playwright on `vite preview`):

- First load: banner shown, `olatu.consent` unset, **no** `googletagmanager.com/gtag`
  request, no `_ga` cookie.
- Accept: gtag/js loads (200), `page_view` collected with `ep.anonymize_ip=true`, Consent
  Mode reads `gcs=G101` (analytics granted, ads denied) + `npa=1`; banner disappears; choice
  persists across reloads.
- `#/legal`, `#/privacy`, `#/contact` render their content with the dashboard hidden; footer
  links + back-to-Olatu work; privacy "your choice" toggles re-enable/disable analytics live.

> **PWA gotcha (logged during dev):** the previous build's service worker will stale-serve
> the old app shell in an already-visited browser until it auto-updates — during local
> verification, unregister the SW / clear caches (or hard-reload) after a rebuild, else you
> "test" the old bundle. In production the `autoUpdate` SW swaps on next load.

## 5. Owner follow-ups

- The GA4 property `G-XWQEVH6TD8` is hard-coded (public measurement ID — safe in the client).
  Nothing secret is added; no CI change needed.
- If a real contact email is ever wanted instead of GitHub-only, add it to the Contact +
  mentions-légales copy (three locales) — see [0008](2026-07-05-0008-tides.md) for the
  message-key pattern.
