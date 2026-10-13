import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  icon?: React.ReactNode;
  wrapperClassName?: string;
  sizeVariant?: 'sm' | 'md';
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, wrapperClassName, icon, sizeVariant = 'md', children, disabled, ...props }, ref) => {
    return (
      <div className={cn('relative inline-flex items-center w-full group', wrapperClassName)}>
        {icon && (
          <div className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-400 group-focus-within:text-yellow-400 transition-colors">
            {icon}
          </div>
        )}
        <select
          ref={ref}
          disabled={disabled}
          className={cn(
            'w-full appearance-none rounded-md border border-zinc-800 bg-zinc-900 text-zinc-100 transition-all duration-150 cursor-pointer',
            'hover:border-zinc-700 hover:bg-zinc-900/90',
            'focus:outline-none focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400/40',
            'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-zinc-800',
            sizeVariant === 'sm' ? 'h-7 text-xs py-1 pr-7' : 'h-9 text-xs py-1.5 pr-8',
            icon ? (sizeVariant === 'sm' ? 'pl-7' : 'pl-8') : 'pl-2.5',
            className
          )}
          {...props}
        >
          {children}
        </select>
        <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-400 group-hover:text-zinc-200 transition-colors">
          <ChevronDown className={cn(sizeVariant === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5')} />
        </div>
      </div>
    );
  }
);

Select.displayName = 'Select';
