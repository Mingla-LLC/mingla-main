// ---------------------------------------------------------------
// DC Showcase Places — ORCH-0998 [marketing real place cards — DC test run]
//
// Hardcoded snapshot of 5 real Washington-DC places used by the hero
// place deck. This is TEST DATA — no backend calls, no fetch, no edge
// function. Photos are public Supabase Storage URLs:
//   https://<project>.supabase.co/storage/v1/object/public/place-photos/<placeKey>/<0..4>.jpg
// Photo index 0 is the hero image; every place has 5 photos.
//
// If a future ORCH wires this deck to the live place pool, replace this
// array with a typed fetch — the consuming component only reads the
// ShowcasePlace shape below.
// ---------------------------------------------------------------

export interface ShowcasePlace {
  /** Display name — real, verbatim. */
  name: string
  /** Real category string (e.g. "Italian Restaurant"). Drives the sell-line fallback. */
  category: string
  /** Real Google rating (0–5). */
  rating: number
  /** Real review count. (Retained on the type; no longer rendered on the card post-v2.) */
  reviewCount: number
  /**
   * Real per-person price range (e.g. "$50–$100", en-dash U+2013), or null
   * when the place has no real price → the card renders "Free" (ORCH-0998 v2.4).
   */
  priceRange: string | null
  /** Editorial blurb, or null → category-derived fallback sell-line is used. */
  blurb: string | null
  /** Supabase Storage place-photos key. */
  placeKey: string
  /** Number of photos available (always 5 in this snapshot). No longer rendered post-v2. */
  nPhotos: number
  /**
   * Decorative social proof — "N locals recommend". NO real local-recommend
   * data exists; these are tasteful per-card values for the marketing test
   * run. Do NOT wire to a backend. (ORCH-0998 v2.6)
   */
  recommendCount: number
}

// Fixed character budget for every card description (ORCH-0998 v3.5). All
// blurbs below are authored to fit within DESCRIPTION_MAX_CHARS so the deck
// renders a uniform, compact 2-line description chip with equal spacing above
// and below. Future cards added to this deck MUST follow the same rule — keep
// each blurb ≤ DESCRIPTION_MAX_CHARS so the layout never drifts.
export const DESCRIPTION_MAX_CHARS = 72

const SUPABASE_PHOTO_BASE =
  'https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-photos'

/** Build the full public Storage URL for a given place photo index. */
export function placePhotoUrl(placeKey: string, index: number): string {
  return `${SUPABASE_PHOTO_BASE}/${placeKey}/${index}.jpg`
}

export const DC_SHOWCASE_PLACES: readonly ShowcasePlace[] = [
  {
    name: "L'Ardente",
    category: 'Italian Restaurant',
    rating: 4.5,
    reviewCount: 2141,
    priceRange: '$50–$100',
    // ≤ DESCRIPTION_MAX_CHARS (68) — authored for uniform card layout.
    blurb:
      'Chandeliers, a gold-plated pizza oven, and pasta worth the occasion.',
    placeKey: 'ChIJ-82JrXi3t4kRSAkfWH-6ToU',
    nPhotos: 5,
    recommendCount: 212,
  },
  {
    name: 'OKPB',
    category: 'Cocktail Bar',
    rating: 4.8,
    reviewCount: 269,
    priceRange: '$30–$50',
    // ≤ DESCRIPTION_MAX_CHARS (63) — authored for uniform card layout.
    blurb: 'Inventive cocktails in a low-lit room built for lingering late.',
    placeKey: 'ChIJuVcr4vHJt4kR3RGgn9ppyKM',
    nPhotos: 5,
    recommendCount: 48,
  },
  {
    name: "President Lincoln's Cottage",
    category: 'Historical Landmark',
    rating: 4.6,
    reviewCount: 800,
    // No real price signal → renders "Free" (warm) per v2.4.
    priceRange: null,
    // ≤ DESCRIPTION_MAX_CHARS (65) — authored for uniform card layout.
    blurb:
      "Lincoln's Civil War retreat, now a quietly moving hilltop museum.",
    placeKey: 'ChIJYXXbqgvIt4kRsTOXeP0bXTA',
    nPhotos: 5,
    recommendCount: 96,
  },
  {
    name: 'Anacostia Park',
    category: 'Park',
    rating: 4.4,
    reviewCount: 1778,
    // No real price signal → renders "Free" (warm) per v2.4.
    priceRange: null,
    // ≤ DESCRIPTION_MAX_CHARS (64) — authored for uniform card layout.
    blurb:
      'Riverside trails, picnic spots, and a skating rink by the water.',
    placeKey: 'ChIJCVOosVS4t4kRc5PLjLRnQU4',
    nPhotos: 5,
    recommendCount: 173,
  },
  {
    name: 'Del Ray Café',
    category: 'French Restaurant',
    rating: 4.6,
    reviewCount: 1786,
    priceRange: '$20–$30',
    // ≤ DESCRIPTION_MAX_CHARS (64) — authored for uniform card layout.
    blurb:
      'Farm-to-table French-American comfort in a cozy converted house.',
    placeKey: 'ChIJS1TgNB6xt4kRBA6GYja2FyY',
    nPhotos: 5,
    recommendCount: 184,
  },
] as const
