// Ghost/skeleton states (spec 0006 §6 polish): the full data-widget layout is shown on
// first paint — banner, charts and station-location — as shimmering placeholders, so the
// page reads as "alive and loading" instead of a bare "Loading…" line. The shimmer
// (.skeleton) is reduced-motion gated. These are purely visual: the wrappers are
// aria-hidden and a single sr-only role=status carries the announcement (see App).

import { cn } from '@/lib/utils';

function Skel({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} />;
}

export function BannerSkeleton() {
  return (
    <section aria-hidden="true" className="relative rounded-2xl border border-line bg-surface px-6 pb-6 pt-5">
      <div className="mb-[1.1rem] flex items-center justify-between">
        <Skel className="h-3.5 w-44" />
        <Skel className="h-7 w-44 rounded-full" />
      </div>
      <div className="grid grid-cols-[minmax(170px,0.85fr)_1.5fr] items-center gap-x-8 gap-y-7 max-[720px]:grid-cols-1 max-[720px]:justify-items-center max-[720px]:gap-6">
        {/* dial + caption */}
        <div className="flex w-full flex-col items-center gap-3">
          <Skel className="aspect-square w-full max-w-[200px] rounded-full" />
          <Skel className="h-3 w-32" />
          <Skel className="h-3 w-20" />
        </div>
        {/* hero + gauges */}
        <div className="flex w-full flex-col gap-[1.35rem] border-l border-line pl-8 max-[720px]:items-center max-[720px]:border-l-0 max-[720px]:pl-0">
          <div className="flex flex-col gap-2 max-[720px]:items-center">
            <Skel className="h-3 w-28" />
            <Skel className="h-12 w-40" />
          </div>
          <div className="flex flex-wrap gap-[1.3rem] max-[720px]:justify-center">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex flex-col gap-2">
                <Skel className="h-3 w-20" />
                <Skel className="h-7 w-16" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function ChartsSkeleton() {
  const panels = ['h-[124px]', 'h-[124px]', 'h-[140px]', 'h-[162px]'];
  return (
    <section aria-hidden="true" className="mt-6">
      {/* toolbar */}
      <div className="mb-[0.8rem] flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-[0.4rem]">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skel key={i} className="h-8 w-12" />
          ))}
        </div>
        <div className="flex gap-[0.4rem]">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skel key={i} className="h-8 w-14" />
          ))}
        </div>
      </div>
      {/* heat-ribbon + hover card */}
      <Skel className="mb-[0.9rem] h-12 w-full" />
      <Skel className="mb-[0.7rem] h-[2.4rem] w-full rounded-[0.7rem]" />
      {/* chart wells */}
      <div className="rounded-2xl border border-line bg-surface-2 px-4 pb-4 pt-3">
        {panels.map((h, i) => (
          <div key={i}>
            <Skel className="my-[0.4rem] ml-[0.2rem] h-3 w-28" />
            <Skel className={cn('w-full', h)} />
          </div>
        ))}
      </div>
    </section>
  );
}

export function StationLocationSkeleton() {
  return (
    <section aria-hidden="true" className="mt-6 grid grid-cols-[minmax(240px,360px)_1fr] items-stretch gap-5 max-[720px]:grid-cols-1">
      <Skel className="aspect-[16/10] w-full rounded-2xl" />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] content-center gap-4 rounded-2xl border border-line px-[1.3rem] py-[1.1rem]">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skel className="h-3 w-20" />
            <Skel className="h-4 w-32" />
          </div>
        ))}
      </div>
    </section>
  );
}
