// #4318 — usemingla.com/links: the pure week model.
//
// Everything here is a plain function of its inputs (no React, no fetch, no
// clock), so the server page, the client page and the node tests share one
// truth:
//   - the database shapes the page reads (`links_page_week()` listing rows and
//     `links_page_strips()` admin strips) and their validation;
//   - which live city a listing belongs to (nearest registry centre, 60 km);
//   - which city the page opens on (?city= > visitor location > remembered
//     city > busiest city);
//   - the week (today through today+6 in the city's own time zone), its day
//     grouping and the strip labels.
//
// Constitution #9: nothing here invents a plan. A row that does not validate
// is dropped, never patched up.

export type LinksListingKind = 'event' | 'trip' | 'experience'
export type LinksPinLabel = 'From Mingla' | 'Featured' | 'New' | 'Giveaway'
export type LinksPinOpens = 'web' | 'blog' | 'explorer' | 'host'

/** One row of `public.links_page_week()` (one per occurrence date). */
export interface LinksWeekRow {
  kind: string
  title: string
  place_label: string | null
  starts_at: string
  ends_at: string | null
  tz: string | null
  lat: number | null
  lng: number | null
  cover_url: string | null
  brand_slug: string | null
  item_slug: string | null
}

/** One row of `public.links_page_strips()` (published, unexpired). */
export interface LinksStripRow {
  id: string
  city_slug: string | null
  shows_on: string
  title: string
  label: string
  opens: string
  url: string | null
  blog_slug: string | null
  position: number
}

export interface LinksPoint {
  lat: number
  lng: number
}

/** A live city as the page needs it (built from content/cities/registry.ts). */
export interface LinksCity extends LinksPoint {
  slug: string
  name: string
  region: string
  timezone: string
  /** How far a listing may be from the centre and still belong here (registry CITY_HUB_REACH_KM). */
  reachKm?: number
}

export interface LinksListing {
  id: string
  kind: LinksListingKind
  title: string
  place: string | null
  startsAt: string
  tz: string
  cover: string | null
  brandSlug: string
  itemSlug: string
  citySlug: string
}

export interface LinksPin {
  id: string
  /** null = every live city. */
  citySlug: string | null
  /** YYYY-MM-DD, the day shown on the strip. */
  showsOn: string
  title: string
  label: LinksPinLabel
  opens: LinksPinOpens
  /** web only: host.tld/path, stored without a scheme. */
  url: string | null
  /** blog only. */
  blogSlug: string | null
  position: number
}

/** The reach of a city that does not state its own (the registry states every one). */
export const NEAREST_CITY_RADIUS_KM = 60
export const WEEK_DAYS = 7

const LISTING_KINDS: readonly LinksListingKind[] = ['event', 'trip', 'experience']
const PIN_LABELS: readonly LinksPinLabel[] = ['From Mingla', 'Featured', 'New', 'Giveaway']
const PIN_OPENS: readonly LinksPinOpens[] = ['web', 'blog', 'explorer', 'host']
const SLUG = /^[a-z0-9][a-z0-9-]{0,159}$/i
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

function isOneOf<T extends string>(list: readonly T[], value: string): value is T {
  return (list as readonly string[]).includes(value)
}

// ---------------------------------------------------------------- distance

/** The city whose centre is nearest among those whose own reach covers the point. */
export function owningCity<C extends LinksCity>(cities: readonly C[], point: LinksPoint): { city: C; km: number } | null {
  let best: { city: C; km: number } | null = null
  for (const city of cities) {
    const km = haversineKm(point, city)
    if (km <= (city.reachKm ?? NEAREST_CITY_RADIUS_KM) && (best === null || km < best.km)) best = { city, km }
  }
  return best
}

/** Great-circle distance in km. */
export function haversineKm(a: LinksPoint, b: LinksPoint): number {
  const r = Math.PI / 180
  const dLat = (b.lat - a.lat) * r
  const dLng = (b.lng - a.lng) * r
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(x)))
}

