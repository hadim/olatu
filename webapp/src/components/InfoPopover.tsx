// Small accessible click-to-open popover. Powers the per-metric definitions and the
// staleness badge explanation (spec 0003: keep the colour badge, explain on click).
//
// Pass `children` to use a custom trigger (e.g. the staleness badge); omit it to get
// the default quiet "i" button next to a metric label.

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../lib/i18n';

interface InfoPopoverProps {
  title: string;
  body: string;
  children?: ReactNode; // custom trigger; defaults to an "i" button
  align?: 'start' | 'end'; // which edge the panel aligns to
  triggerClassName?: string;
  triggerLabel?: string; // accessible name for the trigger
}

export default function InfoPopover({
  title,
  body,
  children,
  align = 'start',
  triggerClassName,
  triggerLabel,
}: InfoPopoverProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span className="info-pop" ref={rootRef}>
      <button
        type="button"
        className={triggerClassName ?? 'info-pop-btn'}
        aria-label={triggerLabel ?? t('a11y.whatIsThis')}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        {children ?? <span aria-hidden="true">i</span>}
      </button>
      {open && (
        <span
          id={panelId}
          role="dialog"
          aria-label={title}
          className={`info-pop-panel info-pop-panel--${align}`}
        >
          <span className="info-pop-title">{title}</span>
          <span className="info-pop-body">{body}</span>
        </span>
      )}
    </span>
  );
}
