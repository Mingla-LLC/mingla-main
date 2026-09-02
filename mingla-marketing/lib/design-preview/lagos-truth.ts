// ---------------------------------------------------------------
// #2902 — Lagos EXPLORER truth set for the design preview.
//
// WHAT IS REAL HERE. Every venue below is a real Lagos business already in
// Mingla's place pool. Name, category, rating, review count and the hero photo
// are verbatim first-party records — the photos are served from Mingla's own
// Supabase storage bucket (`place-photos`), not stock and not generated. All
// ten URLs were verified 200 before this file was written.
//
// WHAT IS DELIBERATELY ABSENT.
//   1. `LAGOS_SHOWCASE_EVENTS` is NOT imported. That file attaches invented
//      event titles, dates and ticket prices to real named Lagos venues
//      ("Afrobeats Rooftop" at Hard Rock Cafe Lagos). Its own header admits the
//      events are "REPRESENTATIVE". Rendering it would claim a real venue has
//      an event it does not have, which this preview forbids.
//   2. `recommendCount` is dropped. Its source file marks it DECORATIVE — no
//      real local-recommend data exists — so it is social proof we cannot back.
//   3. Plan-level price totals and durations from `lagos-intent-plans.ts` are
//      carried ONLY under the `illustrative` provenance label, because that
//      file describes them as "summed editorial ranges" and an "editorial
//      estimate". The VENUES in each plan stay real.
// ---------------------------------------------------------------

import { LAGOS_SHOWCASE_PLACES } from '@/lib/lagos-showcase-places'
import { LAGOS_INTENT_PLANS } from '@/lib/lagos-intent-plans'
import type { ShowcasePlace } from '@/lib/dc-showcase-places'
import type { IntentPlan } from '@/lib/dc-intent-plans'

/** A real Lagos venue, stripped of every field we cannot defend. */
export interface LagosVenue {
  name: string
  category: string
  /** Real Google rating, 0–5. */
  rating: number
  /** Real review count. */
  reviewCount: number
  /**
   * Real per-person price band from the place pool, or null. Null renders as
   * nothing — never as "Free" and never as a guess.
   */
  priceRange: string | null
  blurb: string | null
  /** Verbatim `stored_photo_urls[0]`, served from Mingla's own storage. */
  photo: string
  placeKey: string
  /** Short intent word used by the filter rail (derived from the Mingla category). */
  intent: string
}

function toVenue(p: ShowcasePlace): LagosVenue {
  return {
    name: p.name,
    category: p.category,
    rating: p.rating,
    reviewCount: p.reviewCount,
    priceRange: p.priceRange,
    blurb: p.blurb,
    photo: p.coverImageUrl ?? '',
    placeKey: p.placeKey,
    intent: p.pillLabel.replace(/ (places|dates|shows)$/, ''),
  }
}

export const LAGOS_VENUES: readonly LagosVenue[] = LAGOS_SHOWCASE_PLACES.filter(
  (p) => typeof p.coverImageUrl === 'string' && p.coverImageUrl.length > 0,
).map(toVenue)

/** The hero mosaic uses six real venue photos; the rest feed the answer grid. */
export const LAGOS_HERO_PHOTOS: readonly LagosVenue[] = LAGOS_VENUES.slice(0, 6)

/**
 * A Lagos plan. `venues` are real; `priceRange` and `duration` are editorial and
 * are always rendered behind an `illustrative` label at the call site.
 */
export interface LagosPlan {
  id: string
  title: string
  sellLine: string
  itineraryLabel: string
  /** EDITORIAL — never presented as a quoted or bookable price. */
  illustrativePriceRange: string
  /** EDITORIAL — never presented as a measured duration. */
  illustrativeDuration: string
  stops: readonly { name: string; role: string; photo: string }[]
}

function toPlan(p: IntentPlan): LagosPlan {
  return {
    id: p.id,
    title: p.intentTitle,
    sellLine: p.sellLine,
    itineraryLabel: p.itineraryLabel,
    illustrativePriceRange: p.priceRange,
    illustrativeDuration: p.duration,
    stops: p.stops.map((s) => ({ name: s.name, role: s.role, photo: s.heroPhoto })),
  }
}

export const LAGOS_PLANS: readonly LagosPlan[] = LAGOS_INTENT_PLANS.map(toPlan)

/**
 * The three plans the interactive demo steps through. Chosen to span the three
 * distinct Explorer jobs (a date, a group night, a low-cost daytime plan) rather
 * than to flatter one.
 */
export const LAGOS_DEMO_PLAN_IDS = ['first-date', 'group-fun', 'take-a-stroll'] as const
