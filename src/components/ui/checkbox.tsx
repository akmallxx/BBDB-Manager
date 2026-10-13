import * as React from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface CheckboxProps {
  id?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: React.ReactNode;
  description?: string;
  className?: string;
}

export function Checkbox({
  id,
  checked,
  onCheckedChange,
  disabled = false,
  label,
  description,
  className
}: CheckboxProps) {
  const generatedId = React.useId();
  const inputId = id || generatedId;

  return (
    <div className={cn('inline-flex items-start gap-2 select-none group', disabled && 'opacity-50 cursor-not-allowed', className)}>
      <button
        id={inputId}
        type="button"
        role="checkbox"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onCheckedChange(!checked)}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            if (!disabled) onCheckedChange(!checked);
          }
        }}
        className={cn(
          'w-4 h-4 mt-0.5 rounded-[4px] border transition-all duration-150 flex items-center justify-center shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400/50',
          checked
            ? 'bg-yellow-400 border-yellow-400 text-zinc-950 shadow-xs shadow-yellow-500/20'
            : 'bg-zinc-900/90 border-zinc-700/80 hover:border-zinc-500 text-transparent',
          disabled && 'cursor-not-allowed'
        )}
      >
        <Check
          className={cn(
            'w-3 h-3 stroke-[3] transition-transform duration-150',
            checked ? 'scale-100 opacity-100' : 'scale-50 opacity-0'
          )}
        />
      </button>

      {(label || description) && (
        <div className="flex flex-col">
          {label && (
            <label
              htmlFor={inputId}
              onClick={() => !disabled && onCheckedChange(!checked)}
              className={cn(
                'text-xs text-zinc-300 group-hover:text-zinc-100 cursor-pointer transition-colors',
                disabled && 'cursor-not-allowed'
              )}
            >
              {label}
            </label>
          )}
          {description && (
            <span className="text-[11px] text-zinc-500 leading-tight">
              {description}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
