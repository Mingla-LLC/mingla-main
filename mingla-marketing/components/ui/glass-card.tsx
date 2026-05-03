'use client'
import { forwardRef } from 'react'
import { motion, type HTMLMotionProps } from 'framer-motion'
import { cn } from '@/lib/cn'

type Treatment = 'soft' | 'strong' | 'frost'
type Size = 'sm' | 'md' | 'lg'

interface GlassCardProps extends HTMLMotionProps<'div'> {
  treatment?: Treatment
  size?: Size
  interactive?: boolean
}

const treatments: Record<Treatment, string> = {
  soft: 'glass-soft',
  strong: 'glass-strong',
  frost: 'glass-frost',
}

const sizes: Record<Size, string> = {
  sm: 'rounded-md p-4',
  md: 'rounded-lg p-6',
  lg: 'rounded-xl p-8',
}

export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(
  ({ className, treatment = 'soft', size = 'md', interactive = false, children, ...rest }, ref) => {
    return (
      <motion.div
        ref={ref}
        whileHover={interactive ? { y: -2 } : undefined}
        transition={{ type: 'spring', stiffness: 220, damping: 26 }}
        className={cn(
          treatments[treatment],
          sizes[size],
          interactive && 'cursor-pointer focus-ring',
          className,
        )}
        {...rest}
      >
        {children}
      </motion.div>
    )
  },
)
GlassCard.displayName = 'GlassCard'
