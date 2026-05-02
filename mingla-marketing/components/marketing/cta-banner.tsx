'use client'
import { motion } from 'framer-motion'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'
import { cn } from '@/lib/cn'

interface CTABannerProps {
  eyebrow?: string
  title: string
  children?: React.ReactNode
  variant?: 'cinematic' | 'light'
  className?: string
}

export function CTABanner({
  eyebrow,
  title,
  children,
  variant = 'cinematic',
  className,
}: CTABannerProps) {
  const reduced = useMinglaReducedMotion()
  const isDark = variant === 'cinematic'

  return (
    <section
      data-cinematic={isDark ? 'dark' : undefined}
      className={cn(
        'relative overflow-hidden px-6 py-24 md:px-10 md:py-32',
        isDark ? 'bg-smoke text-text-on-dark' : 'bg-parchment text-text-primary',
        className,
      )}
    >
      {isDark ? (
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute -left-1/3 top-1/2 h-[120vh] w-[120vh] -translate-y-1/2 rounded-full"
          style={{
            background:
              'radial-gradient(closest-side, rgba(249,115,22,0.45), rgba(249,115,22,0))',
          }}
          animate={reduced ? undefined : { opacity: [0.6, 0.9, 0.6] }}
          transition={
            reduced
              ? undefined
              : { duration: 10, ease: [0.65, 0, 0.35, 1], repeat: Infinity }
          }
        />
      ) : null}

      <div className="relative mx-auto flex max-w-3xl flex-col items-center gap-6 text-center">
        {eyebrow ? (
          <span
            className={cn(
              'text-xs font-medium uppercase tracking-[0.18em]',
              isDark ? 'text-coral-300' : 'text-coral-600',
            )}
          >
            {eyebrow}
          </span>
        ) : null}
        <h2
          className={cn(
            'font-display text-4xl font-medium leading-[1.05] tracking-[-0.03em] md:text-6xl',
            isDark ? 'text-text-on-dark' : 'text-text-primary',
          )}
        >
          {title}
        </h2>
        {children ? (
          <div className="flex flex-wrap items-center justify-center gap-3">{children}</div>
        ) : null}
      </div>
    </section>
  )
}
