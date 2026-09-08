// ---------------------------------------------------------------
// City Decks + Resolver — ORCH-1007 [marketing real place cards — DC test run]
//
// Maps a resolved cityKey ('dc' | 'raleigh' | 'lagos') to its static showcase
// snapshot (places + intents + events) and holds the city centers used to pick
// the nearest seeded city from Vercel geo headers. DC is the universal fallback.
//
// ARCHITECTURE (operator-locked): static per-city snapshots only. NO backend /
// edge function. The page (a server component) resolves the city from Vercel
// geo headers (or a ?city= override) and passes the cityKey down to the deck;
// the deck builds its interleaved single→intent→event list from THIS city's
// data. The data files themselves are plain TS modules safe to import on the
// server (no 'use client', no React).
// ---------------------------------------------------------------

import {
  DC_SHOWCASE_PLACES,
  type ShowcasePlace,
} from '@/lib/dc-showcase-places'
import { DC_INTENT_PLANS, type IntentPlan } from '@/lib/dc-intent-plans'
import { DC_SHOWCASE_EVENTS, type ShowcaseEvent } from '@/lib/dc-showcase-events'
import { RALEIGH_SHOWCASE_PLACES } from '@/lib/raleigh-showcase-places'
import { RALEIGH_INTENT_PLANS } from '@/lib/raleigh-intent-plans'
import { RALEIGH_SHOWCASE_EVENTS } from '@/lib/raleigh-showcase-events'
import { LAGOS_SHOWCASE_PLACES } from '@/lib/lagos-showcase-places'
import { LAGOS_INTENT_PLANS } from '@/lib/lagos-intent-plans'
import { LAGOS_SHOWCASE_EVENTS } from '@/lib/lagos-showcase-events'
import { cityHubForSlug, type CityHubRecord } from '@/content/cities/registry'

/** The three currently-seeded marketing cities. DC is the universal fallback. */
export type CityKey = 'dc' | 'raleigh' | 'lagos'

/** One city's full showcase snapshot consumed by the hero deck. */
export interface CityDeck {
  key: CityKey
  /** Human label used in the deck's aria group description. */
  label: string
  places: readonly ShowcasePlace[]
  intents: readonly IntentPlan[]
  events: readonly ShowcaseEvent[]
}

function requireCityRecord(slug: string): CityHubRecord {
  const record = cityHubForSlug(slug)
  if (!record) throw new Error(`Missing city hub registry record for ${slug}`)
  return record
}

const DECK_CITY_RECORDS: Record<CityKey, CityHubRecord> = {
  dc: requireCityRecord('washington-dc'),
  raleigh: requireCityRecord('raleigh-nc'),
  lagos: requireCityRecord('lagos'),
}

export const CITY_DECKS: Record<CityKey, CityDeck> = {
  dc: {
    key: 'dc',
    label: DECK_CITY_RECORDS.dc.city,
    places: DC_SHOWCASE_PLACES,
    intents: DC_INTENT_PLANS,
    events: DC_SHOWCASE_EVENTS,
  },
  raleigh: {
    key: 'raleigh',
    label: DECK_CITY_RECORDS.raleigh.city,
    places: RALEIGH_SHOWCASE_PLACES,
    intents: RALEIGH_INTENT_PLANS,
    events: RALEIGH_SHOWCASE_EVENTS,
  },
  lagos: {
    key: 'lagos',
    label: DECK_CITY_RECORDS.lagos.city,
    places: LAGOS_SHOWCASE_PLACES,
    intents: LAGOS_INTENT_PLANS,
    events: LAGOS_SHOWCASE_EVENTS,
  },
}

/** Default / fallback city when geo can't resolve to a seeded city. */
export const DEFAULT_CITY: CityKey = 'dc'

/** City centers (lat, lng) for the haversine nearest-city pick. */
const CITY_CENTERS: Record<CityKey, { lat: number; lng: number }> = Object.fromEntries(
  Object.entries(DECK_CITY_RECORDS).map(([key, record]) => {
    if (!record.marketingDeckCenter) throw new Error(`Missing marketing deck center for ${record.slug}`)
    return [key, record.marketingDeckCenter]
  }),
) as Record<CityKey, { lat: number; lng: number }>

/**
 * Max distance (km) a visitor may be from the NEAREST seeded city center and
 * still be mapped to it. Beyond this for ALL cities → DC fallback. 250km keeps
 * the DC↔Raleigh corridor (~360km apart) cleanly separated while still catching
 * the metro + suburbs around each seeded city.
 */
const MAX_CITY_RADIUS_KM = 250

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/** Great-circle distance in km between two lat/lng points. */
function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371 // Earth radius km
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

const CITY_KEYS: readonly CityKey[] = ['dc', 'raleigh', 'lagos']

/**
 * Resolve the city from optional geo signals. Resolution order:
 *  1. Explicit `?city=` override (local testing on :3008) — wins outright.
 *  2. Vercel lat/lng → nearest seeded city within MAX_CITY_RADIUS_KM.
 *  3. Vercel country code → 'NG' maps to Lagos (covers Nigeria when precise
 *     coords are missing).
 *  4. DC fallback (also the local-dev path where no Vercel headers exist).
 *
 * Pure function — no I/O — so it's trivially testable and runs on the server.
 */
export function resolveCityKey(input: {
  override?: string | null
  latitude?: string | null
  longitude?: string | null
  country?: string | null
}): CityKey {
  // 1. Explicit override (case-insensitive). Only a recognized key wins.
  const override = input.override?.toLowerCase()
  if (override && (CITY_KEYS as readonly string[]).includes(override)) {
    return override as CityKey
  }

  // 2. Lat/lng → nearest city within the radius.
  const lat = input.latitude ? Number.parseFloat(input.latitude) : NaN
  const lng = input.longitude ? Number.parseFloat(input.longitude) : NaN
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    let best: CityKey = DEFAULT_CITY
    let bestKm = Number.POSITIVE_INFINITY
    for (const key of CITY_KEYS) {
      const km = haversineKm({ lat, lng }, CITY_CENTERS[key])
      if (km < bestKm) {
        bestKm = km
        best = key
      }
    }
    if (bestKm <= MAX_CITY_RADIUS_KM) return best
    // Too far from every seeded city → fall through to country / DC.
  }

  // 3. Country code (Vercel x-vercel-ip-country) → Nigeria maps to Lagos.
  if (input.country && input.country.toUpperCase() === 'NG') {
    return 'lagos'
  }

  // 4. Fallback.
  return DEFAULT_CITY
}
