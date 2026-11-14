// #4339 — which cities usemingla.com lists: the pure model.
//
// ONE owner per fact (Constitution rule 2):
//   - which cities are live: `seeding_cities.is_live_for_consumers`, read
//     through `links_page_cities()` (lib/links-data.ts, cached 5 minutes);
//   - a city's hand-made guide (FAQs, sources, catalogue): the registry
//     (content/cities/registry.ts). It enriches a live city; it never adds or
//     removes one.
// /cities, the Home cities row, /going-out and /cities/<slug> all derive from
// `liveCityTiles` below, so they can never disagree. Pure and React-free: the
// node test loads this file directly.

import { linksCitiesFromRows, type LinksCity, type LinksCityHint, type LinksCityRow } from './links-week'

/** What a registry guide lends a live city (its name, route slug, zone and centre). */
export interface CityHubInput extends LinksCityHint {
  /** The guide's display name, e.g. "Washington, DC". */
  city: string
}

export interface CityTile {
  /** The `/cities/<slug>` slug: the registry slug for a guide, else the live city's own. */
  slug: string
  /** Display name: the guide's, else the database's. */
  name: string
  /** ISO country code (analytics only); '' when unknown. */
  countryCode: string
  /** True when a hand-made registry guide exists (indexable, in the sitemap). */
  guide: boolean
  /** The live city as the weekend/places readers need it; null only in the registry fallback. */
  city: LinksCity | null
}

export interface CityTiles {
  tiles: CityTile[]
  /** `live`: from `links_page_cities()`. `registry`: the read failed or was empty (never an empty page). */
  source: 'live' | 'registry'
}

/** One-zone countries Mingla is live in, for a city with no registry hint (Africa/Lagos covers all of Nigeria). */
const COUNTRY_ZONE: Readonly<Record<string, string>> = { NG: 'Africa/Lagos' }

function byName(a: CityTile, b: CityTile): number {
  return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.slug.localeCompare(b.slug)
}

/** The ten (or more) registry guides alone, A to Z: the outage fallback. */
export function registryCityTiles(hubs: readonly CityHubInput[]): CityTile[] {
  return hubs.map((hub) => ({ slug: hub.slug, name: hub.city, guide: true, countryCode: hub.countryCode, city: null })).sort(byName)
}

/**
 * Every live city as one tile, A to Z. A live city whose slug or alias is a
 * registry slug is that guide's tile; any other live city is a new-city tile
 * (its page is built from live data). Rows the reader cannot trust (bad id,
 * blank name, out-of-range centre) are dropped by `linksCitiesFromRows`.
 * Returns an empty list when no row is valid: the caller falls back.
 */
export function liveCityTiles(rows: readonly LinksCityRow[], hubs: readonly CityHubInput[]): CityTile[] {
  const live = linksCitiesFromRows(rows, hubs)
  const countryById = new Map<string, string>(
    rows.map((row) => [String(row?.city_id ?? '').toLowerCase(), typeof row?.country_code === 'string' ? row.country_code.trim().toUpperCase() : '']),
  )
  const taken = new Set<string>()
  const tiles: CityTile[] = []
  for (const city of live) {
    const hub = hubs.find((h) => !taken.has(h.slug) && (h.slug === city.slug || (city.aliases ?? []).includes(h.slug)))
    if (hub) {
      taken.add(hub.slug)
      tiles.push({ slug: hub.slug, name: hub.city, guide: true, countryCode: hub.countryCode, city: { ...city, slug: hub.slug, name: hub.city } })
      continue
    }
    const country = countryById.get(city.cityId ?? '') ?? ''
    const zone = COUNTRY_ZONE[country] ?? ''
    tiles.push({ slug: city.slug, name: city.name, guide: false, countryCode: country, city: city.timezone ? city : { ...city, timezone: zone } })
  }
  return tiles.sort(byName)
}

/**
 * What the pages list. Live when the database lists at least one valid live
 * city; otherwise the registry guides (and the caller logs why), so a page is
 * never empty.
 */
export function resolveCityTiles(rows: readonly LinksCityRow[], hubs: readonly CityHubInput[]): CityTiles {
  const tiles = liveCityTiles(rows, hubs)
  return tiles.length > 0 ? { tiles, source: 'live' } : { tiles: registryCityTiles(hubs), source: 'registry' }
}

/** What /cities/<slug> does for a slug, given the resolved tiles and the registry's slugs. */
export type CityRouteDecision =
  | { kind: 'guide'; tile: CityTile }
  | { kind: 'live'; tile: CityTile }
  | { kind: 'redirect' }
  | { kind: 'not_found' }

export function decideCityRoute(slug: string, resolved: CityTiles, guideSlugs: readonly string[]): CityRouteDecision {
  const tile = resolved.tiles.find((t) => t.slug === slug)
  if (tile) return tile.guide ? { kind: 'guide', tile } : { kind: 'live', tile }
  // A guide city that is switched off in Admin: send the visitor to the list.
  // (Never during an outage: then every guide is in the registry fallback above.)
  if (guideSlugs.includes(slug)) return { kind: 'redirect' }
  return { kind: 'not_found' }
}
