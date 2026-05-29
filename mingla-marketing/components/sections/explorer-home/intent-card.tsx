'use client'
import { useState } from 'react'
import type { IntentPlan, IntentStop } from '@/lib/dc-intent-plans'

// ---------------------------------------------------------------
// Intent Card — ORCH-0998 [marketing real place cards — DC test run]
//
// A NEW card type (sibling of hero-place-deck.tsx's single place card): a
// snapshot of a multi-stop Mingla EXPERIENCE / plan. Built per
// DESIGN_ORCH-0998_MARKETING_PLACE_CARD_DC.md "Intent Card v1" (§I.1–I.9).
//
// POSITIONING (LOCKED): Mingla is an EXPERIENCE / date-planning / social-
// experiences app — NOT a dating app. An intent is a vibe for an OUTING
// (Romantic, First Date, Group Fun, Culture Crawl). An intent card shows a
// snapshot of a PLAN: a themed sequence of 2–4 real places (stops). No
// hearts-as-product, no "find love", no swipe-on-people language.
//
// SHELL is pixel-identical to the single place card: 260×360, --radius-2xl
// (36px), border/elevation tokens, frosted-white content block, #1a1a2e
// photo fill, 404 fallback. What DIFFERS: the photo zone is a multi-stop
// vertical-seam COLLAGE (one cell per stop) instead of one photo, and the
// chips carry a PLAN's identity (intent title + "N stops", itinerary
// sequence, price + duration) instead of one venue's name + recommend pile.
//
// Honesty rules (shared with the single card): NO distance, NO travel-time,
// NO "X min away". Those are personalized live readings — faking them on a
// marketing page is dishonest. Do NOT add them back thinking they were
// forgotten.
// ---------------------------------------------------------------

const CARD_W = 260
// 🔒LOCKED (ORCH-0998 v2.1 / §I.6): same 360 as the single card — the intent
// card is a pixel-identical SHELL sibling, so the hero no-scroll math is
// unchanged. Do NOT diverge this height.
const CARD_H = 360

interface IntentCardProps {
  plan: IntentPlan
  /** Front card carries meaning to AT; peeked/decorative cards are aria-hidden. */
  isFront?: boolean
  /** Eager-load the photos for the front card; lazy for peeked. */
  eager?: boolean
}

