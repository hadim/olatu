// The steepness reading scale as a five-row table (spec 0023 §6): ground swatch · name · range.
// ONE component for the two places the scale is explained — the pill's popover in Current
// Conditions (with the current class marked) and the Definitions sheet (with examples) — so the
// two can never show a different scale.

import { useLocale } from '@/lib/i18n';
import { m } from '@/paraglide/messages';
import { cn } from '@/lib/utils';
import { fmtNumber } from '../lib/format';
import { STEEPNESS_CLASSES } from '../lib/steepness';

// Same ink ramp as the chart panel's bands (TimeSeries STEEPNESS_BAND_ALPHA), as percentages:
// this table is that panel's legend, so the two must show the same five grounds.
const SWATCH_PCT = [0, 4.5, 9, 15, 22];

export default function SteepnessScale({
  active,
  examples = false,
}: {
  /** Index of the class to mark as "you are here" (the current reading); none when omitted. */
  active?: number;
  /** Print two height · period examples under each name. */
  examples?: boolean;
}) {
  const { locale } = useLocale();
  const pct = (v: number) => fmtNumber(v, locale, Number.isInteger(v) ? 0 : 1);
  const range = (i: number) => {
    const lo = i === 0 ? null : STEEPNESS_CLASSES[i - 1].upTo;
    const hi = STEEPNESS_CLASSES[i].upTo;
    if (lo == null) return `< ${pct(hi)} %`;
    if (!Number.isFinite(hi)) return `> ${pct(lo)} %`;
    return `${pct(lo)}–${pct(hi)} %`;
  };
  const marked = active != null;

  return (
    <ul className="m-0 flex list-none flex-col gap-[0.15rem] p-0">
      {STEEPNESS_CLASSES.map((c, i) => {
        const on = i === active;
        const name = m[c.labelKey]();
        return (
          <li
            key={c.labelKey}
            aria-current={on ? 'true' : undefined}
            className={cn('flex items-center gap-[0.6rem] rounded-md px-1.5 py-[0.28rem]', on && 'bg-surface-2 shadow-[inset_0_0_0_1px_var(--divider)]')}
          >
            <span
              className="h-[1rem] w-[1.4rem] shrink-0 rounded-[0.25rem] border border-line"
              style={{ background: `color-mix(in oklab, var(--c-steep) ${SWATCH_PCT[i]}%, transparent)` }}
              aria-hidden="true"
            />
            <span className="flex min-w-0 flex-1 flex-col">
              {/* With a class marked, the others step back: the row you are on is the message. */}
              <span className={cn('text-[0.86rem] leading-tight', on ? 'font-semibold text-fg' : marked ? 'text-muted' : 'text-fg')}>
                {name.charAt(0).toLocaleUpperCase(locale) + name.slice(1)}
              </span>
              {examples && <span className="font-mono text-[0.68rem] leading-tight text-faint">{c.example.map(([h, t]) => `${pct(h)} m · ${t} s`).join(' / ')}</span>}
            </span>
            <span className={cn('whitespace-nowrap font-mono text-[0.78rem]', on ? 'text-fg' : 'text-faint')}>{range(i)}</span>
          </li>
        );
      })}
    </ul>
  );
}
