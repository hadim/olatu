// The top "station bar" (spec 0005 §5.3): separates the Olatu app frame from the data.
// It introduces the app, lets you pick a buoy (segmented control + the map locator), and
// states plainly where the data comes from (CANDHIS live + the open Hugging Face
// data store). Registry-driven, so it renders before any manifest loads.
//
// It's the tallest thing above the charts (the locator map dominates), so it's collapsed
// BY DEFAULT to a dense one-line bar — eyebrow + a compact buoy switcher + a small chevron
// — that still lets you pick a buoy. Expand drops in the intro, the source links and the
// map. The choice is remembered across sessions, like the chart range/smoothing prefs.

import { lazy, Suspense, useState } from 'react';
import { useLocale, type MessageKey } from '@/lib/i18n';
import { m } from '@/paraglide/messages';
import { cn } from '@/lib/utils';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { BUOYS, buoyInfo } from '../lib/buoys';
import { stationsForBuoy } from '../lib/stations';
import { HuggingFaceMark, BuoyMark } from './brands';
import { StationIcon } from './icons';

interface StationPickerProps {
  campaign: string;
  selected: string | null;
  defaultStation: string | null;
  onSelect: (id: string, isDefault: boolean) => void;
  compact?: boolean;
}

// The wind-station picker (Air realm — amber). Default = the buoy's nearest station (manifest
// pointer); the user may pin any curated station, remembered per buoy. Kept visually distinct
// from the teal buoy switcher so "station" (on land) never reads as "buoy" (offshore). Spec 0013.
function StationPicker({ campaign, selected, defaultStation, onSelect, compact = false }: StationPickerProps) {
  const [open, setOpen] = useState(false);
  const buoy = buoyInfo(campaign);
  const choices = stationsForBuoy(buoy.lat, buoy.lon);
  const cur = selected ? choices.find((c) => c.id === selected) : undefined;
  const kindLabel = (kind: string) => m[`station_kind_${kind.replaceAll('-', '_')}` as MessageKey]();
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={m.station_change()}
          className={cn(
            'inline-flex items-center gap-[0.5rem] rounded-[0.6rem] border text-fg transition-colors',
            'border-[color-mix(in_oklab,var(--c-wind)_40%,var(--divider))] bg-[color-mix(in_oklab,var(--c-wind)_10%,var(--surface-2))] hover:border-[var(--c-wind)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--c-wind)]',
            compact ? 'px-[0.6rem] py-[0.32rem]' : 'px-[0.75rem] py-[0.42rem]',
          )}
        >
          <StationIcon size={compact ? 14 : 16} style={{ color: 'var(--c-wind)' }} className="shrink-0" />
          {cur ? (
            <span className="inline-flex items-baseline gap-1.5 leading-none">
              <span className="font-display text-[0.86rem] font-semibold">{cur.label}</span>
              <span className="font-mono text-[0.66rem] text-faint">{cur.distanceKm.toFixed(1)} km</span>
            </span>
          ) : (
            <span className="font-display text-[0.84rem] text-muted">{m.cc_wind_none()}</span>
          )}
          <span aria-hidden="true" className="text-[0.7rem] text-faint">▾</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" role="listbox" aria-label={m.station_wind_heading()} className="flex w-[20rem] flex-col gap-0.5 p-1.5">
        <div className="px-2 pb-1 pt-1 font-mono text-[0.64rem] uppercase tracking-[0.07em] text-[color:var(--c-wind)]">{m.station_wind_heading()}</div>
        {choices.map((s) => {
          const isDefault = s.id === defaultStation;
          const isSel = s.id === selected;
          return (
            <button
              key={s.id}
              type="button"
              role="option"
              aria-selected={isSel}
              onClick={() => {
                onSelect(s.id, isDefault);
                setOpen(false);
              }}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-2',
                isSel && 'bg-[color-mix(in_oklab,var(--c-wind)_12%,transparent)]',
              )}
            >
              <StationIcon size={16} style={{ color: 'var(--c-wind)' }} className="shrink-0" />
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="font-display text-[0.86rem] font-medium text-fg">
                  {s.label}
                  {isDefault && (
                    <span className="ml-1.5 rounded-[0.3rem] bg-[color-mix(in_oklab,var(--c-wind)_16%,transparent)] px-1 py-[0.05rem] font-mono text-[0.58rem] uppercase tracking-[0.04em] text-[color:var(--c-wind)]">
                      {m.station_nearest()}
                    </span>
                  )}
                </span>
                <span className="font-mono text-[0.64rem] text-faint">
                  {s.distanceKm.toFixed(1)} km · {kindLabel(s.kind)} · {s.altitude_m} m
                </span>
              </span>
              {isSel && (
                <span className="ml-auto shrink-0 text-[0.9rem]" style={{ color: 'var(--c-wind)' }} aria-hidden="true">
                  ✓
                </span>
              )}
            </button>
          );
        })}
        <p className="px-2 pb-1 pt-1.5 text-[0.72rem] leading-snug text-faint">{m.station_pick_help()}</p>
      </PopoverContent>
    </Popover>
  );
}

