# 0006 — Stack migration (Tailwind v4 + shadcn + Paraglide) & Phase-7 polish/a11y

- **Status:** Accepted
- **Date:** 2026-06-28
- **Authors:** Hadrien Mary (+ implementation)
- **Implements:** foundation roadmap **Phase 1 tail** (TS + Tailwind + shadcn was
  deferred) and **Phase 7** (polish, mobile & a11y). See
  [0001 §10](2026-06-27-0001-foundation.md).

> Two roadmap items, landed together because they reinforce each other: paying down
> the **hand-rolled stack debt** (theme + i18n + styling) by moving to the stack the
> foundation always intended — **Tailwind CSS v4 + shadcn/ui (Radix) + Paraglide JS** —
> and then the **Phase-7 polish / mobile / a11y** pass. They go in this order on
> purpose: adopting Radix primitives brings focus-trapping, ARIA wiring and keyboard
> navigation *for free*, so the a11y work builds on accessible primitives instead of
> hardening hand-rolled widgets twice.

---

## 1. Why now

The webapp shipped with three deliberately hand-rolled subsystems (foundation
"build it, swap the stack later"):

- **Theme** — a React context toggling `data-theme` on `<html>`; tokens as CSS vars.
- **i18n** — a context + a single ~280-key `MESSAGES` dict, `t('dot.key')`.
- **Styling** — ~1800 lines of bespoke, BEM-ish, token-driven CSS.

All three work, but they are exactly the substrate the foundation flagged for
replacement (0001 §4: Tailwind v4, shadcn/ui, Paraglide). The longer the bespoke CSS
grows, the costlier the swap. We do it now, before the comparison view (0005 next).

## 2. Decision: **full utility rewrite** (owner's call, 2026-06-28)

Markup is re-expressed in **Tailwind utility classes** across every component; the
bespoke component-class system in `styles.css` is retired. This is the more ambitious
of the two options considered (the other was a token-bridge that kept the component
CSS); the owner chose the full rewrite for a clean end-state.

