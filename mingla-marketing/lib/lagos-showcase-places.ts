// ---------------------------------------------------------------
// Lagos Showcase Places — ORCH-0998 [marketing real place cards — DC test run]
//
// Hardcoded snapshot of 10 real Lagos-NG places (one per Mingla category),
// mirroring dc-showcase-places.ts. TEST DATA — no backend calls, no fetch, no
// edge function. Photo URLs are the EXACT `stored_photo_urls[0]` pulled from
// `place_pool` (city_id 287cab01-4430-4930-983a-435aa194f33a) via the Supabase
// Management API at build time, so the extension is never guessed.
//
// CURRENCY: Lagos is NGN (₦). `price_range_*_cents` are minor units of NGN →
// divide by 100, with the ₦ symbol and thousands separators. "Free" ONLY for
// genuinely-free places (nature reserves, free galleries). Ticketed places with
// no price signal → null (name only; never fake "Free").
//
// Same `ShowcasePlace` shape as dc-showcase-places.ts. `coverImageUrl` carries
// the exact stored photo URL (preferred by the deck over the placeKey path).
// ---------------------------------------------------------------

import type { ShowcasePlace } from '@/lib/dc-showcase-places'

// The 10 top-of-category Lagos places. recommendCount values are DECORATIVE
// social proof (no real local-recommend data exists) — do NOT wire to a backend.
export const LAGOS_SHOWCASE_PLACES: readonly ShowcasePlace[] = [
  {
    // Mingla category: Nature & Views
    name: 'Lekki Conservation Centre',
    category: 'Nature preserve',
    pillLabel: 'nature places',
    pillIcon: 'Trees',
    rating: 4.3,
    reviewCount: 14381,
    // Nature reserve with free access → "Free" per the price-honesty rule.
    priceRange: 'Free',
    blurb: "Africa's longest canopy walkway over a wild Lagos reserve.",
    placeKey: 'ChIJnfWgLfn2OxARZjghHw4IIMA',
    coverImageUrl:
      'https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-photos/ChIJnfWgLfn2OxARZjghHw4IIMA/0.jpg',
    nPhotos: 5,
    recommendCount: 286,
  },
  {
    // Mingla category: Icebreakers
    name: 'Eric Kayser - Victoria Island',
    category: 'Bakery & café',
    pillLabel: 'icebreaker places',
    pillIcon: 'Sparkles',
    rating: 4.5,
    reviewCount: 4315,
    priceRange: '₦10,000–₦60,000',
    blurb: 'French pastries and easy plates on Victoria Island.',
    placeKey: 'ChIJVUftO7r1OxARUCfrp6T_0jc',
    coverImageUrl:
      'https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-photos/ChIJVUftO7r1OxARUCfrp6T_0jc/0.jpg',
    nPhotos: 5,
    recommendCount: 197,
  },
  {
    // Mingla category: Drinks & Music
    name: 'Bay Lounge',
    category: 'Lounge',
    pillLabel: 'drinks places',
    pillIcon: 'Martini',
    rating: 4.3,
    reviewCount: 5120,
    priceRange: '₦20,000–₦70,000',
    blurb: 'Island lounge built for late drinks and a slow set.',
    placeKey: 'ChIJWXCqRVv0OxARuk8b-Can8bU',
    coverImageUrl:
      'https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-photos/ChIJWXCqRVv0OxARuk8b-Can8bU/0.jpg',
    nPhotos: 5,
    recommendCount: 231,
  },
  {
    // Mingla category: Brunch
    name: 'Farmcity Lekki lounge',
    category: 'Lounge restaurant',
    pillLabel: 'brunch places',
    pillIcon: 'Coffee',
    rating: 4.2,
    reviewCount: 10130,
    priceRange: '₦10,000–₦60,000',
    blurb: 'A big Lekki lounge for long brunches and bigger tables.',
    placeKey: 'ChIJ4dejO_z0OxARubQD0vzbqiU',
    coverImageUrl:
      'https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-photos/ChIJ4dejO_z0OxARubQD0vzbqiU/0.jpg',
    nPhotos: 5,
    recommendCount: 312,
  },
  {
    // Mingla category: Casual
    name: 'Golden Eagles Spur Nigeria',
    category: 'Family restaurant',
    pillLabel: 'casual places',
    pillIcon: 'UtensilsCrossed',
    rating: 4.3,
    reviewCount: 2806,
    priceRange: '₦10,000–₦20,000',
    blurb: 'Hearty grills and a easy family table, Spur-style.',
    placeKey: 'ChIJMyfY6hSSOxARhNuUJCD4LtU',
    coverImageUrl:
      'https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-photos/ChIJMyfY6hSSOxARhNuUJCD4LtU/0.jpg',
    nPhotos: 5,
    recommendCount: 158,
  },
  {
    // Mingla category: Upscale & Fine Dining
    name: 'Noir Lagos',
    category: 'French restaurant',
    pillLabel: 'fine dining places',
    pillIcon: 'ChefHat',
    rating: 4.4,
    reviewCount: 792,
    priceRange: 'from ₦20,000',
    blurb: 'Refined French plates and a dim, dressed-up Lagos room.',
    placeKey: 'ChIJf37Oqy31OxAR9MFFkjaEvCE',
    coverImageUrl:
      'https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-photos/ChIJf37Oqy31OxAR9MFFkjaEvCE/0.jpg',
    nPhotos: 5,
    recommendCount: 84,
  },
  {
    // Mingla category: Movies
    name: 'Genesis Deluxe Cinemas Maryland',
    category: 'Movie theater',
    pillLabel: 'movie dates',
    pillIcon: 'Film',
    rating: 4.2,
    reviewCount: 7350,
    // Ticketed but no real price signal → null (name only; never fake "Free").
    priceRange: null,
    blurb: 'New releases and big screens in the heart of Maryland.',
    placeKey: 'ChIJG-WGxxWTOxARA_10DP8tN4E',
    coverImageUrl:
      'https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-photos/ChIJG-WGxxWTOxARA_10DP8tN4E/0.jpg',
    nPhotos: 5,
    recommendCount: 121,
  },
  {
    // Mingla category: Theatre
    name: 'The Canyon Lekki Halls & Event Centre',
    category: 'Event venue',
    pillLabel: 'theatre shows',
    pillIcon: 'Drama',
    rating: 4.3,
    reviewCount: 118,
    // Ticketed but no real price signal → null (never fake "Free").
    priceRange: null,
    blurb: 'A Lekki event hall set up for shows and big nights.',
    placeKey: 'ChIJz72BGjX1OxARtPYos1wBSkc',
    coverImageUrl:
      'https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-photos/ChIJz72BGjX1OxARtPYos1wBSkc/0.jpg',
    nPhotos: 5,
    recommendCount: 64,
  },
  {
    // Mingla category: Creative & Arts
    name: 'Nike Art Gallery',
    category: 'Art gallery',
    pillLabel: 'artsy places',
    pillIcon: 'Palette',
    rating: 4.7,
    reviewCount: 7437,
    // Free-admission gallery → genuinely "Free".
    priceRange: 'Free',
    blurb: "Nike Okundaye's floors of Nigerian art, old and brand new.",
    placeKey: 'ChIJecHJJP_0OxARsqN_e4LH4rQ',
    coverImageUrl:
      'https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-photos/ChIJecHJJP_0OxARsqN_e4LH4rQ/0.jpg',
    nPhotos: 5,
    recommendCount: 274,
  },
  {
    // Mingla category: Play
    name: 'Dream Park and Gardens',
    category: 'Amusement park',
    pillLabel: 'play dates',
    pillIcon: 'Gamepad2',
    rating: 4.2,
    reviewCount: 816,
    // Ticketed but no real price signal → null (never fake "Free").
    priceRange: null,
    blurb: 'A theme park and gardens made for a full day out.',
    placeKey: 'ChIJ7f0vkunvOxARAErwKGQjeM0',
    coverImageUrl:
      'https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-photos/ChIJ7f0vkunvOxARAErwKGQjeM0/0.jpg',
    nPhotos: 5,
    recommendCount: 71,
  },
] as const
