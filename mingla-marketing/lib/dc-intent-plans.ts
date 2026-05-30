// ---------------------------------------------------------------
// DC Intent Plans — ORCH-1007 [marketing real place cards — DC test run]
//
// Hardcoded snapshot of 6 "intent plans" — ONE PER INTENT — themed, multi-stop
// Mingla EXPERIENCES (Mingla is an experience / date-planning app, NOT a dating
// app). Each plan is a snapshot of a PLAN: an ordered sequence of 2–4 real
// Washington-DC places (stops) you'd do together for a given vibe.
//
// This is TEST DATA — no backend calls, no fetch, no edge function. Stop
// hero photos are public Supabase Storage URLs:
//   https://<project>.supabase.co/storage/v1/object/public/place-photos/<placeKey>/0.jpg
// Photo index 0 is each stop's hero image.
//
// HONESTY OF THE TWO PILL FACTS (per DESIGN_ORCH-1007 §I.4):
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
    id: 'romantic',
    intentTitle: 'A Romantic Evening',
    sellLine: 'Omakase, a whiskey terrace, and a slow walk by the river.',
    itineraryLabel: 'Dinner → Cocktails → Stroll',
    priceRange: '$120–$200 for two',
    duration: '≈ 3.5 hrs',
    stops: [
      stop('KYOJIN Sushi', 'Dinner', 'ChIJf57htim3t4kRAMbxTZCtjao'),
      stop('Jack Rose Dining Saloon', 'Cocktails', 'ChIJK7e4Ldu3t4kRUg8DvM7SaSQ'),
      stop('Georgetown Waterfront Park', 'Stroll', 'ChIJ8Rr7HU-2t4kRSWaer7WwQag'),
    ],
  },
  {
    id: 'first-date',
    intentTitle: 'A Slow First Date',
    sellLine: 'Ceviche, an easy art wander, and a cup to talk over.',
    itineraryLabel: 'Bites → Art → Coffee',
    priceRange: '$30–$60 for two',
    duration: '≈ 3 hrs',
    stops: [
      stop('Pisco y Nazca', 'Bites', 'ChIJDc1TJ5q3t4kRQX8x6Pj4IlA'),
      stop('National Gallery of Art', 'Art', 'ChIJSYxSO5u3t4kRm4eyKw_Y7Kg'),
      stop('Dolan Coffee', 'Coffee', 'ChIJQWdBmMnJt4kR_7W5-BvkQso'),
    ],
  },
  {
    id: 'adventurous',
    intentTitle: 'An Adventurous Afternoon',
    sellLine: 'Crack an escape room, taco break, then dance the decades.',
    itineraryLabel: 'Escape → Tacos → Dancing',
    priceRange: '$60–$120 for two',
    duration: '≈ 4 hrs',
    stops: [
      stop('The Great Escape Room DC', 'Escape', 'ChIJY2-6cTW3t4kRUvxabWiY3xA'),
      stop('Oyamel', 'Tacos', 'ChIJvfdr_Y-3t4kRN-8elI5NN6g'),
      stop('Decades DC', 'Dancing', 'ChIJKbZ-nLi3t4kROnEjIdE5cBs'),
    ],
  },
  {
    id: 'group-fun',
    intentTitle: 'A Group Night Out',
    sellLine: 'Pisco sours, a team showdown, then a whiskey nightcap.',
    itineraryLabel: 'Dinner → Game → Nightcap',
    priceRange: 'from $50 each',
    duration: '≈ 4 hrs',
    stops: [
      stop('Pisco y Nazca', 'Dinner', 'ChIJDc1TJ5q3t4kRQX8x6Pj4IlA'),
      stop('The Great Escape Room DC', 'Game', 'ChIJY2-6cTW3t4kRUvxabWiY3xA'),
      stop('Jack Rose Dining Saloon', 'Nightcap', 'ChIJK7e4Ldu3t4kRUg8DvM7SaSQ'),
    ],
  },
  {
    id: 'picnic-dates',
    intentTitle: 'A Picnic by the Water',
    sellLine: 'Fresh pastries, a riverside blanket, easy afternoon light.',
    itineraryLabel: 'Grab → Picnic → Stroll',
    priceRange: '$20–$40 for two',
    duration: '≈ 2.5 hrs',
    stops: [
      stop('Fresh Baguette', 'Grab', 'ChIJ6c1FMXzJt4kRNC1-JFVJWjI'),
      stop('Georgetown Waterfront Park', 'Picnic', 'ChIJ8Rr7HU-2t4kRSWaer7WwQag'),
      stop('Anacostia Park', 'Stroll', 'ChIJCVOosVS4t4kRc5PLjLRnQU4'),
    ],
  },
  {
    id: 'take-a-stroll',
    intentTitle: 'Take a Stroll',
    sellLine: 'Masterpieces, a riverside walk, and a warm cup to finish.',
    itineraryLabel: 'Art → Walk → Coffee',
    priceRange: 'Free–$20 for two',
    duration: '≈ 3 hrs',
    stops: [
      stop('National Gallery of Art', 'Art', 'ChIJSYxSO5u3t4kRm4eyKw_Y7Kg'),
      stop('Georgetown Waterfront Park', 'Walk', 'ChIJ8Rr7HU-2t4kRSWaer7WwQag'),
      stop('Dolan Coffee', 'Coffee', 'ChIJQWdBmMnJt4kR_7W5-BvkQso'),
    ],
  },
] as const
