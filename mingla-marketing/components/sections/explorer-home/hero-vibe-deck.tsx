'use client'
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

// ---------------------------------------------------------------
// Hero Vibe Deck
//
// Compact auto-rotating stack for the supplied Mingla home-page card
// artwork. The SVGs are rendered directly so the deck reflects the
// approved visual system instead of rebuilding the cards in code.
// ---------------------------------------------------------------

interface VibeCardAsset {
  id: string
  src: string
  alt: string
}

const CARD_ASSETS: VibeCardAsset[] = Array.from({ length: 22 }, (_, index) => {
  const n = index + 1
  return {
    id: `dc-card-${n}`,
    src: `/home-page-cards/dc-cards/${n}.svg`,
    alt: `Mingla home page card ${n}`,
  }
})

// Stack offset values tuned for portrait cards inside the one-screen hero.
const positionStyles = [
  { scale: 1, y: 8 },
  { scale: 0.96, y: -14 },
  { scale: 0.92, y: -34 },
] as const

const exitAnim = {
  x: -380,
  opacity: 0,
  scale: 0.95,
  zIndex: 10,
  transition: { duration: 1.0, ease: [0.4, 0, 0.2, 1] as const },
}

const enterAnim = { y: -34, scale: 0.92, x: 0 }
const AUTO_MS = 3600

// Supplied SVGs are 4:5 portrait cards. These dimensions keep the card
// artwork legible without breaking the non-scroll hero.
const CARD_W = 260
const CARD_H = 325

export function HeroVibeDeck() {
  const reduced = useMinglaReducedMotion()
  const [order, setOrder] = useState<number[]>(() => CARD_ASSETS.map((_, i) => i))
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (reduced || paused || CARD_ASSETS.length <= 1) return
    const id = window.setInterval(() => {
      setOrder((prev) =>
        prev.length === 0 ? prev : [...prev.slice(1), prev[0] as number],
      )
    }, AUTO_MS)
    return () => window.clearInterval(id)
  }, [reduced, paused])

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
      style={{ width: CARD_W + 92, height: CARD_H + 62 }}
      className="relative overflow-hidden"
    >
      <AnimatePresence initial={false}>
        {visible.map((cardIdx, position) => {
          const card = CARD_ASSETS[cardIdx] as VibeCardAsset
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
  card: VibeCardAsset
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
      className="absolute overflow-visible will-change-transform [backface-visibility:hidden] [transform-style:preserve-3d]"
    >
      <img
        src={card.src}
        alt={card.alt}
        className="h-full w-full select-none object-contain [image-rendering:auto]"
        decoding="async"
        draggable={false}
      />
    </motion.div>
  )
}
