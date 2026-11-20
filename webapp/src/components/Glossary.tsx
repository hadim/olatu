// "Definitions" slide-over (spec 0001 §6.5 tier 3 / 0003 C2) on the Radix Sheet
// primitive (spec 0006 §4): plain-language meaning of every value on screen, the
// wave-vs-swell distinction, the steepness reading scale (spec 0023) and the direction-colour
// legend. Focus trap / Esc / scroll-lock come from the primitive.
//
// The wave-height colour scale is deliberately NOT listed here any more (spec 0023 §7): it was
// the legend of the history ribbon, whose ~4 900 one-pixel bars blend into a tint nobody can
// match to a swatch — seven rows explaining a code the eye cannot read.
//
// It can also be opened from elsewhere, scrolled to one entry (`openGlossary(anchor)` in
// lib/glossary) — how the steepness chart panel puts its note one tap away.

import { useEffect, useRef, useState } from 'react';
import { useLocale, type MessageKey } from '@/lib/i18n';
import { m } from '@/paraglide/messages';
import { compass, dirColor, fmtNumber } from '../lib/format';
import { glossaryAnchorId, onGlossaryOpen } from '../lib/glossary';
import SteepnessScale from './SteepnessScale';
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';

// Each term carries its CANDHIS source field (the original code, language-neutral) and a
// typical-range hint, so the slide-over is the full tier-3 reference (spec 0001 §6.5).
const TERMS: { labelKey: MessageKey; defKey: MessageKey; src: string; rangeKey: MessageKey }[] = [
  { labelKey: 'cc_wave_height', defKey: 'def_wave_height', src: 'H1/3 · H13D', rangeKey: 'gloss_range_wave_height' },
  { labelKey: 'cc_max_wave', defKey: 'def_max_wave', src: 'Hmax · HMAXD', rangeKey: 'gloss_range_max_wave' },
  { labelKey: 'cc_period', defKey: 'def_period', src: 'Th1/3 · TH13D', rangeKey: 'gloss_range_period' },
  { labelKey: 'cc_direction', defKey: 'def_direction', src: 'DirPic · THETAP', rangeKey: 'gloss_range_direction' },
  { labelKey: 'cc_spread', defKey: 'def_spread', src: 'EtalPic · SIGMAP', rangeKey: 'gloss_range_spread' },
  { labelKey: 'cc_sea_temp', defKey: 'def_sea_temp', src: 'TempMer', rangeKey: 'gloss_range_sea_temp' },
  { labelKey: 'tide_title', defKey: 'def_tide', src: 'api-maree.fr · IFREMER/PREVIMER', rangeKey: 'gloss_range_tide' },
];

// Cardinal anchors of the cyclical direction hue (mirrors format.ts DIR_ANCHORS).
const DIR_LEGEND = [0, 90, 180, 270];

// The steepness note as two short lists (spec 0023 §6) — it was three paragraphs, and nobody
// reads three paragraphs in a side sheet to learn what one number means.
const STEEPNESS_READ: MessageKey[] = ['steep_read_low', 'steep_read_high', 'steep_read_period'];
const STEEPNESS_BLIND: MessageKey[] = ['steep_blind_chop', 'steep_blind_cross', 'steep_blind_beach'];
const NOTE_HEAD = 'm-0 mb-[0.3rem] mt-[0.9rem] text-[0.78rem] font-semibold text-fg';
const NOTE_LIST = 'm-0 flex list-disc flex-col gap-[0.25rem] pl-[1.1rem] text-[0.84rem] leading-snug text-muted marker:text-faint';

function BookIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM19 17H6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Glossary() {
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  // The entry an outside caller asked for; consumed when the sheet's content mounts.
  const pendingAnchor = useRef<string | null>(null);
  useEffect(
    () =>
      onGlossaryOpen((anchor) => {
        pendingAnchor.current = anchor;
        setOpen(true);
      }),
    [],
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline">
          <BookIcon />
          <span>{m.glossary_open()}</span>
        </Button>
      </SheetTrigger>

      <SheetContent
        aria-describedby={undefined}
        onOpenAutoFocus={(e) => {
          // Opened AT an entry: land on it instead of the close button. The entry takes the focus
          // (it must still move inside the dialog), then scrolls to the top of the sheet.
          const anchor = pendingAnchor.current;
          pendingAnchor.current = null;
          const el = anchor ? document.getElementById(glossaryAnchorId(anchor)) : null;
          if (!el) return;
          e.preventDefault();
          el.focus({ preventScroll: true });
          el.scrollIntoView({ block: 'start' });
        }}
      >
        <div className="mb-2 flex items-center justify-between">
          <SheetTitle className="m-0 font-display text-[1.45rem] font-semibold text-fg">{m.glossary_title()}</SheetTitle>
          <SheetClose asChild>
            <Button variant="outline" size="icon" aria-label={m.a11y_close()}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </Button>
          </SheetClose>
        </div>

        <p className="m-0 mb-5.5 text-[0.86rem] leading-normal text-muted">{m.glossary_intro()}</p>

        <section className="mb-[1.6rem]">
          <h3 className="m-0 mb-[0.65rem] font-mono text-[0.72rem] uppercase tracking-[0.08em] text-faint">{m.glossary_wave_vs_swell()}</h3>
          <p className="m-0 text-[0.88rem] leading-[1.55] text-muted">{m.def_wave_vs_swell()}</p>
        </section>

        <section className="mb-[1.6rem]">
          <h3 className="m-0 mb-[0.65rem] font-mono text-[0.72rem] uppercase tracking-[0.08em] text-faint">{m.glossary_measurements()}</h3>
          <dl className="m-0 flex flex-col gap-[0.95rem]">
            {TERMS.map((term) => (
              <div key={term.labelKey} className="flex flex-col gap-[0.2rem]">
                <dt className="font-display text-[0.98rem] font-semibold text-fg">{m[term.labelKey]()}</dt>
                <dd className="m-0 text-[0.86rem] leading-normal text-muted">{m[term.defKey]()}</dd>
                <div className="mt-[0.15rem] flex flex-wrap gap-x-[0.8rem] gap-y-[0.2rem]">
                  <span className="font-mono text-[0.72rem] text-faint">{term.src}</span>
                  <span className="text-[0.74rem] text-faint">{m.glossary_typical()}: {m[term.rangeKey]()}</span>
                </div>
              </div>
            ))}
          </dl>
        </section>

        {/* Steepness (spec 0023 §6): the one reading Olatu COMPUTES rather than relays, so it gets
            its whole note in one place — and a note made to be scanned: one sentence, the scale,
            two short lists, the formula. */}
        <section id={glossaryAnchorId('steepness')} tabIndex={-1} className="mb-[1.6rem] scroll-mt-4 outline-none">
          <h3 className="m-0 mb-[0.65rem] font-mono text-[0.72rem] uppercase tracking-[0.08em] text-faint">{m.glossary_steepness()}</h3>
          <p className="m-0 mb-[0.7rem] text-[0.88rem] leading-[1.55] text-muted">{m.def_steepness()}</p>
          <SteepnessScale examples />
          <h4 className={NOTE_HEAD}>{m.steep_read_title()}</h4>
          <ul className={NOTE_LIST}>
            {STEEPNESS_READ.map((k) => (
              <li key={k}>{m[k]()}</li>
            ))}
          </ul>
          <h4 className={NOTE_HEAD}>{m.steep_blind_title()}</h4>
          <ul className={NOTE_LIST}>
            {STEEPNESS_BLIND.map((k) => (
              <li key={k}>{m[k]()}</li>
            ))}
          </ul>
          <div className="mt-[0.8rem] flex flex-wrap gap-x-[0.8rem] gap-y-[0.2rem]">
            <span className="font-mono text-[0.72rem] text-faint">H1/3 ÷ ({fmtNumber(1.56, locale, 2)} × Th1/3²)</span>
            <span className="text-[0.74rem] text-faint">
              {m.glossary_typical()}: {m.gloss_range_steepness()} · {m.steep_provisional()}
            </span>
          </div>
        </section>

        <section className="mb-[1.6rem]">
          <h3 className="m-0 mb-[0.65rem] font-mono text-[0.72rem] uppercase tracking-[0.08em] text-faint">{m.glossary_direction_scale()}</h3>
          <p className="m-0 mb-[0.7rem] text-[0.82rem] text-faint">{m.glossary_direction_scale_note()}</p>
          <ul className="m-0 flex list-none flex-col gap-[0.45rem] p-0">
            {DIR_LEGEND.map((deg) => (
              <li key={deg} className="flex items-center gap-[0.7rem]">
                <span className="h-[1.1rem] w-[1.1rem] shrink-0 rounded-full" style={{ background: dirColor(deg) }} aria-hidden="true" />
                <span className="flex-1 text-[0.88rem] text-fg">{compass(deg, locale)}</span>
                <span className="font-mono text-[0.8rem] text-faint">{deg}°</span>
              </li>
            ))}
          </ul>
        </section>
      </SheetContent>
    </Sheet>
  );
}
