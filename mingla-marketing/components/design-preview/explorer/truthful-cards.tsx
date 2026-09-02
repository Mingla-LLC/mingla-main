'use client'
import { useState } from 'react'
import { Star } from 'lucide-react'
import type { LagosPlan, LagosVenue } from '@/lib/design-preview/lagos-truth'

// ---------------------------------------------------------------
// #2902 — TRUTHFUL card variants, and why they had to be written.
//
// The intent was to render the shipped `PlaceCard` and `IntentCard` verbatim.
// Reviewing the built page stopped that:
//
//   • `PlaceCard` unconditionally renders `<RecommendStack count=
//     {place.recommendCount} />` — a full-width orange pill reading
//     "197 locals recommend", with three invented avatars. Its own source
//     comment says `recommendCount` is "DECORATIVE social proof — no real
//     local-recommend data exists". There is no prop to suppress it. That pill
//     is currently on the live consumer home page, attached to real, named
//     Lagos businesses.
//
//   • `IntentCard` renders `plan.priceRange` and `plan.duration` as plain card
//     facts. On the Lagos snapshot those are "summed editorial ranges" and an
//     "editorial estimate" — unverified numbers presented as product truth.
//
// Both are exactly the claim this preview forbids, so these variants keep the
// SHELL identical (260×360, --radius-2xl, the 58/42 photo-to-content split, the
// frosted white content block, the ink→white→accent chip cadence) and change
// only what is claimed:
//
//   – the invented recommend pill becomes the REAL Google rating and review
//     count already stored against the place;
//   – the editorial plan total is labelled illustrative, in the card.
//
// The production fix this implies is small — make the recommend pill
// conditional and the plan total labelled — and it belongs on the shipped
// components, not only here.
// ---------------------------------------------------------------

const CARD_W = 260
const CARD_H = 360

const SHELL: React.CSSProperties = {
  width: CARD_W,
  height: CARD_H,
  borderRadius: 'var(--radius-2xl)',
  border: '1px solid rgba(255,255,255,0.08)',
  boxShadow: '0 18px 40px -12px rgba(0,0,0,0.55)',
}

function Photo({ src, alt, eager }: { src: string; alt: string; eager?: boolean }) {
  const [errored, setErrored] = useState(false)
  if (errored || !src) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#1a1a2e]">
        <span className="font-display text-sm text-white/25">Mingla</span>
      </div>
    )
  }
  return (
    <img
      src={src}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      draggable={false}
      onError={() => setErrored(true)}
      className="h-full w-full object-cover"
    />
  )
}

export function TruthfulPlaceCard({
  venue,
  eager = false,
}: {
  venue: LagosVenue
  eager?: boolean
}) {
  const price = venue.priceRange
  return (
    <div
      role="img"
      aria-label={`${venue.name}. ${venue.category}. Rated ${venue.rating.toFixed(1)} from ${venue.reviewCount.toLocaleString('en-US')} reviews.${price ? ` ${price}.` : ''}`}
      style={SHELL}
      className="flex flex-col overflow-hidden bg-[#1a1a2e]"
    >
      <div className="relative h-[58%] w-full overflow-hidden bg-[#1a1a2e]">
        <Photo src={venue.photo} alt="" eager={eager} />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[38%]"
          style={{
            background:
              'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.18) 45%, rgba(0,0,0,0.62) 100%)',
          }}
        />
      </div>

      <div
        className="flex h-[42%] flex-col items-start overflow-hidden p-3"
        style={{ background: 'rgba(255,255,255,0.96)' }}
      >
        {/* Chip 1 — ink: name + real price band. */}
        <div className="flex w-full items-center gap-2 rounded-full bg-ink px-3 py-1.5">
          <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-white">
            {venue.name}
          </span>
          {price ? (
            <span className="shrink-0 text-[11px] font-semibold tabular-nums text-white/70">
              {price}
            </span>
          ) : null}
        </div>

        {/* Chip 2 — white: the real blurb. */}
        <p className="mt-2 line-clamp-2 w-full rounded-xl bg-white px-3 py-2 text-[12px] leading-snug text-ink/70 ring-1 ring-inset ring-black/[0.06]">
          {venue.blurb ?? venue.category}
        </p>

        {/* Chip 3 — accent, spent once. The invented "N locals recommend" pill is
            replaced by the rating and review count Mingla actually stores. */}
        <div
          className="mt-auto flex w-full items-center gap-2 rounded-full px-3"
          style={{ background: 'var(--color-warm)', height: 30 }}
        >
          <Star className="h-3.5 w-3.5 shrink-0 fill-white text-white" aria-hidden="true" />
          <span className="text-[12px] font-bold tabular-nums text-white">
            {venue.rating.toFixed(1)}
          </span>
          <span className="truncate text-[11px] font-semibold text-white/85">
            {venue.reviewCount.toLocaleString('en-US')} Google reviews
          </span>
        </div>
      </div>
    </div>
  )
}

export function TruthfulPlanCard({ plan, eager = false }: { plan: LagosPlan; eager?: boolean }) {
  const cells = plan.stops.slice(0, 4)
  const spoken = plan.stops.map((s) => s.role).join(', then ')
  return (
    <div
      role="img"
      aria-label={`${plan.title}. A ${plan.stops.length}-stop Mingla plan: ${spoken}. Example cost ${plan.illustrativePriceRange}, roughly ${plan.illustrativeDuration}; both figures are illustrative.`}
      style={SHELL}
      className="flex flex-col overflow-hidden bg-[#1a1a2e]"
    >
      <div className="grid h-[58%] w-full grid-cols-2 gap-[2px] overflow-hidden bg-[#1a1a2e]">
        {cells.map((stop, i) => (
          <div
            key={`${stop.name}-${i}`}
            className={cells.length === 3 && i === 0 ? 'col-span-2' : ''}
          >
            <Photo src={stop.photo} alt="" eager={eager && i === 0} />
          </div>
        ))}
      </div>

      <div
        className="flex h-[42%] flex-col items-start overflow-hidden p-3"
        style={{ background: 'rgba(255,255,255,0.96)' }}
      >
        <div className="flex w-full items-center gap-2 rounded-full bg-ink px-3 py-1.5">
          <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-white">
            {plan.title}
          </span>
          <span className="shrink-0 text-[10px] font-semibold text-white/60">
            {plan.stops.length} stops
          </span>
        </div>

        <p className="mt-2 line-clamp-2 w-full rounded-xl bg-white px-3 py-2 text-[12px] leading-snug text-ink/70 ring-1 ring-inset ring-black/[0.06]">
          {plan.itineraryLabel}
        </p>

        {/* The editorial total is allowed on the card only because it is
            labelled on the card. */}
        <div
          className="mt-auto flex w-full items-center gap-1.5 rounded-full px-3"
          style={{ background: 'var(--color-warning)', height: 30 }}
        >
          <span className="shrink-0 text-[9px] font-bold uppercase tracking-[0.08em] text-white/90">
            Example
          </span>
          <span className="truncate text-[11px] font-semibold tabular-nums text-white">
            {plan.illustrativePriceRange} · {plan.illustrativeDuration}
          </span>
        </div>
      </div>
    </div>
  )
}
