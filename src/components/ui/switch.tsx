import * as React from 'react';
import { cn } from '../../lib/utils';

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  id?: string;
  'aria-label'?: string;
}

export function Switch({
  checked,
  onCheckedChange,
  disabled = false,
  size = 'md',
  className,
  id,
  'aria-label': ariaLabel
}: SwitchProps) {
  const isSm = size === 'sm';

  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-label={ariaLabel}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex shrink-0 cursor-pointer items-center rounded-full transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400/50 disabled:cursor-not-allowed disabled:opacity-40',
        isSm ? 'h-4 w-7' : 'h-5 w-9.5',
        checked
          ? 'bg-yellow-400 border border-yellow-400 shadow-xs shadow-yellow-500/25'
          : 'bg-zinc-800/90 border border-zinc-700/80 hover:border-zinc-600',
        className
      )}
    >
      <span
        className={cn(
          'pointer-events-none block rounded-full shadow-sm ring-0 transition-all duration-200',
          isSm ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5',
          checked
            ? cn(isSm ? 'translate-x-3.5' : 'translate-x-4.5', 'bg-zinc-950')
            : cn(isSm ? 'translate-x-0.5' : 'translate-x-1', 'bg-zinc-400')
        )}
      />
    </button>
  );
}
