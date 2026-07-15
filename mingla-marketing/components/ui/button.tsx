'use client'
import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'

type Variant = 'primary' | 'primary-ink' | 'glass' | 'secondary' | 'ghost'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
}

const variants: Record<Variant, string> = {
  primary:
    'bg-warm text-white hover:-translate-y-0.5 hover:bg-[var(--color-warm-hover)] hover:brightness-110 active:translate-y-0 active:brightness-100',
  // ORCH-1010: warm fill + WHITE label. Operator directive — orange pills always
  // carry white text (orange + ink read poorly); the ink-on-warm a11y variant was
  // reverted to white-on-warm for brand consistency across all warm pills/buttons.
  'primary-ink':
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

/**
 * ORCH-1382 — the Button's class recipe, WITHOUT the element.
 *
 * WHY THIS EXISTS. ORCH-1382 turns the store CTAs into real `<a href>` anchors (they
 * navigate, and `window.open` is routinely blocked in the Instagram/TikTok in-app
 * webviews that dominate /links traffic). Those anchors must look identical to a
 * `<Button>` — but `Button` is a `<button>`-only component with site-wide blast
 * radius, and adding `asChild`/`as` polymorphism to it would be a far larger change
 * than this ORCH earns.
 *
 * Exporting the recipe instead lets an anchor consume the exact same tokens, while
 * `Button` below consumes the SAME function — so the two can never drift.
 *
 * PURELY ADDITIVE: Button's props, DOM and behaviour are unchanged.
 */
export function buttonClasses({
  variant = 'primary',
  size = 'md',
  className,
}: {
  variant?: Variant
  size?: Size
  className?: string
} = {}): string {
  return cn(
    'inline-flex items-center justify-center gap-2 rounded-full font-display font-medium tracking-[-0.005em]',
    'transition-all duration-200 ease-out-quart',
    'cursor-pointer focus-ring',
    'disabled:cursor-not-allowed disabled:opacity-60',
    variants[variant],
    sizes[size],
    className,
  )
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, disabled, children, ...rest }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={buttonClasses({ variant, size, className })}
        {...rest}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        {children}
      </button>
    )
  },
)
Button.displayName = 'Button'
