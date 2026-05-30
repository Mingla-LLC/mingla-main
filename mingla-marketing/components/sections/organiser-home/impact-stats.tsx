'use client'
import { useEffect, useRef } from 'react'
import { motion, useInView, useMotionValue, useTransform, animate } from 'framer-motion'
import { SpotlightBand } from '@/components/ui/spotlight-band'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

// ORCH-1010 — impact stats band (dark SpotlightBand). Just the numbers + their
// descriptions; they count up when scrolled into view.
//
// ⚠️ PLACEHOLDER METRICS: illustrative figures for layout, NOT verified data.
// Replace with real, defensible numbers (or reframe) before the live [deploy] —
// public fabricated metrics break the no-fabricated-data rule. Operator owns it.

interface Stat {
  prefix?: string
  value: number
  decimals?: number
  suffix?: string
  label: string
}

const STATS: Stat[] = [
  { prefix: '$', value: 2.4, decimals: 1, suffix: 'M+', label: 'in bookings driven for businesses' },
  { value: 35000, suffix: '+', label: 'guests matched to businesses by vibe' },
  { value: 8500, suffix: '+', label: 'pages & experiences built with Ari' },
  { value: 150, suffix: '+', label: 'businesses growing on Mingla' },
]

function Counter({ prefix = '', value, decimals = 0, suffix = '' }: Omit<Stat, 'label'>) {
  const reduced = useMinglaReducedMotion()
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: '-80px' })
  const mv = useMotionValue(0)
  const text = useTransform(mv, (v) => {
    const n = decimals > 0 ? v.toFixed(decimals) : Math.round(v).toLocaleString('en-US')
    return `${prefix}${n}${suffix}`
  })

  useEffect(() => {
    if (reduced) {
      mv.set(value)
      return
    }
    if (inView) {
      const controls = animate(mv, value, { duration: 1.6, ease: 'easeOut' })
      return controls.stop
    }
  }, [inView, value, reduced, mv])

  return (
    <motion.span ref={ref} className="tabular-nums">
      {text}
    </motion.span>
  )
}

export function OrganiserImpactStats() {
  return (
    <SpotlightBand aria-label="Mingla impact by the numbers" className="py-20 md:py-28">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-x-8 gap-y-12 md:grid-cols-4 md:gap-x-10">
        {STATS.map((s) => (
          <div key={s.label} className="text-center">
            <div className="font-display text-3xl leading-none tracking-[-0.02em] text-white md:text-4xl">
              <Counter prefix={s.prefix} value={s.value} decimals={s.decimals} suffix={s.suffix} />
            </div>
            <p className="mx-auto mt-3.5 max-w-[15rem] text-sm leading-snug text-white/55">
              {s.label}
            </p>
          </div>
        ))}
      </div>
    </SpotlightBand>
  )
}
