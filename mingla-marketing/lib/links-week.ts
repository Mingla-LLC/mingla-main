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

/**
 * One row of `public.links_page_strips()` (published, unexpired). Admin strips
 * are not by city (Seth, 8 Nov 2026): every strip shows first in every city.
 */
export interface LinksStripRow {
  id: string
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
    if (row.opens === 'web' && pinWebHref(row.url) === null) continue
    if (row.opens === 'blog' && (!row.blog_slug || !SLUG.test(row.blog_slug))) continue
    out.push({
      id: row.id,
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
  /** Every unexpired admin strip (strips show in every city), admin order. */
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
  const cityPins = pins.filter((p) => p.showsOn >= today)
  return { today, keys, listings: mine, days, pins: cityPins }
}

/** Strip label: "Event · Sat 7", "Event · Today" or "Tonight" (today from 5 PM). */
export function listingWhen(listing: LinksListing, today: string): { tonight: boolean; text: string } {
  const key = listingDayKey(listing)
  const kind = listing.kind === 'event' ? 'Event' : listing.kind === 'trip' ? 'Trip' : 'Experience'
  if (key === today && localHour(listing.startsAt, listing.tz) >= 17) return { tonight: true, text: 'Tonight' }
  return { tonight: false, text: `${kind} · ${key === today ? 'Today' : shortDayLabel(key)}` }
}

// ---------------------------------------------------------------- recurring plans

/**
 * One strip per recurring plan (#4318, Seth 8 Nov): the week's rows that share
 * brand_slug + item_slug are one plan. `dates` are its occurrences in order and
 * `next` is the first, which the hand-off and the item sheet open.
 */
export interface LinksPlan {
  id: string
  next: LinksListing
  dates: LinksListing[]
}

export function groupListings(listings: readonly LinksListing[]): LinksPlan[] {
  const byKey = new Map<string, LinksListing[]>()
  for (const listing of listings) {
    const key = `${listing.kind}:${listing.brandSlug}/${listing.itemSlug}`
    const dates = byKey.get(key)
    if (dates) dates.push(listing)
    else byKey.set(key, [listing])
  }
  return [...byKey.entries()]
    .map(([key, dates]) => {
      const sorted = [...dates].sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      return { id: key, next: sorted[0], dates: sorted }
    })
    .sort((a, b) => a.next.startsAt.localeCompare(b.next.startsAt) || a.next.title.localeCompare(b.next.title))
}

function weekdayShort(key: string): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(keyDate(key))
}

/**
 * A plan's strip label. One date: as listingWhen ("Event · Sat 7", "Tonight").
 * Several: the day span when the days run on ("Event · Mon–Fri"), else the
 * days listed ("Event · Mon, Wed, Fri").
 */
export function planWhen(plan: LinksPlan, today: string): { tonight: boolean; text: string } {
  const days = [...new Set(plan.dates.map(listingDayKey))].sort()
  if (days.length <= 1) return listingWhen(plan.next, today)
  const kind = plan.next.kind === 'event' ? 'Event' : plan.next.kind === 'trip' ? 'Trip' : 'Experience'
  const runOn = days.every((key, i) => i === 0 || addDaysKey(days[i - 1], 1) === key)
  const span = runOn
    ? `${weekdayShort(days[0])}–${weekdayShort(days[days.length - 1])}`
    : days.map(weekdayShort).join(', ')
  return { tonight: false, text: `${kind} · ${span}` }
}

/** Admin strip label: "From Mingla · Thu 12". No time, no place. */
export function pinWhen(pin: LinksPin, today: string): string {
  return `${pin.label} · ${pin.showsOn === today ? 'Today' : shortDayLabel(pin.showsOn)}`
}

// ---------------------------------------------------------------- cities

/**
 * The picker's cities: only those with at least one listing this week, with
 * their listing counts. Admin strips show in every city, so they never make a
 * city live; the `pins` argument stays so callers pass the same week inputs.
 */
export function liveCities(
  cities: readonly LinksCity[],
  listings: readonly LinksListing[],
  pins: readonly LinksPin[],
  nowIso: string,
): Array<{ city: LinksCity; count: number }> {
  return cities
    // "N this week" counts plans, not dates (a recurring plan is one).
    .map((city) => ({ city, count: groupListings(cityWeek(city, listings, pins, nowIso).listings).length }))
    .filter((c) => c.count > 0)
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

// ---------------------------------------------------------------- places (the quiet week)

/** One row of `public.links_page_places(p_lat, p_lng, p_radius_km, p_limit)`. */
export interface LinksPlaceRow {
  place_id: string
  name: string
  category: string | null
  area_label: string | null
  lat: number | null
  lng: number | null
  photo_path: string | null
}

export interface LinksPlace {
  id: string
  name: string
  category: string | null
  area: string | null
  /** The stored `<placeId>/<n>_thumb.jpg` on the public object endpoint, or null. */
  photo: string | null
  citySlug: string
}

export const QUIET_WEEK_PLACES = 3
const PLACE_ID = /^[A-Za-z0-9_-]{8,256}$/
const PLACE_THUMB_PATH = /^[A-Za-z0-9_-]{8,256}\/\d{1,3}_thumb\.jpg$/

/**
 * The public URL of a stored place thumbnail: the non-metered public object
 * endpoint of the `place-photos` bucket, never /render/image (hold #1643), and
 * only the pre-generated `<placeId>/<n>_thumb.jpg` objects.
 */
export function placePhotoUrl(storageBase: string, path: string | null): string | null {
  if (!path || !PLACE_THUMB_PATH.test(path)) return null
  const base = storageBase.replace(/\/$/, '')
  if (!/^https:\/\//.test(base)) return null
  return `${base}/storage/v1/object/public/place-photos/${path}`
}

/** Place rows → at most 3 valid places for one city. */
export function normalisePlaces(rows: readonly LinksPlaceRow[], citySlug: string, storageBase: string): LinksPlace[] {
  const out: LinksPlace[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (!row || typeof row.place_id !== 'string' || !PLACE_ID.test(row.place_id) || seen.has(row.place_id)) continue
    const name = (row.name ?? '').trim()
    if (name === '') continue
    seen.add(row.place_id)
    out.push({
      id: row.place_id,
      name,
      category: row.category?.trim() || null,
      area: row.area_label?.trim() || null,
      photo: placePhotoUrl(storageBase, row.photo_path),
      citySlug,
    })
    if (out.length === QUIET_WEEK_PLACES) break
  }
  return out
}

/** The nearest other city with listings this week, for "Plans in <city> →". */
export function nearestLiveCity(
  city: LinksCity,
  live: ReadonlyArray<{ city: LinksCity; count: number }>,
): LinksCity | null {
  const others = live.filter((l) => l.city.slug !== city.slug && l.count > 0).map((l) => l.city)
  return nearestCity(others, city)?.city ?? null
}

export type QuietWeek =
  | { mode: 'listings' }
  | { mode: 'quiet'; heading: string; places: LinksPlace[]; plansIn: LinksCity | null; hostCity: string }
  | { mode: 'fallback'; text: string }

/**
 * The shared "nothing this week" rule (#4318 addendum 2, mirrored by #4339):
 *   1. admin strips always first (rendered above, not decided here);
 *   2. the city has listings this week: the listings;
 *   3. no listings: "A quiet week in <City>." with up to 3 real places;
 *   4. under that, "Plans in <nearest live city> →" when another city has
 *      listings, then "Host something in <City> →";
 *   5. a failed read, or nothing live anywhere and no places: the fallback line.
 */
export function quietWeek(input: {
  city: LinksCity
  cityHasListings: boolean
  places: readonly LinksPlace[]
  live: ReadonlyArray<{ city: LinksCity; count: number }>
  readFailed: boolean
}): QuietWeek {
  if (input.cityHasListings) return { mode: 'listings' }
  const plansIn = nearestLiveCity(input.city, input.live)
  if (input.readFailed || (plansIn === null && input.places.length === 0)) {
    return { mode: 'fallback', text: 'Nothing is listed this week yet. Check back soon.' }
  }
  return {
    mode: 'quiet',
    heading: `A quiet week in ${input.city.name}.`,
    places: input.places.slice(0, QUIET_WEEK_PLACES),
    plansIn,
    hostCity: input.city.name,
  }
}
