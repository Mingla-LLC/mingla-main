/**
 * launchCityGateLogic — ORCH-1028 Part 1 pure decision core.
 *
 * Dependency-free (no RN/Expo/Supabase imports) so it is directly unit-testable
 * under Node (`node --experimental-strip-types`) per §F.1. The network wrapper
 * `checkLaunchCity` (in useLaunchCityGate.ts) delegates the (body,error)→result
 * decision and the coordinate guard to these functions.
 *
 * CONTRACT OWNER: ORCH-1027 §C.3 (FROZEN). Do NOT widen the response types.
 */

// ─── Mirrors ORCH-1027 §C.3 FROZEN response (do NOT widen) ───
export interface LaunchCity {
  id: string
  name: string
  center_lat: number
  center_lng: number
}
export interface LaunchCityWithBbox extends LaunchCity {
  bbox_sw_lat: number
  bbox_sw_lng: number
  bbox_ne_lat: number
  bbox_ne_lng: number
}
export interface CheckLaunchCityResponse {
  inLaunchCity: boolean
  matchedCity: LaunchCity | null
  liveCities: LaunchCityWithBbox[]
}

// ─── Discriminated result the gate UI branches on (LOCKED, SPEC §A.1) ───
export type LaunchGateResult =
  | { status: 'in_city'; matchedCity: LaunchCity; liveCities: LaunchCityWithBbox[] }
  | { status: 'out_of_city'; liveCities: LaunchCityWithBbox[] } // >=1 live city to pick
  | { status: 'no_live_cities' } // liveCities == []
  | { status: 'check_failed' } // network / 500 / timeout / malformed

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

function isLaunchCityWithBbox(c: unknown): c is LaunchCityWithBbox {
  if (!c || typeof c !== 'object') return false
  const r = c as Record<string, unknown>
  return (
    typeof r.id === 'string' &&
    typeof r.name === 'string' &&
    isFiniteNumber(r.center_lat) &&
    isFiniteNumber(r.center_lng)
  )
}

/** Coordinate guard shared by the network wrapper + tests. */
export function areCoordsValid(lat: unknown, lng: unknown): boolean {
  return (
    isFiniteNumber(lat) &&
    isFiniteNumber(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  )
}

/**
 * Pure decision: map a raw edge-fn (body, error) to the terminal LaunchGateResult.
 * Never throws. On any failure → { status: 'check_failed' }.
 */
export function resolveLaunchGate(body: unknown, transportError?: unknown): LaunchGateResult {
  if (transportError) {
    return { status: 'check_failed' }
  }
  const b = body as Partial<CheckLaunchCityResponse> | null | undefined
  // Malformed body: missing the `inLaunchCity` boolean or `liveCities` array.
  if (!b || typeof b.inLaunchCity !== 'boolean' || !Array.isArray(b.liveCities)) {
    return { status: 'check_failed' }
  }
  const liveCities = b.liveCities.filter(isLaunchCityWithBbox)
  // Zero live cities (regardless of inLaunchCity) → degraded path (E-3).
  if (liveCities.length === 0) {
    return { status: 'no_live_cities' }
  }
  if (b.inLaunchCity === true && b.matchedCity) {
    const m = b.matchedCity
    const matchedCity: LaunchCity = {
      id: String(m.id),
      name: String(m.name),
      center_lat: m.center_lat,
      center_lng: m.center_lng,
    }
    return { status: 'in_city', matchedCity, liveCities }
  }
  // inLaunchCity === false (or true without a matchedCity) with >=1 live city.
  return { status: 'out_of_city', liveCities }
}

/**
 * Pure builder for the preferences override written on a confirmed city pick (§C).
 * I-1028-ONE-LOCATION-OWNER: ONLY these four keys — never discover_city_*, never
 * a new column. Extracted so the write contract is unit-testable + locked.
 */
export interface LaunchCityOverride {
  custom_lat: number
  custom_lng: number
  custom_location: string
  use_gps_location: false
}
export function buildLaunchCityOverride(city: LaunchCity): LaunchCityOverride {
  return {
    custom_lat: city.center_lat,
    custom_lng: city.center_lng,
    custom_location: city.name,
    use_gps_location: false,
  }
}
