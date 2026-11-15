// #4318 — the pure week model behind the city pages' "This weekend" and the
// Admin strips on usemingla.com/links (/links itself has no city section, #4339).
//
// Everything here is a plain function of its inputs (no React, no fetch, no
// clock), so the server page, the client page and the node tests share one
// truth:
//   - the database shapes the page reads (`links_page_week()` listing rows and
//     `links_page_strips()` admin strips) and their validation;
//   - the live cities: exactly the rows of `links_page_cities()` (the cities
//     live for consumers in Explorer), never a hand-kept list;
//   - which live city a listing belongs to (nearest centre within its reach:
//     60 km, Lagos 80 km);
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
  /** Optional last day (Admin "Show until"); never before shows_on. */
  shows_until?: string | null
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

/** A live city as the page needs it (built from `links_page_cities()` rows by linksCitiesFromRows). */
export interface LinksCity extends LinksPoint {
  slug: string
  name: string
  region: string
  timezone: string
  /** How far a listing may be from the centre and still belong here (cityReachKm). */
  reachKm?: number
  /** Older slugs that still open this city through `?city=` or the remembered-city cookie. */
  aliases?: string[]
  /** The city's id in `seeding_cities` (from `links_page_cities()`); its places are read by id. */
  cityId?: string
  /** Whether the city has any photo place (links_page_places rules); null when unknown. */
  hasPlaces?: boolean | null
}

/** One row of `public.links_page_cities()`: a city live for consumers in Explorer. */
export interface LinksCityRow {
  city_id: string
  name: string
  country_code: string | null
  center_lat: number
  center_lng: number
  /** Any photo place under the links_page_places rules (#4318: replaced place_count). */
  has_places: boolean
}

/**
 * What the city-guide registry already knows about a city (content/cities/
 * registry.ts). Only used to enrich a live city the database lists: its older
 * slug, its region line and its time zone. It never adds or removes a city.
 */
export interface LinksCityHint extends LinksPoint {
  slug: string
  countryCode: string
  region: string
  timezone: string
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
  /** YYYY-MM-DD, the day shown on the strip (its first day). */
  showsOn: string
  /** YYYY-MM-DD, the last day when Admin set "Show until"; null for a one-day strip. */
  showsUntil: string | null
  title: string
  label: LinksPinLabel
  opens: LinksPinOpens
  /** web only: host.tld/path, stored without a scheme. */
  url: string | null
  /** blog only. */
  blogSlug: string | null
  position: number
}

/** The reach of every city without an override (LINKS_CITY_REACH_KM). */
export const NEAREST_CITY_RADIUS_KM = 60
/**
 * Per-slug reach overrides (km). Lagos reaches 80 km because the metro and the
 * Lekki coast sprawl (Ibeju-Lekki, the Lekki Free Trade Zone). Every other
 * city, including one that goes live tomorrow, reaches NEAREST_CITY_RADIUS_KM.
 */
export const LINKS_CITY_REACH_KM: Readonly<Record<string, number>> = { lagos: 80 }
/** How close a registry centre must be to a live city's centre to be the same city. */
export const CITY_HINT_MATCH_KM = 30
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

// ---------------------------------------------------------------- the live cities

/** "Fort Lauderdale" → "fort-lauderdale", "Washington, D.C." → "washington-dc", "Liège" → "liege". */
export function citySlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
}

/** The listing reach of a city: its override, else 60 km. */
export function cityReachKm(slug: string): number {
  return LINKS_CITY_REACH_KM[slug] ?? NEAREST_CITY_RADIUS_KM
}

function countryName(code: string | null): string {
  if (!code) return ''
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code
  } catch {
    return code
  }
}

const CITY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * `links_page_cities()` rows → the page's live cities, in the database's order.
 * The database is the one owner of which cities are live and where they are;
 * the registry hints only add an older slug (accepted by `?city=`), the region
 * line and the time zone for the city whose centre they share. A city with no
 * hint still works: its country is the region line and its zone comes from its
 * own listings (withListingZones), else UTC. A row that does not validate is
 * dropped; two live cities that slug the same keep the first plain and give
 * the next its country code (`-us`).
 */
