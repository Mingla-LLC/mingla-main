// #4137 wave 2 — pure helpers for the city page place grid.
//
// The places arrive in the validated stored order (top 50 overall). A card's
// label is its rank WITHIN its category in that order (Seth's default for
// OQ-2), e.g. "#1 · Brunch" even when the place is #2 overall.

import type { CataloguePlace, ExplorerCategorySlug } from '@/content/page-system/shared'

/**
 * Where the rating line comes from. Seth, 27 Oct 2026: the rating line stays as
 * the live page shows it today, from the stored catalogue.
 */
export const CITY_RATING_SOURCE: 'live' | 'catalogue' = 'catalogue'

type RankedPlace = Pick<CataloguePlace, 'placePoolId' | 'categorySlug' | 'categoryLabel'>
type RatedPlace = Pick<CataloguePlace, 'rating' | 'reviewCount'>

/** 1-based position of each place among places of the same category, in stored order. */
export function categoryRank(places: readonly RankedPlace[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()
  const ranks = new Map<string, number>()
  for (const place of places) {
    const next = (counts.get(place.categorySlug) ?? 0) + 1
    counts.set(place.categorySlug, next)
    ranks.set(place.placePoolId, next)
  }
  return ranks
}

export function rankLabel(place: RankedPlace, ranks: ReadonlyMap<string, number>): string {
  const rank = ranks.get(place.placePoolId)
  if (!rank) throw new Error(`#4137: ${place.placePoolId} has no category rank`)
  return `#${rank} · ${place.categoryLabel}`
}

/** The rating line, or null when the place has no rating (the line is hidden). */
export function ratingLine(place: RatedPlace, locale: string): string | null {
  if (typeof place.rating !== 'number') return null
  if (typeof place.reviewCount === 'number') {
    return `${place.rating.toFixed(1)} · ${new Intl.NumberFormat(locale).format(place.reviewCount)} Google reviews`
  }
  return `${place.rating.toFixed(1)} on Google`
}

/** lucide-react icon name for the no-photo category tile. */
export const CATEGORY_TILE_ICON: Readonly<Record<ExplorerCategorySlug, string>> = {
  nature: 'Trees',
  drinks: 'Wine',
  brunch: 'Coffee',
  casual_food: 'Utensils',
  fine_dining: 'ChefHat',
  theatre: 'Drama',
  creative_arts: 'Palette',
  play: 'Gamepad2',
  icebreakers: 'MessagesSquare',
  movies: 'Clapperboard',
}
