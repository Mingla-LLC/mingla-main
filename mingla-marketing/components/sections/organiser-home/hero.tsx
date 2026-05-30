'use client'
import { useState } from 'react'
import { motion } from 'framer-motion'
import { Play } from 'lucide-react'
import { VideoModal } from '@/components/ui/video-modal'
import { HeroBookingWall } from '@/components/sections/organiser-home/hero-booking-wall'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

// ORCH-1010 — business hero. A full-bleed 3D "booking wall" (vibe-themed booking
// moments across restaurants, cafés, events, clubs, tables) runs as the section
// background behind a dark overlay; the headline sits on top in high contrast.
// Shows the DEMAND Mingla creates. Illustrative content, no stock art.

const EASE = [0.16, 1, 0.3, 1] as const

interface PlayTileProps {
  onPlay: () => void
}

function PlayTile({ onPlay }: PlayTileProps) {
  return (
    <button
      type="button"
      onClick={onPlay}
      aria-label="Watch — see how Mingla works (2:14)"
      className="group flex h-14 cursor-pointer items-center gap-3 rounded-full border border-white/20 bg-white/10 p-1.5 pr-5 backdrop-blur-md transition-all duration-200 ease-out-quart hover:-translate-y-0.5 hover:bg-white/15 active:translate-y-0 focus-ring"
    >
      <span
        aria-hidden="true"
        className="flex h-11 w-11 items-center justify-center rounded-full bg-warm transition-transform duration-200 ease-out-quart group-hover:scale-105"
      >
        <Play className="ml-0.5 h-4 w-4 fill-white text-white" />
      </span>
      <span className="flex flex-col items-start gap-0 leading-none">
        <span className="text-[9px] font-semibold uppercase tracking-[0.22em] text-white/70">
          Watch
        </span>
        <span className="mt-1 font-display text-base text-white">See how Mingla works</span>
      </span>
      <span className="ml-1 self-end pb-1 text-[11px] font-medium text-white/70">2:14</span>
    </button>
  )
}

export function OrganiserHero() {
  const reduced = useMinglaReducedMotion()
  const [videoOpen, setVideoOpen] = useState(false)

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

        {/* Foreground — headline + single CTA, high contrast on the dark wall. */}
        <div className="relative mx-auto w-full max-w-6xl">
          <div className="flex max-w-2xl flex-col items-center text-center md:items-start md:text-left">
            <motion.h1
              initial={reduced ? false : { opacity: 0, y: 12, filter: 'blur(8px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ duration: 0.72, delay: reduced ? 0 : 0.1, ease: EASE }}
              className="font-display text-4xl tracking-[-0.02em] text-white md:text-6xl"
            >
              {/* Curvy orange container hugging the headline. */}
              <span
                className="inline-block rounded-[2.6rem_2rem_2.8rem_2.1rem/2.1rem_2.8rem_2rem_2.6rem] bg-warm px-6 py-3 text-ink md:px-8 md:py-4"
                style={{ boxShadow: '0 16px 48px rgba(235,120,37,0.38)', lineHeight: 1.12 }}
              >
                You deserve to be found.
              </span>
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
              <PlayTile onPlay={() => setVideoOpen(true)} />
            </motion.div>
          </div>
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
