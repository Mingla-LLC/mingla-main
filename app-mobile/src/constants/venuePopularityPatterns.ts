/**
 * Venue Popularity Patterns — Proprietary Heuristic Engine
 *
 * Static popularity curves (0-100 per hour) for each Mingla category.
 * Two variants per category: weekday and weekend.
 * Replaces BestTime API — $0/month, scales infinitely.
 *
 * Lookup key: card.category (Mingla slug, e.g. 'casual_eats').
 * Fallback: stop.placeType (Google primary_type) for curated stops.
 *
 * ORCH-0419 — 2026-04-13
 */

export type VenueCategory =
  | 'casual_eats'
  | 'fine_dining'
  | 'drink'
  | 'first_meet'
  | 'nature'
  | 'picnic_park'
  | 'watch'
  | 'live_performance'
  | 'creative_arts'
  | 'play'
  | 'wellness'
  | 'flowers'
  | 'default';

export interface PopularityCurve {
  weekday: number[]; // 24 values, index 0 = midnight, index 23 = 11 PM
  weekend: number[]; // 24 values, same structure
}

// ─── Popularity Curves ──────────────────────────────────────────────────────
// Each array: 24 numbers (hours 0-23), values 0-100.

export const VENUE_POPULARITY: Record<VenueCategory, PopularityCurve> = {
  casual_eats: {
    weekday: [5, 3, 3, 3, 3, 5, 10, 25, 35, 30, 35, 50, 70, 65, 35, 30, 35, 50, 65, 70, 55, 35, 20, 10],
    weekend: [5, 3, 3, 3, 3, 3, 5, 10, 25, 45, 65, 75, 70, 60, 40, 35, 40, 55, 70, 80, 75, 55, 30, 15],
  },
  fine_dining: {
    weekday: [5, 3, 3, 3, 3, 3, 5, 5, 5, 5, 10, 25, 45, 40, 15, 10, 15, 35, 65, 80, 75, 55, 30, 15],
    weekend: [5, 3, 3, 3, 3, 3, 5, 5, 5, 10, 20, 40, 55, 50, 20, 15, 20, 45, 75, 85, 80, 65, 40, 20],
  },
  drink: {
    weekday: [10, 5, 3, 3, 3, 3, 3, 3, 3, 5, 5, 10, 15, 15, 10, 15, 25, 40, 55, 65, 75, 80, 70, 45],
    weekend: [15, 10, 5, 3, 3, 3, 3, 3, 3, 5, 10, 15, 20, 25, 25, 30, 35, 50, 65, 75, 85, 90, 85, 60],
  },
  first_meet: {
    weekday: [3, 3, 3, 3, 3, 5, 20, 55, 75, 65, 50, 45, 60, 55, 45, 40, 35, 25, 15, 10, 5, 3, 3, 3],
    weekend: [3, 3, 3, 3, 3, 3, 5, 15, 35, 55, 70, 65, 55, 45, 35, 30, 25, 20, 15, 10, 5, 3, 3, 3],
  },
  nature: {
    weekday: [3, 3, 3, 3, 3, 5, 15, 30, 40, 45, 50, 50, 45, 40, 40, 45, 50, 45, 35, 20, 10, 5, 3, 3],
    weekend: [3, 3, 3, 3, 3, 5, 15, 30, 45, 55, 65, 70, 70, 65, 55, 50, 50, 45, 35, 25, 15, 5, 3, 3],
  },
  picnic_park: {
    weekday: [3, 3, 3, 3, 3, 5, 10, 15, 25, 30, 40, 50, 55, 50, 40, 40, 50, 55, 50, 35, 20, 10, 5, 3],
    weekend: [3, 3, 3, 3, 3, 3, 5, 15, 30, 45, 60, 70, 70, 65, 55, 50, 55, 60, 50, 35, 20, 10, 5, 3],
  },
  watch: {
    weekday: [3, 3, 3, 3, 3, 3, 3, 3, 5, 10, 15, 20, 30, 35, 25, 20, 25, 35, 50, 65, 70, 65, 45, 20],
    weekend: [3, 3, 3, 3, 3, 3, 3, 5, 10, 15, 25, 35, 45, 55, 55, 50, 50, 55, 65, 75, 80, 75, 55, 25],
  },
  live_performance: {
    weekday: [5, 3, 3, 3, 3, 3, 3, 3, 5, 5, 10, 15, 15, 15, 15, 15, 20, 30, 50, 70, 80, 75, 50, 20],
    weekend: [5, 3, 3, 3, 3, 3, 3, 3, 5, 10, 15, 20, 25, 30, 30, 30, 35, 45, 60, 75, 85, 85, 65, 30],
  },
  creative_arts: {
    weekday: [3, 3, 3, 3, 3, 3, 5, 5, 10, 20, 40, 55, 60, 65, 60, 55, 45, 30, 15, 10, 5, 3, 3, 3],
    weekend: [3, 3, 3, 3, 3, 3, 5, 5, 15, 30, 50, 65, 70, 75, 70, 60, 50, 35, 20, 10, 5, 3, 3, 3],
  },
  play: {
    weekday: [3, 3, 3, 3, 3, 3, 3, 5, 10, 15, 25, 30, 35, 35, 30, 30, 35, 45, 55, 65, 60, 45, 25, 10],
    weekend: [3, 3, 3, 3, 3, 3, 3, 5, 10, 20, 35, 50, 60, 65, 65, 60, 55, 55, 65, 70, 70, 55, 35, 15],
  },
  wellness: {
    weekday: [3, 3, 3, 3, 3, 5, 10, 15, 25, 40, 55, 60, 55, 45, 35, 30, 30, 25, 15, 10, 5, 3, 3, 3],
    weekend: [3, 3, 3, 3, 3, 3, 5, 10, 20, 40, 55, 65, 65, 60, 50, 40, 35, 25, 15, 10, 5, 3, 3, 3],
  },
  flowers: {
    weekday: [3, 3, 3, 3, 3, 5, 10, 20, 35, 45, 50, 50, 45, 40, 35, 30, 25, 20, 15, 10, 5, 3, 3, 3],
    weekend: [3, 3, 3, 3, 3, 3, 5, 15, 25, 40, 55, 60, 55, 50, 40, 35, 30, 20, 10, 5, 3, 3, 3, 3],
  },
  default: {
    weekday: [5, 3, 3, 3, 3, 5, 10, 20, 30, 35, 40, 50, 55, 50, 40, 35, 40, 50, 55, 50, 40, 25, 15, 8],
    weekend: [5, 3, 3, 3, 3, 3, 5, 15, 25, 40, 50, 60, 65, 60, 50, 45, 45, 55, 60, 60, 50, 35, 20, 10],
  },
};

