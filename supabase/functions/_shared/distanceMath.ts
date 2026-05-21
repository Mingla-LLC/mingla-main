// ORCH-0659 + ORCH-0660: Single owner for distance + travel-time math.
// Replaces duplicate copies in generate-curated-experiences/index.ts and
// _shared/stopAlternatives.ts. Pure leaf module — zero side-effect imports.
//
// I-DECK-CARD-CONTRACT-DISTANCE-AND-TIME: every card emitted by any
// deck-serving edge function MUST carry haversine-computed distanceKm AND
// per-mode travelTimeMin (or explicit null when lat/lng or user-location
// is missing). Never use 0 as a sentinel for "missing".
//
// ORCH-0903 (2026-05-21): TRAVEL_CONFIG is the SINGLE source of truth for
// travel-time speeds across ALL deck-serving edge functions. Both the
// candidate radius (via `radiusKmForConstraint`) and the displayed
// travel-time (via `estimateTravelMinutes`) read from this same constant.
// Do NOT introduce local SPEED tables in caller files — the unified table
// is enforced by `discover-cards/__tests__/orch_0903_travel_time_contract.test.ts`
// (grep regression checks T-07/T-08). Driving value bumped from 35×1.4 to
// 60×1.3 (effective ~46 km/h door-to-door — compromise between
// pessimistic 35-effective-25 and optimistic 100-effective-77). Walking,
// biking, transit, bicycling unchanged.

export type TravelMode = 'walking' | 'driving' | 'transit' | 'biking' | 'bicycling';

export const TRAVEL_CONFIG: Record<string, { speed: number; factor: number }> = {
  walking:   { speed: 4.5, factor: 1.3 },
  driving:   { speed: 60,  factor: 1.3 },  // ORCH-0903: was 35 × 1.4
  transit:   { speed: 20,  factor: 1.3 },
  biking:    { speed: 14,  factor: 1.3 },
  bicycling: { speed: 14,  factor: 1.3 },
};

/**
 * Great-circle distance between two lat/lng points, in kilometers.
 * Uses the haversine formula with Earth radius R=6371km.
 */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Estimated travel time in minutes for a given distance + mode.
 * Per-mode `factor` corrects for non-straight-line routes; speeds are
 * effective speeds (post-traffic, post-stop-light). Floored at 3 minutes
 * to match the curated path. Unknown modes fall back to walking.
 *
 * Sample (Raleigh-center → Williamson Preserve, 17.7 km, post-ORCH-0903):
 *   walking  → ~307 min  (4.5 km/h × 1.3 factor)
 *   driving  →  ~23 min  (60 km/h × 1.3 factor — was ~43 pre-ORCH-0903)
 *   transit  →  ~69 min  (20 km/h × 1.3 factor)
 *   biking   →  ~99 min  (14 km/h × 1.3 factor)
 */
export function estimateTravelMinutes(distKm: number, travelMode: string): number {
  const { speed, factor } = TRAVEL_CONFIG[travelMode] ?? TRAVEL_CONFIG.walking;
  return Math.max(3, Math.round((distKm * factor / speed) * 60));
}

/**
 * ORCH-0903: candidate-radius helper. Returns km radius for a travel-time
 * constraint, applying the SAME speed and factor used by `estimateTravelMinutes`
 * so the filter and the display cannot drift. Caller passes generosity:
 *   - Singles deck (`discover-cards`): generosity = 1.5
 *     (50% wider candidate pool for round-robin diversity; post-filter trims
 *     to honest user cap).
 *   - Curated multi-stop (`generate-curated-experiences`): generosity = 1.0
 *     (tight, honest — multi-stop trips traverse end-to-end, radius IS the
 *     user contract for the whole itinerary).
 * Unknown modes fall back to walking via TRAVEL_CONFIG's nullish coalesce.
 */
export function radiusKmForConstraint(
  constraintMin: number,
  travelMode: string,
  generosity: number = 1.0,
): number {
  const { speed, factor } = TRAVEL_CONFIG[travelMode] ?? TRAVEL_CONFIG.walking;
  return (constraintMin / 60) * speed * factor * generosity;
}
