// Current Conditions — the live block at the top of the page.
//
// Two realm ZONES (Mer = teal, Air = amber) joined by the offshore/onshore verdict; the colour +
// glyph system is spec 0013. **Spec 0015** tightened the density: the dial shrank and stopped
// repeating the numbers it already prints, every measure became the same `Metric` tile in one
// full grid (no capped half-row), and the verdict moved into the header row. It stays a pure
// REAL-TIME snapshot — no trends, no history; that is what the chart stack below is for.
// **Spec 0023** added the steepness reading beside the verdict: how organised the swell is, now.

import { useState, type ReactNode } from 'react';
import { useLocale, type Locale, type MessageKey } from '@/lib/i18n';
import { m } from '@/paraglide/messages';
import { lastValue, latestTimestamp, type Manifest, type Series, type WindData } from '../lib/data';
import { compass, dirColor, fmtNumber, fmtStamp, fmtTimeOfDay, freshness, relativeAgo, FRESH_MAX_MS, type Freshness } from '../lib/format';
import { shoreRelation, shoreColorVar } from '../lib/wind';
import { STEEPNESS_CLASSES, steepnessClassIndex, steepnessPct } from '../lib/steepness';
import { stationInfo } from '../lib/stations';
import { useUnits, formatKeyValue, keySuffix } from '../lib/units';
import { useNow } from '../lib/useNow';
import {
  WaveHeightIcon, MaxWaveIcon, PeriodIcon, SteepnessIcon, DirectionIcon, TempIcon,
  WindIcon, StationIcon, RainIcon, HumidityIcon, PressureIcon, AlertIcon,
} from './icons';
import { BuoyMark } from './brands';
import InfoPopover from './InfoPopover';
import SteepnessScale from './SteepnessScale';
import TideStrip from './TideStrip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { openGlossary } from '../lib/glossary';
import type { Tides } from '../lib/tides';

const LABEL_ICON = 'mr-1.5 shrink-0';
// Inside a Metric label the icon sits in an inline wrapper that carries the gap, so the icon
// itself must not add one (see Metric).
const TILE_ICON = 'shrink-0';

// Annular ("ring") sector centred on "up" in the dial's local frame, half-angle =
// spread, drawn between radii ri..ro so it stays in the outer ring and never covers
// the centre readout. The group is rotated to the swell's from-direction.
function conePath(cx: number, cy: number, ri: number, ro: number, halfDeg: number): string {
  const half = Math.min(Math.max(halfDeg, 2), 80);
  const a1 = ((-90 - half) * Math.PI) / 180;
  const a2 = ((-90 + half) * Math.PI) / 180;
  const p = (r: number, a: number) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  return `M${p(ro, a1)} A${ro} ${ro} 0 0 1 ${p(ro, a2)} L${p(ri, a2)} A${ri} ${ri} 0 0 0 ${p(ri, a1)} Z`;
}

/** Compass rose. `color` overrides the cyclical direction hue (used by the Air realm to fix the
 *  wind arrow to amber); `second` draws a faint secondary marker (the gust direction).
 *  Sized down to 128px by spec 0015 — it used to own a 176px column for one value, and the
 *  cardinal + degrees it prints are now the ONLY place those two appear. */