// ─── Category Slug → Venue Category ─────────────────────────────────────────
// Keys are Mingla category slugs (from card.category) and curated experience type slugs.
// Verified against app-mobile/src/constants/categories.ts slug fields.

export const CATEGORY_TO_VENUE: Record<string, VenueCategory> = {
  // Mingla date category slugs (12 categories)
  casual_eats: 'casual_eats',
  fine_dining: 'fine_dining',
  drink: 'drink',
  first_meet: 'first_meet',
  nature: 'nature',
  picnic_park: 'picnic_park',
  watch: 'watch',
  live_performance: 'live_performance',
  creative_arts: 'creative_arts',
  play: 'play',
  wellness: 'wellness',
  flowers: 'flowers',
  // Curated experience type slugs
  adventurous: 'nature',
  'first-date': 'first_meet',
  romantic: 'fine_dining',
  'group-fun': 'play',
  'picnic-dates': 'picnic_park',
  'take-a-stroll': 'nature',
};

// ─── Google primary_type → Venue Category ───────────────────────────────────
// Fallback for curated stops where card.category is unavailable.

export const PLACE_TYPE_TO_VENUE: Record<string, VenueCategory> = {
  // Restaurants
  restaurant: 'casual_eats',
  fast_food_restaurant: 'casual_eats',
  pizza_restaurant: 'casual_eats',
  hamburger_restaurant: 'casual_eats',
  ramen_restaurant: 'casual_eats',
  sandwich_shop: 'casual_eats',
  diner: 'casual_eats',
  fine_dining_restaurant: 'fine_dining',
  french_restaurant: 'fine_dining',
  steak_house: 'fine_dining',
  seafood_restaurant: 'fine_dining',
  // Drinks
  bar: 'drink',
  night_club: 'drink',
  wine_bar: 'drink',
  pub: 'drink',
  // Coffee / Cafes
  cafe: 'first_meet',
  coffee_shop: 'first_meet',
  tea_house: 'first_meet',
  // Outdoors
  park: 'picnic_park',
  campground: 'nature',
  hiking_area: 'nature',
  national_park: 'nature',
  garden: 'nature',
  // Entertainment
  movie_theater: 'watch',
  stadium: 'watch',
  bowling_alley: 'play',
  amusement_park: 'play',
  casino: 'play',
  // Arts & Culture
  museum: 'creative_arts',
  art_gallery: 'creative_arts',
  performing_arts_theater: 'live_performance',
  concert_hall: 'live_performance',
  // Wellness
  spa: 'wellness',
  gym: 'wellness',
  yoga_studio: 'wellness',
  beauty_salon: 'wellness',
  // Shopping
  florist: 'flowers',
  shopping_mall: 'default',
  clothing_store: 'default',
  book_store: 'default',
  library: 'default',
};

// ─── Lookup Functions ───────────────────────────────────────────────────────

/**
 * Determine the venue category for busyness lookup.
 * Priority: card category slug → placeType (Google) → 'default'
 */
export function getVenueCategory(category?: string, placeType?: string): VenueCategory {
  if (category) {
    const match = CATEGORY_TO_VENUE[category];
    if (match) return match;
  }
  if (placeType) {
    const match = PLACE_TYPE_TO_VENUE[placeType];
    if (match) return match;
  }
  return 'default';
}

/**
 * Build a 7-day PopularTime[] array from the venue category's curves.
 * Same shape as the old generateHeuristicPopularTimes() output.
 * Days: Monday(0) through Sunday(6). Sat+Sun use weekend curve.
 */
export function getPopularTimesForCategory(
  venueCategory: VenueCategory,
  _isWeekend: boolean
): { day: string; times: { hour: string; popularity: number }[] }[] {
  const curve = VENUE_POPULARITY[venueCategory];
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  return days.map((day, idx) => {
    const isWE = idx >= 5; // Saturday=5, Sunday=6
    const hourValues = isWE ? curve.weekend : curve.weekday;
    const times = hourValues.map((popularity, h) => ({
      hour: `${h.toString().padStart(2, '0')}:00`,
      popularity,
    }));
    return { day, times };
  });
}