/** The nearest city to a point, optionally only within `maxKm`. */
export function nearestCity<C extends LinksPoint>(
  cities: readonly C[],
  point: LinksPoint,
  maxKm: number = Number.POSITIVE_INFINITY,
): { city: C; km: number } | null {
  let best: { city: C; km: number } | null = null
  for (const city of cities) {
    const km = haversineKm(point, city)
    if (km <= maxKm && (best === null || km < best.km)) best = { city, km }
  }
  return best
}

/** "12 mi" for US visitors, "19 km" everywhere else. */
export function distanceLabel(km: number, useMiles: boolean): string {
  return useMiles ? `${Math.round(km * 0.621371)} mi` : `${Math.round(km)} km`
}

/** Vercel's coarse IP location headers, or null when missing or nonsense. */
export function parseGeoHeaders(lat: string | null, lng: string | null): LinksPoint | null {
  if (lat === null || lng === null || lat.trim() === '' || lng.trim() === '') return null
  const point = { lat: Number(lat), lng: Number(lng) }
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null
  if (Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) return null
  return point
}

// ---------------------------------------------------------------- dates

function safeZone(tz: string | null | undefined, fallback: string): string {
  for (const zone of [tz, fallback]) {
    if (!zone) continue
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: zone })
      return zone
    } catch {
      // not a zone this runtime knows; try the next one
    }
  }
  return 'UTC'
}

/** The calendar date (YYYY-MM-DD) of an instant in a time zone. */
export function localDateKey(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
}

/** The local hour (0-23) of an instant in a time zone. */
export function localHour(iso: string, tz: string): number {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' })
    .formatToParts(new Date(iso))
    .find((p) => p.type === 'hour')
  return part ? Number(part.value) % 24 : 0
}

export function addDaysKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

function keyDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12))
}

/** "Sat 7" */
export function shortDayLabel(key: string): string {
  const date = keyDate(key)
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(date)
  return `${weekday} ${date.getUTCDate()}`
}

/** "Saturday 7 November" */
export function longDayLabel(key: string): string {
  const date = keyDate(key)
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(date)
  const month = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(date)
  return `${weekday} ${date.getUTCDate()} ${month}`
}

/** "7 PM", "7:30 PM" in the listing's own zone. */
export function timeLabel(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })
    .format(new Date(iso))
    .replace(':00', '')
}

// ---------------------------------------------------------------- rows

/**
 * Listing rows → listings, each assigned to the nearest city whose own reach
 * (60 km, Lagos 80 km) covers it. A row with no location, an unknown kind or no slugs is dropped.
 */
export function bucketListings(rows: readonly LinksWeekRow[], cities: readonly LinksCity[]): LinksListing[] {
  const out: LinksListing[] = []
  for (const row of rows) {
    if (!isOneOf(LISTING_KINDS, row.kind)) continue
    const title = (row.title ?? '').trim()
    if (title === '' || Number.isNaN(Date.parse(row.starts_at))) continue
    if (!row.brand_slug || !row.item_slug || !SLUG.test(row.brand_slug) || !SLUG.test(row.item_slug)) continue
    if (typeof row.lat !== 'number' || typeof row.lng !== 'number') continue
    if (!Number.isFinite(row.lat) || !Number.isFinite(row.lng)) continue
    const hit = owningCity(cities, { lat: row.lat, lng: row.lng })
    if (hit === null) continue
    const startsAt = new Date(row.starts_at).toISOString()
    out.push({
      id: `${row.kind}:${row.brand_slug}/${row.item_slug}@${startsAt}`,
      kind: row.kind,
      title,
      place: row.place_label?.trim() || null,
      startsAt,
      tz: safeZone(row.tz, hit.city.timezone),
      cover: row.cover_url && /^https:\/\//.test(row.cover_url) ? row.cover_url : null,
      brandSlug: row.brand_slug,
      itemSlug: row.item_slug,
      citySlug: hit.city.slug,
    })
  }
  return out.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.title.localeCompare(b.title))
}

