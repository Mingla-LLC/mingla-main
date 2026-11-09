// #4339 phase 4a (§4) — the city page's "This weekend", from live data.
//
// Pure: no React, no fetch, no clock. The server page reads #4318's readers
// through lib/links-data.ts (the same 5-minute cache and `links` tag) and hands
// the rows here; the node test feeds stubbed rows. Every building block is
// #4318's own (lib/links-week.ts), imported, never copied:
//   - `bucketListings` assigns each row to a city by the registry centre and
//     the city's own reach (`reachKm`), the same rule /links uses;
//   - `normalisePins` keeps the valid admin strips in admin order (strips are
//     not by city: every published strip shows on every city page);
//   - `cityWeek` is the city's [today, today+6] in its own zone;
//   - `quietWeek` is the shared "nothing this week" rule;
//   - `groupListings` / `planWhen` (#4349): one card per recurring plan
//     (brand_slug + item_slug), labelled with its day span ("Event · Fri–Sun"),
//     opening its next date. Applied AFTER the Friday–Sunday filter, so the
//     span is the weekend's own and every count is a count of plans;
//   - `cityForSlug` over `links_page_cities()` rows resolves the page's city to
//     its `city_id`, so its quiet-week places use the fast per-city read.
//
// What this module adds is the city page's weekend: the city's local Friday to
// Sunday, each listing's day taken in the listing's own `tz`.
//
// The empty-week rule (§4, verbatim order):
//   1. admin strips always first;
//   2. no weekend listings but some this week: this week's weekday plans;
//   3. nothing this week: "A quiet week in <City>." + up to 3 real places;
//   4. then "Plans in <nearest live city> →" when another city is live, and
//      "Host something in <City> →";
//   5. no places to show: "Nothing is listed this week yet. Check back soon.",
//      then "Plans in <nearest live city> →" when another city is live and
//      "Host something in <City> →" (#4349 made /links do the same);
//   6. a failed read: the fallback line and the Host banner only.
//
// Constitution #9: nothing here invents a plan, a price or a photo.

import {
  addDaysKey,
  bucketListings,
  cityForSlug,
  cityWeek,
  groupListings,
  listingDayKey,
  liveCities,
  normalisePins,
  pinWhen,
  quietWeek,
  type LinksCity,
  type LinksListing,
  type LinksPin,
  type LinksPlan,
  type LinksPlace,
  type LinksStripRow,
  type LinksWeekRow,
} from './links-week'
import type { LinksTarget } from './links-handoff'

export const FALLBACK_TEXT = 'Nothing is listed this week yet. Check back soon.'

/** Weekday (0 Sunday … 6 Saturday) of a YYYY-MM-DD key. */
export function weekdayOfKey(key: string): number {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()
}

/**
 * The weekend to show, as day keys, from today's key in the city's zone:
 * Monday–Thursday → the coming Friday, Saturday and Sunday; Friday → Friday to
 * Sunday; Saturday → Saturday and Sunday; Sunday → Sunday only (the days
 * already gone are not shown, and the readers start at now).
 */
export function weekendKeys(today: string): string[] {
  const dow = weekdayOfKey(today)
  if (dow === 0) return [today]
  if (dow === 6) return [today, addDaysKey(today, 1)]
  const friday = addDaysKey(today, 5 - dow)
  return [friday, addDaysKey(friday, 1), addDaysKey(friday, 2)]
}

export type CityWeekendKind = 'Events' | 'Experiences' | 'Places'

/** The small label a listing card and its sheet show for its kind. */
export const CITY_LISTING_KIND_LABEL: Record<LinksListing['kind'], string> = { event: 'Event', trip: 'Trip', experience: 'Experience' }

/** What a "This weekend" card opens on a computer: a listing or a place sheet. */
export type CityItemTarget = Extract<LinksTarget, { type: 'listing' } | { type: 'place' }>

/** The chip a plan sits under: its kind, the same for every date. */
export function planChip(plan: LinksPlan): CityWeekendKind {
  return listingChip(plan.next)
}

