'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'
import { HeroVibeDeck } from '@/components/sections/explorer-home/hero-vibe-deck'
import { cn } from '@/lib/cn'

// ---------------------------------------------------------------
// Mingla Explorer Hero
//
// Pure pitch-charcoal canvas (matches mingla-business canvas-discover).
// No gradient orbs, no eyebrow, no hairline. Type, motion, and a
// premium charcoal-chrome chip row at the bottom.
// ---------------------------------------------------------------

interface ChipLink {
  href: string
  label: string
  /** When true, render only below the md breakpoint (mobile-only).
      The surface toggle in the header is hidden on mobile, so the
      bottom row carries the cross-link there. */
  mobileOnly?: boolean
}

const SITE_CHIPS: ChipLink[] = [
  { href: '/organisers', label: 'Organiser', mobileOnly: true },
  { href: '/about', label: 'About' },
  { href: '/support', label: 'Support' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
]

const VIBES = [
  'rooftop.',
  'a long table.',
  'the after-party.',
  'something quieter.',
  'a first date.',
  '7 friends + a fire.',
] as const

const CYCLE_MS = 2800

interface StaggeredHeadlineProps {
  text: string
  delay?: number
}

function StaggeredHeadline({ text, delay = 0 }: StaggeredHeadlineProps) {
  const reduced = useMinglaReducedMotion()
  const words = text.split(' ')
  return (
    <span className="inline-block">
      {words.map((word, i) => (
        <motion.span
          key={i}
          className="mr-[0.25em] inline-block"
          initial={reduced ? false : { opacity: 0, y: 16, filter: 'blur(8px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{
            duration: 0.72,
            ease: [0.16, 1, 0.3, 1],
            delay: reduced ? 0 : delay + i * 0.06,
          }}
        >
          {word}
        </motion.span>
      ))}
    </span>
  )
}

interface CyclingPhraseProps {
  words: readonly string[]
  intervalMs?: number
  startDelayMs?: number
}

function CyclingPhrase({
  words,
  intervalMs = CYCLE_MS,
  startDelayMs = 0,
}: CyclingPhraseProps) {
  const reduced = useMinglaReducedMotion()
  const [i, setI] = useState(0)
  const [armed, setArmed] = useState(startDelayMs === 0)

  useEffect(() => {
    if (reduced) return
    if (startDelayMs > 0) {
      const t = window.setTimeout(() => setArmed(true), startDelayMs)
      return () => window.clearTimeout(t)
    }
  }, [reduced, startDelayMs])

  useEffect(() => {
    if (reduced || !armed) return
    const id = window.setInterval(
      () => setI((prev) => (prev + 1) % words.length),
      intervalMs,
    )
    return () => window.clearInterval(id)
  }, [reduced, armed, words.length, intervalMs])

  if (reduced) {
    return (
      <span className="relative inline-block font-display text-warm">
        {words[0]}
        <span className="absolute -bottom-1 left-0 right-0 h-[2px] rounded-full bg-warm" />
      </span>
    )
  }

  return (
    <span className="relative inline-block whitespace-nowrap align-baseline">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={i}
          initial={{ opacity: 0, y: 14, filter: 'blur(6px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -14, filter: 'blur(6px)' }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="relative inline-block font-display text-warm"
        >
          {words[i]}
          <motion.span
            aria-hidden="true"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            exit={{ scaleX: 0 }}
            transition={{
              duration: 0.5,
              delay: 0.18,
              ease: [0.16, 1, 0.3, 1],
            }}
            className="absolute -bottom-1 left-0 right-0 h-[2px] origin-left rounded-full bg-warm"
          />
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

export function ExplorerHero() {
  const reduced = useMinglaReducedMotion()

  return (
    <section className="relative flex h-[100svh] items-center justify-center overflow-hidden px-6 pb-20 pt-20 md:px-10">
      <div className="relative mx-auto flex w-full max-w-4xl flex-col items-center text-center">
        {/* Headline */}
        <h1 className="font-display text-3xl leading-[1.05] tracking-[-0.005em] text-text-primary sm:text-4xl md:text-5xl lg:text-6xl">
          <StaggeredHeadline text="Find a vibe," />
          <br />
          <span className="text-warm">
            <StaggeredHeadline text="not a venue." delay={0.36} />
          </span>
        </h1>

        {/* Subhead with cycling word */}
        <motion.p
          initial={reduced ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.6,
            delay: reduced ? 0 : 1.0,
            ease: [0.16, 1, 0.3, 1],
          }}
          className="mt-3 flex max-w-2xl flex-col items-center gap-y-1.5 text-sm leading-snug text-text-secondary sm:mt-5 sm:gap-y-2 sm:text-base md:text-lg"
        >
          <span>Tonight you might feel like</span>
          {/* pb-1.5 extends the cycling word's layout box to contain the
              -bottom-1 underline (4px offset + 2px height = 6px = pb-1.5),
              so the gap above and below this line read visually equal. */}
          <span className="block pb-1.5">
            <CyclingPhrase words={VIBES} startDelayMs={1500} />
          </span>
          <span>Mingla finds the night that fits.</span>
        </motion.p>

        {/* CTA */}
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.6,
            delay: reduced ? 0 : 1.2,
            ease: [0.16, 1, 0.3, 1],
          }}
          className="mt-4 flex flex-wrap items-center justify-center gap-3 sm:mt-6"
        >
          <Button size="lg" variant="glass">Get the app</Button>
        </motion.div>

        <motion.div
          initial={reduced ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.7,
            delay: reduced ? 0 : 1.4,
            ease: [0.16, 1, 0.3, 1],
          }}
          className="mt-5 flex justify-center sm:mt-8 lg:scale-110 xl:scale-[1.18]"
        >
          <HeroVibeDeck />
        </motion.div>
      </div>

      {/* Chip-style site links at the bottom of the hero */}
      <motion.nav
        aria-label="Site"
        initial={reduced ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: 0.6,
          delay: reduced ? 0 : 1.5,
          ease: [0.16, 1, 0.3, 1],
        }}
        className="absolute bottom-6 left-1/2 flex max-w-[calc(100%-0.5rem)] -translate-x-1/2 items-center justify-center gap-1 sm:gap-2"
      >
        {SITE_CHIPS.map((chip) => (
          <Link
            key={chip.href}
            href={chip.href}
            className={cn(
              'glass-soft inline-flex h-8 items-center whitespace-nowrap rounded-full px-2.5 text-[11px] font-medium text-text-secondary transition-all duration-200 ease-out-quart hover:-translate-y-0.5 hover:text-text-primary hover:brightness-110 active:translate-y-0 active:brightness-100 focus-ring sm:h-9 sm:px-4 sm:text-sm',
              chip.mobileOnly && 'md:hidden',
            )}
          >
            {chip.label}
          </Link>
        ))}
      </motion.nav>
    </section>
  )
}