function CompassDial({
  deg, spread, locale, color, second,
}: { deg: number | null; spread: number | null; locale: Locale; color?: string; second?: number | null }) {
  const dirText = deg != null ? compass(deg, locale) : '—';
  const hue = color ?? (deg != null ? dirColor(deg) : null);
  return (
    <div className="relative aspect-square w-full max-w-[128px]" role="img" aria-label={deg != null ? `from ${compass(deg, locale)}` : 'no direction'}>
      <svg viewBox="0 0 120 120" width="100%" height="100%">
        <circle cx="60" cy="60" r="56" className="fill-none stroke-line [stroke-width:2]" />
        {['N', 'E', 'S', 'W'].map((c, i) => {
          const a = (i * 90 - 90) * (Math.PI / 180);
          // Cardinals carry the cyclical direction colour code (N teal · E blue · S gold · W pink),
          // identical on the swell and wind dials — direction is encoded by hue, realm by the zone
          // (spec 0013 revision). So wind direction reads "which way" at a glance, like the swell.
          return (
            <text key={c} x={60 + Math.cos(a) * 51} y={60 + Math.sin(a) * 51 + 3.5} className="font-mono text-[10px] font-semibold" textAnchor="middle" style={{ fill: dirColor(i * 90) }}>
              {locale === 'en' ? c : c === 'W' ? 'O' : c}
            </text>
          );
        })}
        {second != null && (
          <g transform={`rotate(${second + 180} 60 60)`}>
            <path d="M60 16 L56 29 L64 29 Z" style={hue ? { fill: hue, opacity: 0.4 } : undefined} className="fill-accent [opacity:0.4]" />
          </g>
        )}
        {deg != null && (
          <g transform={`rotate(${deg + 180} 60 60)`}>
            {spread != null && <path d={conePath(60, 60, 30, 50, spread)} style={hue ? { fill: `${hue}33` } : undefined} />}
            <path d="M60 13 L54.5 31 L65.5 31 Z" className="fill-accent" style={hue ? { fill: hue } : undefined} />
          </g>
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-[0.05rem]">
        <span className="font-display text-[1.35rem] font-bold leading-none tracking-[-0.01em] text-fg">{dirText}</span>
        {deg != null && <span className="font-mono text-[0.74rem] leading-none text-muted">{Math.round(deg)}°</span>}
      </div>
    </div>
  );
}

/**
 * One measure: label + value. Every reading in both zones is this same tile (spec 0015) — the
 * wave-height hero differs only in TYPE SIZE, not in structure, so the two zones share one grid
 * rhythm instead of a hero block plus two mismatched gauge rows.
 *
 * The label reserves two lines (`min-h`): several are long once translated, and letting them
 * wrap freely would stagger the value baselines across a row. `title` lets a tile show a short
 * label while the popover still names the measure in full (the two temperatures) — the Air row
 * only packs six-up because "Température de l'air" isn't printed in a 120px column.
 *
 * **The type scales with the TILE, not the viewport** (spec 0015 §2). Every tile is a
 * `@container`, so `cqw` resolves against its own grid cell: a Mer cell is ~190px and a six-up
 * Air cell ~124px at the same window, and a fixed size that filled one left the other looking
 * empty. Viewport units can't do this — the page is capped at `max-w-[1100px]`, so past ~1140px
 * a `vw`-sized number stops tracking the box it sits in entirely.
 */
// The percentages are set by the WIDEST string each tile must hold without wrapping — Air's
// "1 020 hPa" is why its floor can't rise, Mer's four-up cell is why its ceiling can. The max
// stops a one-column phone tile (~300px) from rendering a 60px number.
const VALUE_SIZE = 'text-[clamp(1.55rem,20cqw,2.35rem)]';
const VALUE_SIZE_HERO = 'text-[clamp(2.4rem,30cqw,3.6rem)]';
const UNIT_SIZE = 'text-[clamp(0.85rem,9cqw,1.15rem)]';
const UNIT_SIZE_HERO = 'text-[clamp(1rem,11cqw,1.5rem)]';

/** The hour of ONE value, printed under its label only when it is older than its zone's stamp.
 *  The zone badge is the hour of every figure in the zone (it is, on a healthy source: every
 *  variable rides the newest row), so a tile carries its own hour as the exception, never the
 *  rule — a buoy that sent a wave height at 08:00 and its last direction at 07:30.
 *  A line of its own, in words: inline ("· 07:30") it squeezed the dial caption onto three lines
 *  and, on a phone, wrapped to a line that began with the separator. */
function LagStamp({ at, className = '' }: { at?: string; className?: string }) {
  if (!at) return null;
  return <span className={`block font-mono normal-case tracking-normal text-muted ${className}`}>{`${m.cc_measured_at()} ${at}`.toLowerCase()}</span>;
}

function Metric({
  label, value, unit, defKey, accent, icon, hero = false, title, at,
}: { label: string; value: string; unit?: string; defKey: MessageKey; accent?: string; icon?: ReactNode; hero?: boolean; title?: string; at?: string }) {
  // Alignment is inherited from the grid (TILE_COL): left-aligned from 720px up, centred below —
  // where the zone stacks under a centred dial and a left column would read as mis-set (0017 §3).
  return (
    <div className="@container grid min-w-0 grid-rows-subgrid gap-[0.15rem] [grid-row:span_2]">
      {/* Inline flow, NOT flex: in a flex row the label text takes the whole line box, so once it
          wraps to two lines the `i` badge is shoved to the far right and reads as belonging to
          nothing. Inline, the icon · label · badge wrap together as one phrase. */}
      <span className="block self-start text-[0.66rem] uppercase leading-[1.2] tracking-[0.04em] text-faint">
        <span className="mr-1.5 inline-block align-[-0.2em]">{icon}</span>
        {label}
        <InfoPopover title={title ?? label} body={m[defKey]()} />
        <LagStamp at={at} className="mt-[0.15rem] text-[0.68rem]" />
      </span>
      <span
        className={`self-end font-display leading-none [font-feature-settings:'tnum'] ${hero ? `${VALUE_SIZE_HERO} font-bold tracking-[-0.02em]` : `${VALUE_SIZE} font-medium`}`}
        style={accent ? { color: accent } : undefined}
      >
        {value}
        {/* No unit beside a missing value: "— °C" reads as a measurement of nothing. */}
        {unit && value !== '—' && <span className={`text-muted ${hero ? `ml-[0.15rem] ${UNIT_SIZE_HERO}` : UNIT_SIZE}`}> {unit}</span>}
      </span>
    </div>
  );
}

/** A small "comes-from" arrow for the offshore/onshore bridge (realm-coloured). */
function MiniArrow({ deg, color }: { deg: number | null; color: string }) {
  if (deg == null) return <span className="text-faint">—</span>;
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <g transform={`rotate(${deg} 12 12)`}>
        <path d="M12 3 L8 12 L12 10 L16 12 Z" style={{ fill: color }} />
        <line x1="12" y1="10" x2="12" y2="20.5" style={{ stroke: color }} strokeWidth="1.6" strokeLinecap="round" />
      </g>
    </svg>
  );
}

type Realm = 'sea' | 'air';

const ZONE: Record<Realm, string> = {
  sea: 'border-[color-mix(in_oklab,var(--accent)_22%,var(--hairline))] bg-[color-mix(in_oklab,var(--accent)_6%,var(--surface))]',
  air: 'border-[color-mix(in_oklab,var(--c-wind)_24%,var(--hairline))] bg-[color-mix(in_oklab,var(--c-wind)_7%,var(--surface))]',
};

/** A realm whose source has stopped reporting (spec 0015 §8) gives up its realm identity: the
 *  teal/amber card becomes neutral, dashed and hatched. The realm TINT is what says "live" here,
 *  so §7's *desaturated* tint could never say the opposite loudly enough — on 2026-09-09 CANDHIS
 *  had been down 27 h and the Mer zone still read as a working card next to a 21-minute-old Air
 *  one. Grey-and-dashed beside amber needs no reading at all. */
const ZONE_OFF = 'cc-dormant border-dashed border-[color-mix(in_oklab,var(--text-3)_40%,var(--hairline))] bg-surface-2';
/** …and its readings become a record rather than a reading: colour fully drained. This rides on
 *  the zone BODY, never the whole zone — the header carries the alert badge, and greying the
 *  warning along with what it warns about is how §7 lost the signal in the first place.
 *  Greyscale ONLY, no dimming: the point is that the last-known values stay readable, and an
 *  opacity on top of the drain took the hero values to ~2.2:1 on the light theme (they are the
 *  accent colour, i.e. mid-tone before they are grey at all). The zone reads as off through its
 *  chrome — sunken ground, dashed border, hatch, hollow tag — not by being hard to read. */
const ZONE_OFF_BODY = 'grayscale';

/** Zone header: a coloured realm tag + a source chip (buoy or station attribution), and — since
 *  spec 0015 §7 — that realm's own freshness badge, pushed to the trailing edge. Each realm
 *  answers for its own source: the buoy and the station fail independently (CANDHIS can freeze
 *  for hours while Météo-France keeps reporting), so one shared badge could only ever be right
 *  about one of them. `min-[720px]:ml-auto` rather than a plain `ml-auto` — below 720px the whole
 *  header centres (spec 0017) and an auto margin would break that. */
function ZoneHeader({ realm, tag, badge, off = false, children }: { realm: Realm; tag: string; badge?: ReactNode; off?: boolean; children: ReactNode }) {
  const bg = realm === 'sea' ? 'var(--accent)' : 'var(--c-wind)';
  // A dormant realm's tag goes hollow — outlined in the muted ink instead of filled with the
  // realm colour. (Hollow, not a grey fill: a filled pill has to keep its dark label legible,
  // and every grey light enough for that reads as another live colour.)
  const tagStyle = off
    ? { color: 'var(--text-3)', boxShadow: 'inset 0 0 0 1px color-mix(in oklab, var(--text-3) 45%, transparent)' }
    : { background: bg, color: '#08201a' };
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 max-[720px]:justify-center max-[720px]:text-center">
      <span className="rounded-md px-2 py-[0.1rem] font-display text-[0.72rem] font-bold uppercase tracking-[0.05em]" style={tagStyle}>
        {tag}
      </span>
      <span className="inline-flex items-center gap-1.5 font-mono text-[0.72rem] text-muted">{children}</span>
      {badge && <span className="min-[720px]:ml-auto">{badge}</span>}
    </div>
  );
}

