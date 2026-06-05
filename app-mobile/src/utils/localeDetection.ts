import { geocodingService } from '../services/geocodingService'
import {
  getCurrencyByCountryName,
  getCurrencyByCountryCode,
  type CountryCurrency,
} from '../services/countryCurrencyService'

export interface DetectedLocale {
  currency: string // ISO 4217 code, e.g. 'USD', 'GBP', 'EUR'
  measurementSystem: 'Metric' | 'Imperial'
  measurementSystemDb: 'metric' | 'imperial' // DB-format — use this for Supabase writes
  countryName: string | null // For logging/analytics only
  countryCode: string | null // For logging/analytics only
}

const IMPERIAL_COUNTRY_CODES = new Set(['US', 'LR', 'MM'])

const DEFAULT_LOCALE: DetectedLocale = {
  currency: 'USD',
  measurementSystem: 'Imperial',
  measurementSystemDb: 'imperial',
  countryName: null,
  countryCode: null,
}

/**
 * Detect currency and measurement system from a country name string.
 * Synchronous — no network call. Use when you already have the country
 * (e.g., from Expo's reverseGeocodeAsync result).
 * Returns DEFAULT_LOCALE (USD/Imperial) if country is null or not in DB.
 */
export function detectLocaleFromCountryName(countryName: string | null | undefined): DetectedLocale {
  if (!countryName) return DEFAULT_LOCALE

  const detectedCountry = getCurrencyByCountryName(countryName)
  if (!detectedCountry) {
    console.warn('Locale detection: country not in currency DB, falling back to USD/Imperial', countryName)
    return DEFAULT_LOCALE
  }

  const usesImperial = IMPERIAL_COUNTRY_CODES.has(detectedCountry.countryCode)
  return {
    currency: detectedCountry.currencyCode,
    measurementSystem: usesImperial ? 'Imperial' : 'Metric',
    measurementSystemDb: usesImperial ? 'imperial' : 'metric',
    countryName,
    countryCode: detectedCountry.countryCode,
  }
}

/**
 * Detect currency and measurement system from GPS coordinates.
 * Uses reverse geocoding to determine country, then maps to currency and measurement.
 * Returns DEFAULT_LOCALE (USD/Imperial) on any failure — never throws.
 */
export async function detectLocaleFromCoordinates(
  latitude: number,
  longitude: number,
): Promise<DetectedLocale> {
  try {
    const geocodeResult = await geocodingService.reverseGeocode(latitude, longitude)

    // META-ORCH-1060 §3.7: prefer the STRUCTURED ISO country code that Mapbox
    // returns directly (cleaner + more reliable than country-name matching).
    // Fall back to the legacy name lookup only if no code is present.
    let detectedCountry: CountryCurrency | undefined
    if (geocodeResult.countryCode) {
      detectedCountry = getCurrencyByCountryCode(geocodeResult.countryCode)
    }
    if (!detectedCountry && geocodeResult.country) {
      detectedCountry = getCurrencyByCountryName(geocodeResult.country)
    }

    if (!detectedCountry) {
      console.warn('Locale detection: country not in currency DB, falling back to USD/Imperial', geocodeResult.countryCode ?? geocodeResult.country)
      return DEFAULT_LOCALE
    }

    const usesImperial = IMPERIAL_COUNTRY_CODES.has(detectedCountry.countryCode)

    return {
      currency: detectedCountry.currencyCode,
      measurementSystem: usesImperial ? 'Imperial' : 'Metric',
      measurementSystemDb: usesImperial ? 'imperial' : 'metric',
      countryName: detectedCountry.countryName ?? geocodeResult.country ?? null,
      countryCode: detectedCountry.countryCode,
    }
  } catch (err) {
    console.warn('Locale detection failed, falling back to USD/Imperial:', err instanceof Error ? err.message : err)
    return DEFAULT_LOCALE
  }
}