const BuoyLocator = lazy(() => import('./BuoyLocator'));

const HF_DATA = 'https://huggingface.co/buckets/hadim/olatu';
const CANDHIS = 'https://candhis.cerema.fr';
// Same look as the footer source links (see Footer.tsx) so the whole app's attribution
// reads as one coherent system (spec 0007).
const SOURCE_LINK = 'inline-flex items-center gap-1.5 text-muted no-underline transition-colors hover:text-accent';

// Collapsed state is remembered across sessions, like the chart range/smoothing prefs.
// Default is COLLAPSED (the dense bar); only an explicit "0" means the user expanded it.
const COLLAPSE_STORE = 'olatu.station_collapsed';
function storedCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_STORE) !== '0';
  } catch {
    /* storage unavailable (private mode) — default to the dense, collapsed bar */
    return true;
  }
}

const EYEBROW = 'font-mono text-[0.72rem] uppercase tracking-[0.08em] text-accent';

function BuoySwitcher({ selected, onSelect, compact = false }: { selected: string; onSelect: (c: string) => void; compact?: boolean }) {
  return (
    <ToggleGroup
      type="single"
      value={selected}
      onValueChange={(v) => v && onSelect(v)}
      aria-label={m.picker_choose()}
      className={compact ? 'gap-[0.4rem]' : 'mt-[0.15rem] gap-[0.45rem]'}
    >
      {BUOYS.map((b) => (
        <ToggleGroupItem
          key={b.campaign_id}
          value={b.campaign_id}
          className={cn(
            'group inline-flex items-center rounded-[0.6rem] border border-line bg-surface-2 text-muted hover:border-divider hover:text-fg data-[state=on]:border-accent data-[state=on]:bg-[color-mix(in_oklab,var(--accent)_12%,var(--surface-2))] data-[state=on]:text-fg',
            compact ? 'gap-[0.45rem] px-[0.65rem] py-[0.32rem]' : 'gap-[0.55rem] px-[0.85rem] py-[0.5rem]',
          )}
        >
          <span
            className={cn(
              'shrink-0 rounded-full bg-faint group-data-[state=on]:bg-accent group-data-[state=on]:shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent)_25%,transparent)]',
              compact ? 'h-[7px] w-[7px]' : 'h-[9px] w-[9px]',
            )}
            aria-hidden="true"
          />
          {compact ? (
            <span className="font-display text-[0.86rem] font-semibold leading-none">{b.name}</span>
          ) : (
            <span className="flex flex-col text-left leading-[1.15]">
              <span className="font-display text-[0.92rem] font-semibold">{b.name}</span>
              <span className="font-mono text-[0.66rem] tracking-[0.03em] text-faint">CANDHIS {b.campaign_id}</span>
            </span>
          )}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export default function StationBar({
  campaign,
  onSelect,
  selectedStation,
  defaultStation,
  onSelectStation,
}: {
  campaign: string;
  onSelect: (campaign: string) => void;
  selectedStation: string | null;
  defaultStation: string | null;
  onSelectStation: (id: string, isDefault: boolean) => void;
}) {
  useLocale();
  const [collapsed, setCollapsed] = useState(storedCollapsed);

  const toggle = () =>
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(COLLAPSE_STORE, next ? '1' : '0');
      } catch {
        /* storage unavailable — the choice still applies for this session */
      }
      return next;
    });

  const label = collapsed ? m.station_expand() : m.station_collapse();
  const toggleBtn = (
    <button
      type="button"
      onClick={toggle}
      aria-expanded={!collapsed}
      aria-label={label}
      title={label}
      className="inline-flex shrink-0 items-center justify-center rounded-[0.45rem] border border-line bg-surface-2 px-[0.42rem] py-[0.24rem] text-[0.8rem] leading-none text-muted transition-colors hover:border-accent hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <span aria-hidden="true">{collapsed ? '▾' : '▴'}</span>
    </button>
  );

  return (
    <section
      aria-label={m.picker_eyebrow()}
      className={cn('mb-6 rounded-2xl border border-line bg-surface', collapsed ? 'px-[1.1rem] py-[0.5rem]' : 'px-[1.35rem] py-[1.15rem]')}
    >
      {collapsed ? (
        // Dense one-liner on desktop: eyebrow · compact switcher · chevron pinned right. On a
        // phone it folds to two rows — eyebrow + chevron up top, the switcher full-width below
        // (via order + basis-full) — so picking a buoy still needs no expand.
        <div className="flex flex-wrap items-center gap-x-3 gap-y-[0.5rem]">
          <span className={cn(EYEBROW, 'shrink-0 max-[560px]:order-1')}>{m.picker_eyebrow()}</span>
          <div className="max-[560px]:order-3 max-[560px]:basis-full">
            <BuoySwitcher selected={campaign} onSelect={onSelect} compact />
          </div>
          <div className="max-[560px]:order-4 max-[560px]:basis-full">
            <StationPicker campaign={campaign} selected={selectedStation} defaultStation={defaultStation} onSelect={onSelectStation} compact />
          </div>
          <div className="ml-auto shrink-0 max-[560px]:order-2">{toggleBtn}</div>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-4">
            <span className={EYEBROW}>{m.picker_eyebrow()}</span>
            {toggleBtn}
          </div>
          <div className="mt-[0.9rem] grid grid-cols-[1fr_minmax(280px,30rem)] items-start gap-6 max-[720px]:grid-cols-1 max-[720px]:gap-[1.15rem]">
            <div className="flex min-w-0 flex-col gap-[0.65rem]">
              <p className="m-0 max-w-[48ch] text-[0.95rem] leading-normal text-muted">{m.intro_description()}</p>
              <BuoySwitcher selected={campaign} onSelect={onSelect} />
              <div className="mt-[0.1rem] flex flex-col gap-[0.35rem]">
                <span className="font-mono text-[0.68rem] uppercase tracking-[0.08em] text-[color:var(--c-wind)]">{m.station_wind_heading()}</span>
                <div>
                  <StationPicker campaign={campaign} selected={selectedStation} defaultStation={defaultStation} onSelect={onSelectStation} />
                </div>
              </div>
              <p className="mt-[0.15rem] flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8rem] text-faint">
                <span>{m.data_source()}:</span>
                <a href={CANDHIS} target="_blank" rel="noopener noreferrer" className={SOURCE_LINK}>
                  <BuoyMark size={15} />
                  <span>{m.data_live()}</span>
                </a>
                <span className="text-divider" aria-hidden="true">·</span>
                <a href={HF_DATA} target="_blank" rel="noopener noreferrer" className={SOURCE_LINK}>
                  <HuggingFaceMark size={15} />
                  <span>{m.data_dataset()}</span>
                </a>
              </p>
            </div>
            <div className="min-w-0">
              <Suspense
                fallback={
                  <div
                    aria-hidden="true"
                    className="aspect-[16/10] w-full rounded-2xl border border-line bg-[radial-gradient(120%_100%_at_30%_0%,color-mix(in_oklab,var(--accent)_8%,var(--surface-2)),var(--surface-2))]"
                  />
                }
              >
                <BuoyLocator selected={campaign} onSelect={onSelect} />
              </Suspense>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
