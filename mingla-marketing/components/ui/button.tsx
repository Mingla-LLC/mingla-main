'use client'
import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'

type Variant = 'primary' | 'glass' | 'secondary' | 'ghost'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
}

const variants: Record<Variant, string> = {
  primary:
    'bg-warm text-white hover:-translate-y-0.5 hover:bg-[var(--color-warm-hover)] hover:brightness-110 active:translate-y-0 active:brightness-100',
  glass:
    'glass-soft text-text-primary hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0 active:brightness-100',
  secondary:
    'glass-soft text-text-primary hover:-translate-y-0.5 hover:bg-[var(--glass-strong-bg)] active:translate-y-0',
  ghost:
    'text-text-primary hover:-translate-y-0.5 hover:text-warm hover:bg-white/5 active:translate-y-0',
}

const sizes: Record<Size, string> = {
  sm: 'h-10 px-4 text-base',
  md: 'h-11 px-5 text-base',
  lg: 'h-14 px-7 text-base',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, disabled, children, ...rest }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={cn(
          'inline-flex items-center justify-center gap-2 rounded-full font-display font-medium tracking-[-0.005em]',
          'transition-all duration-200 ease-out-quart',
          'cursor-pointer focus-ring',
          'disabled:cursor-not-allowed disabled:opacity-60',
          variants[variant],
          sizes[size],
          className,
        )}
        {...rest}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        {children}
      </button>
    )
  },
)
Button.displayName = 'Button'
