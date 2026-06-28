// "Definitions" slide-over (spec 0001 §6.5 tier 3 / 0003 C2) on the Radix Sheet
// primitive (spec 0006 §4): plain-language meaning of every value on screen, the
// wave-vs-swell distinction, the direction-colour legend and the sea-state colour scale
// that doubles as the chart legend. Focus trap / Esc / scroll-lock come from the primitive.

import { useLocale, type MessageKey } from '@/lib/i18n';
import { m } from '@/paraglide/messages';
import { compass, dirColor } from '../lib/format';
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
];

// Cardinal anchors of the cyclical direction hue (mirrors format.ts DIR_ANCHORS).
const DIR_LEGEND = [0, 90, 180, 270];

// Sea-state reference scale — mirrors specs/0002 §6 and the chart wave-height colours.
const SEA_STATE: { key: MessageKey; range: string; color: string }[] = [
  { key: 'sea_glassy', range: '0–0.5 m', color: '#BFE9E0' },
  { key: 'sea_smooth', range: '0.5–1 m', color: '#6FD3C4' },
  { key: 'sea_moderate', range: '1–1.5 m', color: '#38B8C9' },
  { key: 'sea_clean', range: '1.5–2.5 m', color: '#2E8FC4' },
  { key: 'sea_building', range: '2.5–4 m', color: '#3D5FBE' },
  { key: 'sea_big', range: '4–6 m', color: '#7A4FC0' },
  { key: 'sea_storm', range: '6 m+', color: '#B83D8E' },
];

function BookIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM19 17H6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Glossary() {
  const { locale } = useLocale();

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">
          <BookIcon />
          <span>{m.glossary_open()}</span>
        </Button>
      </SheetTrigger>

      <SheetContent aria-describedby={undefined}>
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

        <section className="mb-[1.6rem]">
          <h3 className="m-0 mb-[0.65rem] font-mono text-[0.72rem] uppercase tracking-[0.08em] text-faint">{m.glossary_sea_state()}</h3>
          <p className="m-0 mb-[0.7rem] text-[0.82rem] text-faint">{m.glossary_sea_state_note()}</p>
          <ul className="m-0 flex list-none flex-col gap-[0.45rem] p-0">
            {SEA_STATE.map((s) => (
              <li key={s.key} className="flex items-center gap-[0.7rem]">
                <span className="h-[1.1rem] w-[1.6rem] shrink-0 rounded-[0.3rem]" style={{ background: s.color }} aria-hidden="true" />
                <span className="flex-1 text-[0.88rem] text-fg">{m[s.key]()}</span>
                <span className="font-mono text-[0.8rem] text-faint">{s.range}</span>
              </li>
            ))}
          </ul>
        </section>
      </SheetContent>
    </Sheet>
  );
}