/** The single caption under a dial: the direction label + its definition, then the realm's
 *  secondary direction fact (swell spread / gust direction). It no longer repeats the cardinal
 *  and degrees the dial already prints — that redundancy was a whole extra line (spec 0015). */
function DialCaption({ label, defKey, icon, at, children }: { label: string; defKey: MessageKey; icon: ReactNode; at?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-[0.1rem] text-center leading-tight">
      <span className="inline-flex items-baseline text-[0.78rem] text-muted">
        {icon}
        {label}
        <InfoPopover title={label} body={m[defKey]()} />
      </span>
      <LagStamp at={at} className="text-[0.76rem]" />
      {children}
    </div>
  );
}

// `flex-wrap` + `max-w-full`: the pill holds two nowrap spans ("il y a 31 minutes" · "10 août,
// 18:00") that together are ~310px — wider than a 320px phone, and it overflowed the page rather
// than breaking between them (spec 0017 §2).
const STATUS_BADGE = 'inline-flex max-w-full flex-wrap items-center justify-center gap-x-[0.45rem] rounded-full border px-[0.7rem] py-[0.32rem] font-mono text-[0.78rem] cursor-pointer transition-colors hover:border-accent hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';
// Each state owns border + ground + ink together (no shared base to fight): the stale one is the
// ONE element of a dormant zone that gets louder rather than quieter, so it must not inherit the
// muted ink. Amber, not red — the buoy being silent is not an emergency, and `--danger` on a card
// people read at dawn cries wolf.
const STATUS_TONE: Record<Freshness, string> = {
  fresh: 'bg-surface-2 text-muted border-[color-mix(in_oklab,var(--accent)_45%,var(--hairline))]',
  aging: 'bg-surface-2 text-muted border-[color-mix(in_oklab,var(--warning)_50%,var(--hairline))]',
  stale: 'bg-[color-mix(in_oklab,var(--warning)_10%,var(--surface))] text-warning-ink border-[color-mix(in_oklab,var(--warning)_55%,var(--hairline))]',
};
const STATUS_DOT: Record<Freshness, string> = {
  fresh: 'bg-accent motion-safe:animate-[pulse_2.4s_ease-out_infinite]',
  aging: 'bg-warning',
  stale: 'bg-faint',
};

