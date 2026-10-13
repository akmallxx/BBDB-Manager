import { cn } from '../../lib/utils';

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'secondary' | 'outline' | 'yellow' | 'driver';
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  const variants = {
    default: 'bg-zinc-800 text-zinc-300 border-zinc-700',
    secondary: 'bg-zinc-900 text-zinc-400 border-zinc-800',
    outline: 'border border-zinc-700 text-zinc-300',
    yellow: 'bg-yellow-400/20 text-yellow-300 border-yellow-400/30',
    driver: 'bg-zinc-800/90 text-zinc-400 border-zinc-700/50 text-[10px] uppercase font-mono px-1.5 py-0.5 tracking-wider'
  };

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold transition-colors',
        variants[variant],
        className
      )}
      {...props}
    />
  );
}
