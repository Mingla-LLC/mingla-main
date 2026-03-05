// ALL reverse geocoding in the app MUST go through this wrapper.
// Do NOT call Location.reverseGeocodeAsync directly from any other file.
// Grep audit: `grep -rn "reverseGeocodeAsync" app-mobile/src/ --include="*.ts*"`
// should return ONLY this file.

import * as Location from 'expo-location'

interface GeocodeResult {
  addresses: Location.LocationGeocodedAddress[]
  fromCache: boolean
}

// ── Configuration ──
const MIN_INTERVAL_MS = 1500           // Minimum gap between native geocode calls
const CACHE_TTL_MS = 30 * 60 * 1000   // 30 minutes — city names don't change
const CACHE_MAX_ENTRIES = 50
const COORDINATE_PRECISION = 4         // 4 decimal places ≈ 11m

// ── State ──
let lastCallTimestamp = 0
const cache = new Map<string, { addresses: Location.LocationGeocodedAddress[], ts: number }>()
const inflight = new Map<string, Promise<Location.LocationGeocodedAddress[]>>()

function roundCoord(n: number): string {
  return n.toFixed(COORDINATE_PRECISION)
}

function makeCacheKey(latitude: number, longitude: number): string {
  return `${roundCoord(latitude)},${roundCoord(longitude)}`
}

function evictStaleEntries(): void {
  const now = Date.now()
  for (const [key, entry] of cache) {
    if (now - entry.ts > CACHE_TTL_MS) {
      cache.delete(key)
    }
  }
  // LRU eviction if still over limit
  if (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0]
    if (oldest) cache.delete(oldest[0])
  }
}

async function callNativeWithThrottle(
  latitude: number,
  longitude: number
): Promise<Location.LocationGeocodedAddress[]> {
  // Enforce minimum interval
  const now = Date.now()
  const elapsed = now - lastCallTimestamp
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise(resolve => setTimeout(resolve, MIN_INTERVAL_MS - elapsed))
  }

  lastCallTimestamp = Date.now()
  return Location.reverseGeocodeAsync({ latitude, longitude })
}

/**
 * Throttled, cached, deduplicated reverse geocoding.
 *
 * - Returns cached result immediately if available (within TTL and ~11m radius)
 * - Enforces minimum 1.5s gap between native OS geocoder calls
 * - Deduplicates concurrent requests for the same location
 * - On rate-limit error: waits 1.5s and retries exactly once
 * - On all other errors: throws (caller must handle)
 */
export async function throttledReverseGeocode(
  latitude: number,
  longitude: number
): Promise<GeocodeResult> {
  const key = makeCacheKey(latitude, longitude)

  // 1. Check cache
  const cached = cache.get(key)
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return { addresses: cached.addresses, fromCache: true }
  }

  // 2. Deduplicate in-flight requests
  const existing = inflight.get(key)
  if (existing) {
    const addresses = await existing
    return { addresses, fromCache: false }
  }

  // 3. Make the throttled call — deferred promise pattern to register in Map
  //    BEFORE any async work starts, preventing the race where two callers
  //    both pass the inflight.get() check in the same microtask.
  let resolve!: (value: Location.LocationGeocodedAddress[]) => void
  let reject!: (reason: unknown) => void
  const deferred = new Promise<Location.LocationGeocodedAddress[]>((res, rej) => {
    resolve = res
    reject = rej
  })
  inflight.set(key, deferred) // Registered synchronously — subsequent callers will await this

  try {
    const addresses = await callNativeWithThrottle(latitude, longitude)
    cache.set(key, { addresses, ts: Date.now() })
    evictStaleEntries()
    resolve(addresses)
    return { addresses, fromCache: false }
  } catch (error: unknown) {
    const msg = (error instanceof Error ? error.message : String(error)) || ''
    const isRateLimit = msg.toLowerCase().includes('rate limit')

    if (isRateLimit) {
      // Rate-limit detected — wait and retry exactly once
      await new Promise(r => setTimeout(r, MIN_INTERVAL_MS))
      lastCallTimestamp = Date.now()
      try {
        const addresses = await Location.reverseGeocodeAsync({ latitude, longitude })
        cache.set(key, { addresses, ts: Date.now() })
        evictStaleEntries()
        resolve(addresses)
        return { addresses, fromCache: false }
      } catch (retryError) {
        const err = new Error(`Geocoding rate limit: retry failed (${retryError instanceof Error ? retryError.message : retryError})`)
        reject(err)
        throw err
      }
    }

    // Non-rate-limit error — rethrow as-is
    reject(error)
    throw error
  } finally {
    inflight.delete(key)
  }
}

/**
 * Clear the geocode cache. Call when the user changes their location
 * (e.g., after manual location entry or GPS toggle change).
 */
export function clearGeocodeCache(): void {
  cache.clear()
  inflight.clear()
}
