// Click-to-open definition popover, on the Radix Popover primitive (spec 0006 §4):
// focus return, Esc, outside-click and ARIA come from the primitive. Powers the
// per-metric "i" definitions and the staleness-badge explanation.
//
// Pass `children` for a custom trigger (e.g. the staleness badge) + `triggerClassName`
// for its styling; omit them to get the default quiet "i" button next to a label.

import { type ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { m } from '@/paraglide/messages';

interface InfoPopoverProps {
  title: string;
  body: string;
  children?: ReactNode;
  align?: 'start' | 'end';
  triggerClassName?: string;
  triggerLabel?: string;
}

const DEFAULT_TRIGGER =
  'inline-flex items-center justify-center w-[1.1rem] h-[1.1rem] ml-1.5 rounded-full border border-line bg-transparent text-faint font-display text-[0.72rem] italic leading-none cursor-pointer transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

export default function InfoPopover({ title, body, children, align = 'start', triggerClassName, triggerLabel }: InfoPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={triggerLabel ?? m.a11y_what_is_this()} className={triggerClassName ?? DEFAULT_TRIGGER}>
          {children ?? <span aria-hidden="true">i</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} role="dialog" aria-label={title} className="flex w-[17rem] flex-col gap-1.5 normal-case tracking-normal">
        <span className="font-display text-[0.92rem] font-semibold text-fg">{title}</span>
        <span className="text-sm leading-relaxed text-muted">{body}</span>
      </PopoverContent>
    </Popover>
  );
}
