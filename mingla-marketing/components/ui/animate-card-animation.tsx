'use client'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'
import { cn } from '@/lib/cn'

// ---------------------------------------------------------------
// Mingla AnimatedCardStack
//
// Retheme of the 21st.dev card stack as a 3-card case-study showcase
// for the organiser home. Auto-rotates every 4s, pauses on hover/focus,
// supports ←/→ arrow keys, and disables auto-rotate under reduced motion.
// ---------------------------------------------------------------

export interface CaseStudyCard {
  id: string
  venue: string
  result: string
  image: string
  href?: string
}

const DEFAULT_CASES: CaseStudyCard[] = [
  {
    id: 'the-90-atlanta',
    venue: 'The 90 — Atlanta',
    result: 'From dead Tuesdays to 70-cover wait-list nights.',
    image:
      'https://images.unsplash.com/photo-1517457373958-b7bdd4587205?w=1200&q=80',
    href: '/organisers/case-studies/the-90-atlanta',
  },
  {
    id: 'lagos-open-mic',
    venue: 'Lagos Open Mic Co.',
    result: 'From IG-only to 1,200 RSVPs in six weeks.',
    image:
      'https://images.unsplash.com/photo-1525268323446-0505b6fe7778?w=1200&q=80',
    href: '/organisers/case-studies/lagos-open-mic',
  },
  {
    id: 'brand-x-activation',
    venue: 'Brand X — Brooklyn',
    result: 'Mingla pre-sold the room before doors opened.',
    image:
      'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1200&q=80',
    href: '/organisers/case-studies/brand-x',
  },
]

const positionStyles = [
  { scale: 1, y: 12 },
  { scale: 0.95, y: -16 },
  { scale: 0.9, y: -44 },
] as const

const exitAnimation = { y: 340, scale: 1, zIndex: 10 }
const enterAnimation = { y: -16, scale: 0.9 }

const AUTOROTATE_MS = 4000

interface AnimatedCardStackProps {
  cards?: CaseStudyCard[]
  className?: string
  autoRotateMs?: number
}

export default function AnimatedCardStack({
  cards = DEFAULT_CASES,
  className,
  autoRotateMs = AUTOROTATE_MS,
}: AnimatedCardStackProps) {
  const reduced = useMinglaReducedMotion()
  const [order, setOrder] = useState<number[]>(() => cards.map((_, i) => i))
  const [paused, setPaused] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const advance = useCallback((): void => {
    setOrder((prev) => (prev.length === 0 ? prev : [...prev.slice(1), prev[0] as number]))
  }, [])

  const reverse = useCallback((): void => {
    setOrder((prev) =>
      prev.length === 0 ? prev : [prev[prev.length - 1] as number, ...prev.slice(0, -1)],
    )
  }, [])

  // Auto-rotate
  useEffect(() => {
    if (reduced || paused || cards.length <= 1) return
    const id = window.setInterval(advance, autoRotateMs)
    return () => window.clearInterval(id)
  }, [reduced, paused, advance, autoRotateMs, cards.length])

  // Pause when tab not visible
  useEffect(() => {
    const onVis = (): void => {
      setPaused(document.visibilityState !== 'visible')
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>): void => {
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        advance()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        reverse()
      }
    },
    [advance, reverse],
  )

  const visible = order.slice(0, 3)

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      role="region"
      aria-label="Mingla Business case studies"
      aria-roledescription="Case study carousel — left and right arrow keys to navigate"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onKeyDown={onKeyDown}
      className={cn('flex w-full flex-col items-center justify-center pt-2 focus-ring', className)}
    >
      <div className="relative h-[380px] w-full overflow-hidden sm:w-[644px]">
        <AnimatePresence initial={false}>
          {visible.map((cardIndex, position) => {
            const card = cards[cardIndex]
            if (!card) return null
            return (
              <AnimatedCard
                key={card.id}
                card={card}
                position={position}
                reduced={reduced}
              />
            )
          })}
        </AnimatePresence>
      </div>

      <div className="relative z-10 -mt-px flex w-full items-center justify-center gap-3 border-t border-text-muted/15 py-4">
        <button
          type="button"
          onClick={reverse}
          aria-label="Show previous case study"
          className="flex h-9 cursor-pointer items-center justify-center rounded-full px-3 text-sm font-medium text-text-secondary transition-colors hover:bg-coral-50 hover:text-coral-700 focus-ring"
        >
          ←
        </button>
        <span aria-live="polite" className="text-xs text-text-muted">
          {((order[0] ?? 0) % cards.length) + 1} / {cards.length}
        </span>
        <button
          type="button"
          onClick={advance}
          aria-label="Show next case study"
          className="flex h-9 cursor-pointer items-center justify-center rounded-full px-3 text-sm font-medium text-text-secondary transition-colors hover:bg-coral-50 hover:text-coral-700 focus-ring"
        >
          →
        </button>
      </div>
    </div>
  )
}

interface AnimatedCardProps {
  card: CaseStudyCard
  position: number
  reduced: boolean
}

function AnimatedCard({ card, position, reduced }: AnimatedCardProps) {
  const { scale, y } = positionStyles[position] ?? positionStyles[2]!
  const zIndex = 3 - position
  const exitAnim = position === 0 ? exitAnimation : undefined
  const initialAnim = position === 2 ? enterAnimation : undefined

  return (
    <motion.div
      initial={reduced ? false : initialAnim}
      animate={{ y, scale }}
      exit={exitAnim}
      transition={{ type: 'spring', duration: 1, bounce: 0 }}
      style={{ zIndex, left: '50%', x: '-50%', bottom: 0 }}
      className="glass-strong absolute flex h-[280px] w-[324px] items-center justify-center overflow-hidden rounded-xl p-1 shadow-lg sm:w-[512px]"
    >
      <CardContent card={card} />
    </motion.div>
  )
}

function CardContent({ card }: { card: CaseStudyCard }) {
  return (
    <div className="flex h-full w-full flex-col gap-4">
      <div className="flex h-[200px] w-full items-center justify-center overflow-hidden rounded-md ring-1 ring-glass-border">
        <img
          src={card.image}
          alt={`${card.venue} case study`}
          className="h-full w-full select-none object-cover"
        />
      </div>
      <div className="flex w-full items-center justify-between gap-2 px-3 pb-6">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-display text-base font-medium text-text-primary md:text-lg">
            {card.venue}
          </span>
          <span className="line-clamp-2 text-sm text-text-secondary">{card.result}</span>
        </div>
        <a
          href={card.href ?? '#'}
          className="flex h-10 shrink-0 cursor-pointer select-none items-center gap-1 rounded-full bg-coral-500 pl-4 pr-3 text-sm font-medium text-white transition-colors hover:bg-coral-600 focus-ring"
          aria-label={`Read the ${card.venue} case study`}
        >
          Read
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </a>
      </div>
    </div>
  )
}