export function linksCitiesFromRows(rows: readonly LinksCityRow[], hints: readonly LinksCityHint[]): LinksCity[] {
  const out: LinksCity[] = []
  const taken = new Set<string>()
  for (const row of rows) {
    if (!row || typeof row.city_id !== 'string' || !CITY_ID.test(row.city_id)) continue
    const name = (row.name ?? '').trim()
    const lat = Number(row.center_lat)
    const lng = Number(row.center_lng)
    if (name === '' || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue
    const code =
      typeof row.country_code === 'string' && /^[A-Za-z]{2}$/.test(row.country_code.trim())
        ? row.country_code.trim().toUpperCase()
        : null
    let slug = citySlug(name)
    if (slug === '') continue
    if (taken.has(slug)) slug = code ? `${slug}-${code.toLowerCase()}` : ''
    if (slug === '' || taken.has(slug)) continue
    taken.add(slug)
    const point = { lat, lng }
    const hint = nearestCity(
      hints.filter((h) => code !== null && h.countryCode.toUpperCase() === code),
      point,
      CITY_HINT_MATCH_KM,
    )?.city
    out.push({
      slug,
      name,
      region: hint?.region ?? countryName(code),
      timezone: hint?.timezone ?? '',
      reachKm: cityReachKm(slug),
      aliases: hint && hint.slug !== slug ? [hint.slug] : [],
      cityId: row.city_id.toLowerCase(),
      hasPlaces: typeof row.has_places === 'boolean' ? row.has_places : null,
      lat,
      lng,
    })
  }
  return out
}

/**
 * The `links_page_places` arguments for a quiet city: its `city_id` when known
 * (the fast per-city index path), with the centre and reach as the fallback
 * the function still requires. Without an id, the lat/lng path alone.
 */
export function linksPlacesArgs(city: LinksCity, limit: number): Record<string, number | string> {
  const args: Record<string, number | string> = {
    p_lat: city.lat,
    p_lng: city.lng,
    p_radius_km: Math.round(city.reachKm ?? cityReachKm(city.slug)),
    p_limit: limit,
  }
  if (city.cityId && CITY_ID.test(city.cityId)) args.p_city_id = city.cityId
  return args
}

/** The live city a `?city=` value or remembered slug names: its own slug or an older one. */
export function cityForSlug<C extends LinksCity>(cities: readonly C[], slug: string | null): C | null {
  if (slug === null) return null
  return cities.find((c) => c.slug === slug) ?? cities.find((c) => (c.aliases ?? []).includes(slug)) ?? null
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
    const until = row.shows_until ?? null
    out.push({
      id: row.id,
      showsOn: row.shows_on,
      showsUntil: until !== null && DATE_KEY.test(until) && until > row.shows_on ? until : null,
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
  const cityPins = pins.filter((p) => pinLive(p, nowIso))
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

/**
 * The zone whose calendar is furthest behind (UTC-12). Admin dates are typed
 * in the admin's own day, which can be a day behind a viewer's city (a strip
 * posted on a US evening is already "yesterday" in Lagos), so a strip stays
 * up until its last day has ended everywhere, never cut early in a city that
 * is ahead. Same idea as the database cut-off in `links_page_strips()`.
 */
const LATEST_ZONE = 'Etc/GMT+12'

/** The strip's last day: "Show until" when set, else its one day. */
export function pinLastDay(pin: LinksPin): string {
  return pin.showsUntil ?? pin.showsOn
}

/** True while the strip's last day has not ended in every time zone. */
export function pinLive(pin: LinksPin, nowIso: string): boolean {
  return pinLastDay(pin) >= localDateKey(nowIso, LATEST_ZONE)
}

/**
 * Admin strip label: "From Mingla · Thu 12" before it starts, "From Mingla ·
 * Today" once it is running (in this city or still in the admin's day). No
 * time, no place.
 */
export function pinWhen(pin: LinksPin, today: string): string {
  return `${pin.label} · ${pin.showsOn > today ? shortDayLabel(pin.showsOn) : 'Today'}`
}

/** The strip sheet's date line: "Sunday 8 November", or a range with "Show until". */
export function pinDaysLabel(pin: LinksPin): string {
  return !pin.showsUntil
    ? longDayLabel(pin.showsOn)
    : `${longDayLabel(pin.showsOn)} – ${longDayLabel(pin.showsUntil)}`
}

// ---------------------------------------------------------------- cities

/**
 * Every live city with its plan count this week (0 for a quiet city). Admin
 * strips show in every city, so they never count; the `pins` argument stays so
 * callers pass the same week inputs.
 */
export function cityCounts(
  cities: readonly LinksCity[],
  listings: readonly LinksListing[],
  pins: readonly LinksPin[],
  nowIso: string,
): Array<{ city: LinksCity; count: number }> {
  // "N this week" counts plans, not dates (a recurring plan is one).
  return cities.map((city) => ({ city, count: groupListings(cityWeek(city, listings, pins, nowIso).listings).length }))
}

/**
 * The cities with at least one plan this week, with their counts: what
 * "busiest city" and "Plans in <city> →" choose from.
 */
export function liveCities(
  cities: readonly LinksCity[],
  listings: readonly LinksListing[],
  pins: readonly LinksPin[],
  nowIso: string,
): Array<{ city: LinksCity; count: number }> {
  return cityCounts(cities, listings, pins, nowIso).filter((c) => c.count > 0)
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
  | { mode: 'fallback'; text: string; plansIn?: LinksCity | null; hostCity?: string }

/**
 * The shared "nothing this week" rule (#4318 addendum 2, mirrored by #4339):
 *   1. admin strips always first (rendered above, not decided here);
 *   2. the city has listings this week: the listings;
 *   3. no listings: "A quiet week in <City>." with up to 3 real places;
 *   4. under that, "Plans in <nearest live city> →" when another city has
 *      listings, then "Host something in <City> →";
 *   5. a failed read: the fallback line alone;
 *   6. no places to show: the fallback line, then "Plans in <city> →" when
 *      another city has listings and "Host something in <City> →".
 */
export function quietWeek(input: {
  city: LinksCity
  cityHasListings: boolean
  places: readonly LinksPlace[]
  live: ReadonlyArray<{ city: LinksCity; count: number }>
  readFailed: boolean
}): QuietWeek {
  if (input.cityHasListings) return { mode: 'listings' }
  const text = 'Nothing is listed this week yet. Check back soon.'
  if (input.readFailed) return { mode: 'fallback', text }
  const plansIn = nearestLiveCity(input.city, input.live)
  if (input.places.length === 0) return { mode: 'fallback', text, plansIn, hostCity: input.city.name }
  return {
    mode: 'quiet',
    heading: `A quiet week in ${input.city.name}.`,
    places: input.places.slice(0, QUIET_WEEK_PLACES),
    plansIn,
    hostCity: input.city.name,
  }
}
