'use client'
import { useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BetaAccessModal } from '@/components/marketing/beta-access-modal'
import { HeroBookingWall } from '@/components/sections/organiser-home/hero-booking-wall'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

// ORCH-1010 — business hero. A full-bleed 3D "booking wall" (vibe-themed booking
// moments across restaurants, cafés, events, clubs, tables) runs as the section
// background behind a dark overlay; the headline sits on top in high contrast.
// Shows the DEMAND Mingla creates. Illustrative content, no stock art.
//
// ORCH-1045 — the hero CTA is now "Get Beta Access" (opens the 3-step lead
// modal). The prior demo-clip launch tile + its modal wiring were removed
// entirely (I-1045-HERO-NO-VIDEO); the shared ui/video-modal component itself is
// left in the repo for reuse elsewhere.

const EASE = [0.16, 1, 0.3, 1] as const

export function OrganiserHero() {
  const reduced = useMinglaReducedMotion()
  const [betaOpen, setBetaOpen] = useState(false)

  return (
    <>
      <section className="relative flex min-h-[88vh] items-center overflow-hidden px-6 pb-24 pt-32 md:px-10 md:pb-32 md:pt-40 [padding-left:max(1.5rem,env(safe-area-inset-left))] [padding-right:max(1.5rem,env(safe-area-inset-right))] md:[padding-left:max(2.5rem,env(safe-area-inset-left))] md:[padding-right:max(2.5rem,env(safe-area-inset-right))]">
        {/* Background — the 3D booking wall (full-bleed cover). */}
        <HeroBookingWall />

        {/* Overlay — darkens the wall so the headline reads in high contrast.
            Warm-tinted near the foot, deepest behind the text column. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(8,9,12,0.78) 0%, rgba(8,9,12,0.66) 42%, rgba(20,10,4,0.82) 100%)',
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 w-full md:w-3/4"
          style={{ background: 'linear-gradient(90deg, rgba(8,9,12,0.72) 0%, transparent 100%)' }}
        />
        {/* Dissolve — the dark wall melts into the next section's canvas so the
            scroll from hero → "What is Mingla?" is one continuous pull, not a cut. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[38%]"
          style={{ background: 'linear-gradient(to bottom, transparent 0%, var(--color-smoke) 92%)' }}
        />

        {/* Foreground — headline + single CTA, centered, high contrast on the wall. */}
        <div className="relative mx-auto w-full max-w-6xl">
          <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
            <motion.h1
              initial={reduced ? false : { opacity: 0, y: 12, filter: 'blur(8px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ duration: 0.72, delay: reduced ? 0 : 0.1, ease: EASE }}
              className="font-display text-5xl leading-[1.05] tracking-[-0.02em] text-white md:text-7xl"
              style={{ textShadow: '0 2px 24px rgba(0,0,0,0.4)' }}
            >
              You deserve <br className="hidden sm:block" />to be <span className="text-warm">found.</span>
            </motion.h1>

            <motion.p
              initial={reduced ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: reduced ? 0 : 0.35, ease: EASE }}
              className="mt-8 max-w-xl text-xl font-bold leading-snug text-white md:text-2xl"
              style={{ textShadow: '0 2px 20px rgba(0,0,0,0.45)' }}
            >
              Your business has a vibe, your community is looking for it. Mingla
              helps them find you.
            </motion.p>

            <motion.div
              initial={reduced ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: reduced ? 0 : 0.5, ease: EASE }}
              className="mt-10"
            >
              <Button variant="primary" size="lg" onClick={() => setBetaOpen(true)}>
                Get Beta Access
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
              <p className="mt-4 text-sm text-white/70">
                Free during beta. Two minutes to join.
              </p>
            </motion.div>
          </div>
        </div>
      </section>

      <BetaAccessModal
        open={betaOpen}
        onClose={() => setBetaOpen(false)}
        source="organiser_marketing_hero"
      />
    </>
  )
}
