'use client'
import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'
import {
  DC_SHOWCASE_PLACES,
  placePhotoUrl,
  type ShowcasePlace,
} from '@/lib/dc-showcase-places'

// ---------------------------------------------------------------
// Hero Place Deck — ORCH-0998 [marketing real place cards — DC test run]
//
// Auto-rotating 3-card stack showing 5 REAL Washington-DC places, built
// per DESIGN_ORCH-0998_MARKETING_PLACE_CARD_DC.md. Replaces the decorative
// 22-SVG HeroVibeDeck at the same hero mount slot (hero.tsx ~L614).
//
// Honesty rules (spec §4): NO distance, NO travel-time, NO "X min away".
// Those are personalized live readings that only mean something for a
// logged-in user physically near the place — faking them on a marketing
// page is dishonest. Do NOT add them back thinking they were forgotten.
// Also intentionally omitted: Saved/Scheduled/Share/swipe chrome and any
// app-download/store CTA. Cards are presentational only (no click target).
// ---------------------------------------------------------------

// Stack offsets — reused from HeroVibeDeck, tuned for the heavier real card.
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
// Slightly slower than the SVG deck (3600) — real cards have more to read.
const AUTO_MS = 4200

const CARD_W = 260
const CARD_H = 325

// Category → editorial sell-line fallback (spec §5). Hardcoded for this
// test run; deterministic, never renders a blank or a raw category slug.
function fallbackSellLine(category: string): string {
  const c = category.toLowerCase()
  if (c.includes('cocktail') || c.includes('bar'))
    return 'Craft cocktails and a room worth lingering in.'
  if (c.includes('restaurant') || c.includes('café') || c.includes('cafe'))
    return 'A table worth planning your evening around.'
  if (c.includes('park')) return 'Open-air hours, whenever you need them.'
  if (c.includes('historical') || c.includes('landmark') || c.includes('museum'))
    return 'A piece of the city you can actually walk into.'
  return 'One of the spots locals actually go back to.'
}

function sellLineFor(place: ShowcasePlace): string {
  return place.blurb ?? fallbackSellLine(place.category)
}

const numberFmt = new Intl.NumberFormat('en-US')

