// ---------------------------------------------------------------
// Raleigh Showcase Places — ORCH-0998 [marketing real place cards — DC test run]
//
// Hardcoded snapshot of 10 real Raleigh-NC places (one per Mingla category),
// mirroring dc-showcase-places.ts. TEST DATA — no backend calls, no fetch, no
// edge function. Photo URLs are the EXACT `stored_photo_urls[0]` pulled from
// `place_pool` (city_id 0ccfcf20-21a9-4d7b-805d-cbe629dcfd2b) via the Supabase
// Management API at build time, so the extension (.jpg / .png) is never guessed
// — note Royal India's hero is a `.png`.
//
// CURRENCY: Raleigh is USD ($). `price_range_*_cents` are minor units of USD →
// divide by 100. "Free" ONLY for genuinely-free places (parks, free-admission
// museums). Ticketed places with no price signal → null (name only).
//
// Same `ShowcasePlace` shape as dc-showcase-places.ts. `coverImageUrl` carries
// the exact stored photo URL (preferred by the deck over the placeKey-built
// path); `placeKey` stays the Google place_id for parity with the DC shape.
// ---------------------------------------------------------------

import type { ShowcasePlace } from '@/lib/dc-showcase-places'

// The 10 top-of-category Raleigh places. recommendCount values are DECORATIVE
// social proof (no real local-recommend data exists) — do NOT wire to a backend.
export const RALEIGH_SHOWCASE_PLACES: readonly ShowcasePlace[] = [
  {
    // Mingla category: Nature & Views
    name: 'William B. Umstead State Park',
    category: 'State park',
    pillLabel: 'nature places',
    pillIcon: 'Trees',
    rating: 4.8,
    reviewCount: 2524,
    // Genuinely free (public state park) → "Free" per the price-honesty rule.
    priceRange: 'Free',
    blurb: 'Woodland trails, fishing lakes, and quiet acres minutes from town.',
    placeKey: 'ChIJL7C1g7TwrIkRj8ymStBSWYI',
    coverImageUrl:
      'https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-photos/ChIJL7C1g7TwrIkRj8ymStBSWYI/0.jpg',
    nPhotos: 5,
    recommendCount: 168,
  },
  {
    // Mingla category: Icebreakers
    name: "Big Ed's City Market Restaurant",
    category: 'American restaurant',
    pillLabel: 'icebreaker places',
    pillIcon: 'Sparkles',
    rating: 4.6,
    reviewCount: 3048,
    priceRange: '$10–$20',
    blurb: 'Southern breakfast plates under a ceiling of funky old antiques.',
    placeKey: 'ChIJawqNdP9YrIkRGdQ9Y2yGK88',
    coverImageUrl:
      'https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-photos/ChIJawqNdP9YrIkRGdQ9Y2yGK88/0.jpg',
    nPhotos: 5,
    recommendCount: 211,
  },
  {
    // Mingla category: Drinks & Music
    name: 'Raleigh Beer Garden',
    category: 'Beer garden',
    pillLabel: 'drinks places',
    pillIcon: 'Martini',
    rating: 4.4,
    reviewCount: 5344,
    priceRange: '$20–$30',
    blurb: '350+ beers on tap across two floors and a wide-open patio.',
    placeKey: 'ChIJAZyy6mdfrIkRsHSZYRGu7XA',
    coverImageUrl:
      'https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-photos/ChIJAZyy6mdfrIkRsHSZYRGu7XA/0.jpg',
    nPhotos: 5,
    recommendCount: 247,
  },
  {
    // Mingla category: Brunch
    name: 'The Pit Authentic Barbecue',
    category: 'Barbecue restaurant',
    pillLabel: 'brunch places',
    pillIcon: 'Coffee',
    rating: 4.3,
    reviewCount: 8419,
    priceRange: '$20–$30',
    blurb: 'Pit-smoked pork and proper Carolina sides, bar and terrace too.',
    placeKey: 'ChIJndbEYnBfrIkRfYFK6qIyHZo',
    coverImageUrl:
      'https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-photos/ChIJndbEYnBfrIkRfYFK6qIyHZo/0.jpg',
    nPhotos: 5,
    recommendCount: 302,
  },
  {
    // Mingla category: Casual
    name: 'Royal India',
    category: 'Indian restaurant',
    pillLabel: 'casual places',
    pillIcon: 'UtensilsCrossed',
    rating: 4.8,
    reviewCount: 6125,
    priceRange: '$20–$30',
    blurb: 'North Indian classics from an old-world favorite since 1990.',
    placeKey: 'ChIJ92NPhm1ZrIkRhAKkNZh59X0',
    // NOTE: this place's hero is a .png (not .jpg) — verified from stored_photo_urls.
    coverImageUrl:
      'https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-photos/ChIJ92NPhm1ZrIkRhAKkNZh59X0/0.png',
    nPhotos: 5,
    recommendCount: 184,
  },
  {
    // Mingla category: Upscale & Fine Dining
    name: 'Angus Barn',
    category: 'Steak house',
    pillLabel: 'fine dining places',
    pillIcon: 'ChefHat',
    rating: 4.6,
    reviewCount: 10171,
    priceRange: '$50–$100',
    blurb: 'Barn-glam steakhouse with an opulent wine cellar and cigar bar.',
    placeKey: 'ChIJi3GT76TwrIkRy5mbzxyd-UE',
    coverImageUrl:
      'https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-photos/ChIJi3GT76TwrIkRy5mbzxyd-UE/0.jpg',
    nPhotos: 5,
    recommendCount: 96,
  },
  {
    // Mingla category: Movies
    name: 'Regal Brier Creek',
    category: 'Movie theater',
    pillLabel: 'movie dates',
    pillIcon: 'Film',
    rating: 4.2,
    reviewCount: 3187,
    // Ticketed but no real price signal → null (name only; never fake "Free").
    priceRange: null,
    blurb: 'New releases, plush seating, and the full concession spread.',
    placeKey: 'ChIJVyYIe4TwrIkRA0ZleLVlb9c',
    coverImageUrl:
      'https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-photos/ChIJVyYIe4TwrIkRA0ZleLVlb9c/0.jpg',
    nPhotos: 5,
    recommendCount: 118,
  },
  {
    // Mingla category: Theatre
    name: 'Meymandi Concert Hall',
    category: 'Concert hall',
    pillLabel: 'theatre shows',
    pillIcon: 'Drama',
    rating: 4.8,
    reviewCount: 1436,
    // Ticketed but no real price signal → null (never fake "Free").
    priceRange: null,
    blurb: 'Home of the NC Symphony, 1,700 seats for music from everywhere.',
    placeKey: 'ChIJY101yZBYrIkR2-AEFcGAyv8',
    coverImageUrl:
      'https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-photos/ChIJY101yZBYrIkR2-AEFcGAyv8/0.jpg',
    nPhotos: 5,
    recommendCount: 142,
  },
  {
    // Mingla category: Creative & Arts
    name: 'North Carolina Museum of Art',
    category: 'Art museum',
    pillLabel: 'artsy places',
    pillIcon: 'Palette',
    rating: 4.8,
    reviewCount: 11177,
    // Free general-admission museum → genuinely "Free".
    priceRange: 'Free',
    blurb: '5,000 years of art, plus an outdoor park and amphitheater.',
    placeKey: 'ChIJa2hvU9P1rIkRQaI7E_xzG4Q',
    coverImageUrl:
      'https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-photos/ChIJa2hvU9P1rIkRQaI7E_xzG4Q/0.jpg',
    nPhotos: 5,
    recommendCount: 268,
  },
  {
    // Mingla category: Play
    name: 'DEFY Raleigh',
    category: 'Amusement park',
    pillLabel: 'play dates',
    pillIcon: 'Gamepad2',
    rating: 4.5,
    reviewCount: 2127,
    // Ticketed but no real price signal → null (never fake "Free").
    priceRange: null,
    blurb: 'Warehouse trampoline park built for open jumps and big groups.',
    placeKey: 'ChIJA9mqGaNZrIkRd-sTRwe1YI0',
    coverImageUrl:
      'https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-photos/ChIJA9mqGaNZrIkRd-sTRwe1YI0/0.jpg',
    nPhotos: 5,
    recommendCount: 73,
  },
] as const
