import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '@/lib/utils';

// Side slide-over (used for the Definitions glossary). Same Radix Dialog backend as the
// modal, so focus trap / Esc / scroll-lock are handled; on mobile it goes full-width.
export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetTitle = DialogPrimitive.Title;
export const SheetDescription = DialogPrimitive.Description;

export const SheetContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-[color-mix(in_oklab,#000_55%,transparent)] data-[state=open]:animate-[fade-in_0.18s_ease] motion-reduce:animate-none" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed inset-y-0 right-0 z-[101] h-full w-[min(440px,92vw)] overflow-y-auto border-l border-line bg-bg px-5.5 pb-10 pt-5 shadow-[-20px_0_50px_-20px_rgba(0,0,0,0.6)] outline-none',
        'data-[state=open]:animate-[slide-in_0.22s_ease] motion-reduce:animate-none',
        className,
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
SheetContent.displayName = DialogPrimitive.Content.displayName;
