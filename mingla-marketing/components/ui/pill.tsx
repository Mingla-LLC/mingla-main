import { forwardRef, type HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

type Variant = 'filled' | 'outline' | 'glass'
type Dot = 'live' | 'soon' | null

interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: Variant
  dot?: Dot
}

const variants: Record<Variant, string> = {
  filled: 'bg-coral-500 text-white',
  outline: 'border border-text-muted/30 text-text-primary',
  glass: 'glass-soft text-text-primary',
}

export const Pill = forwardRef<HTMLSpanElement, PillProps>(
  ({ className, variant = 'glass', dot = null, children, ...rest }, ref) => {
    return (
      <span
        ref={ref}
        className={cn(
          'inline-flex h-8 items-center gap-2 rounded-full px-4 text-sm font-medium',
          variants[variant],
          className,
        )}
        {...rest}
      >
        {dot === 'live' ? (
          <span aria-hidden="true" className="relative inline-flex h-2 w-2">
            <span className="absolute inset-0 animate-ping rounded-full bg-success/60" />
            <span className="relative inline-block h-2 w-2 rounded-full bg-success" />
          </span>
        ) : dot === 'soon' ? (
          <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-warning" />
        ) : null}
        {children}
      </span>
    )
  },
)
Pill.displayName = 'Pill'