/**
 * The https URL a web strip opens, from its stored `host.tld/path`. Null when
 * it does not look like a public web address (the strip is then dropped).
 */
export function pinWebHref(stored: string | null): string | null {
  if (!stored) return null
  const bare = stored.trim().replace(/^https?:\/\//i, '')
  if (bare === '' || /\s/.test(bare)) return null
  try {
    const url = new URL(`https://${bare}`)
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return null
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(url.hostname)) return null
    return url.toString()
  } catch {
    return null
  }
}

/** Strip rows → valid admin strips in the admin's order. */
export function normalisePins(rows: readonly LinksStripRow[]): LinksPin[] {
  const out: LinksPin[] = []
  for (const row of rows) {
    if (!isOneOf(PIN_LABELS, row.label) || !isOneOf(PIN_OPENS, row.opens)) continue
    const title = (row.title ?? '').trim()
    if (title === '' || !DATE_KEY.test(row.shows_on ?? '')) continue
    if (row.city_slug !== null && !SLUG.test(row.city_slug)) continue
    if (row.opens === 'web' && pinWebHref(row.url) === null) continue
    if (row.opens === 'blog' && (!row.blog_slug || !SLUG.test(row.blog_slug))) continue
    out.push({
      id: row.id,
      citySlug: row.city_slug,
      showsOn: row.shows_on,
      title,
      label: row.label,
      opens: row.opens,
      url: row.opens === 'web' ? row.url : null,
      blogSlug: row.opens === 'blog' ? row.blog_slug : null,
      position: Number.isFinite(row.position) ? row.position : 0,
    })
  }
  return out.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
}

// ---------------------------------------------------------------- the week

export interface LinksDay {
  key: string
  listings: LinksListing[]
}

export interface LinksWeek {
  /** YYYY-MM-DD, today in the city's zone. */
  today: string
  /** The seven day keys, today first. */
  keys: string[]
  /** Listings this week, by start. */
  listings: LinksListing[]
  /** Only the days that have something on. */
  days: LinksDay[]
  /** Admin strips for this city (its own and every-city ones), admin order. */
  pins: LinksPin[]
}

/** The listing's own calendar day. */
export function listingDayKey(listing: LinksListing): string {
  return localDateKey(listing.startsAt, listing.tz)
}

/** The city's week: today through today+6 in its own zone, grouped by day. */
export function cityWeek(
  city: LinksCity,
  listings: readonly LinksListing[],
  pins: readonly LinksPin[],
  nowIso: string,
): LinksWeek {
  const zone = safeZone(city.timezone, 'UTC')
  const today = localDateKey(nowIso, zone)
  const keys = Array.from({ length: WEEK_DAYS }, (_, i) => addDaysKey(today, i))
  const inWeek = new Set(keys)
  const mine = listings.filter((l) => l.citySlug === city.slug && inWeek.has(listingDayKey(l)))
  const days = keys
    .map((key) => ({ key, listings: mine.filter((l) => listingDayKey(l) === key) }))
    .filter((d) => d.listings.length > 0)
  const cityPins = pins.filter((p) => (p.citySlug === null || p.citySlug === city.slug) && p.showsOn >= today)
  return { today, keys, listings: mine, days, pins: cityPins }
}

/** Strip label: "Event · Sat 7", "Event · Today" or "Tonight" (today from 5 PM). */
export function listingWhen(listing: LinksListing, today: string): { tonight: boolean; text: string } {
  const key = listingDayKey(listing)
  const kind = listing.kind === 'event' ? 'Event' : listing.kind === 'trip' ? 'Trip' : 'Experience'
  if (key === today && localHour(listing.startsAt, listing.tz) >= 17) return { tonight: true, text: 'Tonight' }
  return { tonight: false, text: `${kind} · ${key === today ? 'Today' : shortDayLabel(key)}` }
}

