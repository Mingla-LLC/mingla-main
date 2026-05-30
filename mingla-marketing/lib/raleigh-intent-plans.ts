// ---------------------------------------------------------------
// Raleigh Intent Plans — ORCH-1007 [marketing real place cards — DC test run]
//
// 6 themed multi-stop Mingla EXPERIENCES (one per intent), mirroring
// dc-intent-plans.ts. TEST DATA — no backend calls. Stop hero photos are the
// EXACT `stored_photo_urls[0]` pulled from place_pool (Raleigh city_id) so the
// extension is never guessed. Prices are USD ($), summed editorial ranges for
// this test run (set by the operator); duration is an editorial estimate — do
// NOT wire either to a backend.
//
// Same `IntentPlan` / `IntentStop` shape as dc-intent-plans.ts.
// ---------------------------------------------------------------

import type { IntentPlan, IntentStop } from '@/lib/dc-intent-plans'

const PHOTO_BASE =
  'https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-photos'

// Exact stored hero-photo URLs for every Raleigh stop venue (verbatim from
// place_pool.stored_photo_urls[0]; note Royal India's is a .png).
const PHOTO = {
  angusBarn: `${PHOTO_BASE}/ChIJi3GT76TwrIkRy5mbzxyd-UE/0.jpg`,
  beerGarden: `${PHOTO_BASE}/ChIJAZyy6mdfrIkRsHSZYRGu7XA/0.jpg`,
  umstead: `${PHOTO_BASE}/ChIJL7C1g7TwrIkRj8ymStBSWYI/0.jpg`,
  bigEds: `${PHOTO_BASE}/ChIJawqNdP9YrIkRGdQ9Y2yGK88/0.jpg`,
  ncMuseum: `${PHOTO_BASE}/ChIJa2hvU9P1rIkRQaI7E_xzG4Q/0.jpg`,
  defy: `${PHOTO_BASE}/ChIJA9mqGaNZrIkRd-sTRwe1YI0/0.jpg`,
  thePit: `${PHOTO_BASE}/ChIJndbEYnBfrIkRfYFK6qIyHZo/0.jpg`,
  royalIndia: `${PHOTO_BASE}/ChIJ92NPhm1ZrIkRhAKkNZh59X0/0.png`,
} as const

function stop(name: string, role: string, heroPhoto: string): IntentStop {
  return { name, role, heroPhoto }
}

export const RALEIGH_INTENT_PLANS: readonly IntentPlan[] = [
  {
    id: 'romantic',
    intentTitle: 'A Romantic Evening',
    sellLine: 'Steakhouse glamour, 350 beers, and a walk in the pines.',
    itineraryLabel: 'Dinner → Drinks → Stroll',
    priceRange: '$80–$140 for two',
    duration: '≈ 3.5 hrs',
    stops: [
      stop('Angus Barn', 'Dinner', PHOTO.angusBarn),
      stop('Raleigh Beer Garden', 'Drinks', PHOTO.beerGarden),
      stop('William B. Umstead State Park', 'Stroll', PHOTO.umstead),
    ],
  },
  {
    id: 'first-date',
    intentTitle: 'A Slow First Date',
    sellLine: 'Southern breakfast, an art wander, easy drinks to follow.',
    itineraryLabel: 'Brunch → Art → Drinks',
    priceRange: '$30–$60 for two',
    duration: '≈ 3 hrs',
    stops: [
      stop("Big Ed's City Market Restaurant", 'Brunch', PHOTO.bigEds),
      stop('North Carolina Museum of Art', 'Art', PHOTO.ncMuseum),
      stop('Raleigh Beer Garden', 'Drinks', PHOTO.beerGarden),
    ],
  },
  {
    id: 'adventurous',
    intentTitle: 'An Adventurous Day',
    sellLine: 'Trampoline chaos, smoked BBQ, then a beer-garden cooldown.',
    itineraryLabel: 'Jump → BBQ → Drinks',
    priceRange: '$50–$90 for two',
    duration: '≈ 4 hrs',
    stops: [
      stop('DEFY Raleigh', 'Jump', PHOTO.defy),
      stop('The Pit Authentic Barbecue', 'BBQ', PHOTO.thePit),
      stop('Raleigh Beer Garden', 'Drinks', PHOTO.beerGarden),
    ],
  },
  {
    id: 'group-fun',
    intentTitle: 'A Group Night Out',
    sellLine: 'Heaping BBQ, a team jump session, 350 beers to close.',
    itineraryLabel: 'Dinner → Play → Nightcap',
    priceRange: 'from $40 each',
    duration: '≈ 4 hrs',
    stops: [
      stop('The Pit Authentic Barbecue', 'Dinner', PHOTO.thePit),
      stop('DEFY Raleigh', 'Play', PHOTO.defy),
      stop('Raleigh Beer Garden', 'Nightcap', PHOTO.beerGarden),
    ],
  },
  {
    id: 'picnic-dates',
    intentTitle: 'A Picnic in the Pines',
    sellLine: 'Pack a feast, find the pines, slow afternoon by the lake.',
    itineraryLabel: 'Grab → Picnic → Wander',
    priceRange: '$20–$40 for two',
    duration: '≈ 3 hrs',
    stops: [
      stop('Royal India', 'Grab', PHOTO.royalIndia),
      stop('William B. Umstead State Park', 'Picnic', PHOTO.umstead),
      stop('North Carolina Museum of Art', 'Wander', PHOTO.ncMuseum),
    ],
  },
  {
    id: 'take-a-stroll',
    intentTitle: 'Take a Stroll',
    sellLine: 'Museum halls, a forest trail, and a Southern plate to end.',
    itineraryLabel: 'Art → Walk → Bite',
    priceRange: 'Free–$20 for two',
    duration: '≈ 3 hrs',
    stops: [
      stop('North Carolina Museum of Art', 'Art', PHOTO.ncMuseum),
      stop('William B. Umstead State Park', 'Walk', PHOTO.umstead),
      stop("Big Ed's City Market Restaurant", 'Bite', PHOTO.bigEds),
    ],
  },
] as const
