'use client'
import { useState } from 'react'
import { motion } from 'framer-motion'
import { Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { VideoModal } from '@/components/ui/video-modal'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

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
        <span className="text-[9px] font-semibold uppercase tracking-[0.22em] text-text-muted">
          Watch
        </span>
        <span className="mt-1 font-display text-base text-text-primary">
          See how Mingla works
        </span>
      </span>
      <span className="ml-1 self-end pb-1 text-[11px] font-medium text-text-muted">
        2:14
      </span>
    </button>
  )
}

export function OrganiserHero() {
  const reduced = useMinglaReducedMotion()
  const [videoOpen, setVideoOpen] = useState(false)

  return (
    <>
      <section className="relative overflow-hidden px-6 pb-24 pt-32 md:px-10 md:pb-32 md:pt-44">
        <div className="relative mx-auto flex max-w-5xl flex-col items-center text-center">
          <motion.h1
            initial={reduced ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.7,
              delay: reduced ? 0 : 0.1,
              ease: [0.16, 1, 0.3, 1],
            }}
            className="font-display text-4xl leading-[1.05] tracking-[-0.005em] text-text-primary sm:text-5xl md:text-7xl"
          >
            we give people a reason
            <br />
            <span className="text-warm">to show up for you.</span>
          </motion.h1>

          <motion.p
            initial={reduced ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.6,
              delay: reduced ? 0 : 0.35,
              ease: [0.16, 1, 0.3, 1],
            }}
            className="mt-8 max-w-3xl text-base leading-relaxed text-text-secondary md:text-lg"
          >
            Mingla turns what makes your place, event, menu, or pop-up special into something people want to book, buy, visit, and share. Using AI, we label the vibe, shape the story, highlight what matters, and match you with the people most likely to care.
          </motion.p>

          <motion.div
            initial={reduced ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.6,
              delay: reduced ? 0 : 0.5,
              ease: [0.16, 1, 0.3, 1],
            }}
            className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:gap-3"
          >
            <Button size="lg" variant="glass">
              Partner with Mingla
            </Button>
            <PlayTile onPlay={() => setVideoOpen(true)} />
          </motion.div>

          <motion.p
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: reduced ? 0 : 0.75 }}
            className="mt-12 text-sm text-text-muted"
          >
            Not just listings. Not just ads.{' '}
            <span className="text-text-primary">Reasons people choose you.</span>
          </motion.p>
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