/** Admin strip label: "From Mingla · Thu 12". No time, no place. */
export function pinWhen(pin: LinksPin, today: string): string {
  return `${pin.label} · ${pin.showsOn === today ? 'Today' : shortDayLabel(pin.showsOn)}`
}

// ---------------------------------------------------------------- cities

/**
 * The picker's cities: only those with at least one listing or one admin strip
 * aimed at that city this week, with their listing counts.
 */
export function liveCities(
  cities: readonly LinksCity[],
  listings: readonly LinksListing[],
  pins: readonly LinksPin[],
  nowIso: string,
): Array<{ city: LinksCity; count: number }> {
  return cities
    .map((city) => {
      const week = cityWeek(city, listings, pins, nowIso)
      // An every-city strip does not make a city live on its own.
      const own = week.pins.filter((p) => p.citySlug === city.slug).length
      return { city, count: week.listings.length, pins: own }
    })
    .filter((c) => c.count > 0 || c.pins > 0)
    .map(({ city, count }) => ({ city, count }))
}

export type CitySource = 'query' | 'geo' | 'cookie' | 'busiest' | 'fallback'

export interface ResolveCityInput {
  cities: readonly LinksCity[]
  live: ReadonlyArray<{ city: LinksCity; count: number }>
  query: string | null
  geo: LinksPoint | null
  cookie: string | null
}

/**
 * The city the page opens on (#4318 §10):
 *   1. `?city=<slug>` always wins (city-specific bio links);
 *   2. the visitor's coarse location: the nearest live city, however far;
 *   3. the city they picked last time, when it is live;
 *   4. the live city with the most plans this week;
 *   5. with nothing live anywhere, the same rules over every registry city.
 */
export function resolveCity({ cities, live, query, geo, cookie }: ResolveCityInput): { slug: string; source: CitySource } {
  if (cities.length === 0) throw new Error('#4318 links: the city registry is empty')
  if (query !== null && cities.some((c) => c.slug === query)) return { slug: query, source: 'query' }
  const pool = live.length > 0 ? live.map((l) => l.city) : cities
  if (geo !== null) {
    const hit = nearestCity(pool, geo)
    if (hit !== null) return { slug: hit.city.slug, source: 'geo' }
  }
  if (cookie !== null && pool.some((c) => c.slug === cookie)) return { slug: cookie, source: 'cookie' }
  if (live.length > 0) {
    const busiest = live.reduce((best, next) => (next.count > best.count ? next : best))
    return { slug: busiest.city.slug, source: 'busiest' }
  }
  return { slug: cities[0].slug, source: 'fallback' }
}

/** Picker order: closest to the visitor first, else registry order. */
export function pickerOrder(
  live: ReadonlyArray<{ city: LinksCity; count: number }>,
  geo: LinksPoint | null,
): Array<{ city: LinksCity; count: number; km: number | null }> {
  const rows = live.map((l) => ({ ...l, km: geo === null ? null : haversineKm(geo, l.city) }))
  if (geo !== null) rows.sort((a, b) => (a.km ?? 0) - (b.km ?? 0))
  return rows
}

/**
 * The empty list's line (#4318 rulings): a city with nothing says so and only
 * offers another city when one is live; with nothing live anywhere (or a
 * failed read) it says to check back.
 */
export function emptyListText(input: {
  nothingAnywhere: boolean
  cityHasListings: boolean
  cityName: string
  plural: string
  otherLiveCity: boolean
}): string {
  if (input.nothingAnywhere) return 'Nothing is listed this week yet. Check back soon.'
  if (input.cityHasListings) return `No ${input.plural} listed in ${input.cityName} this week yet.`
  return `Nothing is listed in ${input.cityName} this week yet.${input.otherLiveCity ? ' Try another city.' : ''}`
}
