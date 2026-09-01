'use client'
import { type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/cn'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

// #2902 — the shared hero shell for BOTH landing surfaces.
//
// The one rule this component exists to enforce: copy never depends on the
// media for its contrast. The `sanctuary` layer is an opaque-enough gradient
// keyed to the surface polarity, painted between the media and the text, so a
// bright frame in a video or a pale venue photo cannot wash out the headline.
// The current /host hero relies on a 0.34-alpha veil and hopes; this does not.

const EASE = [0.16, 1, 0.3, 1] as const

interface LandingHeroProps {
  /** Full-bleed media layer (video, photo mosaic). Decorative — never the message. */
  media: ReactNode
  eyebrow: string
  /** The H1. Kept as a node so a surface can accent one clause. */
  headline: ReactNode
  lede: string
  /** Primary + optional secondary action. */
  actions: ReactNode
  /** Small truthful footnote under the actions (e.g. what the media is). */
  footnote?: ReactNode
  /** 'night' = white copy over a dark scrim; 'parchment' = ink copy over a light scrim. */
  polarity: 'night' | 'parchment'
  className?: string
}

export function LandingHero({
  media,
  eyebrow,
  headline,
  lede,
  actions,
  footnote,
  polarity,
  className,
}: LandingHeroProps) {
  const reduced = useMinglaReducedMotion()
  const night = polarity === 'night'

  return (
    <section
      data-theme={night ? 'dark' : 'light'}
      className={cn(
        'relative flex min-h-[100svh] flex-col justify-end overflow-hidden',
        'px-6 pb-16 pt-32 md:px-10 md:pb-24 md:pt-40',
        '[padding-left:max(1.5rem,env(safe-area-inset-left))]',
        '[padding-right:max(1.5rem,env(safe-area-inset-right))]',
        'md:[padding-left:max(2.5rem,env(safe-area-inset-left))]',
        'md:[padding-right:max(2.5rem,env(safe-area-inset-right))]',
        night ? 'bg-obsidian' : 'bg-parchment',
        className,
      )}
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        {media}
      </div>

      {/* Copy sanctuary — the contrast guarantee. Bottom-anchored so the media
          keeps its top two-thirds and the text always lands on a known floor. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background: night
            ? 'linear-gradient(180deg, rgba(8,9,12,0.22) 0%, rgba(8,9,12,0.42) 30%, rgba(8,9,12,0.74) 52%, rgba(8,9,12,0.94) 72%, #08090c 100%)'
            // Parchment keeps more of its media: the shipped Host loop is soft
            // and low-contrast, and the earlier veil erased it entirely.
            : 'linear-gradient(180deg, rgba(250,248,244,0.06) 0%, rgba(250,248,244,0.24) 32%, rgba(250,248,244,0.66) 54%, rgba(250,248,244,0.93) 74%, #faf8f4 100%)',
        }}
      />

      {/* Copy sanctuary, part two: a full-bleed horizontal wash anchored to the
          reading edge. Full-bleed on purpose — the first attempt scoped this to
          the copy column and the box edge was visible as a stray panel. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background: night
            ? 'linear-gradient(90deg, rgba(8,9,12,0.86) 0%, rgba(8,9,12,0.58) 34%, rgba(8,9,12,0.10) 62%, rgba(8,9,12,0) 80%)'
            : 'linear-gradient(90deg, rgba(250,248,244,0.90) 0%, rgba(250,248,244,0.62) 34%, rgba(250,248,244,0.12) 62%, rgba(250,248,244,0) 80%)',
        }}
      />

      <div className="relative z-10 mx-auto w-full max-w-6xl">
        <div className="relative">
        <motion.span
          initial={reduced ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: reduced ? 0 : 0.05, ease: EASE }}
          className={cn(
            'block text-xs font-semibold uppercase tracking-[0.2em]',
            night ? 'text-warm' : 'text-warm-ink',
          )}
        >
          {eyebrow}
        </motion.span>

        <motion.h1
          initial={reduced ? false : { opacity: 0, y: 14, filter: 'blur(8px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.72, delay: reduced ? 0 : 0.12, ease: EASE }}
          className={cn(
            'mt-4 max-w-[15ch] font-display leading-[1.02] tracking-[-0.035em]',
            'text-[clamp(2.5rem,6.4vw,5rem)]',
            night ? 'text-white' : 'text-ink',
          )}
        >
          {headline}
        </motion.h1>

        <motion.p
          initial={reduced ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: reduced ? 0 : 0.3, ease: EASE }}
          className={cn(
            'mt-6 max-w-2xl text-base font-medium leading-relaxed sm:text-lg md:text-xl',
            night ? 'text-white/78' : 'text-ink/70',
          )}
        >
          {lede}
        </motion.p>

        <motion.div
          initial={reduced ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: reduced ? 0 : 0.42, ease: EASE }}
          className="mt-9 flex flex-wrap items-center gap-3"
        >
          {actions}
        </motion.div>

        {footnote ? (
          <motion.div
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: reduced ? 0 : 0.55, ease: EASE }}
            className={cn(
              'mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs',
              night ? 'text-white/50' : 'text-ink/50',
            )}
          >
            {footnote}
          </motion.div>
        ) : null}
        </div>
      </div>
    </section>
  )
}
