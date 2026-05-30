'use client'
import { useState } from 'react'
import { motion } from 'framer-motion'
import { Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { VideoModal } from '@/components/ui/video-modal'
import { ProductFrame } from '@/components/ui/product-frame'
import { StatLine } from '@/components/ui/stat-line'
import {
  HeroPlaceDeck,
  useDeckRotation,
} from '@/components/sections/explorer-home/hero-place-deck'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

// ORCH-1010 — business hero. The page's biggest premium move: the centered
// emotional headline is paired with the REAL consumer card deck inside a
// <ProductFrame>, so the very first screen SHOWS the product that creates
// demand instead of just claiming it (reality-anchor: real deck, no stock art).

const EASE = [0.16, 1, 0.3, 1] as const

// Numberless trust strip — all three are SHIPPED capabilities (no metric).
const TRUST_PILLS = [
  'Native all-in checkout',
  'Email your real buyers',
  'Guest list + check-ins',
] as const

interface PlayTileProps {
  onPlay: () => void
}

function PlayTile({ onPlay }: PlayTileProps) {
  return (
    <button
      type="button"
      onClick={onPlay}
      aria-label="Watch — see how Mingla works (2:14)"
      className="group glass-strong flex h-14 cursor-pointer items-center gap-3 rounded-full p-1.5 pr-5 transition-all duration-200 ease-out-quart hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0 focus-ring"
    >
      <span
        aria-hidden="true"
        className="flex h-11 w-11 items-center justify-center rounded-full bg-warm transition-transform duration-200 ease-out-quart group-hover:scale-105"
      >
        <Play className="ml-0.5 h-4 w-4 fill-white text-white" />
      </span>
      <span className="flex flex-col items-start gap-0 leading-none">
        <span className="text-[9px] font-semibold uppercase tracking-[0.22em] text-text-secondary">
          Watch
        </span>
        <span className="mt-1 font-display text-base text-text-primary">
          See how Mingla works
        </span>
      </span>
      <span className="ml-1 self-end pb-1 text-[11px] font-medium text-text-secondary">
        2:14
      </span>
    </button>
  )
}

export function OrganiserHero() {
  const reduced = useMinglaReducedMotion()
  const [videoOpen, setVideoOpen] = useState(false)
  // The same hook the consumer hero uses — drives the auto-rotating
  // single → intent → event deck. Defaults to the DC city deck.
  const rotation = useDeckRotation()

  return (
    <>
      <section className="relative overflow-hidden px-6 pb-24 pt-32 md:px-10 md:pb-40 md:pt-44 [padding-left:max(1.5rem,env(safe-area-inset-left))] [padding-right:max(1.5rem,env(safe-area-inset-right))] md:[padding-left:max(2.5rem,env(safe-area-inset-left))] md:[padding-right:max(2.5rem,env(safe-area-inset-right))]">
        {/* Warm aurora — the page's single hero light source (used once here,
            once on the CTA). pointer-events-none, behind all content. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{ background: 'var(--bg-warm-aurora)' }}
        />

        <div className="relative mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
          {/* LEFT — emotional headline + CTA + trust strip. Centered on mobile,
              left-aligned on desktop (premium-craft: no centered-everything). */}
          <div className="flex max-w-xl flex-col items-center text-center lg:items-start lg:text-left">
            <motion.h1
              initial={reduced ? false : { opacity: 0, y: 12, filter: 'blur(8px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ duration: 0.72, delay: reduced ? 0 : 0.1, ease: EASE }}
              className="font-display text-5xl leading-[1.02] tracking-[-0.02em] text-text-primary md:text-8xl"
            >
              we give people a reason
              <br />
              <span className="text-warm-ink">to show up for you.</span>
            </motion.h1>

            <motion.p
              initial={reduced ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: reduced ? 0 : 0.35, ease: EASE }}
              className="mt-8 max-w-xl text-lg leading-relaxed text-text-secondary md:text-xl"
            >
              The businesses with the most soul are the hardest for people to
              find. Mingla changes that. We take what makes your place, event, or
              experience special — the vibe, the story, the night people will
              actually remember — and put it in front of the people already
              looking for exactly that.
            </motion.p>

            <motion.div
              initial={reduced ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: reduced ? 0 : 0.5, ease: EASE }}
              className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:gap-3 lg:items-start"
            >
              <Button size="lg" variant="primary-ink" aria-label="Partner with Mingla">
                Partner with Mingla
              </Button>
              <PlayTile onPlay={() => setVideoOpen(true)} />
            </motion.div>

            <motion.div
              initial={reduced ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: reduced ? 0 : 0.6, ease: EASE }}
              className="mt-8"
            >
              <StatLine items={TRUST_PILLS} className="justify-center lg:justify-start" />
            </motion.div>

            <motion.p
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: reduced ? 0 : 0.75 }}
              className="mt-12 text-base text-text-muted"
            >
              Not just a listing. Not just an ad.{' '}
              <span className="text-text-primary">A reason people choose you.</span>
            </motion.p>
          </div>

          {/* RIGHT — the real product. The live consumer card deck inside a
              warm-tinted glass frame. The page's signature "show, don't tell". */}
          <motion.div
            initial={reduced ? false : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: reduced ? 0 : 0.4, ease: EASE }}
            className="flex justify-center lg:justify-end"
          >
            <ProductFrame>
              <HeroPlaceDeck rotation={rotation} />
            </ProductFrame>
          </motion.div>
        </div>
      </section>

      <VideoModal
        open={videoOpen}
        onClose={() => setVideoOpen(false)}
        title="See how Mingla works"
      />
    </>
  )
}
