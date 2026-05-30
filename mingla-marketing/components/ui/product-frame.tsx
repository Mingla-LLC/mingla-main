import { type ReactNode } from 'react'
import { cn } from '@/lib/cn'

// ---------------------------------------------------------------
// ORCH-1010 — <ProductFrame>
//
// A glass-strong, rounded-2xl, --elev-3 (warm-tinted) frame that holds a REAL
// product artifact — the live consumer card deck (HeroPlaceDeck) in the hero,
// or a real brand-page mock in Features. The page's one "show, don't tell"
// device. NEVER a stock/AI screenshot — only real product surfaces go inside
// (reality-anchor, DESIGN PART 3.4).
//
// Pure presentational wrapper: it carries material + elevation only. The
// artifact owns its own size; the frame hugs it with padding.
// ---------------------------------------------------------------

interface ProductFrameProps {
  children: ReactNode
  className?: string
  /** Inner padding around the artifact. Default p-4. */
  padded?: boolean
}

export function ProductFrame({
  children,
  className,
  padded = true,
}: ProductFrameProps) {
  return (
    <div
      style={{ boxShadow: 'var(--elev-3)' }}
      className={cn(
        'glass-strong rounded-2xl',
        padded && 'p-4 md:p-6',
        className,
      )}
    >
      {children}
    </div>
  )
}
