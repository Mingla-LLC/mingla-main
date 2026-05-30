'use client'
import { type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

// ---------------------------------------------------------------
// ORCH-1010 — consolidated scroll-reveal primitives.
//
// Replaces the 7 near-identical local `Reveal` helpers that every
// organiser-home section re-declared. One curve (ease-out-quart
// cubic-bezier(0.16,1,0.3,1)), one set of motion roles, one
// reduced-motion fallback wired via useMinglaReducedMotion.
//
// Motion roles (per DESIGN PART 0.5):
//   revealUp      — section blocks enter on scroll
//   revealStagger — list/grid items (delay = i*step + base, set by caller)
//   litanyLine    — "What Mingla Does" lines (smaller rise, faster)
//   headlineRise  — hero H1 only (blur-in)
//
// Reduced-motion: initial={false} → element appears in place, no transform,
// no blur, delay 0. Every consumer inherits this automatically.
// ---------------------------------------------------------------

const EASE = [0.16, 1, 0.3, 1] as const

type RevealVariant = 'revealUp' | 'litanyLine' | 'headlineRise'

interface RevealProps {
  children: ReactNode
  /** Animation role. Defaults to revealUp. */
  variant?: RevealVariant
  /** Stagger / sequence delay in seconds (ignored when reduced-motion). */
  delay?: number
  className?: string
  /** Render as a span (inline) instead of a div. */
  as?: 'div' | 'span'
}

const variantConfig: Record<
  RevealVariant,
  { initial: Record<string, number | string>; duration: number }
> = {
  revealUp: { initial: { opacity: 0, y: 24 }, duration: 0.6 },
  litanyLine: { initial: { opacity: 0, y: 14 }, duration: 0.5 },
  headlineRise: { initial: { opacity: 0, y: 12, filter: 'blur(8px)' }, duration: 0.72 },
}

/**
 * Single scroll-reveal wrapper. Enters once when ~20% in view.
 * Reduced-motion → appears in place (no move, no blur).
 */
export function Reveal({
  children,
  variant = 'revealUp',
  delay = 0,
  className,
  as = 'div',
}: RevealProps) {
  const reduced = useMinglaReducedMotion()
  const cfg = variantConfig[variant]
  const animate =
    variant === 'headlineRise'
      ? { opacity: 1, y: 0, filter: 'blur(0px)' }
      : { opacity: 1, y: 0 }
  const Comp = as === 'span' ? motion.span : motion.div

  return (
    <Comp
      initial={reduced ? false : cfg.initial}
      whileInView={animate}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: cfg.duration, delay: reduced ? 0 : delay, ease: EASE }}
      className={className}
    >
      {children}
    </Comp>
  )
}

interface RevealGroupProps<T> {
  items: readonly T[]
  /** Render one item. `i` is the stagger index. */
  children: (item: T, i: number) => ReactNode
  /** Per-item stagger step in seconds (default 0.06). */
  step?: number
  /** Base delay added to every item (default 0.2). */
  base?: number
  /** Motion role for each item (default revealUp). */
  variant?: Exclude<RevealVariant, 'headlineRise'>
  /** Stable key extractor. */
  keyFor: (item: T, i: number) => string
  className?: string
  as?: 'div' | 'span'
}

/**
 * Staggered group reveal. Each item enters with delay = i*step + base.
 * Reduced-motion → all items appear together (delay 0, no transform).
 */
export function RevealGroup<T>({
  items,
  children,
  step = 0.06,
  base = 0.2,
  variant = 'revealUp',
  keyFor,
  className,
  as = 'div',
}: RevealGroupProps<T>) {
  const reduced = useMinglaReducedMotion()
  const cfg = variantConfig[variant]
  const Comp = as === 'span' ? motion.span : motion.div

  return (
    <>
      {items.map((item, i) => (
        <Comp
          key={keyFor(item, i)}
          initial={reduced ? false : cfg.initial}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{
            duration: cfg.duration,
            delay: reduced ? 0 : i * step + base,
            ease: EASE,
          }}
          className={className}
        >
          {children(item, i)}
        </Comp>
      ))}
    </>
  )
}
