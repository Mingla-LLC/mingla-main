'use client'
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

// ---------------------------------------------------------------
// Hero Vibe Deck
//
// Compact 3-card auto-rotating stack that sits beneath the "Get the
// app" CTA on the explorer hero. Adapts the 21st.dev card-stack motion
// pattern to the Mingla Liquid Glass surface.
//
// Exit choreography: front card slides off to the LEFT (instead of
// dropping down). Slightly fades and scales as it leaves so the slide
// feels weighty and clean rather than abrupt.
// ---------------------------------------------------------------

interface VibeCard {
  id: string
  vibe: string
  city: string
  detail: string
  image: string
  imageAlt: string
}

const CARDS: VibeCard[] = [
  {
    id: 'rooftop-lagos',
    vibe: 'Rooftop',
    city: 'Lagos',
    detail: '12 friends going · Friday',
    image:
      'https://images.unsplash.com/photo-1571805341302-f857704f7426?w=900&q=80',
    imageAlt: 'A rooftop bar at golden hour',
  },
  {
    id: 'open-mic-atlanta',
    vibe: 'Open mic',
    city: 'Atlanta',
    detail: '78 going · 9 PM',
    image:
      'https://images.unsplash.com/photo-1525268323446-0505b6fe7778?w=900&q=80',
    imageAlt: 'A neon-lit open mic venue',
  },
  {
    id: 'late-ramen-nyc',
    vibe: 'Late ramen',
    city: 'NYC',
    detail: 'Live now · 11:42 PM',
    image:
      'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=900&q=80',
    imageAlt: 'Steaming bowl of ramen at a late-night counter',
  },
  {
    id: 'long-table-la',
    vibe: 'Long table',
    city: 'LA',
    detail: 'Saved · Sunday',
    image:
      'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=900&q=80',
    imageAlt: 'Friends gathered around a long dinner table',
  },
  {
    id: 'comedy-houston',
    vibe: 'Comedy night',
    city: 'Houston',
    detail: '32 going · 8 PM',
    image:
      'https://images.unsplash.com/photo-1517457373958-b7bdd4587205?w=900&q=80',
    imageAlt: 'A standing crowd at a comedy show',
  },
]

// Stack offset values tuned for the compact-fit dimensions.
const positionStyles = [
  { scale: 1, y: 6 },
  { scale: 0.94, y: -12 },
  { scale: 0.88, y: -30 },
] as const

const exitAnim = {
  x: -380,
  opacity: 0,
  scale: 0.95,
  zIndex: 10,
  transition: { duration: 1.0, ease: [0.4, 0, 0.2, 1] as const },
}

const enterAnim = { y: -30, scale: 0.88, x: 0 }
const AUTO_MS = 4200

// Card geometry — sized so the deck + the rest of the hero content
// (headline + subhead + CTA + chips) fit in 100svh on every md+ viewport,
// down to 720p laptops in landscape.
const CARD_W = 320
const CARD_H = 180

export function HeroVibeDeck() {
  const reduced = useMinglaReducedMotion()
  const [order, setOrder] = useState<number[]>(() => CARDS.map((_, i) => i))
  const [paused, setPaused] = useState(false)

  // Auto-rotate
  useEffect(() => {
    if (reduced || paused || CARDS.length <= 1) return
    const id = window.setInterval(() => {
      setOrder((prev) =>
        prev.length === 0 ? prev : [...prev.slice(1), prev[0] as number],
      )
    }, AUTO_MS)
    return () => window.clearInterval(id)
  }, [reduced, paused])

  // Pause when tab is not visible
  useEffect(() => {
    const onVis = (): void => {
      setPaused(document.visibilityState !== 'visible')
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const visible = order.slice(0, 3)

  return (
    <div
      aria-hidden="true"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      style={{ width: CARD_W + 20, height: CARD_H + 40 }}
      className="relative overflow-hidden"
    >
      <AnimatePresence initial={false}>
        {visible.map((cardIdx, position) => {
          const card = CARDS[cardIdx] as VibeCard
          return (
            <DeckCard
              key={card.id}
              card={card}
              position={position}
              reduced={reduced}
            />
          )
        })}
      </AnimatePresence>
    </div>
  )
}

interface DeckCardProps {
  card: VibeCard
  position: number
  reduced: boolean
}

function DeckCard({ card, position, reduced }: DeckCardProps) {
  const { scale, y } = positionStyles[position] ?? positionStyles[2]
  const zIndex = 3 - position
  const exit = position === 0 ? exitAnim : undefined
  const initial = position === 2 ? enterAnim : undefined

  return (
    <motion.div
      initial={reduced ? false : initial}
      animate={{ y, scale, x: 0 }}
      exit={exit}
      transition={{ type: 'spring', duration: 1.1, bounce: 0 }}
      style={{
        zIndex,
        left: '50%',
        marginLeft: -CARD_W / 2,
        bottom: 18,
        width: CARD_W,
        height: CARD_H,
      }}
      className="glass-soft absolute flex flex-col gap-2 overflow-hidden rounded-2xl p-3 will-change-transform"
    >
      <div className="relative h-[100px] w-full overflow-hidden rounded-xl ring-1 ring-glass-border">
        <img
          src={card.image}
          alt={card.imageAlt}
          className="h-full w-full select-none object-cover"
          draggable={false}
        />
      </div>
      <div className="flex items-center justify-between gap-2 px-1 pb-1">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate font-display text-base leading-tight text-text-primary">
            {card.vibe}
          </span>
          <span className="truncate text-xs text-text-secondary">
            {card.detail}
          </span>
        </div>
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">
          {card.city}
        </span>
      </div>
    </motion.div>
  )
}
