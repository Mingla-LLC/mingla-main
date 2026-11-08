// #4339 phase 4a (§4) — the city page's "This weekend": the server read.
//
// Reads #4318's three public readers through #4318's own data layer
// (lib/links-data.ts: raw PostgREST with the public anon key, the Next Data
// Cache for 5 minutes under the `links` tag, failures logged, never swallowed)
// and builds the page's model (lib/city-weekend.ts). No new reader, no new
// cache tag: a new admin strip shows on /links and on every city page at once.
//
// The quiet week's places are read only when they can show: the week read
// worked and the city has nothing this week. They come from
// `links_page_places(centre, reachKm, 3)` with stored `<dir>/<stem>_thumb.jpg`
// photos on the public object endpoint (never /render/image, hold #1643).
//
// No database configured (local builds, CI): every list is empty and the page
// shows "Nothing is listed this week yet. Check back soon."

import { CITY_HUB_CENTRES, CITY_HUB_REACH_KM, CITY_HUB_REGIONS, CITY_HUBS, type CityHubSlug } from '@/content/cities/registry'
import { getLinksData, getLinksPlaces } from './links-data'
import type { LinksCity } from './links-week'
import { cityWeekListings, cityWeekendModel, type CityWeekendModel } from './city-weekend'

/** Every registry city as the #4318 week model needs it (the same mapping /links uses). */
export function registryLinksCities(): LinksCity[] {
  return CITY_HUBS.map((hub) => ({
    slug: hub.slug,
    name: hub.city,
    region: CITY_HUB_REGIONS[hub.slug],
    timezone: hub.timezone,
    reachKm: CITY_HUB_REACH_KM[hub.slug],
    ...CITY_HUB_CENTRES[hub.slug],
  }))
}

export async function getCityWeekend(slug: CityHubSlug, nowIso: string): Promise<CityWeekendModel> {
  const cities = registryLinksCities()
  const city = cities.find((c) => c.slug === slug)
  if (!city) throw new Error(`#4339 city weekend: ${slug} is not a registry city`)
  const data = await getLinksData()
  const readFailed = data.failed.includes('week')
  const quiet = !readFailed && cityWeekListings({ city, cities, rows: data.rows, nowIso }).length === 0
  const places = quiet ? (await getLinksPlaces([city])).places[city.slug] ?? [] : []
  return cityWeekendModel({ city, cities, rows: data.rows, strips: data.strips, places, readFailed, nowIso })
}
