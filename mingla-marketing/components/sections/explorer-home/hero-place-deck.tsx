'use client'
import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'
import { Pill } from '@/components/ui/pill'
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
// 🔒LOCKED (ORCH-0998 v2.1): 360 is the tallest height that clears a 768px-tall
// viewport with real headroom (+14.4px). The hero wrapper scales the deck by
// ~1.075× at vmin=768, so every added pixel is amplified — 375 already overflows
// (−1.7px). Do NOT round up past 360 or the one-screen hero reintroduces page scroll.
const CARD_H = 360

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
  // v2.6 aria: drop the old rating/review clause; honest to AT (no fake
  // recommend count). Price reads "Free" when there is no real range.
  const priceLabel = place.priceRange ?? 'Free'

  return (
    <motion.div
      // Front card carries the meaning; peeked cards are hidden from AT.
      role={isFront ? 'img' : undefined}
      aria-label={
        isFront
          ? `${place.name}. ${sellLine}. ${priceLabel}.`
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
      {/* Photo zone — 58% (v2.7). Trimmed from 64% to give the chip stack
          (name + 2-line description + price + bottom social row) room to fit
          inside CARD_H=360 with no scroll. The over-photo sell-line, price pill
          and "5 photos" pill were removed in v2; only a faint seam scrim remains. */}
      <div className="relative h-[58%] w-full overflow-hidden bg-[#1a1a2e]">
        <PhotoOrFallback place={place} eager={isFront} />

        {/* Seam scrim — lower 38% (v2.2: reduced from 52%, no text sits on it now) */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[38%]"
          style={{
            background:
              'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.18) 45%, rgba(0,0,0,0.62) 100%)',
          }}
        />
      </div>

      {/* Content area — 42% solid block (v2.7). All chips LEFT-aligned, stacked:
          name chip, description chip (2-line clamp), price chip, then a flex
          spacer, then the bottom row (avatars + "N locals recommend" on ONE line).
          Category eyebrow removed per operator. Chips reuse the shared
          <Pill variant="glass"> primitive (glass-soft fill + rim) with compact
          height/padding overrides so everything fits inside CARD_H=360 with no
          scroll. overflow:hidden so any wrap clips cleanly, never grows the card. */}
      <div
        className="flex h-[42%] flex-col items-start overflow-hidden"
        style={{
          background: 'rgba(255,255,255,0.96)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderTop: '1px solid rgba(14,14,16,0.06)',
          padding: '10px 12px',
          gap: '5px',
        }}
      >
        {/* Category eyebrow removed (operator v2.7: the category labels go away).
            The card no longer shows the category. */}

        {/* place name chip (left-aligned, single-line truncate) */}
        <Pill
          variant="glass"
          className="h-auto max-w-full truncate px-2.5 py-1 font-display"
          style={{ fontSize: '14px', lineHeight: 1.15, color: '#0e0e10' }}
        >
          {place.name}
        </Pill>

        {/* description chip (left-aligned, 2-line clamp) */}
        <Pill
          variant="glass"
          className="h-auto max-w-full px-2.5 py-1 font-sans"
          style={{
            fontSize: '11.5px',
            lineHeight: 1.25,
            fontWeight: 500,
            color: 'rgba(14,14,16,0.7)',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            whiteSpace: 'normal',
          }}
        >
          {sellLine}
        </Pill>

        {/* price chip (left-aligned, consistent with name + description) */}
        <Pill
          variant="glass"
          className="h-auto px-2.5 py-1 font-sans"
          style={{ fontSize: '12px', lineHeight: 1 }}
        >
          {place.priceRange ? (
            <>
              <span style={{ fontWeight: 700, color: '#0e0e10' }}>
                {place.priceRange}
              </span>
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 600,
                  color: 'rgba(14,14,16,0.45)',
                }}
              >
                {' · per person'}
              </span>
            </>
          ) : (
            <span style={{ fontWeight: 700, color: '#eb7825' }}>Free</span>
          )}
        </Pill>

        {/* bottom row: avatars + "N locals recommend" on ONE line,
            pinned to the bottom of the content block (mt-auto). */}
        <div className="mt-auto flex w-full items-center">
          {/* decorative "N locals recommend" avatar stack — CSS-only, no images */}
          <RecommendStack count={place.recommendCount} />
        </div>
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

// Decorative "N locals recommend" indicator (v2.6). Replaces the old ★ rating +
// review-count row. CSS-only avatars — NO <img>, NO network fetch (any external
// avatar URL could 404/hang and break the premium read). Three soft-gradient
// circles from the Mingla warm/butter family + a "+N" overflow chip + a label.
// `recommendCount` is DECORATIVE social proof — no real local-recommend data
// exists; do NOT wire this to a backend.
const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #eb7825 0%, #f4a85f 100%)', // warm
  'linear-gradient(135deg, #f4d679 0%, #eba94f 100%)', // butter→amber
  'linear-gradient(135deg, #7a4a2a 0%, #b87333 100%)', // cocoa→copper
] as const
const AVATAR_INITIALS = ['M', 'J', 'K'] as const

function RecommendStack({ count }: { count: number }) {
  // 3 faces shown; overflow chip = count − 3.
  const overflow = Math.max(0, count - 3)
  const ringStyle = {
    width: 22,
    height: 22,
    borderRadius: 9999,
    border: '2px solid rgba(255,255,255,0.96)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: '0 0 auto',
  } as const

  return (
    <div aria-hidden="true" className="flex items-center">
      <div className="flex items-center">
        {AVATAR_INITIALS.map((initial, i) => (
          <div
            key={initial}
            style={{
              ...ringStyle,
              background: AVATAR_GRADIENTS[i] ?? AVATAR_GRADIENTS[0],
              marginLeft: i === 0 ? 0 : -8,
              zIndex: AVATAR_INITIALS.length - i,
            }}
          >
            <span
              className="font-sans"
              style={{
                fontSize: '10px',
                fontWeight: 800,
                color: 'rgba(255,255,255,0.96)',
                lineHeight: 1,
              }}
            >
              {initial}
            </span>
          </div>
        ))}
        {overflow > 0 ? (
          <div
            style={{
              ...ringStyle,
              background: 'rgba(14,14,16,0.82)',
              marginLeft: -8,
              zIndex: 0,
            }}
          >
            <span
              className="font-sans"
              style={{
                fontSize: '9px',
                fontWeight: 800,
                color: 'rgba(255,255,255,0.95)',
                lineHeight: 1,
              }}
            >
              {`+${overflow}`}
            </span>
          </div>
        ) : null}
      </div>
      <span
        className="font-sans"
        style={{
          marginLeft: 8,
          fontSize: '11px',
          lineHeight: 1.1,
          fontWeight: 600,
          color: 'rgba(14,14,16,0.6)',
          textAlign: 'right',
        }}
      >
        <span style={{ fontWeight: 700, color: '#0e0e10' }}>{count}</span>
        {' locals recommend'}
      </span>
    </div>
  )
}