/** One stamp per zone, and it is the hour of the MEASUREMENT — named as such, because "8 minutes
 *  ago · 08:42" did not say of what, and its popover called it "updated". Three clocks exist and
 *  only this one belongs on the card: when the instrument measured. When a single value is older
 *  than that, its tile says so (`LagStamp`); when Olatu last rebuilt its data is a diagnostic
 *  ("is the buoy silent, or is the site?") and lives in the popover. The hour leads and the age
 *  follows: the hour is the fact, the age is what the dot already says. */
function StalenessBadge({ realm, fresh, stampMs, refreshedMs, tz, now }: { realm: Realm; fresh: Freshness; stampMs: number | null; refreshedMs: number | null; tz: string; now: number }) {
  const { locale } = useLocale();
  const { units } = useUnits();
  // Short form ("il y a 11 min"): with the hour now named, the long one no longer fits a phone on one line.
  const ago = stampMs != null ? relativeAgo(stampMs, locale, now, 'short') : null;
  const stamp = stampMs != null ? fmtStamp(stampMs, now, locale, tz, units.clock) : null;
  const refreshed = refreshedMs != null ? fmtStamp(refreshedMs, now, locale, tz, units.clock) : null;
  // The help text is source-agnostic; the reporting cadence that explains the age is what
  // differs between the realms (buoy every 30 min vs station every 6 min behind our refresh).
  const help = `${m[`cc_${fresh}_help` as MessageKey]()} ${m[`cc_cadence_${realm}` as MessageKey]()}`;
  const body = refreshed ? `${help} ${m.cc_refreshed_at()} ${refreshed.text}.` : help;
  const realmLabel = realm === 'sea' ? m.cc_realm_sea() : m.cc_realm_air();
  const off = fresh === 'stale';
  // "Measured at 08:42" while it reports; "last at 00:30" behind the words that say it stopped.
  const lead = stamp && (off ? (stamp.today ? m.cc_last_at() : m.cc_last_on()) : stamp.today ? m.cc_measured_at() : m.cc_measured_on());
  return (
    <InfoPopover title={`${realmLabel} · ${m[`cc_${fresh}` as MessageKey]()}`} body={body} align="end" triggerClassName={`${STATUS_BADGE} ${STATUS_TONE[fresh]}`} triggerLabel={`${m.cc_freshness()} · ${realmLabel} · ${m[`cc_${fresh}` as MessageKey]()}`}>
      {/* A dormant zone spells the state out in words: a timestamp alone is something you have to
          *do arithmetic on* to be alarmed by, and "yesterday, 13:30" read as an ordinary reading
          for a whole day (2026-09-09). The dot survives for the two live states, where the pulse
          is the point. */}
      {off ? <AlertIcon size={13} className="shrink-0" /> : <span className={`h-[9px] w-[9px] rounded-full ${STATUS_DOT[fresh]}`} aria-hidden="true" />}
      {off && <span className="font-semibold">{m.cc_stale()}</span>}
      {stamp && (
        <span className="whitespace-nowrap">
          {off && '· '}
          {lead} <span className={off ? '' : 'text-fg'}>{stamp.text}</span>
        </span>
      )}
      {ago && <span className={`whitespace-nowrap ${off ? 'opacity-75' : 'text-faint'}`}>· {ago}</span>}
    </InfoPopover>
  );
}

// The two readings in the header row are PILLS that open their own explanation: one shape, one
// behaviour. The whole pill is the button; the trailing "i" is only the hint that it is one.
const PILL =
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[0.22rem] font-display text-[0.84rem] font-bold cursor-pointer transition-[filter,border-color] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';
function PillInfoGlyph() {
  return (
    <span className="font-display text-[0.72rem] font-normal italic opacity-60" aria-hidden="true">
      i
    </span>
  );
}

/** The offshore/onshore verdict — the only cross-realm synthesis (station wind × buoy swell).
 *  Spec 0015 folded it into the card's header row: as its own full-width band it was three
 *  tokens and a pill on an otherwise empty line. */
