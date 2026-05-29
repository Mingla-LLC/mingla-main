// ---------------------------------------------------------------
// DC Intent Plans — ORCH-0998 [marketing real place cards — DC test run]
//
// Hardcoded snapshot of 4 "intent plans" — themed, multi-stop Mingla
// EXPERIENCES (Mingla is an experience / date-planning app, NOT a dating
// app). Each plan is a snapshot of a PLAN: an ordered sequence of 2–4 real
// Washington-DC places (stops) you'd do together for a given vibe.
//
// This is TEST DATA — no backend calls, no fetch, no edge function. Stop
// hero photos are public Supabase Storage URLs:
//   https://<project>.supabase.co/storage/v1/object/public/place-photos/<placeKey>/0.jpg
// Photo index 0 is each stop's hero image.
//
// HONESTY OF THE TWO PILL FACTS (per DESIGN_ORCH-0998 §I.4):
//  - priceRange is a REAL summed range where the stops carry real price data;
//    where a stop is free or has no price signal it is folded in as "from $X"
//    or "Free" — never a fabricated number. These verbatim strings were set by
//    the operator for this DC test run.
//  - duration is an EDITORIAL plan-level ESTIMATE (≈ N hrs) — there is no real
//    per-plan duration data. Do NOT wire duration to a backend.
//
// If a future ORCH wires this to the live place pool, replace this array with
// a typed fetch — the consuming component only reads the IntentPlan shape.
// ---------------------------------------------------------------

const SUPABASE_PHOTO_BASE =
  'https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-photos'

/** Build the full public Storage URL for a given place photo index. */
export function placePhotoUrl(placeKey: string, index: number): string {
  return `${SUPABASE_PHOTO_BASE}/${placeKey}/${index}.jpg`
}

/** One stop in an intent plan. */
export interface IntentStop {
  /** Real venue name — verbatim. */
  name: string
  /** Short role label in the itinerary (e.g. "Dinner", "Cocktails", "Stroll"). */
  role: string
  /** Full public Supabase Storage hero-photo URL (<base>/<placeKey>/0.jpg). */
  heroPhoto: string
}

/** A themed multi-stop Mingla experience snapshot. */
export interface IntentPlan {
  /** Stable id for keys/rotation. */
  id: string
  /** Experiential title — the vibe phrased as a plan you'd say out loud. */
  intentTitle: string
  /** Ordered stops, 2–4. */
  stops: readonly IntentStop[]
  /** The itinerary as a tiny arrow sequence of roles (e.g. "Dinner → Cocktails → Stroll"). */
  itineraryLabel: string
  /** One-line whole-experience pitch (≤72 chars, Mingla experiential voice). */
  sellLine: string
  /** Total price string — real summed range where stop price data exists, else "from $X" / "Free". */
  priceRange: string
  /** Editorial plan-level duration estimate (decorative — do NOT wire to a backend). */
  duration: string
}

/** Build a stop with its resolved hero photo URL. */
function stop(name: string, role: string, placeKey: string): IntentStop {
  return { name, role, heroPhoto: placePhotoUrl(placeKey, 0) }
}

export const DC_INTENT_PLANS: readonly IntentPlan[] = [
  {
    id: 'romantic-evening',
    intentTitle: 'A Romantic Evening',
    sellLine: 'Candlelit pasta, late cocktails, and a slow river walk.',
    itineraryLabel: 'Dinner → Cocktails → Stroll',
    priceRange: '$80–$150 for two',
    duration: '≈ 3 hrs',
    stops: [
      stop("L'Ardente", 'Dinner', 'ChIJ-82JrXi3t4kRSAkfWH-6ToU'),
      stop('OKPB', 'Cocktails', 'ChIJuVcr4vHJt4kR3RGgn9ppyKM'),
      stop('Georgetown Waterfront Park', 'Stroll', 'ChIJ8Rr7HU-2t4kRSWaer7WwQag'),
    ],
  },
  {
    id: 'group-night-out',
    intentTitle: 'A Group Night Out',
    sellLine: 'Pisco sours, a laser-room showdown, then a tiny-bar nightcap.',
    itineraryLabel: 'Dinner → Game → Nightcap',
    priceRange: 'from $40 for two',
    duration: '≈ 3.5 hrs',
    stops: [
      stop('Pisco y Nazca', 'Dinner', 'ChIJixeyzuvJt4kRVW6c09ZsVZE'),
      stop('Beat The Bomb DC', 'Game', 'ChIJX8KKlVy5t4kR24fw5XyyFM0'),
      stop("Snappy's Small Bar", 'Nightcap', 'ChIJvd0xokXJt4kR8LkVsaOSLsM'),
    ],
  },
  {
    id: 'culture-crawl',
    intentTitle: 'A Culture Crawl',
    sellLine: 'Americana, a riverside walk, and a proper cup to end on.',
    itineraryLabel: 'Museum → Walk → Coffee',
    priceRange: 'Free–$20 for two',
    duration: '≈ 4 hrs',
    stops: [
      stop(
        'Smithsonian Museum of American History',
        'Museum',
        'ChIJx7K17Ji3t4kR6h3neQYXsjI',
      ),
      stop('Georgetown Waterfront Park', 'Walk', 'ChIJ8Rr7HU-2t4kRSWaer7WwQag'),
      stop('Dolan Coffee', 'Coffee', 'ChIJQWdBmMnJt4kR_7W5-BvkQso'),
    ],
  },
  {
    id: 'slow-first-date',
    intentTitle: 'A Slow First Date',
    sellLine: 'Easy sushi, warm pastries, and an unhurried walk to talk.',
    itineraryLabel: 'Sushi → Pastries → Stroll',
    priceRange: '$20–$40 for two',
    duration: '≈ 2.5 hrs',
    stops: [
      stop('Mita Ethio-Japanese Cafe', 'Sushi', 'ChIJtc1Uk9HJt4kRUt5SDQNksww'),
      stop("Nino's Bakery", 'Pastries', 'ChIJg__WApW3t4kRq7CvEnSb9q0'),
      stop('Anacostia Park', 'Stroll', 'ChIJCVOosVS4t4kRc5PLjLRnQU4'),
    ],
  },
] as const
