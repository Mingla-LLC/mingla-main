// #4339 — the one server read of "which cities does usemingla.com list".
//
// /cities, the Home cities row, /going-out and /cities/<slug> all call
// `getCityTiles()`: the live cities from `links_page_cities()` (lib/links-data.ts:
// the same 5-minute Next Data Cache and `links` tag /links used), enriched by the
// registry guides, A to Z (lib/cities-page.ts). A failed or empty read falls back
// to the registry guides so no page is ever empty, and is logged (never silent).
// No database configured (local builds, CI): the registry fallback, not logged.

import { CITY_HUB_CENTRES, CITY_HUB_REGIONS, CITY_HUBS } from '@/content/cities/registry'
import { resolveCityTiles, type CityHubInput, type CityTiles } from './cities-page'
import { getLinksData, linksDataConfigured } from './links-data'

/** Every registry guide as the pure model needs it. */
export function cityHubInputs(): CityHubInput[] {
  return CITY_HUBS.map((hub) => ({
    slug: hub.slug,
    city: hub.city,
    countryCode: hub.countryCode,
    region: CITY_HUB_REGIONS[hub.slug],
    timezone: hub.timezone,
    ...CITY_HUB_CENTRES[hub.slug],
  }))
}

export async function getCityTiles(): Promise<CityTiles> {
  const hubs = cityHubInputs()
  if (!linksDataConfigured()) return resolveCityTiles([], hubs)
  const data = await getLinksData()
  const resolved = resolveCityTiles(data.cities, hubs)
  if (resolved.source === 'registry') {
    // getLinksData already logged a failed read; an empty or invalid list is logged here.
    const why = data.failed.includes('cities') ? 'the read failed' : `the list had no valid city (${data.cities.length} rows)`
    console.error(`[#4339 cities] listing the registry guides only: ${why}`)
  }
  return resolved
}