export function HeroPlaceDeck() {
  const reduced = useMinglaReducedMotion()
  const [order, setOrder] = useState<number[]>(() =>
    DC_SHOWCASE_PLACES.map((_, i) => i),
  )
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (reduced || paused || DC_SHOWCASE_PLACES.length <= 1) return
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
      role="group"
      aria-label="Real places on Mingla, from Washington DC"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      style={{ width: CARD_W + 92, height: CARD_H + 62 }}
      className="relative overflow-hidden"
    >
      <AnimatePresence initial={false}>
        {visible.map((placeIdx, position) => {
          const place = DC_SHOWCASE_PLACES[placeIdx] as ShowcasePlace
          return (
            <DeckCard
              key={place.placeKey}
              place={place}
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
  place: ShowcasePlace
  position: number
  reduced: boolean
}

function DeckCard({ place, position, reduced }: DeckCardProps) {
  const { scale, y } = positionStyles[position] ?? positionStyles[2]
  const zIndex = 3 - position
  const isFront = position === 0
  const exit = isFront ? exitAnim : undefined
  const initial = position === 2 ? enterAnim : undefined

  const sellLine = useMemo(() => sellLineFor(place), [place])
  const ratingLabel = `${place.rating} from ${numberFmt.format(place.reviewCount)} reviews`

  return (
    <motion.div
      // Front card carries the meaning; peeked cards are hidden from AT.
      role={isFront ? 'img' : undefined}
      aria-label={
        isFront
          ? `${place.name}, ${place.category}, rated ${ratingLabel}. ${sellLine}`
          : undefined
      }
      aria-hidden={isFront ? undefined : true}
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
        borderRadius: 'var(--radius-2xl)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: isFront
          ? '0 18px 40px -12px rgba(0,0,0,0.55)'
          : '0 8px 24px -8px rgba(0,0,0,0.45)',
        filter: isFront ? undefined : 'brightness(0.82)',
        cursor: 'default',
      }}
      className="group absolute flex flex-col overflow-hidden bg-[#1a1a2e] will-change-transform [backface-visibility:hidden] [transform-style:preserve-3d] hover:[transform:translateY(-4px)]"
    >
      {/* Photo zone — 84% */}
      <div className="relative h-[84%] w-full overflow-hidden bg-[#1a1a2e]">
        <PhotoOrFallback place={place} eager={isFront} />

        {/* Bottom scrim — lower 52% of the photo zone, for sell-line/badge legibility */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[52%]"
          style={{
            background:
              'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.18) 45%, rgba(0,0,0,0.62) 100%)',
          }}
        />

        {/* "5 photos" affordance — glass pill, top-right */}
        <span
          aria-hidden="true"
          className="glass-soft absolute right-3 top-3 inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-semibold transition-[filter] duration-200 ease-out-quart group-hover:brightness-110"
          style={{ color: 'rgba(255,255,255,0.92)' }}
        >
          <StackedPhotosGlyph />
          {place.nPhotos}
        </span>

        {/* Scrim content: price pill (if any) + sell-line */}
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 p-3">
          {place.priceTier ? (
            <span
              aria-hidden="true"
              className="glass-soft inline-flex h-6 w-fit items-center rounded-full px-2 text-[11px] font-semibold"
              style={{ color: 'rgba(255,255,255,0.92)' }}
            >
              {place.priceTier}
            </span>
          ) : null}
          <p
            className="font-sans text-[13px] font-semibold leading-[1.3]"
            style={{
              color: 'rgba(255,255,255,0.95)',
              textShadow: '0 1px 3px rgba(0,0,0,0.7)',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {sellLine}
          </p>
        </div>
      </div>

      {/* Frosted info strip — 16% */}
      <div
        className="flex h-[16%] flex-col justify-center gap-0.5 px-[14px] py-3"
        style={{
          background: 'rgba(255,255,255,0.92)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderTop: '1px solid rgba(14,14,16,0.06)',
        }}
      >
        <p
          className="truncate font-display text-[18px] leading-[1.15]"
          style={{ color: '#0e0e10' }}
        >
          {place.name}
        </p>
        <p
          className="truncate font-sans text-[12px] font-semibold"
          style={{ color: 'rgba(14,14,16,0.68)' }}
        >
          {place.category}
          {' · '}
          <StarGlyph />
          {' '}
          {place.rating}
          {' '}
          <span style={{ color: 'rgba(14,14,16,0.48)', fontWeight: 400 }}>
            ({numberFmt.format(place.reviewCount)})
          </span>
        </p>
      </div>
    </motion.div>
  )
}

// Hero photo with a graceful 404 fallback (spec §9): on error, keep the
// #1a1a2e fill + a faint centered Mingla mark; the card never collapses.
function PhotoOrFallback({
  place,
  eager,
}: {
  place: ShowcasePlace
  eager: boolean
}) {
  const [errored, setErrored] = useState(false)

  if (errored) {
    return (
      <div
        aria-hidden="true"
        className="flex h-full w-full items-center justify-center bg-[#1a1a2e] font-display text-[28px]"
        style={{ color: 'rgba(255,255,255,0.12)' }}
      >
        Mingla
      </div>
    )
  }

  return (
    // Plain <img> (not next/image) — matches the existing hero-vibe-deck
    // pattern and avoids next.config remotePatterns setup. alt="" because
    // the card's aria-label carries the meaning (spec §10).
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={placePhotoUrl(place.placeKey, 0)}
      alt=""
      className="h-full w-full select-none object-cover"
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      draggable={false}
      onError={() => setErrored(true)}
      style={{ userSelect: 'none' }}
    />
  )
}

function StarGlyph() {
  return (
    <svg
      aria-hidden="true"
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="#f4d679"
      className="inline-block align-[-1px]"
    >
      <path d="M12 2.5l2.9 6.06 6.6.62-4.97 4.44 1.46 6.48L12 17.9l-5.99 2.7 1.46-6.48L2.5 9.68l6.6-.62L12 2.5z" />
    </svg>
  )
}

function StackedPhotosGlyph() {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="rgba(255,255,255,0.92)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="7" y="3" width="14" height="14" rx="2.5" />
      <path d="M3 8v11a2 2 0 0 0 2 2h11" />
    </svg>
  )
}
