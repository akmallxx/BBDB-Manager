import * as React from 'react';
import { cn } from '../../lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'yellow';
  size?: 'default' | 'sm' | 'lg' | 'icon' | 'xs';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    const baseStyles = 'inline-flex items-center justify-center whitespace-nowrap rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400 disabled:pointer-events-none disabled:opacity-50 select-none cursor-pointer';

    const variants = {
      default: 'bg-zinc-100 text-zinc-900 hover:bg-zinc-200 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 shadow-sm',
      secondary: 'bg-zinc-800 text-zinc-100 hover:bg-zinc-700 border border-zinc-700/60',
      outline: 'border border-zinc-700 bg-transparent hover:bg-zinc-800 text-zinc-200',
      ghost: 'hover:bg-zinc-800 text-zinc-300 hover:text-zinc-100',
      destructive: 'bg-red-600 text-white hover:bg-red-700',
      yellow: 'bg-yellow-400 text-zinc-950 font-semibold hover:bg-yellow-300 shadow-sm'
    };

    const sizes = {
      default: 'h-8 px-3 py-1.5',
      sm: 'h-7 px-2.5 text-xs',
      xs: 'h-6 px-2 text-[11px]',
      lg: 'h-9 px-4 text-sm',
      icon: 'h-7 w-7'
    };

    return (
      <button
        ref={ref}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';
