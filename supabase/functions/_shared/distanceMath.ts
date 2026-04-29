// ORCH-0659 + ORCH-0660: Single owner for distance + travel-time math.
// Replaces duplicate copies in generate-curated-experiences/index.ts and
// _shared/stopAlternatives.ts. Pure leaf module — zero side-effect imports.
//
// I-DECK-CARD-CONTRACT-DISTANCE-AND-TIME: every card emitted by any
// deck-serving edge function MUST carry haversine-computed distanceKm AND
// per-mode travelTimeMin (or explicit null when lat/lng or user-location
// is missing). Never use 0 as a sentinel for "missing".

export type TravelMode = 'walking' | 'driving' | 'transit' | 'biking' | 'bicycling';

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
 * Sample (Raleigh-center → Williamson Preserve, 17.7 km):
 *   walking  → ~307 min  (4.5 km/h × 1.3 factor)
 *   driving  →  ~43 min  (35 km/h × 1.4 factor)
 *   transit  →  ~69 min  (20 km/h × 1.3 factor)
 *   biking   →  ~99 min  (14 km/h × 1.3 factor)
 */
export function estimateTravelMinutes(distKm: number, travelMode: string): number {
  const config: Record<string, { speed: number; factor: number }> = {
    walking:   { speed: 4.5, factor: 1.3 },
    driving:   { speed: 35,  factor: 1.4 },
    transit:   { speed: 20,  factor: 1.3 },
    biking:    { speed: 14,  factor: 1.3 },
    bicycling: { speed: 14,  factor: 1.3 },
  };
  const { speed, factor } = config[travelMode] ?? config.walking;
  return Math.max(3, Math.round((distKm * factor / speed) * 60));
}