export function IntentCard({
  plan,
  isFront = true,
  eager = false,
}: IntentCardProps) {
  // §I.7 aria-label: "{title}. A {N}-stop Mingla plan: {sequence with 'then'}.
  // {price} {duration}." — the orange pill + badges + photos are aria-hidden,
  // so the label carries all meaning. Sequence uses "then" instead of arrows.
  const stopCount = plan.stops.length
  const sequenceSpoken = plan.stops.map((s) => s.role).join(', then ')
  const ariaLabel = `${plan.intentTitle}. A ${stopCount}-stop Mingla plan: ${sequenceSpoken}. ${plan.priceRange}, ${plan.duration}.`

  // §I.1: render at most 4 cells; "N stops" chip still states the true total.
  const cells = plan.stops.slice(0, 4)

  return (
    <div
      role={isFront ? 'img' : undefined}
      aria-label={isFront ? ariaLabel : undefined}
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
      {/* Photo zone — 64% (≈230px), §I.1. A horizontal flex row of N equal
          cells (one per stop, itinerary order), separated by 2px ink seams
          drawn as gap:2px over a #0E0E10 background so the seam color shows
          through. Echoes the app's imageStrip "this is one plan" mechanic. */}
      <div
        className="relative w-full overflow-hidden"
        style={{ height: '64%', background: 'var(--color-ink)' }}
      >
        <div className="flex h-full w-full" style={{ gap: '2px' }}>
          {cells.map((stop, i) => (
            <StopCell
              key={`${plan.id}-${i}`}
              stop={stop}
              index={i}
              eager={eager}
            />
          ))}
        </div>

        {/* Seam scrim — lower 38%, spans all cells (§I.1). Its only job is to
            guard the photo edge against the content block. No text sits on it. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0"
          style={{
            height: '38%',
            background:
              'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.18) 45%, rgba(0,0,0,0.62) 100%)',
          }}
        />
      </div>

      {/* Content block — 36% frosted-white, same surface as the single card.
          Three stacked chips, same dark→light→accent cadence as the single
          card's v3 ink/white/orange system, re-purposed for a PLAN (§I.2):
          (1) intent title + "N stops" on ONE ink line, (2) itinerary sequence
          white chip, (3) full-width orange price+duration pill (mt-auto). */}
      <div
        className="flex flex-col items-start overflow-hidden"
        style={{
          height: '36%',
          background: 'rgba(255,255,255,0.96)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderTop: '1px solid rgba(14,14,16,0.06)',
          padding: '10px 12px',
        }}
      >
        {/* Chip 1 — intent title + stop count → ONE ink chip on a single line
            (§I.2). Mirrors the single card's name+price chip: title takes the
            "name" slot (flexes/truncates), stop count takes the "price" slot
            (flex:0 0 auto, never wraps). White on ink = 18.9:1 (AAA). */}
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
            {plan.intentTitle}
          </span>
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
            {`${stopCount} stops`}
          </span>
        </div>

        {/* Chip 2 — itinerary sequence → solid white chip with a hairline rim
            (§I.2). Takes the single card's "description" slot. The itinerary
            IS the sell (concrete arc of the outing > any adjective). Grows to
            fill (flex:1) with equal 8px margins so the orange pill pins to the
            bottom; 2-line clamp + overflow:hidden clips a long 4-stop run. */}
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
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {plan.itineraryLabel}
        </div>

        {/* Chip 3 — full-width ORANGE price+duration pill (§I.4). The single
            card's pill carries a decorative recommend pile; a PLAN's pill
            carries two HONEST facts instead: total price (left) · duration
            (right), balanced edge-to-edge (justify-between). Ink text on
            orange = 5.0:1 (AA body ✓) — never white-on-orange (4.2:1 fails).
            decorative duration estimate — no real per-plan duration data;
            do NOT wire to a backend. */}
        <div
          className="flex w-full items-center justify-between overflow-hidden"
          aria-hidden="true"
          style={{
            flex: '0 0 auto',
            background: 'var(--color-warm)',
            borderRadius: '999px',
            height: '30px',
            padding: '0 12px',
          }}
        >
          <span
            className="font-sans"
            style={{
              fontSize: '14px',
              lineHeight: 1.1,
              fontWeight: 700,
              color: '#FFFFFF',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {plan.priceRange}
          </span>
          <span
            className="font-sans"
            style={{
              flex: '0 0 auto',
              marginLeft: '8px',
              fontSize: '14px',
              lineHeight: 1.1,
              fontWeight: 700,
              color: '#FFFFFF',
              whiteSpace: 'nowrap',
            }}
          >
            {plan.duration}
          </span>
        </div>
      </div>
    </div>
  )
}

// One collage cell — a single stop's hero photo with the same graceful 404
// fallback as the single card (§I.1 / §9): on error keep the #1a1a2e fill + a
// faint centered Mingla mark; one dead cell never collapses the card.
function StopCell({
  stop,
  index,
  eager,
}: {
  stop: IntentStop
  index: number
  eager: boolean
}) {
  const [errored, setErrored] = useState(false)

  return (
    <div
      className="relative h-full overflow-hidden bg-[#1a1a2e]"
      style={{ flex: '1 1 0%', minWidth: 0 }}
    >
      {errored ? (
        <div
          aria-hidden="true"
          className="flex h-full w-full items-center justify-center bg-[#1a1a2e] font-display text-[18px]"
          style={{ color: 'rgba(255,255,255,0.12)' }}
        >
          Mingla
        </div>
      ) : (
        // Plain <img> (not next/image) — matches the single-card pattern and
        // avoids next.config remotePatterns setup. alt="" because the card's
        // aria-label carries the meaning (§I.7).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={stop.heroPhoto}
          alt=""
          className="h-full w-full select-none object-cover"
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          onError={() => setErrored(true)}
          style={{ userSelect: 'none' }}
        />
      )}

      {/* Stop-number badge (§I.1) — top-left, ink circle with white ring + white
          numeral, so the collage reads as an ORDERED plan, not a random grid.
          aria-hidden (order is in the card aria-label). */}
      <div
        aria-hidden="true"
        className="absolute flex items-center justify-center font-sans"
        style={{
          top: '8px',
          left: '8px',
          width: '20px',
          height: '20px',
          borderRadius: '9999px',
          background: 'rgba(14,14,16,0.92)',
          border: '1.5px solid rgba(255,255,255,0.85)',
          fontSize: '11px',
          fontWeight: 800,
          lineHeight: 1,
          color: '#ffffff',
        }}
      >
        {index + 1}
      </div>
    </div>
  )
}
