import { type ReactNode } from 'react'
import { cn } from '@/lib/cn'

// #2902 — one owner for section rhythm and safe-area padding, so no landing
// section re-declares the six padding utilities the existing sections repeat.

interface PreviewSectionProps {
  children: ReactNode
  /** 'light' = parchment editorial band, 'night' = obsidian product band. */
  polarity: 'light' | 'night'
  id?: string
  'aria-label'?: string
  className?: string
  /** Tighter vertical rhythm for supporting bands. */
  compact?: boolean
}

export function PreviewSection({
  children,
  polarity,
  id,
  'aria-label': ariaLabel,
  className,
  compact = false,
}: PreviewSectionProps) {
  const night = polarity === 'night'
  return (
    <section
      id={id}
      aria-label={ariaLabel}
      data-theme={night ? 'dark' : 'light'}
      // #2902 — the nav is a ~112px fixed band. Without this, every in-page
      // CTA (`#plan-lab`, `#workflow`, `#limits`) lands its heading UNDER the
      // header. Caught by looking at the built page, not by reading the code.
      style={{
        ...(night ? { background: 'var(--bg-spotlight)' } : {}),
        scrollMarginTop: '7rem',
      }}
      className={cn(
        'relative overflow-hidden px-6 md:px-10',
        compact ? 'py-16 md:py-20' : 'py-20 md:py-28',
        night ? '' : 'bg-parchment',
        '[padding-left:max(1.5rem,env(safe-area-inset-left))]',
        '[padding-right:max(1.5rem,env(safe-area-inset-right))]',
        'md:[padding-left:max(2.5rem,env(safe-area-inset-left))]',
        'md:[padding-right:max(2.5rem,env(safe-area-inset-right))]',
        className,
      )}
    >
      <div className="relative mx-auto w-full max-w-6xl">{children}</div>
    </section>
  )
}
