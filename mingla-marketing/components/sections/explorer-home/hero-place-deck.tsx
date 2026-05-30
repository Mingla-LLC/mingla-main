'use client'
import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'
import {
  DC_SHOWCASE_PLACES,
  placePhotoUrl,
  type ShowcasePlace,
} from '@/lib/dc-showcase-places'
import { DC_INTENT_PLANS, type IntentPlan } from '@/lib/dc-intent-plans'
import { DC_SHOWCASE_EVENTS, type ShowcaseEvent } from '@/lib/dc-showcase-events'
import { IntentCard } from '@/components/sections/explorer-home/intent-card'
import { EventCard } from '@/components/sections/explorer-home/event-card'

// ---------------------------------------------------------------
// Hero Place Deck — ORCH-0998 [marketing real place cards — DC test run]
//
// REAL ASSEMBLY: a single auto-rotating 260×360 stack that INTERLEAVES all
// three card types in the repeating order
//   1 single place → 1 intent → 1 event → (loop)
// across 10 single places, 6 intents, and 6 events (the shorter lists WRAP
// modulo so the strict single→intent→event cadence holds across all 10
// singles). All three card types are the same 260×360 shell, so they cycle in
// one stack mechanically identically to the original single-place deck.
//
// Card shells:
//  - single place → <PlaceCard> (extracted below; previously inline DeckCard).
//  - intent       → <IntentCard> (intent-card.tsx, reused unchanged).
//  - event        → <EventCard>  (event-card.tsx, reused unchanged).
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

// ---------------------------------------------------------------
// Interleaved deck slots. Each slot is one card in the rotation, tagged by
// kind so the stack cell can render the right component. Built once at module
// load by round-robin: single[0], intent[0], event[0], single[1], intent[1],
// event[1], … When a list is shorter than the singles list (6 intents,
// 6 events vs 10 singles), it WRAPS modulo so every single is followed by an
// intent then an event and the cadence never breaks. Deterministic ordering →
// no hydration mismatch.
// ---------------------------------------------------------------
type DeckSlot =
  | { kind: 'place'; key: string; place: ShowcasePlace }
  | { kind: 'intent'; key: string; plan: IntentPlan }
  | { kind: 'event'; key: string; event: ShowcaseEvent }

function buildInterleavedSlots(): DeckSlot[] {
  const slots: DeckSlot[] = []
  const nSingles = DC_SHOWCASE_PLACES.length
  for (let i = 0; i < nSingles; i++) {
    const place = DC_SHOWCASE_PLACES[i] as ShowcasePlace
    const plan = DC_INTENT_PLANS[i % DC_INTENT_PLANS.length] as IntentPlan
    const event = DC_SHOWCASE_EVENTS[i % DC_SHOWCASE_EVENTS.length] as ShowcaseEvent
    // Keys are made unique across the (possibly wrapped) sequence by prefixing
    // the round index, so AnimatePresence never sees a duplicate key when a
    // shorter list wraps onto a second pass.
    slots.push({ kind: 'place', key: `p${i}-${place.placeKey}`, place })
    slots.push({ kind: 'intent', key: `i${i}-${plan.id}`, plan })
    slots.push({
      kind: 'event',
      key: `e${i}-${event.source}-${event.title}`,
      event,
    })
  }
  return slots
}

const DECK_SLOTS: readonly DeckSlot[] = buildInterleavedSlots()

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
    DECK_SLOTS.map((_, i) => i),
  )
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (reduced || paused || DECK_SLOTS.length <= 1) return
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
      aria-label="Real places, plans, and events on Mingla, from Washington DC"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      style={{ width: CARD_W + 92, height: CARD_H + 62 }}
      className="relative overflow-hidden"
    >
      <AnimatePresence initial={false}>
        {visible.map((slotIdx, position) => {
          const slot = DECK_SLOTS[slotIdx] as DeckSlot
          return (
            <StackCell key={slot.key} slot={slot} position={position} reduced={reduced} />
          )
        })}
      </AnimatePresence>
    </div>
  )
}

// ---------------------------------------------------------------
// StackCell — the positioning wrapper for ONE card in the stack. It carries
// the stack transform (scale / y / zIndex), the enter/exit animation, and the
// peeked-card dim filter, then renders the right card component for the slot
// kind. The 260×360 shell + border + shadow live INSIDE each card component
// (PlaceCard / IntentCard / EventCard) so all three are pixel-identical in the
// stack — mechanically the same as the original single-place deck.
// ---------------------------------------------------------------
interface StackCellProps {
  slot: DeckSlot
  position: number
  reduced: boolean
}

