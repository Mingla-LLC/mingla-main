// ---------------------------------------------------------------
// DC Showcase Places — ORCH-0998 [marketing real place cards — DC test run]
//
// Hardcoded snapshot of 10 real Washington-DC places (top-scored servable
// place per category, from place_scores) used by the interleaved hero deck.
// This is TEST DATA — no backend calls, no fetch, no edge function. Photos
// are public Supabase Storage URLs:
//   https://<project>.supabase.co/storage/v1/object/public/place-photos/<placeKey>/<0..4>.jpg
// Photo index 0 is the hero image; every place has 5 photos.
//
// If a future ORCH wires this deck to the live place pool, replace this
// array with a typed fetch — the consuming component only reads the
// ShowcasePlace shape below.
// ---------------------------------------------------------------

/**
 * Headline-pill label + icon (ORCH-0998 hero-pill sync). Each card carries the
 * exact word phrase shown in "Find <pillLabel> that fit the vibe" plus the
 * lucide icon name rendered in the pill's warm chip while this card is front.
 * `pillIcon` is the lucide icon NAME (resolved to the component in the deck) so
 * this data file stays icon-library-free.
 */
export type PlacePillIcon =
  | 'Trees'
  | 'Sparkles'
  | 'Martini'
  | 'Coffee'
  | 'UtensilsCrossed'
  | 'ChefHat'
  | 'Film'
  | 'Drama'
  | 'Palette'
  | 'Gamepad2'

