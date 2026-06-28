import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// shadcn-style button, tokenized to the Olatu theme. Focus-visible ring is the
// keyboard-accessibility floor (spec 0006 §6); touch sizes meet the ≥44px target.
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-body text-sm cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:pointer-events-none disabled:opacity-40',
  {
    variants: {
      variant: {
        solid: 'bg-accent text-bg border border-accent hover:bg-accent-deep',
        outline: 'border border-line bg-surface text-fg hover:border-accent hover:text-accent',
        ghost: 'text-muted hover:text-accent',
      },
      size: {
        default: 'h-[38px] px-3',
        sm: 'h-8 px-2.5 text-[0.8rem]',
        icon: 'h-[38px] w-[38px] max-md:h-11 max-md:w-11',
      },
    },
    defaultVariants: { variant: 'outline', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = 'button', ...props }, ref) => (
    <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = 'Button';

export { buttonVariants };
