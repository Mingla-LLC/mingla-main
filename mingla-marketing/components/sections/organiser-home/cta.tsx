'use client'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { SpotlightBand } from '@/components/ui/spotlight-band'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

// ORCH-1010 — convert, and end on the [SACRED] Business signature line. The
// second dark SpotlightBand bookends the page's two argument peaks and gives
// the sacred line a stage with maximum air. A slow warm-aurora "breathe" behind
// the headline is the page's one ambient loop — only here. Reduced-motion →
// aurora static, content appears with no move.

const EASE = [0.16, 1, 0.3, 1] as const

export function OrganiserCta() {
  const reduced = useMinglaReducedMotion()

  return (
    <SpotlightBand className="py-32 md:py-48" aria-label="Partner with Mingla">
      {/* Warm aurora halo behind the headline — the one ambient breathe loop. */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ background: 'var(--bg-warm-aurora)' }}
        initial={false}
        animate={reduced ? { opacity: 0.8 } : { opacity: [0.6, 1, 0.6] }}
        transition={
          reduced
            ? { duration: 0 }
            : { duration: 8, repeat: Infinity, ease: 'easeInOut' }
        }
      />

      <motion.div
        initial={reduced ? false : { opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.7, ease: EASE }}
        className="relative mx-auto flex max-w-3xl flex-col items-center gap-6 text-center"
      >
        <span className="text-xs font-semibold uppercase tracking-[0.2em] text-warm">
          Ready to give people a reason?
        </span>
        <h2 className="font-display text-5xl leading-[1.02] tracking-[-0.02em] text-text-primary md:text-8xl">
          your business has a vibe. <br className="hidden md:block" />
          <span className="text-warm">your community is looking for it.</span>
        </h2>
        <p className="max-w-2xl text-lg leading-relaxed text-text-secondary md:text-xl">
          Restaurants, bars, venues, events, pop-ups, and the people behind every
          experience, trip, and adventure — Mingla takes what makes you special
          and puts it in front of the people already looking for it.{' '}
          <span className="text-text-primary">Mingla helps them find you.</span>
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          <Button size="lg" variant="primary-ink" aria-label="Partner with Mingla">
            Partner with Mingla
          </Button>
        </div>
      </motion.div>
    </SpotlightBand>
  )
}
