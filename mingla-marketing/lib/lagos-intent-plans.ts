// ---------------------------------------------------------------
// Lagos Intent Plans — ORCH-0998 [marketing real place cards — DC test run]
//
// 6 themed multi-stop Mingla EXPERIENCES (one per intent), mirroring
// dc-intent-plans.ts. TEST DATA — no backend calls. Stop hero photos are the
// EXACT `stored_photo_urls[0]` from place_pool (Lagos city_id). Prices are NGN
// (₦), summed editorial ranges for this test run; duration is an editorial
// estimate — do NOT wire either to a backend.
//
// Same `IntentPlan` / `IntentStop` shape as dc-intent-plans.ts.
// ---------------------------------------------------------------

import type { IntentPlan, IntentStop } from '@/lib/dc-intent-plans'

const PHOTO_BASE =
  'https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-photos'

// Exact stored hero-photo URLs for every Lagos stop venue (verbatim from
// place_pool.stored_photo_urls[0]).
const PHOTO = {
  noir: `${PHOTO_BASE}/ChIJf37Oqy31OxAR9MFFkjaEvCE/0.jpg`,
  bayLounge: `${PHOTO_BASE}/ChIJWXCqRVv0OxARuk8b-Can8bU/0.jpg`,
  lekkiConservation: `${PHOTO_BASE}/ChIJnfWgLfn2OxARZjghHw4IIMA/0.jpg`,
  ericKayser: `${PHOTO_BASE}/ChIJVUftO7r1OxARUCfrp6T_0jc/0.jpg`,
  nikeGallery: `${PHOTO_BASE}/ChIJecHJJP_0OxARsqN_e4LH4rQ/0.jpg`,
  dreamPark: `${PHOTO_BASE}/ChIJ7f0vkunvOxARAErwKGQjeM0/0.jpg`,
  goldenEagles: `${PHOTO_BASE}/ChIJMyfY6hSSOxARhNuUJCD4LtU/0.jpg`,
  farmcity: `${PHOTO_BASE}/ChIJ4dejO_z0OxARubQD0vzbqiU/0.jpg`,
} as const

function stop(name: string, role: string, heroPhoto: string): IntentStop {
  return { name, role, heroPhoto }
}

export const LAGOS_INTENT_PLANS: readonly IntentPlan[] = [
  {
    id: 'romantic',
    intentTitle: 'A Romantic Evening',
    sellLine: 'French plates, a lounge nightcap, and easy island air.',
    itineraryLabel: 'Dinner → Drinks → Stroll',
    priceRange: '₦40,000–₦120,000 for two',
    duration: '≈ 3.5 hrs',
    stops: [
      stop('Noir Lagos', 'Dinner', PHOTO.noir),
      stop('Bay Lounge', 'Drinks', PHOTO.bayLounge),
      stop('Lekki Conservation Centre', 'Stroll', PHOTO.lekkiConservation),
    ],
  },
  {
    id: 'first-date',
    intentTitle: 'A Slow First Date',
    sellLine: 'Pastries, Nigerian art, and easy drinks to talk over.',
    itineraryLabel: 'Bites → Art → Drinks',
    priceRange: '₦20,000–₦80,000 for two',
    duration: '≈ 3 hrs',
    stops: [
      stop('Eric Kayser - Victoria Island', 'Bites', PHOTO.ericKayser),
      stop('Nike Art Gallery', 'Art', PHOTO.nikeGallery),
      stop('Bay Lounge', 'Drinks', PHOTO.bayLounge),
    ],
  },
  {
    id: 'adventurous',
    intentTitle: 'An Adventurous Day',
    sellLine: 'Theme-park thrills, a hearty feast, then a lounge wind-down.',
    itineraryLabel: 'Play → Eat → Drinks',
    priceRange: '₦30,000–₦90,000 for two',
    duration: '≈ 4 hrs',
    stops: [
      stop('Dream Park and Gardens', 'Play', PHOTO.dreamPark),
      stop('Golden Eagles Spur Nigeria', 'Eat', PHOTO.goldenEagles),
      stop('Bay Lounge', 'Drinks', PHOTO.bayLounge),
    ],
  },
  {
    id: 'group-fun',
    intentTitle: 'A Group Night Out',
    sellLine: 'A Lekki lounge dinner, park fun, then a Bay Lounge close.',
    itineraryLabel: 'Dinner → Play → Nightcap',
    priceRange: 'from ₦25,000 each',
    duration: '≈ 4 hrs',
    stops: [
      stop('Farmcity Lekki lounge', 'Dinner', PHOTO.farmcity),
      stop('Dream Park and Gardens', 'Play', PHOTO.dreamPark),
      stop('Bay Lounge', 'Nightcap', PHOTO.bayLounge),
    ],
  },
  {
    id: 'picnic-dates',
    intentTitle: 'A Park Afternoon',
    sellLine: 'Grab pastries, claim a bench, easy conservation-park light.',
    itineraryLabel: 'Grab → Picnic → Wander',
    priceRange: '₦10,000–₦40,000 for two',
    duration: '≈ 3 hrs',
    stops: [
      stop('Eric Kayser - Victoria Island', 'Grab', PHOTO.ericKayser),
      stop('Lekki Conservation Centre', 'Picnic', PHOTO.lekkiConservation),
      stop('Nike Art Gallery', 'Wander', PHOTO.nikeGallery),
    ],
  },
  {
    id: 'take-a-stroll',
    intentTitle: 'Take a Stroll',
    sellLine: 'A gallery wander, green park paths, a café to finish.',
    itineraryLabel: 'Art → Walk → Coffee',
    priceRange: 'Free–₦20,000 for two',
    duration: '≈ 3 hrs',
    stops: [
      stop('Nike Art Gallery', 'Art', PHOTO.nikeGallery),
      stop('Lekki Conservation Centre', 'Walk', PHOTO.lekkiConservation),
      stop('Eric Kayser - Victoria Island', 'Coffee', PHOTO.ericKayser),
    ],
  },
] as const