**What "full utility rewrite" means here (and what it pragmatically can't):** the
*only* CSS that survives is what utilities genuinely cannot express:

1. **Design tokens** — the two `:root[data-theme]` blocks (dark/light) defining the
   raw custom properties, bridged into Tailwind via `@theme inline` (see §3).
2. **`@keyframes`** — `pulse`, `marker-pulse`, `fade-in`, `slide-in`.
3. **Third-party overrides** — uPlot (`.u-select`, `.u-cursor-pt`) and MapLibre.
4. **A few pseudo-element effects** — the marker ping ring, the hatched
   "no-data" band, the calendar day data/big-swell dots — kept as tiny
   `@utility`/`@layer components` rules (utilities can't do `::after` content).
5. **JS-driven chart internals** — `TimeSeries` builds DOM in JS and queries it by
   class (`.hover-time`, `.hover-stats`) and injects `innerHTML` chips. Those class
   hooks stay; the chips use utility classes inside the HTML strings (Tailwind's JIT
   scans `.tsx` source, template literals included, so the classes are generated).

Everything else — layout, spacing, color, type, borders, radii, responsive — becomes
utilities. This is the standard shape of a Tailwind-native shadcn app, not a
compromise.

## 3. Theming under Tailwind v4 (the load-bearing detail)

The canvas charts and assorted inline tints read the **raw CSS variables** directly
and rely on `[data-theme]` switching:

- `TimeSeries` — `cssVar('--text-3')`, `cssVar('--hairline')`, `cssVar(s.colorVar)`
  where `colorVar ∈ {--c-height,--c-max,--c-period,--c-dir,--c-temp}`.
- `iconSvg(name, { color: 'var(--c-*)' })`, banner SVG `style={{color:'var(--c-dir)'}}`.
- `Sparkline` `stroke="var(--accent)"`; `ExpandedMap`/`BuoyLocator` read `--accent`.

So the raw vars **must keep existing and keep switching by `[data-theme]`**. The
Tailwind v4 bridge is `@theme inline`, which emits utilities that *reference* the raw
var rather than copying its value:

```css
@import "tailwindcss";
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));

:root, :root[data-theme="dark"] { --bg:#0a1622; --accent:#38e1c6; /* …raw vars… */ }
:root[data-theme="light"]      { --bg:#eef4f6; --accent:#0e8c7a; /* …raw vars… */ }

@theme inline {
  --color-bg: var(--bg);          /* → bg-bg / text-bg / border-bg            */
  --color-surface: var(--surface);
  --color-fg: var(--text);        /* → text-fg  (raw var stays --text)        */
  --color-muted: var(--text-2);   /* → text-muted                            */
  --color-faint: var(--text-3);   /* → text-faint                            */
  --color-accent: var(--accent);
  --color-wave: var(--c-height);  /* series tints, if needed as utilities    */
  --font-display: 'Space Grotesk', system-ui, sans-serif;
  --font-mono: 'IBM Plex Mono', ui-monospace, monospace;
}
```

**Consequence:** because `bg-surface` resolves to `var(--surface)` and that var
changes per `[data-theme]`, **components almost never need `dark:` variants** — the
token *is* theme-aware. This is what makes the full rewrite low-risk: the dark/light
behaviour lives in ~40 lines of token definitions, not sprinkled across utilities.

Tailwind token → utility name map (raw var kept as-is for the canvas):

| Raw var | Tailwind token | Utilities |
|---|---|---|
| `--bg` | `--color-bg` | `bg-bg` |
| `--surface` / `--surface-2` | `--color-surface` / `--color-surface-2` | `bg-surface` |
| `--hairline` | `--color-line` | `border-line` |
| `--divider` | `--color-divider` | `border-divider` |
| `--text` / `--text-2` / `--text-3` | `--color-fg` / `--color-muted` / `--color-faint` | `text-fg` … |
| `--accent` / `--accent-deep` | `--color-accent` / `--color-accent-deep` | `text-accent` … |
| `--warm`/`--danger`/`--warning`/`--calm` | same names | `text-warm` … |
| `--c-height…--c-temp` | `--color-wave/max/period/dir/temp` | `text-wave` … |

## 4. shadcn/ui (copy-in, Radix backend)

Author the primitives we actually need in `src/components/ui/` (shadcn-style, but
hand-placed — no CLI/network round-trip; Tailwind-v4 token wiring is bespoke anyway):

| Primitive | Replaces | a11y win |
|---|---|---|
| `Popover` | `InfoPopover` panel | focus return, `Esc`, outside-click, ARIA |
| `Dialog` / `Sheet` | `Glossary` slide-over, `ExpandedMap` modal | focus trap, `aria-modal`, scroll-lock |
| `Tooltip` | hover hints | keyboard-reachable description |
| `ToggleGroup` | buoy segmented switch, range/smoother chips | roving tabindex, arrow keys |
| `Select` | language switch | typeahead, ARIA listbox |
| `Button` | `.icon-button` / `.chip` / triggers | consistent focus-visible ring |

Deps: `@radix-ui/react-{popover,dialog,tooltip,toggle-group,select}`,
`class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react` (some bespoke
SVGs in `icons.tsx` are kept — they're tied to the chart series colours). `cn()` lives
in `src/lib/utils.ts`.

The bespoke data-viz widgets stay bespoke in behaviour (the calendar cherry-picker's
data-dot day cells, the heat-ribbon's drag math, the compass dial SVG) — only their
*chrome* (trigger buttons, popovers, the panel container) adopts the primitives. The
heat-ribbon and date-picker get real ARIA (see §6).

## 5. i18n → Paraglide JS v2

- **Setup:** `project.inlang/settings.json` (locales `en`/`fr`/`es`, base `en`,
  `plugin.inlang.messageFormat`), messages in `messages/{en,fr,es}.json`, generated
  output in `src/paraglide/` via `@inlang/paraglide-js`'s Vite plugin. `src/paraglide/`
  is gitignored (generated).
- **Keys:** Paraglide message names must be valid JS identifiers, so the dot keys
  become snake — `cc.waveHeight` → `cc_waveHeight`, `chart.smooth.raw` →
  `chart_smooth_raw`. Call sites move from `t('cc.waveHeight')` to `m.cc_waveHeight()`;
  dynamic keys use `m[`cc_${fresh}_help`]()` (Paraglide's `m` is a namespace object,
  so runtime indexing works).
- **No-reload switch:** strategy `["localStorage","preferredLanguage","baseLocale"]`
  (same detection the hand-rolled one had). A thin `LocaleProvider` calls
  `setLocale(l, { reload:false })` then bumps a context value so the React tree
  re-renders and every `m.*()` re-reads the new locale — range/zoom/scroll state
  survives a language switch (0001 §8).
- **`Locale` type:** re-exported from the Paraglide runtime through a stable
  `src/lib/i18n.ts` shim so `format.ts` (`compass(deg, locale)` etc.) and call sites
  keep a single import path. `i18n.tsx` (the old provider) is deleted.
- Glossary content stays inline in messages for now; the per-locale **glossary JSON +
  CI key-parity check** (0001 §8) remain a *future* item — out of scope here.

## 6. Phase-7 — polish, mobile & a11y

- **Accessible chart fallback:** the four canvas panels are decorative to a screen
  reader. Add a visually-hidden, per-window **data summary** (latest reading + window
  min/max/range per metric) in a real `<table>` behind the live region, plus
  `role="img"` + `aria-label` on each panel host. Canvas stays the visual; the table
  is the non-visual truth.
- **uPlot touch / pinch-zoom:** a small touch plugin (two-finger pinch → `setScale` on
  x, synced across panels; one-finger drag pans) + a "Reset" affordance. Respects the
  existing drag-to-zoom on desktop.
- **Mobile reflow hardening:** audit every breakpoint at 360 px; banner dial
  full-width, gauges 3-up, charts taller with tap-to-inspect (value card pinned, not
  under the finger), presets snap-scroll, picker as a bottom sheet, all touch targets
  ≥44 px.
- **Reduced-motion:** every animation (`pulse`, `marker-pulse`, slide/fade, any new
  micro-interaction) gated behind `motion-reduce:` / the existing
  `prefers-reduced-motion` media block.
- **ARIA floor:** the heat-ribbon `slider` gets keyboard support (←/→ to nudge the
  window, Home/End), the date-picker grid gets roving focus + arrow keys (via the
  primitive where possible), live regions announce range changes politely.
- **Contrast AA:** verify both themes hit WCAG AA for text and UI; nudge `--text-3`
  / faint tokens if any pairing fails (documented in LEARNINGS if changed).

## 7. Risks & mitigations

- **Visual regression on the pixel-perfect bits** — mitigated by keeping the raw token
  values byte-identical (only the *delivery mechanism* changes) and screenshotting
  before/after at desktop + mobile widths. The canvas code is untouched.
- **Paraglide dynamic keys / tree-shaking** — runtime `m[key]()` is intentional;
  accept that those messages aren't tree-shaken (the dict is ~280 small strings).
- **rolldown-vite + plugin compat** — `@tailwindcss/vite` and `paraglideVitePlugin`
  are standard Vite plugins; verified to build under vite 8 (rolldown).
- **shadcn-by-hand drift** — we author only ~6 primitives and pin Radix versions; no
  CLI dependency to keep in sync.

## 8. Out of scope (kept for later, per roadmap)

- Side-by-side **buoy comparison** (0005 left it out — still next).
- Per-locale **glossary JSON** + the CI **key-parity** check (0001 §8) — the glossary
  stays in the message dict for now.
- PMTiles self-hosting; further branding.

## 9. Acceptance

- `npm run typecheck` + `npm run build` green; bundle CSS not materially larger.
- App renders identically (dark + light, en/fr/es) at desktop and ≤360 px — verified
  by screenshot diff on the key surfaces.
- Keyboard-only: every control reachable, focus visible, dialogs trap + restore focus,
  `Esc` closes overlays.
- Charts expose an accessible data summary; pinch-zoom works on a real touch surface.
- No bespoke component CSS remains beyond §2's allowed list.
