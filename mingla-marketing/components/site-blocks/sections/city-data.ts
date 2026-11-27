// #4636 — how a city block finds its city from the one parameter the editor
// sets (the city slug). Live data stays live (R7): a guide city is the
// registry record (content/cities/registry.ts); any other live city comes from
// lib/live-cities.ts. Server only.
import { cityHubForSlug, type CityHubRecord } from '@/content/cities/registry'
import { getCityTiles } from '@/lib/live-cities'
import { getCityWeekend, getLiveCityWeekend } from '@/lib/city-weekend-data'
import type { CityWeekendModel } from '@/lib/city-weekend'

/** What the hero, breadcrumb and host band need of a city: a guide record or a live city. */
export interface CityIdentity {
  readonly slug: string
  readonly city: string
  readonly countryCode: string
}

export interface CityParams {
  city: string
}

/** The guide record for a slug, or null when the city has no hand-made guide. */
export function guideCity(slug: string): CityHubRecord | null {
  return cityHubForSlug(slug)
}

/** Hero / host-band identity for any live or guide city, or null when unknown. */
export async function cityIdentity(slug: string): Promise<CityIdentity | null> {
  const record = cityHubForSlug(slug)
  if (record) return { slug: record.slug, city: record.city, countryCode: record.countryCode }
  const tile = (await getCityTiles()).tiles.find((t) => t.slug === slug)
  return tile ? { slug: tile.slug, city: tile.name, countryCode: tile.countryCode } : null
}

/** The weekend model for any guide or live city (the same readers the city route uses). */
export async function cityWeekendFor(slug: string): Promise<CityWeekendModel | null> {
  const now = new Date().toISOString()
  const record = cityHubForSlug(slug)
  if (record) return getCityWeekend(record.slug, now)
  const { tiles } = await getCityTiles()
  const tile = tiles.find((t) => t.slug === slug)
  if (!tile?.city) return null
  return getLiveCityWeekend(tile.city, tiles.flatMap((t) => (t.city ? [t.city] : [])), now)
}