function ShoreBridge({ swellDeg, windDeg, locale }: { swellDeg: number | null; windDeg: number | null; locale: Locale }) {
  const shore = shoreRelation(windDeg, swellDeg);
  const label = shore === 'offshore' ? m.cc_offshore() : shore === 'onshore' ? m.cc_onshore() : m.cc_cross_shore();
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      <span className="inline-flex items-center gap-1 font-mono text-[0.74rem] text-muted">
        <MiniArrow deg={swellDeg} color="var(--accent)" />
        {m.cc_swell()} {swellDeg != null && compass(swellDeg, locale)}
      </span>
      <span className="font-mono text-[0.72rem] text-faint">/</span>
      <span className="inline-flex items-center gap-1 font-mono text-[0.74rem] text-muted">
        <MiniArrow deg={windDeg} color="var(--c-wind)" />
        {m.cc_wind()} {windDeg != null && compass(windDeg, locale)}
      </span>
      {shore ? (
        // Softened verdict: a tinted pill with the shore colour as text + border, not a loud
        // solid fill — onshore's red in particular read as an alarm at full strength (spec 0013 rev).
        // The WHOLE pill opens its definition (spec 0023 §9): the "i" alone was a 10px target
        // inside something that already looked like a button.
        <InfoPopover
          title={m.cc_shore()}
          body={m.def_offshore()}
          align="end"
          triggerLabel={`${m.cc_shore()} · ${label} · ${m.a11y_what_is_this()}`}
          triggerClassName={PILL}
          triggerStyle={{
            color: `var(${shoreColorVar(shore)})`,
            background: `color-mix(in oklab, var(${shoreColorVar(shore)}) 14%, var(--surface))`,
            borderColor: `color-mix(in oklab, var(${shoreColorVar(shore)}) 42%, var(--hairline))`,
          }}
        >
          {label}
          <PillInfoGlyph />
        </InfoPopover>
      ) : (
        <span className="font-mono text-[0.74rem] text-faint">{m.cc_shore()} —</span>
      )}
    </div>
  );
}

/** How organised the swell is, right now (spec 0023 §9): the steepness of the newest reading and
 *  the class it falls in. Built like the shore verdict it sits beside — the fact in mono, the
 *  reading in a pill — because the two answer one question together: the swell's own order here,
 *  what the local wind does to its surface there. Deliberately NOT a fifth tile: a bare "1.6 %"
 *  means nothing without its word, and the Mer grid is four-up (0015).
 *
 *  Neutral, where the shore pill is coloured: a steep sea is not an alarm and a long swell is not
 *  a promise (this number cannot see local chop). The five-step gauge only says where on the
 *  scale the reading sits; equal steps, not rising bars — "five bars" reads as "full signal".
 *
 *  The pill opens the SCALE, with the current class marked: for this reading the explanation is
 *  "where am I among the five", which a paragraph cannot show. One sentence, the table, one hint,
 *  and a way on to the full note in the Definitions sheet.
 *
 *  `off` = the buoy has stopped reporting: the pill goes hollow and dashed like its zone, a
 *  record of the last reading rather than a reading. */
function SteepnessReadout({ pct, off, locale }: { pct: number; off: boolean; locale: Locale }) {
  const [open, setOpen] = useState(false);
  const idx = steepnessClassIndex(pct);
  const word = m[STEEPNESS_CLASSES[idx].labelKey]();
  const value = `${fmtNumber(pct, locale, 1)}\u00a0%`;
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      <span className="inline-flex items-center gap-1 whitespace-nowrap font-mono text-[0.74rem] text-muted">
        <SteepnessIcon size={15} style={{ color: 'var(--c-steep)' }} />
        {m.cc_steepness()} {value}
      </span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`${m.cc_steepness()} · ${word} · ${m.a11y_what_is_this()}`}
            className={`${PILL} ${off ? 'border-dashed border-[color-mix(in_oklab,var(--text-3)_40%,var(--hairline))] text-faint' : 'border-line bg-surface-2 text-fg hover:border-accent'}`}
          >
            <span className="inline-flex items-center gap-[2px]" aria-hidden="true">
              {STEEPNESS_CLASSES.map((c, i) => (
                // The active step is taller as well as darker: at 4px wide, ink alone is too quiet.
                <span
                  key={c.labelKey}
                  className={`w-[4px] rounded-[1px] ${i === idx ? 'h-[11px]' : 'h-[7px]'}`}
                  style={{ background: i === idx ? 'var(--c-steep)' : 'color-mix(in oklab, var(--c-steep) 26%, transparent)' }}
                />
              ))}
            </span>
            {word.charAt(0).toLocaleUpperCase(locale) + word.slice(1)}
            <PillInfoGlyph />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" role="dialog" aria-label={m.cc_steepness()} className="flex w-[19rem] flex-col gap-2 normal-case tracking-normal">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-display text-[0.92rem] font-semibold text-fg">{m.cc_steepness()}</span>
            <span className="font-mono text-[0.82rem] text-muted">{value}</span>
          </div>
          <span className="text-[0.82rem] leading-snug text-muted">{m.def_steepness()}</span>
          <SteepnessScale active={idx} />
          <span className="text-[0.78rem] leading-snug text-faint">{m.steep_hint()}</span>
          <button
            type="button"
            className="self-start rounded-md font-mono text-[0.74rem] text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            onClick={() => {
              setOpen(false);
              openGlossary('steepness');
            }}
          >
            {m.steep_more()} →
          </button>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// Zone body: a narrow dial column + the tile grid. `items-center` keeps the tiles optically
