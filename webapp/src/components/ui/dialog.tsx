import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '@/lib/utils';

// Centered modal dialog (used for the expanded map). Radix gives focus trap + return,
// Esc, scroll lock and aria-modal for free (spec 0006 §4/§6).
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;

export const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-[110] bg-[color-mix(in_oklab,#000_60%,transparent)] data-[state=open]:animate-[fade-in_0.18s_ease] motion-reduce:animate-none" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-1/2 top-1/2 z-[111] flex -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-line bg-bg shadow-[0_30px_80px_-30px_rgba(0,0,0,0.7)] outline-none',
        'data-[state=open]:animate-[fade-in_0.18s_ease] motion-reduce:animate-none',
        className,
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;
