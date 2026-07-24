// Settings modal (spec 0014): pick display units for speed, temperature and pressure. A small
// gear in the header opens a centered Dialog (Radix → focus-trap + Esc + scroll-lock). The choice
// persists (olatu.units, via useUnits) and reflows every value on the page live.

import { m } from '@/paraglide/messages';
import { useLocale } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { useUnits } from '@/lib/units';

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

const UNIT_ITEM =
  'inline-flex min-h-9 min-w-[3.1rem] items-center justify-center rounded-md border border-line bg-surface-2 px-3 py-1 font-mono text-[0.82rem] text-muted hover:border-divider hover:text-fg data-[state=on]:border-accent data-[state=on]:bg-[color-mix(in_oklab,var(--accent)_14%,var(--surface-2))] data-[state=on]:text-fg';

function UnitRow<T extends string>({
  label, value, options, onChange,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[0.82rem] font-medium text-fg">{label}</span>
      <ToggleGroup type="single" value={value} onValueChange={(v) => v && onChange(v as T)} aria-label={label}>
        {options.map(([val, lbl]) => (
          <ToggleGroupItem key={val} value={val} className={cn(UNIT_ITEM)}>
            {lbl}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

export default function Settings() {
  useLocale(); // re-render on locale change so the labels translate
  const { units, setUnit, reset } = useUnits();
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" aria-label={m.settings_title()} title={m.settings_title()}>
          <GearIcon />
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[min(92vw,22rem)]">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <DialogTitle className="m-0 font-display text-[1.02rem] font-semibold text-fg">{m.settings_title()}</DialogTitle>
          <DialogClose asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={m.settings_close()}>
              <CloseIcon />
            </Button>
          </DialogClose>
        </div>
        <div className="flex flex-col gap-4 px-4 py-4">
          <DialogDescription className="m-0 text-[0.82rem] leading-snug text-muted">{m.settings_units_hint()}</DialogDescription>
          <UnitRow
            label={m.settings_speed()}
            value={units.speed}
            options={[['kmh', 'km/h'], ['ms', 'm/s'], ['kn', 'kn']] as const}
            onChange={(v) => setUnit('speed', v)}
          />
          <UnitRow
            label={m.settings_temp()}
            value={units.temp}
            options={[['c', '°C'], ['f', '°F']] as const}
            onChange={(v) => setUnit('temp', v)}
          />
          <UnitRow
            label={m.settings_pressure()}
            value={units.pressure}
            options={[['hpa', 'hPa'], ['inhg', 'inHg'], ['mmhg', 'mmHg']] as const}
            onChange={(v) => setUnit('pressure', v)}
          />
          <button
            type="button"
            onClick={reset}
            className="self-start text-[0.76rem] text-faint underline-offset-2 transition-colors hover:text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {m.settings_reset()}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