// centred against the taller dial, so the dial's spare height reads as padding, not a hole.
const ZONE_GRID = 'grid grid-cols-[minmax(120px,0.4fr)_2.7fr] items-center gap-x-5 gap-y-4 max-[720px]:grid-cols-1 max-[720px]:justify-items-center';
// Below 720px the zone stacks under a CENTRED dial, so the tiles centre too (spec 0017 §3) — a
// left-aligned column under a centred dial reads as mis-set, which is exactly what it looked like.
// From 720px up the 0015 rule stands unchanged: left-aligned, values on a subgrid baseline.
// (`text-center` only — NOT `justify-items-center`: each tile is a `@container`, and shrink-wrapping
// a size-contained box collapses it, taking the `cqw` type scale down with it.)
const TILE_COL = 'border-l border-line pl-5 max-[720px]:w-full max-[720px]:border-l-0 max-[720px]:pl-0 max-[720px]:text-center';
// Sea 4-up, Air 6-up — each fills its grid EDGE TO EDGE at every breakpoint. No ragged last row,
// no `max-w` cap leaving half a row blank (what made the old Air zone read as empty), and no
// over-wide columns leaving rivers of white between the values.
// `auto-rows-auto` + each tile spanning two rows and adopting them via `grid-rows-subgrid` aligns
// every value baseline across a row WITHOUT reserving space: the label track is exactly as tall as
// the tallest label in that row. A `min-h` on the label did the same job but cost a blank line's
// height whenever no label actually wrapped, which is the common case.
// Sea keeps TWO columns to the narrowest phone (spec 0017 §3): one column left a hero value alone
// on a full-width row with an empty half beside it. The width freed in §2 pays for the second.
const SEA_TILES = `grid auto-rows-auto grid-cols-4 gap-x-5 gap-y-4 max-[1000px]:grid-cols-2 max-[420px]:gap-x-3 ${TILE_COL}`;
const AIR_TILES = `grid auto-rows-auto grid-cols-6 gap-x-4 gap-y-4 max-[1000px]:grid-cols-3 max-[560px]:grid-cols-2 max-[420px]:gap-x-3 ${TILE_COL}`;

