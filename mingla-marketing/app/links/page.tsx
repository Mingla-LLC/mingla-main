// ORCH-1317 → #4318 — usemingla.com/links, the single link in Mingla's social
// bios: a one-screen week calendar for every live Mingla city.
//
// A thin SERVER Component. It owns the SEO metadata (public, noindex), reads
// the week through lib/links-data.ts (cached 5 minutes), works out which city
// the page opens on, and hands plain data to the client <LinksExperience/>.
//
// City order (lib/links-week.ts resolveCity; it picks whose LISTINGS show, admin
// strips show in every city): `?city=<slug>` wins, then the
// visitor's coarse location from Vercel's edge headers (no prompt, nothing
// stored), then the city they picked last time (cookie), then the busiest city.
//
// ORCH-1399 — `?src=` is UNTRUSTED INPUT that reaches an OUTBOUND URL. It is
// sanitised HERE, once, at the boundary (sanitizeLinksSrc), and passed down as
// a page-level prop so every tap on the page carries the same bio pid.

import { cookies, headers } from 'next/headers'
import { LinksExperience } from '@/components/marketing/links-experience'
import { CITY_HUB_CENTRES, CITY_HUB_REACH_KM, CITY_HUB_REGIONS, CITY_HUBS } from '@/content/cities/registry'
import { LINKS_CITY_COOKIE } from '@/lib/links-config'
import { getLinksData, getLinksPlaces } from '@/lib/links-data'
import { sanitizeLinksSrc } from '@/lib/links-src'
import {
  bucketListings,
  liveCities,
  normalisePins,
  parseGeoHeaders,
  resolveCity,
  type LinksCity,
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

function registryCities(): LinksCity[] {
  return CITY_HUBS.map((hub) => ({
    slug: hub.slug,
    name: hub.city,
    region: CITY_HUB_REGIONS[hub.slug],
    timezone: hub.timezone,
    reachKm: CITY_HUB_REACH_KM[hub.slug],
    ...CITY_HUB_CENTRES[hub.slug],
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
  const cities = registryCities()
  const listings = bucketListings(data.rows, cities)
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

  // The quiet-week places (#4318 addendum 2): for every city the visitor can
  // reach without listings — the opening city when it is quiet, and every
  // registry city when nothing is live (the picker then lists them all).
  const liveSlugs = new Set(live.map((l) => l.city.slug))
  const quietCities = live.length === 0 ? cities : cities.filter((c) => c.slug === initial.slug && !liveSlugs.has(c.slug))
  const places = data.failed.includes('week') ? { places: {}, failed: [] } : await getLinksPlaces(quietCities)

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
        readFailed={data.failed.includes('week')}
        places={places.places}
        placesFailed={places.failed}
      />
    </div>
  )
}