function StackCell({ slot, position, reduced }: StackCellProps) {
  const { scale, y } = positionStyles[position] ?? positionStyles[2]
  const zIndex = 3 - position
  const isFront = position === 0
  const exit = isFront ? exitAnim : undefined
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
        // Peeked cards dim slightly so the front card reads as the hero. The
        // border/shadow/radius are owned by the card component itself.
        filter: isFront ? undefined : 'brightness(0.82)',
        cursor: 'default',
      }}
      className="group absolute will-change-transform [backface-visibility:hidden] [transform-style:preserve-3d] hover:[transform:translateY(-4px)]"
    >
      {slot.kind === 'place' ? (
        <PlaceCard place={slot.place} isFront={isFront} eager={isFront} />
      ) : slot.kind === 'intent' ? (
        <IntentCard plan={slot.plan} isFront={isFront} eager={isFront} />
      ) : (
        <EventCard event={slot.event} isFront={isFront} eager={isFront} />
      )}
    </motion.div>
  )
}

// ---------------------------------------------------------------
// PlaceCard — the single-place card, extracted from the old inline DeckCard so
// the interleaved deck can render it as a sibling of IntentCard / EventCard.
// Self-contained 260×360 shell: --radius-2xl, border/elevation tokens, frosted
// white content block, #1a1a2e photo fill, 404 fallback. Pixel-identical shell
// to the two siblings (chip recipe is the v3 ink→white→orange cadence).
// ---------------------------------------------------------------
interface PlaceCardProps {
  place: ShowcasePlace
  /** Front card carries meaning to AT; peeked/decorative cards are aria-hidden. */
  isFront?: boolean
  /** Eager-load the photo for the front card; lazy for peeked. */
  eager?: boolean
}

