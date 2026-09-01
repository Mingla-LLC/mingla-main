'use client'
import { type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

// #2902 — Cutout motion.
//
// Framer Motion only, per Seth's ruling. AIgocy's feel comes from GSAP
// ScrollTrigger with scrub and pinning; what actually reads on the page is a
// slightly heavier, slightly slower rise than Mingla's existing `Reveal`, with
// a real stagger down a list. Both are reproducible here with no new dependency
// and no scroll hijacking.
//
// What we deliberately do NOT reproduce: ScrollSmoother's inertial scroll. It
// replaces native scrolling, and it is the single worst thing you can do to
// scroll performance and accessibility on mobile Safari.

const EASE = [0.16, 1, 0.3, 1] as const

type Variant = 'rise' | 'lift' | 'headline'

const CONFIG: Record<Variant, { initial: Record<string, number | string>; duration: number }> = {
  // Longer travel than the existing Reveal — this is the AIgocy weight.
  rise: { initial: { opacity: 0, y: 36 }, duration: 0.78 },
  // For cards: rises AND scales up very slightly, which is what makes a card
  // read as arriving toward the reader rather than sliding on a rail.
  lift: { initial: { opacity: 0, y: 30, scale: 0.985 }, duration: 0.82 },
  headline: { initial: { opacity: 0, y: 18, filter: 'blur(10px)' }, duration: 0.9 },
}

interface CutRevealProps {
  children: ReactNode
  variant?: Variant
  delay?: number
  className?: string
  as?: 'div' | 'span' | 'li'
}

export function CutReveal({
  children,
  variant = 'rise',
  delay = 0,
  className,
  as = 'div',
}: CutRevealProps) {
  const reduced = useMinglaReducedMotion()
  const cfg = CONFIG[variant]
  const Comp = as === 'span' ? motion.span : as === 'li' ? motion.li : motion.div
  const animate =
    variant === 'headline'
      ? { opacity: 1, y: 0, filter: 'blur(0px)' }
      : { opacity: 1, y: 0, scale: 1 }

  return (
    <Comp
      initial={reduced ? false : cfg.initial}
      whileInView={animate}
      viewport={{ once: true, amount: 0.15, margin: '0px 0px -80px 0px' }}
      transition={{ duration: reduced ? 0 : cfg.duration, delay: reduced ? 0 : delay, ease: EASE }}
      className={className}
    >
      {children}
    </Comp>
  )
}

/*
 * NOTE — there is deliberately NO <CutRevealGroup> with a render prop.
 *
 * This module is `'use client'`. A render prop is a FUNCTION, and functions
 * cannot be passed from a Server Component to a Client Component — Next fails
 * the prerender with "Functions cannot be passed directly to Client
 * Components". Since every page in this system is a Server Component on
 * purpose (the content has to be in the HTML for answer engines), the stagger
 * is expressed at the call site instead:
 *
 *   {items.map((item, i) => (
 *     <CutReveal key={item.id} variant="lift" delay={0.05 + i * 0.08}>
 *       …
 *     </CutReveal>
 *   ))}
 *
 * Elements serialize across the boundary; functions do not.
 */
