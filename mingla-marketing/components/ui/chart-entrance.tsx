'use client'

import { type CSSProperties, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

const EASE = [0.16, 1, 0.3, 1] as const

interface ChartEntranceProps {
  children: ReactNode
  className?: string
  lightTheme?: boolean
  style?: CSSProperties
}

/**
 * One owner for Host marketing chart entrances. The chart arrives once with a
 * short compositor-only rise/scale; reduced-motion users see the final state.
 */
export function ChartEntrance({
  children,
  className,
  lightTheme = false,
  style,
}: ChartEntranceProps) {
  const reduced = useMinglaReducedMotion()

  return (
    <motion.div
      data-theme={lightTheme ? 'light' : undefined}
      initial={reduced ? false : { opacity: 0, y: 24, scale: 0.975 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, amount: 0.18 }}
      transition={{ duration: reduced ? 0 : 0.62, ease: EASE }}
      className={className}
      style={style}
    >
      {children}
    </motion.div>
  )
}

interface AnimatedBarProps {
  axis?: 'x' | 'y'
  className?: string
  delay?: number
  size: string
  style?: CSSProperties
}

/** Keeps the final layout size from first paint and reveals it by transform. */
export function AnimatedBar({
  axis = 'x',
  className,
  delay = 0,
  size,
  style,
}: AnimatedBarProps) {
  const reduced = useMinglaReducedMotion()
  const isHorizontal = axis === 'x'

  return (
    <motion.span
      aria-hidden="true"
      initial={reduced ? false : isHorizontal ? { scaleX: 0 } : { scaleY: 0 }}
      whileInView={isHorizontal ? { scaleX: 1 } : { scaleY: 1 }}
      viewport={{ once: true, amount: 0.35 }}
      transition={{ duration: reduced ? 0 : 0.72, delay: reduced ? 0 : delay, ease: EASE }}
      className={className}
      style={{
        ...style,
        ...(isHorizontal ? { width: size, transformOrigin: 'left center' } : { height: size, transformOrigin: 'center bottom' }),
      }}
    />
  )
}