export function PlaceCard({
  place,
  isFront = true,
  eager = false,
}: PlaceCardProps) {
  const sellLine = useMemo(() => sellLineFor(place), [place])
  // v2.6 aria: drop the old rating/review clause; honest to AT (no fake
  // recommend count). Price reads "Free" when there is no real range.
  const priceLabel = place.priceRange ?? 'Free'

  return (
    <div
      // Front card carries the meaning; peeked cards are hidden from AT.
      role={isFront ? 'img' : undefined}
      aria-label={
        isFront ? `${place.name}. ${sellLine}. ${priceLabel}.` : undefined
      }
      aria-hidden={isFront ? undefined : true}
      style={{
        width: CARD_W,
        height: CARD_H,
        borderRadius: 'var(--radius-2xl)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: isFront
          ? '0 18px 40px -12px rgba(0,0,0,0.55)'
          : '0 8px 24px -8px rgba(0,0,0,0.45)',
        cursor: 'default',
      }}
      className="flex flex-col overflow-hidden bg-[#1a1a2e]"
    >
      {/* Photo zone — 58% (v2.7). Trimmed from 64% to give the chip stack
          (name + 2-line description + price + bottom social row) room to fit
          inside CARD_H=360 with no scroll. The over-photo sell-line, price pill
          and "5 photos" pill were removed in v2; only a faint seam scrim remains. */}
      <div className="relative h-[58%] w-full overflow-hidden bg-[#1a1a2e]">
        <PhotoOrFallback place={place} eager={eager} />

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

      {/* Content area — 42% solid block (v2.7), frosted white. Chip Color
          System v3: a calm dark→light→accent cadence of 3 solid chips:
          (1) name+price on ONE ink chip, (2) description white chip with a
          hairline rim, (3) a full-width ORANGE locals pill pinned to the bottom
          (mt-auto). Orange is spent ONCE so it lands as a single intentional
          accent. Category eyebrow removed per operator (v2.7). overflow:hidden
          so any name wrap / long fallback clips cleanly, never grows the card. */}
      <div
        className="flex h-[42%] flex-col items-start overflow-hidden"
        style={{
          background: 'rgba(255,255,255,0.96)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderTop: '1px solid rgba(14,14,16,0.06)',
          padding: '10px 12px',
        }}
      >
        {/* Name + price → ONE ink-black chip on a single line (v3.2). Name
            flexes left and truncates; price hugs the right and never wraps.
            Range-only on this line. White text on ink = 18.9:1 (AAA). "Free"
            renders in WHITE here, not orange — orange is reserved for the
            locals pill (v3.1). */}
        <div
          className="flex max-w-full items-baseline overflow-hidden"
          style={{
            width: 'max-content',
            background: 'var(--color-ink)',
            borderRadius: '10px',
            padding: '5px 10px',
            gap: '8px',
          }}
        >
          <span
            className="font-display"
            style={{
              flex: '1 1 auto',
              minWidth: 0,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              fontSize: '14px',
              lineHeight: 1.15,
              color: '#ffffff',
            }}
          >
            {place.name}
          </span>
          {/* Price slot — shown ONLY when a real price exists. Honest: a
              ticketed place with no price data (priceRange === null) shows the
              name only and NEVER a fake "Free" (ORCH-0998 real-assembly rule). */}
          {place.priceRange ? (
            <span
              className="font-sans"
              style={{
                flex: '0 0 auto',
                whiteSpace: 'nowrap',
                fontSize: '12px',
                fontWeight: 700,
                color: '#ffffff',
              }}
            >
              {place.priceRange}
            </span>
          ) : null}
        </div>

        {/* description chip → solid white with a subtle hairline rim (v3.5),
            ink text at 78% (9.8:1 AAA), left-aligned. The chip GROWS to fill the
            space between the name+price chip and the locals pill (flex: 1), and
            carries an equal vertical margin top + bottom (8px each) so the gap
            ABOVE the description equals the gap BELOW it. */}
        <div
          className="flex w-full max-w-full flex-col justify-center font-sans"
          style={{
            flex: '1 1 auto',
            minHeight: 0,
            margin: '8px 0',
            background: '#ffffff',
            border: '1px solid rgba(14,14,16,0.08)',
            borderRadius: '8px',
            padding: '6px 9px',
            fontSize: '11.5px',
            lineHeight: 1.3,
            fontWeight: 500,
            color: 'rgba(14,14,16,0.78)',
            textAlign: 'left',
            overflow: 'hidden',
            whiteSpace: 'normal',
          }}
        >
          {sellLine}
        </div>

        {/* Locals row → full-width orange pill (v3.5), sits at the block bottom
            because the description chip above grows to fill (flex:1) with equal
            8px margins. */}
        <div
          className="flex w-full items-center overflow-hidden"
          style={{
            flex: '0 0 auto',
            background: 'var(--color-warm)',
            borderRadius: '999px',
            height: '30px',
            padding: '0 10px',
          }}
        >
          {/* decorative "N locals recommend" avatar stack — CSS-only, no images */}
          <RecommendStack count={place.recommendCount} />
        </div>
      </div>
    </div>
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

// Decorative "N locals recommend" indicator (v2.6 / v3.4). Replaces the old ★
// rating + review-count row. CSS-only avatars — NO <img>, NO network fetch (any
// external avatar URL could 404/hang and break the premium read). Three
// soft-gradient circles + a "+N" overflow chip + a label, laid out on ONE line
// inside the full-width orange locals pill (v3.4).
// `recommendCount` is DECORATIVE social proof — no real local-recommend data
// exists; do NOT wire this to a backend.
//
// v3.4 gradient reorder: on the orange pill, avatar #1's old warm gradient would
// blend into the band, so the most-contrasting fills face the orange — cocoa,
// then butter, then a NEW cool plum to break the all-warm monotony and guarantee
// the 3rd disc separates from the band.
const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #7a4a2a 0%, #b87333 100%)', // cocoa→copper (darkest)
  'linear-gradient(135deg, #f4d679 0%, #eba94f 100%)', // butter→amber
  'linear-gradient(135deg, #2a1f3d 0%, #5a4a7a 100%)', // deep plum→violet (cool)
] as const
const AVATAR_INITIALS = ['M', 'J', 'K'] as const

function RecommendStack({ count }: { count: number }) {
  // 3 faces shown; overflow chip = count − 3.
  const overflow = Math.max(0, count - 3)
  // White rings (v3.4): solid #FFFFFF punches a clean separation from both the
  // neighbour avatar AND the saturated orange band.
  const ringStyle = {
    width: 22,
    height: 22,
    borderRadius: 9999,
    border: '2px solid #ffffff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: '0 0 auto',
  } as const

  return (
    <div aria-hidden="true" className="flex w-full items-center">
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
                color: '#ffffff',
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
              // +N chip → solid ink (v3.4: reads as "more" decisively on orange).
              ...ringStyle,
              background: 'var(--color-ink)',
              marginLeft: -8,
              zIndex: 0,
            }}
          >
            <span
              className="font-sans"
              style={{
                fontSize: '9px',
                fontWeight: 800,
                color: '#ffffff',
                lineHeight: 1,
              }}
            >
              {`+${overflow}`}
            </span>
          </div>
        ) : null}
      </div>
      {/* Label → WHITE on orange (v3.5). white-on-#eb7825 ≈ 4.2:1 passes WCAG AA
          ONLY for LARGE text, so the label is BOLD (700) at 14px — at ≥14px bold
          the AA threshold drops to 3:1, which 4.2:1 clears. Do NOT drop below
          14px or un-bold this label or it stops being accessible. */}
      <span
        className="font-sans"
        style={{
          marginLeft: 8,
          fontSize: '14px',
          lineHeight: 1.1,
          fontWeight: 700,
          color: '#ffffff',
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ fontWeight: 800, color: '#ffffff' }}>{count}</span>
        {' locals recommend'}
      </span>
      {/* flex spacer — eats remaining width so the pill is genuinely full-width
          with the avatars + label left-packed (v3.4). */}
      <span style={{ flex: '1 1 auto' }} aria-hidden="true" />
    </div>
  )
}
