import * as React from 'react';
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import { cn } from '@/lib/utils';

// Thin wrapper: Radix gives roving-tabindex + arrow-key navigation (one tab stop per
// group, spec 0006 §6). Visual styling is left to each call site via className +
// data-[state=on]; only the focus ring is standardized here.
export const ToggleGroup = React.forwardRef<
  React.ComponentRef<typeof ToggleGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root>
>(({ className, ...props }, ref) => (
  <ToggleGroupPrimitive.Root ref={ref} className={cn('inline-flex flex-wrap items-center gap-1.5', className)} {...props} />
));
ToggleGroup.displayName = ToggleGroupPrimitive.Root.displayName;

export const ToggleGroupItem = React.forwardRef<
  React.ComponentRef<typeof ToggleGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item>
>(({ className, ...props }, ref) => (
  <ToggleGroupPrimitive.Item
    ref={ref}
    className={cn(
      'cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-default disabled:opacity-35',
      className,
    )}
    {...props}
  />
));
ToggleGroupItem.displayName = ToggleGroupPrimitive.Item.displayName;
