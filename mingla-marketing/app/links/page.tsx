// ORCH-1317 → #4318 — usemingla.com/links, the single link in Mingla's social
// bios: a one-screen week calendar for every live Mingla city.
//
// A thin SERVER Component. It owns the SEO metadata (public, noindex), reads
// the week and the live cities through lib/links-data.ts (cached 5 minutes),
// works out which city the page opens on, and hands plain data to the client
// <LinksExperience/>.
//
// The cities are exactly the ones live for consumers in Explorer
// (`links_page_cities()`); the database is their one owner. The city-guide
// registry only lends an older slug, the region line and the time zone to the
// city it already describes; it never adds or removes a /links city.
//
// City order (lib/links-week.ts resolveCity; it picks whose LISTINGS show, admin
// strips show in every city): `?city=<slug>` wins (an older registry slug
// too), then the visitor's coarse location from Vercel's edge headers (no
// prompt, nothing stored), then the city they picked last time (cookie), then
// the busiest city.
//
// ORCH-1399 — `?src=` is UNTRUSTED INPUT that reaches an OUTBOUND URL. It is
// sanitised HERE, once, at the boundary (sanitizeLinksSrc), and passed down as
// a page-level prop so every tap on the page carries the same bio pid.

import { cookies, headers } from 'next/headers'
import { LinksExperience } from '@/components/marketing/links-experience'
import { CITY_HUB_CENTRES, CITY_HUB_REGIONS, CITY_HUBS } from '@/content/cities/registry'
import { LINKS_CITY_COOKIE } from '@/lib/links-config'
import { getLinksData, getLinksPlaces } from '@/lib/links-data'
import { sanitizeLinksSrc } from '@/lib/links-src'
import {
  bucketListings,
  cityReachKm,
  linksCitiesFromRows,
  liveCities,
  normalisePins,
  parseGeoHeaders,
  resolveCity,
  withListingZones,
  type LinksCity,
  type LinksCityHint,
} from '@/lib/links-week'
import { publicNoindexMetadata } from '@/lib/search/metadata'
import { linksSans, linksMono, linksSerif } from './fonts'

export const metadata = publicNoindexMetadata('/links', {
  title: 'Get Mingla',
  description:
    'Mingla is the experiences app for date nights, things to do, and your city’s hidden gems. Get the app, or if you run a venue, event, or trip, get started on the web.',
})

const CITY_SLUG = /^[a-z0-9-]{2,60}$/

function oneParam(raw: string | string[] | undefined): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim().toLowerCase()
  return CITY_SLUG.test(value) ? value : null
}

/** What the city guides already know: an older slug, a region line and a zone per centre. */
function registryHints(): LinksCityHint[] {
  return CITY_HUBS.map((hub) => ({
    slug: hub.slug,
    countryCode: hub.countryCode,
    region: CITY_HUB_REGIONS[hub.slug],
    timezone: hub.timezone,
    ...CITY_HUB_CENTRES[hub.slug],
  }))
}

/**
 * Only while `links_page_cities()` cannot be read (no database configured, or
 * the read failed and was logged): the city guides stand in so the bio link
 * still opens on its "Check back soon" state instead of crashing. Nothing is
 * listed in this mode, so no city is presented as having plans.
 */
function outageCities(hints: readonly LinksCityHint[]): LinksCity[] {
  return CITY_HUBS.map((hub, i) => ({
    ...hints[i],
    name: hub.city,
    reachKm: cityReachKm(hub.slug),
    aliases: [],
    placeCount: null,
  }))
}

export default async function LinksPage({
  searchParams,
}: {
  searchParams: Promise<{ src?: string | string[]; city?: string | string[] }>
}) {
  const { src, city } = await searchParams
  const [requestHeaders, jar, data] = await Promise.all([headers(), cookies(), getLinksData()])

  const nowIso = new Date().toISOString()
  const hints = registryHints()
  const dbCities = linksCitiesFromRows(data.cities, hints)
  const outage = dbCities.length === 0
  if (outage && !data.failed.includes('cities') && data.cities.length > 0) {
    console.error('[#4318 links] links_page_cities returned no valid city', data.cities.length)
  }
  const unzoned = outage ? outageCities(hints) : dbCities
  const listings = outage ? [] : bucketListings(data.rows, unzoned)
  const cities = withListingZones(unzoned, listings)
  const pins = normalisePins(data.strips)
  const live = liveCities(cities, listings, pins, nowIso)
  const geo = parseGeoHeaders(
    requestHeaders.get('x-vercel-ip-latitude'),
    requestHeaders.get('x-vercel-ip-longitude'),
  )
  const initial = resolveCity({
    cities,
    live,
    query: oneParam(city),
    geo,
    cookie: oneParam(jar.get(LINKS_CITY_COOKIE)?.value),
  })

  // The quiet-week places (#4318 addendum 2): the picker lists every live
  // city, so every quiet one the visitor can switch to gets its places (each
  // read cached 5 minutes). A city with no photo places is not asked.
  const liveSlugs = new Set(live.map((l) => l.city.slug))
  const quietCities = cities.filter((c) => !liveSlugs.has(c.slug) && c.placeCount !== 0)
  const readFailed = outage || data.failed.includes('week')
  const places = readFailed ? { places: {}, failed: [] } : await getLinksPlaces(quietCities)

  return (
    <div className={`${linksSerif.variable} ${linksSans.variable} ${linksMono.variable}`}>
      <LinksExperience
        src={sanitizeLinksSrc(src)}
        nowIso={nowIso}
        cities={cities}
        listings={listings}
        pins={pins}
        initialCity={initial.slug}
        visitor={{ point: geo, useMiles: requestHeaders.get('x-vercel-ip-country') === 'US' }}
        readFailed={readFailed}
        places={places.places}
        placesFailed={places.failed}
      />
    </div>
  )
}