export interface ShowcasePlace {
  /** Display name — real, verbatim. */
  name: string
  /** Real category string (e.g. "Italian Restaurant"). Drives the sell-line fallback. */
  category: string
  /** Headline-pill word for "Find <pillLabel> that fit the vibe" (Mingla-category derived). */
  pillLabel: string
  /** Lucide icon NAME for the pill warm chip (resolved to a component in the deck). */
  pillIcon: PlacePillIcon
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
  /**
   * Exact hero photo URL (verbatim `stored_photo_urls[0]` from place_pool),
   * used by newer per-city snapshots (Raleigh, Lagos) where the photo extension
   * (.jpg / .png) must NOT be guessed. When present the deck renders this URL
   * directly; when omitted (the original DC snapshot) the deck falls back to
   * `placePhotoUrl(placeKey, 0)`. Optional so the DC shape is unchanged.
   */
  coverImageUrl?: string
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

// The 10 top-scored servable DC places, ONE PER MINGLA CATEGORY (from
// place_scores). `category` holds the real Google place type; the Mingla
// category each place leads for is noted in the comment above each entry.
// recommendCount values are DECORATIVE social proof (no real local-recommend
// data exists) — do NOT wire to a backend.
export const DC_SHOWCASE_PLACES: readonly ShowcasePlace[] = [
  {
    // Mingla category: Nature & Views
    name: 'Anacostia Park',
    category: 'Park',
    pillLabel: 'nature places',
    pillIcon: 'Trees',
    rating: 4.4,
    reviewCount: 1778,
    // Genuinely free (public park) → "Free" per the price-honesty rule.
    priceRange: 'Free',
    blurb: 'Riverside trails, picnic spots, and a skating rink by the water.',
    placeKey: 'ChIJCVOosVS4t4kRc5PLjLRnQU4',
    nPhotos: 5,
    recommendCount: 173,
  },
  {
    // Mingla category: Icebreakers
    name: 'National Gallery of Art',
    category: 'Art Museum',
    pillLabel: 'icebreaker places',
    pillIcon: 'Sparkles',
    rating: 4.8,
    reviewCount: 20211,
    // Free-admission museum → genuinely "Free".
    priceRange: 'Free',
    blurb: 'Two grand halls of masterpieces and a sculpture garden to roam.',
    placeKey: 'ChIJSYxSO5u3t4kRm4eyKw_Y7Kg',
    nPhotos: 5,
    recommendCount: 264,
  },
  {
    // Mingla category: Drinks & Music
    name: 'Jack Rose Dining Saloon',
    category: 'Cocktail Bar',
    pillLabel: 'drinks places',
    pillIcon: 'Martini',
    rating: 4.6,
    reviewCount: 2411,
    priceRange: '$50–$100',
    blurb: 'Hundreds of whiskeys and an open-air terrace built for nights.',
    placeKey: 'ChIJK7e4Ldu3t4kRUg8DvM7SaSQ',
    nPhotos: 5,
    recommendCount: 142,
  },
  {
    // Mingla category: Brunch
    name: 'Pisco y Nazca Ceviche Gastrobar',
    category: 'Peruvian',
    pillLabel: 'brunch places',
    pillIcon: 'Coffee',
    rating: 4.9,
    reviewCount: 25092,
    priceRange: '$30–$80',
    blurb: 'Ceviche, pisco sours, and a buzzing South American table.',
    placeKey: 'ChIJDc1TJ5q3t4kRQX8x6Pj4IlA',
    nPhotos: 5,
    recommendCount: 318,
  },
  {
    // Mingla category: Casual
    name: 'Oyamel',
    category: 'Mexican',
    pillLabel: 'casual places',
    pillIcon: 'UtensilsCrossed',
    rating: 4.5,
    reviewCount: 7642,
    priceRange: '$20–$70',
    blurb: 'Creative Mexican small plates and a cocktail list to linger over.',
    placeKey: 'ChIJvfdr_Y-3t4kRN-8elI5NN6g',
    nPhotos: 5,
    recommendCount: 197,
  },
  {
    // Mingla category: Upscale & Fine Dining
    name: 'KYOJIN Sushi',
    category: 'Sushi',
    pillLabel: 'fine dining places',
    pillIcon: 'ChefHat',
    rating: 4.9,
    reviewCount: 7104,
    priceRange: 'from $100',
    blurb: 'Precise omakase sushi worth the splurge and the slow savoring.',
    placeKey: 'ChIJf57htim3t4kRAMbxTZCtjao',
    nPhotos: 5,
    recommendCount: 88,
  },
  {
    // Mingla category: Movies
    name: 'Regal Hyattsville Royale',
    category: 'Movie Theater',
    pillLabel: 'movie dates',
    pillIcon: 'Film',
    rating: 4.1,
    reviewCount: 1829,
    // Ticketed but no real price signal → null (card shows name only; never fake "Free").
    priceRange: null,
    blurb: "Big screens, plush recliners, and the night's blockbuster.",
    placeKey: 'ChIJm9E-V-XGt4kRhqYQELLGxts',
    nPhotos: 5,
    recommendCount: 121,
  },
  {
    // Mingla category: Theatre
    name: 'Kennedy Center',
    category: 'Performing Arts Theater',
    pillLabel: 'theatre shows',
    pillIcon: 'Drama',
    rating: 4.8,
    reviewCount: 11449,
    // Ticketed but no real price signal → null (never fake "Free").
    priceRange: null,
    blurb: "Plays, music, and dance across the river's grandest stage.",
    placeKey: 'ChIJOQirI623t4kRnVgHeeTpCrc',
    nPhotos: 5,
    recommendCount: 231,
  },
  {
    // Mingla category: Creative & Arts
    name: 'National Museum of African American History & Culture',
    category: 'Museum',
    pillLabel: 'artsy places',
    pillIcon: 'Palette',
    rating: 4.8,
    reviewCount: 30458,
    // Free-admission Smithsonian museum → genuinely "Free".
    priceRange: 'Free',
    blurb: "The Smithsonian's moving journey through Black history and culture.",
    placeKey: 'ChIJF4Mpspi3t4kRBi9jWNebAZg',
    nPhotos: 5,
    recommendCount: 402,
  },
  {
    // Mingla category: Play
    name: 'The Great Escape Room DC',
    category: 'Amusement Center',
    pillLabel: 'play dates',
    pillIcon: 'Gamepad2',
    rating: 4.9,
    reviewCount: 875,
    // Ticketed but no real price signal → null (never fake "Free").
    priceRange: null,
    blurb: 'Lock-in puzzle rooms made for teams that love a countdown.',
    placeKey: 'ChIJY2-6cTW3t4kRUvxabWiY3xA',
    nPhotos: 5,
    recommendCount: 64,
  },
] as const