export default function CurrentConditions({
  latest, manifest, tides, wind,
}: { latest: Series; manifest: Manifest; tides: Tides | null; wind: WindData | null }) {
  const { locale } = useLocale();
  const { units } = useUnits();
  const tz = manifest.timezone;
  const now = useNow(30_000);

  // Sea (buoy) realm
  // Every value on the card is read through `sea` / `air`, never a bare `lastValue`: a value is
  // shown only while it belongs to its realm's current reading, i.e. measured at most
  // FRESH_MAX_MS before the realm's stamp. A buoy that keeps its wave height and loses its
  // direction otherwise shows a 35 h-old direction (and a shore verdict built on it) under a
  // fresh stamp. Healthy sources never get near the bound: every variable rides the newest row.
  const sea = (key: string) => lastValue(latest, key, FRESH_MAX_MS);
  const hs = sea('significant_wave_height_m');
  const hmax = sea('max_wave_height_m');
  const period = sea('significant_period_s');
  const dir = sea('peak_direction_deg');
  const spread = sea('peak_directional_spread_deg');
  const seaTemp = sea('sea_temperature_c');
  // Steepness (spec 0023) is made of the two tiles beside it, so it is computed from exactly the
  // values they print — and only when both come from the SAME reading: a height from 09:00 over a
  // period from 08:30 is a ratio of nothing. No smoothing either: a median over the last readings
  // would be steadier at a class boundary, but the card would then disagree with its own tiles and
  // with the last point of the chart below. The number rides beside the word so that a borderline
  // reading reads as borderline.
  const steepness = hs && period && hs.at === period.at ? steepnessPct(hs.value, period.value) : null;

  // Air (station) realm
  const wl = wind?.latest;
  const air = (key: string) => (wl ? lastValue(wl, key, FRESH_MAX_MS) : null);
  const windSpeed = air('wind_speed_ms');
  const windDir = air('wind_direction_deg');
  const gust = air('wind_gust_ms');
  const gustDir = air('wind_gust_direction_deg');
  const airTemp = air('air_temperature_c');
  const rain = air('precipitation_mm');
  const humidity = air('humidity_pct');
  const pressure = air('pressure_msl_hpa');

  const num = (v: { value: number } | null, digits = 1) => (v ? fmtNumber(v.value, locale, digits) : '—');
  // Units-aware value for the convertible measures (speed · temperature · pressure) — spec 0014.
  // The matching unit suffix comes from keySuffix(key, units).
  const fmtU = (v: { value: number } | null, key: string) => (v ? formatKeyValue(key, v.value, units, locale) : '—');

  // One stamp PER REALM (spec 0015 §7). The two sources are unrelated feeds on unrelated
  // cadences and they stall independently, so neither one may stand in for the other.
  const seaStampMs = latestTimestamp(latest);
  const seaFresh = seaStampMs != null ? freshness(now - seaStampMs) : 'stale';
  const airStampMs = wl ? latestTimestamp(wl) : null;
  const airFresh = airStampMs != null ? freshness(now - airStampMs) : 'stale';
  // A value older than its zone's stamp names its own hour on its tile (see `LagStamp`).
  const lagOf = (v: { at: number } | null, stampMs: number | null) =>
    v && stampMs != null && v.at < stampMs ? fmtTimeOfDay(v.at, locale, tz, units.clock) : undefined;
  const seaLag = (v: { at: number } | null) => lagOf(v, seaStampMs);
  const airLag = (v: { at: number } | null) => lagOf(v, airStampMs);
  // When Olatu last rebuilt each source's tiers — the popover's diagnostic, never the stamp.
  const seaRefreshedMs = Date.parse(manifest.generated_at) || null;
  const airRefreshedMs = wind ? Date.parse(wind.manifest.generated_at) || null : null;
  // "This source has stopped reporting" — the state the whole zone dresses for (spec 0015 §8).
  const seaOff = seaFresh === 'stale';
  const airOff = airFresh === 'stale';

  const kind = wind ? stationInfo(wind.station)?.kind : undefined;
  const kindLabel = kind ? m[`station_kind_${kind.replaceAll('-', '_')}` as MessageKey]() : '';

  return (
    <section
      aria-label={m.cc_title()}
      className="relative flex flex-col gap-2 rounded-2xl border border-line bg-surface px-3 pb-4 pt-3.5 shadow-[0_0_40px_-28px_var(--accent)] sm:px-5 sm:pb-5 sm:pt-4"
    >
      {/* Header row: identity · the two readings (steepness, spec 0023; the cross-realm verdict).
          They ride here rather than in their own band (spec 0015); below 860px they drop to their
          own full-width line. Freshness used to
          sit here too, as ONE badge fed by the buoy alone — it now lives per zone (spec 0015 §7). */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span className="font-mono text-[0.74rem] uppercase tracking-[0.08em] text-faint">
          {m.cc_title()}
          <span className="text-muted"> · {manifest.buoy.name}</span>
        </span>
        {(steepness != null || wind) && (
          // The card's two READINGS, side by side: the swell's own order (Mer only — it stands
          // without a station) and the wind against it. They wrap as a pair under the title.
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 max-[860px]:order-3 max-[860px]:basis-full min-[861px]:justify-end">
            {steepness != null && <SteepnessReadout pct={steepness} off={seaOff} locale={locale} />}
            {wind && (
              // The verdict is the card's one CROSS-realm claim, so a single dormant realm makes it
              // stale whole: on 2026-09-09 it read "cross-shore" from a live wind and a swell
              // direction a day old. It wears the same grey as the zone it can no longer speak for.
              <div className={seaOff || airOff ? ZONE_OFF_BODY : ''}>
                <ShoreBridge swellDeg={dir?.value ?? null} windDeg={windDir?.value ?? null} locale={locale} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* ---- MER (buoy) zone ---- */}
      <div className={`rounded-xl border p-2.5 sm:p-3.5 ${seaOff ? ZONE_OFF : ZONE.sea}`}>
        <ZoneHeader realm="sea" tag={m.cc_realm_sea()} off={seaOff} badge={<StalenessBadge realm="sea" fresh={seaFresh} stampMs={seaStampMs} refreshedMs={seaRefreshedMs} tz={tz} now={now} />}>
          <BuoyMark size={15} className={seaOff ? 'text-faint' : 'text-accent'} />
          {m.cc_buoy()} {manifest.buoy.campaign_id} · {manifest.buoy.network}
        </ZoneHeader>
        <div className={`${ZONE_GRID} ${seaOff ? ZONE_OFF_BODY : ''}`}>
          <div className="flex flex-col items-center gap-1.5">
            <CompassDial deg={dir?.value ?? null} spread={spread?.value ?? null} locale={locale} />
            <DialCaption label={m.cc_direction()} defKey="def_direction" at={seaLag(dir)} icon={<DirectionIcon className={LABEL_ICON} style={{ color: 'var(--c-dir)' }} />}>
              {spread && (
                <span className="inline-flex items-center whitespace-nowrap font-mono text-[0.76rem] text-faint">
                  {m.cc_spread()} ±{Math.round(spread.value)}°
                  <InfoPopover title={m.cc_spread()} body={m.def_spread()} />
                </span>
              )}
            </DialCaption>
          </div>
          <div className={SEA_TILES}>
            <Metric label={m.cc_wave_height()} value={num(hs)} at={seaLag(hs)} unit="m" defKey="def_wave_height" accent="var(--accent)" hero icon={<WaveHeightIcon className={TILE_ICON} style={{ color: 'var(--c-height)' }} />} />
            <Metric label={m.cc_max_wave()} value={num(hmax)} at={seaLag(hmax)} unit="m" defKey="def_max_wave" icon={<MaxWaveIcon className={TILE_ICON} style={{ color: 'var(--c-max)' }} />} />
            <Metric label={m.cc_period()} value={num(period)} at={seaLag(period)} unit="s" defKey="def_period" icon={<PeriodIcon className={TILE_ICON} style={{ color: 'var(--c-period)' }} />} />
            <Metric label={m.cc_sea_temp_short()} title={m.cc_sea_temp()} value={fmtU(seaTemp, 'sea_temperature_c')} at={seaLag(seaTemp)} unit={keySuffix('sea_temperature_c', units) ?? undefined} defKey="def_sea_temp" accent="var(--accent)" icon={<TempIcon className={TILE_ICON} style={{ color: 'var(--accent)' }} />} />
          </div>
        </div>
      </div>

      {/* ---- AIR (station) zone ---- */}
      {wind ? (
        <div className={`rounded-xl border p-2.5 sm:p-3.5 ${airOff ? ZONE_OFF : ZONE.air}`}>
          <ZoneHeader realm="air" tag={m.cc_realm_air()} off={airOff} badge={<StalenessBadge realm="air" fresh={airFresh} stampMs={airStampMs} refreshedMs={airRefreshedMs} tz={tz} now={now} />}>
            <StationIcon size={15} style={{ color: airOff ? 'var(--text-3)' : 'var(--c-wind)' }} />
            {m.cc_station()} {wind.manifest.station.label} <span className="text-faint">· {fmtNumber(wind.distanceKm, locale, 1)} km{kindLabel ? ` · ${kindLabel}` : ''} · {wind.manifest.source.provider}</span>
          </ZoneHeader>
          <div className={`${ZONE_GRID} ${airOff ? ZONE_OFF_BODY : ''}`}>
            <div className="flex flex-col items-center gap-1.5">
              <CompassDial deg={windDir?.value ?? null} spread={null} second={gustDir?.value ?? null} locale={locale} />
              <DialCaption label={m.cc_wind_dir()} defKey="def_wind" at={airLag(windDir)} icon={<WindIcon className={LABEL_ICON} style={{ color: 'var(--c-wind)' }} />}>
                {gustDir && (
                  <span className="whitespace-nowrap font-mono text-[0.76rem] text-faint">
                    {m.cc_gust().toLowerCase()} {compass(gustDir.value, locale)} · {Math.round(gustDir.value)}°
                  </span>
                )}
              </DialCaption>
            </div>
            <div className={AIR_TILES}>
              <Metric label={m.cc_wind()} value={fmtU(windSpeed, 'wind_speed_ms')} at={airLag(windSpeed)} unit={keySuffix('wind_speed_ms', units) ?? undefined} defKey="def_wind" accent="var(--c-wind)" icon={<WindIcon className={TILE_ICON} style={{ color: 'var(--c-wind)' }} />} />
              <Metric label={m.cc_gust()} value={fmtU(gust, 'wind_gust_ms')} at={airLag(gust)} unit={keySuffix('wind_gust_ms', units) ?? undefined} defKey="def_gust" icon={<WindIcon className={TILE_ICON} style={{ color: 'var(--c-wind)', opacity: 0.7 }} />} />
              <Metric label={m.cc_air_temp_short()} title={m.cc_air_temp()} value={fmtU(airTemp, 'air_temperature_c')} at={airLag(airTemp)} unit={keySuffix('air_temperature_c', units) ?? undefined} defKey="def_air_temp" accent="var(--c-airtemp)" icon={<TempIcon className={TILE_ICON} style={{ color: 'var(--c-airtemp)' }} />} />
              <Metric label={m.cc_rain()} value={num(rain)} at={airLag(rain)} unit="mm/h" defKey="def_rain" icon={<RainIcon className={TILE_ICON} style={{ color: 'var(--c-period)' }} />} />
              <Metric label={m.cc_humidity()} value={humidity ? fmtNumber(humidity.value, locale, 0) : '—'} at={airLag(humidity)} unit={humidity ? '%' : undefined} defKey="def_humidity" icon={<HumidityIcon className={TILE_ICON} style={{ color: 'var(--c-tide)' }} />} />
              <Metric label={m.cc_pressure()} value={fmtU(pressure, 'pressure_msl_hpa')} at={airLag(pressure)} unit={pressure ? keySuffix('pressure_msl_hpa', units) ?? undefined : undefined} defKey="def_pressure" icon={<PressureIcon className={TILE_ICON} style={{ color: 'var(--c-dir)' }} />} />
            </div>
          </div>
        </div>
      ) : (
        <div className={`flex items-center gap-2.5 rounded-xl border border-dashed p-2.5 sm:p-3.5 ${ZONE.air}`}>
          <StationIcon size={16} style={{ color: 'var(--c-wind)' }} />
          <span className="font-mono text-[0.78rem] text-muted">{manifest.wind ? m.cc_wind_unavailable() : m.cc_wind_none()}</span>
        </div>
      )}

      <TideStrip tides={tides} tz={tz} lat={manifest.buoy.lat} lon={manifest.buoy.lon} />
    </section>
  );
}
