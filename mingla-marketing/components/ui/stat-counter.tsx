'use client'
import { useEffect, useRef, useState } from 'react'
import { motion, useInView } from 'framer-motion'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'
import { cn } from '@/lib/cn'

interface StatCounterProps {
  value: number
  prefix?: string
  suffix?: string
  label: string
  durationSec?: number
  format?: (n: number) => string
  className?: string
}

export function StatCounter({
  value,
  prefix = '',
  suffix = '',
  label,
  durationSec = 1.6,
  format,
  className,
}: StatCounterProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const inView = useInView(ref, { once: true, amount: 0.4 })
  const reduced = useMinglaReducedMotion()
  const [display, setDisplay] = useState<number>(reduced ? value : 0)

  useEffect(() => {
    if (!inView || reduced) return
    const start = performance.now()
    let frame = 0
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / (durationSec * 1000))
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(Math.round(value * eased))
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [inView, value, durationSec, reduced])

  return (
    <motion.div ref={ref} aria-live="polite" className={cn('flex flex-col gap-2', className)}>
      <span className="font-display text-4xl font-medium leading-none tracking-[-0.02em] text-text-primary md:text-6xl">
        {prefix}
        {format ? format(display) : display}
        {suffix}
      </span>
      <span className="text-sm text-text-secondary md:text-base">{label}</span>
    </motion.div>
  )
}
