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
  /** Real review count. */
  reviewCount: number
  /** Price tier ("$$", "$$$") or null when the place has no price signal. */
  priceTier: string | null
  /** Editorial blurb, or null → category-derived fallback sell-line is used. */
  blurb: string | null
  /** Supabase Storage place-photos key. */
  placeKey: string
  /** Number of photos available (always 5 in this snapshot). */
  nPhotos: number
}

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
    priceTier: '$$$',
    blurb:
      'Elegant Italian restaurant with chandeliers and a gold-plated pizza oven firing signature pies.',
    placeKey: 'ChIJ-82JrXi3t4kRSAkfWH-6ToU',
    nPhotos: 5,
  },
  {
    name: 'OKPB',
    category: 'Cocktail Bar',
    rating: 4.8,
    reviewCount: 269,
    priceTier: null,
    blurb: null,
    placeKey: 'ChIJuVcr4vHJt4kR3RGgn9ppyKM',
    nPhotos: 5,
  },
  {
    name: "President Lincoln's Cottage",
    category: 'Historical Landmark',
    rating: 4.6,
    reviewCount: 800,
    priceTier: null,
    blurb:
      "Lincoln's home during the height of the Civil War, the Gothic-Revival cottage is now a museum.",
    placeKey: 'ChIJYXXbqgvIt4kRsTOXeP0bXTA',
    nPhotos: 5,
  },
  {
    name: 'Anacostia Park',
    category: 'Park',
    rating: 4.4,
    reviewCount: 1778,
    priceTier: null,
    blurb:
      'Waterside park offering trails, a roller-skating rink, picnic sites, golf, fishing & sports areas.',
    placeKey: 'ChIJCVOosVS4t4kRc5PLjLRnQU4',
    nPhotos: 5,
  },
  {
    name: 'Del Ray Café',
    category: 'French Restaurant',
    rating: 4.6,
    reviewCount: 1786,
    priceTier: '$$',
    blurb:
      'Farm-to-table French-American cuisine served from morning to night in a quaint, converted house.',
    placeKey: 'ChIJS1TgNB6xt4kRBA6GYja2FyY',
    nPhotos: 5,
  },
] as const
