// The top "station bar" (spec 0005 §5.3): separates the Olatu app frame from the data.
// It introduces the app, lets you pick a buoy (segmented control + the map locator), and
// states plainly where the data comes from (CANDHIS live + the open Hugging Face
// dataset). Registry-driven, so it renders before any manifest loads.

import { lazy, Suspense } from 'react';
import { useLocale } from '@/lib/i18n';
import { m } from '@/paraglide/messages';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { BUOYS } from '../lib/buoys';

const BuoyLocator = lazy(() => import('./BuoyLocator'));

const HF_DATASET = 'https://huggingface.co/datasets/hadim/olatu';
const CANDHIS = 'https://candhis.cerema.fr';
const SOURCE_LINK = 'text-muted no-underline border-b border-line transition-colors hover:text-accent hover:border-accent';

function BuoySwitcher({ selected, onSelect }: { selected: string; onSelect: (c: string) => void }) {
  return (
    <ToggleGroup
      type="single"
      value={selected}
      onValueChange={(v) => v && onSelect(v)}
      aria-label={m.picker_choose()}
      className="mt-[0.15rem] gap-[0.45rem]"
    >
      {BUOYS.map((b) => (
        <ToggleGroupItem
          key={b.campaign_id}
          value={b.campaign_id}
          className="group inline-flex items-center gap-[0.55rem] rounded-[0.7rem] border border-line bg-surface-2 px-[0.85rem] py-[0.5rem] text-muted hover:border-divider hover:text-fg data-[state=on]:border-accent data-[state=on]:bg-[color-mix(in_oklab,var(--accent)_12%,var(--surface-2))] data-[state=on]:text-fg"
        >
          <span className="h-[9px] w-[9px] shrink-0 rounded-full bg-faint group-data-[state=on]:bg-accent group-data-[state=on]:shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent)_25%,transparent)]" aria-hidden="true" />
          <span className="flex flex-col text-left leading-[1.15]">
            <span className="font-display text-[0.92rem] font-semibold">{b.name}</span>
            <span className="font-mono text-[0.66rem] tracking-[0.03em] text-faint">CANDHIS {b.campaign_id}</span>
          </span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export default function StationBar({ campaign, onSelect }: { campaign: string; onSelect: (campaign: string) => void }) {
  useLocale();
  return (
    <section
      aria-label={m.picker_eyebrow()}
      className="mb-6 grid grid-cols-[1fr_minmax(280px,30rem)] items-start gap-6 rounded-2xl border border-line bg-surface px-[1.35rem] py-[1.15rem] max-[720px]:grid-cols-1 max-[720px]:gap-[1.15rem]"
    >
      <div className="flex min-w-0 flex-col gap-[0.65rem]">
        <span className="font-mono text-[0.72rem] uppercase tracking-[0.08em] text-accent">{m.picker_eyebrow()}</span>
        <p className="m-0 max-w-[48ch] text-[0.95rem] leading-normal text-muted">{m.intro_description()}</p>
        <BuoySwitcher selected={campaign} onSelect={onSelect} />
        <p className="mt-[0.15rem] text-[0.8rem] text-faint">
          {m.data_source()}:{' '}
          <a href={CANDHIS} target="_blank" rel="noopener noreferrer" className={SOURCE_LINK}>
            {m.data_live()}
          </a>{' '}
          ·{' '}
          <a href={HF_DATASET} target="_blank" rel="noopener noreferrer" className={SOURCE_LINK}>
            {m.data_dataset()}
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
    </section>
  );
}