/**
 * The registry city with its `city_id` and `has_places` from the live cities
 * (`links_page_cities()` rows through linksCitiesFromRows), matched by slug or
 * by the older registry slug the live city carries as an alias (`raleigh-nc`
 * opens Raleigh). Never matched by distance: Cary and Raleigh sit 15 km apart.
 * A city that is not live (or an unread cities list) keeps no id, and its
 * places are read around its centre instead.
 */
export function withLiveCityId(city: LinksCity, live: readonly LinksCity[]): LinksCity {
  const match = cityForSlug(live, city.slug)
  if (!match || !match.cityId) return city
  return { ...city, cityId: match.cityId, hasPlaces: match.hasPlaces ?? null }
}

/** The chip a listing sits under. Trips are experiences you travel for, so they sit under Experiences. */
export function listingChip(listing: LinksListing): CityWeekendKind {
  return listing.kind === 'event' ? 'Events' : 'Experiences'
}

export interface CityWeekendStrip {
  pin: LinksPin
  /** "From Mingla · Fri 20" (shown uppercase). */
  when: string
}

export type CityWeekendModel = {
  /** Admin strips, admin order, always first. */
  strips: CityWeekendStrip[]
  /** Today in the city's zone (for labels). */
  today: string
  weekend: string[]
} & (
  | { mode: 'weekend'; listings: LinksListing[]; plans: LinksPlan[] }
  | { mode: 'weekday'; listings: LinksListing[]; plans: LinksPlan[] }
  | { mode: 'quiet'; heading: string; places: LinksPlace[]; plansIn: LinksCity | null; hostCity: string }
  | { mode: 'fallback'; text: string; hostCity: string; plansIn: LinksCity | null }
)

export interface CityWeekendInput {
  city: LinksCity
  /** Every registry city (listings are assigned to their owning city). */
  cities: readonly LinksCity[]
  rows: readonly LinksWeekRow[]
  strips: readonly LinksStripRow[]
  /** The quiet week's places for this city (empty when not read or none). */
  places: readonly LinksPlace[]
  /** `links_page_week()` failed (logged on the server). */
  readFailed: boolean
  nowIso: string
}

/** Listings rows → the city's own listings this week (shared with the server page's places decision). */
export function cityWeekListings(input: Pick<CityWeekendInput, 'city' | 'cities' | 'rows' | 'nowIso'>): LinksListing[] {
  return cityWeek(input.city, bucketListings(input.rows, input.cities), [], input.nowIso).listings
}

export function cityWeekendModel(input: CityWeekendInput): CityWeekendModel {
  const listings = bucketListings(input.rows, input.cities)
  const pins = normalisePins(input.strips)
  const week = cityWeek(input.city, listings, pins, input.nowIso)
  const weekend = weekendKeys(week.today)
  const strips = week.pins.map((pin) => ({ pin, when: pinWhen(pin, week.today) }))
  const base = { strips, today: week.today, weekend }

  if (!input.readFailed) {
    const inWeekend = new Set(weekend)
    const weekendListings = week.listings.filter((l) => inWeekend.has(listingDayKey(l)))
    // One card per plan (#4349): grouped after the Friday–Sunday filter, so a
    // boat charter listed every day this week is one weekend card ("Fri–Sun").
    if (weekendListings.length > 0) {
      return { ...base, mode: 'weekend', listings: weekendListings, plans: groupListings(weekendListings) }
    }
    if (week.listings.length > 0) return { ...base, mode: 'weekday', listings: week.listings, plans: groupListings(week.listings) }
  }

  const live = liveCities(input.cities, listings, pins, input.nowIso)
  const rule = quietWeek({
    city: input.city,
    cityHasListings: false,
    places: input.places,
    live,
    readFailed: input.readFailed,
  })
  if (rule.mode === 'quiet') {
    return { ...base, mode: 'quiet', heading: rule.heading, places: rule.places, plansIn: rule.plansIn, hostCity: rule.hostCity }
  }
  // No places to show: the line, "Plans in <nearest live city>" when there is one, and the Host banner.
  // A failed read: the line and the Host banner only.
  const plansIn = rule.mode === 'fallback' && !input.readFailed ? rule.plansIn ?? null : null
  return { ...base, mode: 'fallback', text: FALLBACK_TEXT, hostCity: input.city.name, plansIn }
}
