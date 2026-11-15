// #4318 — implementor happy-path test for usemingla.com/links (the city week
// calendar). Runs the REAL pure modules with no install: node strips the
// TypeScript types from lib/links-week.ts, lib/links-fit.ts, lib/links-handoff.ts
// and every lib module they import, then the tests call them with fixtures
// (never the database). Store and OneLink URLs are read from lib/store-links.ts,
// never written here.
//
// Covers:
//   - nearest-city bucketing (60 km) of `links_page_week()` rows;
//   - the city the page opens on (?city= > location > cookie > busiest);
//   - the week (today..today+6 in the city's zone) and its day grouping;
//   - the one-screen fit rule: admin strips push the listings down to 3 (1 on
//     short screens), then fold into "See N more from Mingla";
//   - the hand-off per device and per strip target.
//   - the live cities (8 Nov ruling): exactly the `links_page_cities()` rows,
//     a newly live city with no code change, a city switched off, quiet
//     cities in the picker, and `?city=` with an older guide slug.
//
// Run from mingla-marketing/ (Node 22.13+):
//   node --test lib/__tests__/issue-4318-links.implementor.test.mjs

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { stripTypeScriptTypes } from 'node:module'
import { after, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const MARKETING = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const IMPORT = /from\s+'(@\/lib\/|\.\/)([\w-]+)'/g

function emit(name, out, seen) {
  if (seen.has(name)) return
  seen.add(name)
  const source = fs.readFileSync(path.join(MARKETING, 'lib', `${name}.ts`), 'utf8')
  const deps = []
  const js = stripTypeScriptTypes(source).replace(IMPORT, (_m, _prefix, dep) => {
    deps.push(dep)
    return `from './${dep}.mjs'`
  })
  fs.writeFileSync(path.join(out, `${name}.mjs`), js)
  for (const dep of deps) emit(dep, out, seen)
}

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-4318-'))
const seen = new Set()
for (const name of ['links-week', 'links-fit', 'links-handoff', 'store-links', 'revalidate-tag']) emit(name, out, seen)
after(() => fs.rmSync(out, { recursive: true, force: true }))
const load = (name) => import(pathToFileURL(path.join(out, `${name}.mjs`)).href)
const week = await load('links-week')
const fit = await load('links-fit')
const handoff = await load('links-handoff')
const stores = await load('store-links')
const revalidate = await load('revalidate-tag')

// ---------------------------------------------------------------- fixtures

const CITIES = [
  { slug: 'lagos', name: 'Lagos', region: 'Nigeria', timezone: 'Africa/Lagos', lat: 6.4281, lng: 3.4219, reachKm: 80 },
  { slug: 'durham-nc', name: 'Durham', region: 'North Carolina', timezone: 'America/New_York', lat: 35.994, lng: -78.8986 },
  { slug: 'cary-nc', name: 'Cary', region: 'North Carolina', timezone: 'America/New_York', lat: 35.7915, lng: -78.7811 },
  { slug: 'raleigh-nc', name: 'Raleigh', region: 'North Carolina', timezone: 'America/New_York', lat: 35.7796, lng: -78.6382 },
  { slug: 'new-york-city', name: 'New York City', region: 'New York', timezone: 'America/New_York', lat: 40.7128, lng: -74.006 },
  { slug: 'brussels', name: 'Brussels', region: 'Belgium', timezone: 'Europe/Brussels', lat: 50.8467, lng: 4.3525 },
  { slug: 'london', name: 'London', region: 'United Kingdom', timezone: 'Europe/London', lat: 51.5074, lng: -0.1278 },
  { slug: 'fort-lauderdale', name: 'Fort Lauderdale', region: 'Florida', timezone: 'America/New_York', lat: 26.1224, lng: -80.1373 },
]
const city = (slug) => CITIES.find((c) => c.slug === slug)

// Saturday 7 November 2026, 14:00 UTC (9 AM in Raleigh, 3 PM in Lagos).
const NOW = '2026-11-07T14:00:00.000Z'

function row(over) {
  return {
    kind: 'event',
    title: 'A plan',
    place_label: 'Somewhere',
    starts_at: '2026-11-07T23:00:00Z',
    ends_at: null,
    tz: 'America/New_York',
    lat: 35.78,
    lng: -78.64,
    cover_url: null,
    brand_slug: 'brand',
    item_slug: 'plan',
    ...over,
  }
}

// ---------------------------------------------------------------- bucketing

test('each listing goes to its nearest live city within 60 km, and anything further is dropped', () => {
  const rows = [
    row({ title: 'Downtown Raleigh', lat: 35.7796, lng: -78.6382, item_slug: 'a' }),
    row({ title: 'Cary town centre', lat: 35.788, lng: -78.79, item_slug: 'b' }),
    row({ title: 'Chapel Hill (Durham is nearest)', lat: 35.913, lng: -79.0558, item_slug: 'c' }),
    row({ title: 'Lekki, Lagos', lat: 6.45, lng: 3.6, tz: 'Africa/Lagos', item_slug: 'd' }),
    row({ title: 'Brooklyn', lat: 40.6782, lng: -73.9442, item_slug: 'e' }),
    row({ title: 'Miami is 40 km from Fort Lauderdale', lat: 25.7617, lng: -80.1918, item_slug: 'f' }),
    row({ title: 'Charlotte is too far from every city', lat: 35.2271, lng: -80.8431, item_slug: 'g' }),
    row({ title: 'No location', lat: null, lng: null, item_slug: 'h' }),
    row({ title: 'Unknown kind', kind: 'venue', item_slug: 'i' }),
    row({ title: 'No slug', item_slug: null }),
  ]
  const byTitle = Object.fromEntries(week.bucketListings(rows, CITIES).map((l) => [l.title, l.citySlug]))
  assert.deepEqual(byTitle, {
    'Downtown Raleigh': 'raleigh-nc',
    'Cary town centre': 'cary-nc',
    'Chapel Hill (Durham is nearest)': 'durham-nc',
    'Lekki, Lagos': 'lagos',
    Brooklyn: 'new-york-city',
    'Miami is 40 km from Fort Lauderdale': 'fort-lauderdale',
  })
  assert.equal(week.NEAREST_CITY_RADIUS_KM, 60)
})

// ---------------------------------------------------------------- city order

// ---------------------------------------------------------------- the week

test('the week is today through today+6 in the city zone, grouped by day, with admin strips for that city', () => {
  const rows = [
    // Friday 6 Nov 8 PM in Raleigh: yesterday there, so out of the week.
    row({ title: 'Yesterday', starts_at: '2026-11-07T01:00:00Z', item_slug: 'y' }),
    row({ title: 'Tonight', starts_at: '2026-11-07T23:30:00Z', item_slug: 't' }),
    row({ title: 'Sunday brunch', kind: 'experience', starts_at: '2026-11-08T16:00:00Z', item_slug: 's' }),
    row({ title: 'Friday trip', kind: 'trip', starts_at: '2026-11-13T12:00:00Z', item_slug: 'f' }),
    // Saturday 14 Nov in Raleigh: day 8, out of the week.
    row({ title: 'Next Saturday', starts_at: '2026-11-14T15:00:00Z', item_slug: 'n' }),
  ]
  const listings = week.bucketListings(rows, CITIES)
  const pins = week.normalisePins([
    // Admin strips are not by city (#4318 addendum 2): no city_slug at all.
    { id: 'p1', shows_on: '2026-11-12', title: 'Giveaway strip', label: 'Giveaway', opens: 'explorer', url: null, blog_slug: null, position: 2 },
    { id: 'p2', shows_on: '2026-11-09', title: 'Event link strip', label: 'From Mingla', opens: 'web', url: 'host.usemingla.com/e/apexmanager/beach-unwind-2-0?ref=bio', blog_slug: null, position: 1 },
    { id: 'p3', shows_on: '2026-11-09', title: 'Host strip', label: 'New', opens: 'host', url: null, blog_slug: null, position: 0 },
    { id: 'p4', shows_on: '2026-11-06', title: 'Expired', label: 'New', opens: 'host', url: null, blog_slug: null, position: -1 },
    { id: 'p5', shows_on: '2026-11-09', title: 'Bad web link', label: 'New', opens: 'web', url: 'not a url', blog_slug: null, position: 3 },
  ])
  const w = week.cityWeek(city('raleigh-nc'), listings, pins, NOW)
  assert.equal(w.today, '2026-11-07')
  assert.deepEqual(w.keys, ['2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'])
  assert.deepEqual(w.listings.map((l) => l.title), ['Tonight', 'Sunday brunch', 'Friday trip'])
  assert.deepEqual(w.days.map((d) => [d.key, d.listings.length]), [['2026-11-07', 1], ['2026-11-08', 1], ['2026-11-13', 1]])
  // Admin order (position), every strip in every city, never expired or invalid.
  assert.deepEqual(w.pins.map((p) => p.title), ['Host strip', 'Event link strip', 'Giveaway strip'])
  assert.deepEqual(week.cityWeek(city('lagos'), listings, pins, NOW).pins.map((p) => p.id), ['p3', 'p2', 'p1'])
  // Labels: Tonight for today from 5 PM, else kind and day; admin strips show label and day only.
  assert.deepEqual(week.listingWhen(w.listings[0], w.today), { tonight: true, text: 'Tonight' })
  assert.deepEqual(week.listingWhen(w.listings[1], w.today), { tonight: false, text: 'Experience · Sun 8' })
  assert.equal(week.pinWhen(w.pins[2], w.today), 'Giveaway · Thu 12')
  assert.equal(week.timeLabel(w.listings[0].startsAt, w.listings[0].tz), '6:30 PM')
  // Strips never make a city live; only listings do.
  assert.deepEqual(week.liveCities(CITIES, listings, pins, NOW).map((l) => l.city.slug), ['raleigh-nc'])
})

// ---------------------------------------------------------------- the fit

// Fixture geometry: the list area holds `room` strips with no admin strips;
// every admin strip shown takes one strip's room from it (it sits above it).
function phone({ room, pins, list, short = false }) {
  return fit.computeLinksFit({
    pinCount: pins,
    listCount: list,
    short,
    desk: false,
    fitList: (shown) => Math.max(0, Math.min(list, room - shown)),
    leftOverflows: () => false,
  })
}

// ---------------------------------------------------------------- hand-off

test('every tap lands in the right place per device and per strip target', () => {
  const [listing] = week.bucketListings([row({ kind: 'trip', brand_slug: 'salsa4life', item_slug: 'bring-a-friend' })], CITIES)
  const pin = (opens, extra = {}) => ({ id: `p-${opens}`, citySlug: null, showsOn: '2026-11-09', title: 'x', label: 'New', opens, url: null, blogSlug: null, position: 0, ...extra })
  const SRC = 'instagram'
  const go = (target, platform) => handoff.resolveLinksHandoff(target, platform, SRC)
  const onelink = (href) => {
    const u = new URL(href)
    return { base: `${u.origin}${u.pathname}`, params: Object.fromEntries(u.searchParams) }
  }

  // Listings: phones get the Explorer OneLink deep-linked to the listing, with the bio pid.
  for (const platform of ['ios', 'android']) {
    const h = go({ type: 'listing', listing }, platform)
    assert.equal(h.action, 'navigate')
    assert.equal(h.newTab, false)
    assert.deepEqual(onelink(h.href), {
      base: stores.EXPLORER_ONELINK_URL,
      params: { pid: 'bio_instagram', c: 'explorer_bio', deep_link_value: 'trip', deep_link_sub1: 'salsa4life', deep_link_sub2: 'bring-a-friend' },
    })
  }
  // Computers get a sheet; their server href is the listing's public page.
  assert.deepEqual(go({ type: 'listing', listing }, 'other'), { action: 'sheet', sheet: 'item' })
  assert.equal(handoff.linksTargetHrefs({ type: 'listing', listing }, SRC).computerHref, `${stores.BUSINESS_WEB_URL}/t/salsa4life/bring-a-friend`)

  // Banners: Explore → Explorer store on phones, a sheet on computers; Host → Host store / sheet.
  const explore = go({ type: 'banner', app: 'explorer' }, 'ios')
  assert.deepEqual(onelink(explore.href), { base: stores.EXPLORER_ONELINK_URL, params: { pid: 'bio_instagram', c: 'explorer_bio' } })
  const host = go({ type: 'banner', app: 'host' }, 'android')
  assert.deepEqual(onelink(host.href), { base: stores.BUSINESS_ONELINK_URL, params: { pid: 'bio_instagram', c: 'business_bio' } })
  assert.deepEqual(go({ type: 'banner', app: 'explorer' }, 'other'), { action: 'sheet', sheet: 'explore' })
  assert.deepEqual(go({ type: 'banner', app: 'host' }, 'other'), { action: 'sheet', sheet: 'host' })

  // Admin strips, per "opens" value.
  const web = go({ type: 'pin', pin: pin('web', { url: 'host.usemingla.com/e/apexmanager/beach-unwind-2-0?ref=bio' }) }, 'ios')
  assert.deepEqual(web, { action: 'navigate', href: 'https://host.usemingla.com/e/apexmanager/beach-unwind-2-0?ref=bio', newTab: true })
  assert.deepEqual(go({ type: 'pin', pin: pin('blog', { blogSlug: 'first-date-ideas' }) }, 'android'), { action: 'navigate', href: '/blog/first-date-ideas', newTab: false })
  assert.equal(onelink(go({ type: 'pin', pin: pin('explorer') }, 'android').href).base, stores.EXPLORER_ONELINK_URL)
  assert.equal(onelink(go({ type: 'pin', pin: pin('host') }, 'ios').href).base, stores.BUSINESS_ONELINK_URL)
  for (const opens of ['web', 'blog', 'explorer', 'host']) {
    assert.deepEqual(go({ type: 'pin', pin: pin(opens, { url: 'usemingla.com/host', blogSlug: 'b' }) }, 'other'), { action: 'sheet', sheet: 'item' })
  }
  // An app strip never mixes the two apps.
  assert.equal(handoff.targetApp({ type: 'pin', pin: pin('host') }), 'host')
  assert.equal(handoff.targetApp({ type: 'pin', pin: pin('explorer') }), 'explorer')
  assert.equal(handoff.targetApp({ type: 'pin', pin: pin('web') }), null)
})

// ---------------------------------------------------------------- flush + chips

// Geometry MEASURED in Chrome on the built page (2026-11-07, 4 admin strips and
// 12 listings): for each size, the listings box height with s admin strips
// shown (the "See N more from Mingla" line included while any is folded), the
// strip height, the gap and the "more" link height.
const MEASURED = {
  '320x568': { short: true, desk: false, stripH: 54, gap: 10, moreH: 40, rooms: [157, 93, 29, 0, 0] },
  '360x640': { short: true, desk: false, stripH: 54, gap: 10, moreH: 40, rooms: [229, 165, 101, 37, 15] },
  '390x844': { short: false, desk: false, stripH: 60, gap: 10, moreH: 40, rooms: [374, 304, 234, 164, 136] },
  '820x1180': { short: false, desk: false, stripH: 66, gap: 12, moreH: 40, rooms: [575, 497, 419, 341, 307] },
  // Desktop: admin strips live in the left column (it never overflowed with 4),
  // so the listings box is the same whatever the admin strips do.
  '1440x900': { short: false, desk: true, stripH: 64, gap: 12, moreH: 40, rooms: [437, 437, 437, 437, 437] },
}
const PINS = 4
const LISTINGS = 12

function fitAt(size) {
  const g = MEASURED[size]
  const bottoms = Array.from({ length: LISTINGS }, (_, i) => (i + 1) * g.stripH + i * g.gap)
  const fitList = (shown) => fit.stripsThatFit(bottoms, g.rooms[shown], g.moreH, g.gap)
  const result = fit.computeLinksFit({
    pinCount: PINS,
    listCount: LISTINGS,
    short: g.short,
    desk: g.desk,
    fitList,
    leftOverflows: () => false,
  })
  const used = result.listShown > 0 ? bottoms[result.listShown - 1] + g.gap + g.moreH : g.moreH
  return { ...result, g, used, leftover: g.rooms[result.pinsShown] - used }
}

// Chip row widths MEASURED in Chrome (scrollWidth per fit level vs the row's box).
const CHIPS = {
  '320x568': { box: 292, widths: [311, 311, 292] },
  '360x640': { box: 332, widths: [332, 332, 332] },
  '390x844': { box: 358, widths: [377, 358, 358] },
  '820x1180': { box: 576, widths: [576, 576, 576] },
  '1440x900': { box: 484, widths: [484, 484, 484] },
}

// ---------------------------------------------------------------- the quiet week (addendum 2)

const STORAGE = 'https://gqnoajqerqhnvulmnyvv.supabase.co'
const placeRow = (i, over = {}) => ({
  place_id: `ChIJplace000${i}`,
  name: `Place ${i}`,
  category: 'Park',
  area_label: 'Downtown',
  lat: 35.78,
  lng: -78.64,
  photo_path: `ChIJplace000${i}/0_thumb.jpg`,
  ...over,
})

test('quiet week ladder: listings, places, plans elsewhere, nothing anywhere, a failed read', () => {
  const raleigh = city('raleigh-nc')
  const cary = city('cary-nc')
  const listings = week.bucketListings([row({ lat: 35.7796, lng: -78.6382, item_slug: 'r1' })], CITIES)
  const live = week.liveCities(CITIES, listings, [], NOW)
  const places = week.normalisePlaces([placeRow(1), placeRow(2), placeRow(3), placeRow(4)], 'cary-nc', STORAGE)

  // 2. The city has listings: listings.
  assert.deepEqual(week.quietWeek({ city: raleigh, cityHasListings: true, places, live, readFailed: false }), { mode: 'listings' })
  // 3 + 4. No listings, with places: the heading, up to 3 places, plans in the nearest live city, host.
  const q = week.quietWeek({ city: cary, cityHasListings: false, places, live, readFailed: false })
  assert.equal(q.mode, 'quiet')
  assert.equal(q.heading, 'A quiet week in Cary.')
  assert.deepEqual(q.places.map((p) => p.name), ['Place 1', 'Place 2', 'Place 3'])
  assert.equal(q.plansIn.slug, 'raleigh-nc')
  assert.equal(q.hostCity, 'Cary')
  // No listings and no places, another city live (conductor ruling, 8 Nov: a
  // city with nothing to show says so, it no longer heads an empty place
  // list): the fallback line, "Plans in Raleigh" and "Host something in Cary".
  const q2 = week.quietWeek({ city: cary, cityHasListings: false, places: [], live, readFailed: false })
  assert.deepEqual([q2.mode, q2.text, q2.plansIn.slug, q2.hostCity], ['fallback', 'Nothing is listed this week yet. Check back soon.', 'raleigh-nc', 'Cary'])
  // No listings anywhere but places here: places and host, no "Plans in".
  const q3 = week.quietWeek({ city: cary, cityHasListings: false, places, live: [], readFailed: false })
  assert.deepEqual([q3.mode, q3.plansIn], ['quiet', null])
  // 5. A failed read: the fallback line alone. 6. Nothing anywhere and no
  //    places: the fallback line and "Host something in Cary".
  const fallback = { mode: 'fallback', text: 'Nothing is listed this week yet. Check back soon.' }
  assert.deepEqual(week.quietWeek({ city: cary, cityHasListings: false, places: [], live: [], readFailed: false }), { ...fallback, plansIn: null, hostCity: 'Cary' })
  assert.deepEqual(week.quietWeek({ city: cary, cityHasListings: false, places, live, readFailed: true }), fallback)
})

test('places: stored thumbnails on the public object endpoint only, junk dropped, Explorer hand-off', () => {
  const [p] = week.normalisePlaces([placeRow(1)], 'cary-nc', STORAGE)
  assert.equal(p.photo, `${STORAGE}/storage/v1/object/public/place-photos/ChIJplace0001/0_thumb.jpg`)
  // Never /render/image, never a full-size original, never a foreign path.
  for (const photo_path of ['ChIJplace0001/0.jpg', '../x/0_thumb.jpg', 'ChIJplace0001/0_thumb.jpg?width=99', null]) {
    assert.equal(week.normalisePlaces([placeRow(1, { photo_path })], 'cary-nc', STORAGE)[0].photo, null, String(photo_path))
  }
  assert.equal(week.placePhotoUrl('http://insecure.example', 'ChIJplace0001/0_thumb.jpg'), null)
  assert.equal(week.normalisePlaces([placeRow(1, { place_id: '<script>' }), placeRow(2, { name: '  ' })], 'x', STORAGE).length, 0)
  // Phone: the plain Explorer OneLink with the bio pid (no place deep link exists); computer: the sheet.
  const h = handoff.resolveLinksHandoff({ type: 'place', place: p }, 'android', 'instagram')
  const u = new URL(h.href)
  assert.deepEqual([`${u.origin}${u.pathname}`, u.searchParams.get('pid'), u.searchParams.get('deep_link_value')], [stores.EXPLORER_ONELINK_URL, 'bio_instagram', null])
  assert.deepEqual(handoff.resolveLinksHandoff({ type: 'place', place: p }, 'other', 'instagram'), { action: 'sheet', sheet: 'item' })
})

// ---------------------------------------------------------------- recurring plans (one strip each)

test('a recurring listing is one strip with its day span, opening its next date; counts are plans', () => {
  // Live Lagos: "Crusaders Adventure Island" once per date, Mon 9 to Fri 13.
  const crusaders = [9, 10, 11, 12, 13].map((d) =>
    row({ title: 'Crusaders Adventure Island', tz: 'Africa/Lagos', lat: 6.45, lng: 3.42, brand_slug: 'crusaders', item_slug: 'adventure-island', starts_at: `2026-11-${String(d).padStart(2, "0")}T08:00:00Z` }),
  )
  const salsa = [9, 11, 13].map((d) =>
    row({ title: 'Salsa night', tz: 'Africa/Lagos', lat: 6.45, lng: 3.42, brand_slug: 'salsa4life', item_slug: 'salsa', starts_at: `2026-11-${String(d).padStart(2, "0")}T19:00:00Z` }),
  )
  const once = row({ title: 'One night only', tz: 'Africa/Lagos', lat: 6.45, lng: 3.42, item_slug: 'once', starts_at: '2026-11-10T20:00:00Z' })
  const listings = week.bucketListings([...salsa, ...crusaders, once], CITIES)
  const w = week.cityWeek(city('lagos'), listings, [], NOW)
  assert.equal(w.listings.length, 9, 'the week keeps one row per date (the full-week sheet)')
  const plans = week.groupListings(w.listings)
  assert.deepEqual(plans.map((p) => [p.next.title, p.dates.length]), [
    ['Crusaders Adventure Island', 5],
    ['Salsa night', 3],
    ['One night only', 1],
  ])
  assert.deepEqual(week.planWhen(plans[0], w.today), { tonight: false, text: 'Event · Mon–Fri' })
  assert.deepEqual(week.planWhen(plans[1], w.today), { tonight: false, text: 'Event · Mon, Wed, Fri' })
  assert.deepEqual(week.planWhen(plans[2], w.today), { tonight: false, text: 'Event · Tue 10' })
  assert.equal(week.timeLabel(plans[0].next.startsAt, plans[0].next.tz), '9 AM')
  // The hand-off opens the next date (the listing's deep link).
  const h = handoff.resolveLinksHandoff({ type: 'listing', listing: plans[0].next }, 'ios', 'instagram')
  assert.equal(new URL(h.href).searchParams.get('deep_link_sub2'), 'adventure-island')
  assert.equal(plans[0].next.startsAt, '2026-11-09T08:00:00.000Z')
  // "N this week" counts plans, not dates.
  assert.deepEqual(week.liveCities(CITIES, listings, [], NOW).map((l) => [l.city.slug, l.count]), [['lagos', 3]])
})

test('the revalidate route drops blog by default, links on {"tag":"links"}, and refuses anything else', () => {
  assert.equal(revalidate.revalidateTargetFor(''), 'blog')
  assert.equal(revalidate.revalidateTargetFor('{}'), 'blog')
  assert.equal(revalidate.revalidateTargetFor('{"tag":"blog"}'), 'blog')
  assert.equal(revalidate.revalidateTargetFor('{"tag":"links"}'), 'links')
  for (const bad of ['{"tag":"all"}', '{"tag":["links"]}', '"links"', '[]', 'null', '{', '{"tag":"LINKS"}']) {
    assert.equal(revalidate.revalidateTargetFor(bad), null, bad)
  }
})

// ---------------------------------------------------------------- live cities (8 Nov ruling)

// The ten `links_page_cities()` rows read from production on 8 Nov 2026 (ids,
// names, country codes and centres as stored), with the design's photo counts.
const LIVE_ROWS = [
  ['42197b35-45e8-4cac-b40d-a548416d87d2', 'Brussels', 'BE', 50.8477029, 4.3572001, 2593],
  ['9cff3a58-18cc-4c51-aa94-4c3e96ca1841', 'Cary', 'US', 35.7890402, -78.7797644, 959],
  ['a9e110dd-c26c-4141-9fee-165fad1fd455', 'Durham', 'US', 35.9955684, -78.9002077, 839],
  ['96d591c0-acb6-4605-884d-442cc261ea8d', 'Fort Lauderdale', 'US', 26.1224386, -80.1373174, 1302],
  ['287cab01-4430-4930-983a-435aa194f33a', 'Lagos', 'NG', 6.6137395, 3.3552568, 1036],
  ['c0bcef4f-82c1-44c6-9e9d-3329f5c860bf', 'London', 'GB', 51.5072178, -0.1275862, 11654],
  ['72cd3c91-7a32-470b-8e59-a57af654d07f', 'New York', 'US', 40.7127753, -74.0059728, 9880],
  ['13d9113a-4796-499e-9544-ae4d17c678db', 'Paris', 'FR', 48.8575475, 2.3513765, 4438],
  ['0ccfcf20-21a9-4d7b-805d-cbe629dcfd2b', 'Raleigh', 'US', 35.7795897, -78.6381787, 2129],
  ['e7b70cd8-d2c8-47f2-9112-08e86942bf96', 'Washington', 'US', 38.9072873, -77.0369274, 2682],
].map(([city_id, name, country_code, center_lat, center_lng, place_count]) => ({ city_id, name, country_code, center_lat, center_lng, has_places: place_count > 0 }))
// What the city guides know (content/cities/registry.ts): older slugs, regions, zones.
const HINTS = CITIES.map((c) => ({ slug: c.slug, countryCode: { lagos: 'NG', brussels: 'BE', london: 'GB' }[c.slug] ?? 'US', region: c.region, timezone: c.timezone, lat: c.lat, lng: c.lng }))
  .concat([{ slug: 'washington-dc', countryCode: 'US', region: 'District of Columbia', timezone: 'America/New_York', lat: 38.9072, lng: -77.0369 }])

test('the live cities are exactly the database rows: slugs from names, older guide slugs kept, Lagos 80 km, the rest 60', () => {
  const cities = week.linksCitiesFromRows(LIVE_ROWS, HINTS)
  assert.deepEqual(cities.map((c) => c.slug), ['brussels', 'cary', 'durham', 'fort-lauderdale', 'lagos', 'london', 'new-york', 'paris', 'raleigh', 'washington'])
  const by = Object.fromEntries(cities.map((c) => [c.slug, c]))
  assert.deepEqual(by['new-york'].aliases, ['new-york-city'])
  assert.deepEqual(by.washington.aliases, ['washington-dc'])
  assert.deepEqual(by.lagos.aliases, [])
  assert.equal(by.washington.region, 'District of Columbia')
  assert.equal(by.durham.region, 'North Carolina')
  // Paris has no guide hint in this fixture: its country is the region line.
  assert.equal(by.paris.region, 'France')
  assert.equal(by.paris.timezone, '')
  for (const c of cities) assert.equal(c.reachKm, c.slug === 'lagos' ? 80 : 60, c.slug)
  assert.equal(by.london.hasPlaces, true)
  assert.equal(by.london.cityId, 'c0bcef4f-82c1-44c6-9e9d-3329f5c860bf')
  // Slugs: lowercase, hyphenated, punctuation stripped.
  assert.equal(week.citySlug('Washington, D.C.'), 'washington-dc')
  assert.equal(week.citySlug("St. John's"), 'st-johns')
  assert.equal(week.citySlug('Liège'), 'liege')
  // Junk rows are dropped, never patched up; a duplicate slug takes its country.
  const junk = week.linksCitiesFromRows(
    [
      { ...LIVE_ROWS[0], city_id: 'not-a-uuid' },
      { ...LIVE_ROWS[1], name: '  ' },
      { ...LIVE_ROWS[2], center_lat: 95 },
      LIVE_ROWS[3],
      { ...LIVE_ROWS[3], city_id: '00000000-0000-4000-8000-000000000001', country_code: 'GB' },
    ],
    [],
  )
  assert.deepEqual(junk.map((c) => c.slug), ['fort-lauderdale', 'fort-lauderdale-gb'])
})

test('quiet-week places are read by city_id (the fast index path); lat/lng alone only when no id is known', () => {
  const cities = week.linksCitiesFromRows(LIVE_ROWS, HINTS)
  const durham = cities.find((c) => c.slug === 'durham')
  assert.deepEqual(week.linksPlacesArgs(durham, 3), {
    p_lat: 35.9955684,
    p_lng: -78.9002077,
    p_radius_km: 60,
    p_limit: 3,
    p_city_id: 'a9e110dd-c26c-4141-9fee-165fad1fd455',
  })
  // A stand-in guide city (cities read down) has no id: the lat/lng path, Lagos at 80 km.
  const noId = { slug: 'lagos', name: 'Lagos', region: 'Nigeria', timezone: 'Africa/Lagos', lat: 6.4281, lng: 3.4219, reachKm: 80 }
  assert.deepEqual(week.linksPlacesArgs(noId, 3), { p_lat: 6.4281, p_lng: 3.4219, p_radius_km: 80, p_limit: 3 })
  assert.equal('p_city_id' in week.linksPlacesArgs({ ...noId, cityId: 'not-a-uuid' }, 3), false)
})

test('the white wordmark in the orange bar goes Home, with a 44px target and a visible focus ring', () => {
  const ui = fs.readFileSync(path.join(MARKETING, 'components/marketing/links-experience.tsx'), 'utf8')
  const css = fs.readFileSync(path.join(MARKETING, 'components/marketing/links-experience.module.css'), 'utf8')
  const bar = ui.slice(ui.indexOf("styles['lk-bar']"), ui.indexOf("styles['lk-grid']"))
  assert.match(bar, /<a href="\/" aria-label="Mingla home" className=\{styles\['lk-home'\]\}>[\s\S]*mingla-wordmark-white\.svg[\s\S]*<\/a>/)
  const home = css.match(/\.lk-home \{([^}]*)\}/)
  assert.ok(home, 'a .lk-home rule exists')
  assert.match(home[1], /min-height: 44px/)
  assert.match(home[1], /text-decoration: none/)
  assert.match(css, /\.lk-home:focus-visible \{\s*outline: 2px solid #fff/)
})

test('an admin strip shows in every city until its day has ended everywhere, and "Show until" keeps it up to its last day', () => {
  // Live check 8 Nov 2026: an admin in Cary posted "Today, Sunday 8 November"
  // at 23:04 ET; Lagos was already on Monday and hid it. Admin dates are the
  // admin's own day, so no city ahead of it may cut the strip early.
  const pins = week.normalisePins([
    { id: 'today', shows_on: '2026-11-08', title: 'Posted Sunday evening', label: 'From Mingla', opens: 'host', url: null, blog_slug: null, position: 0 },
    { id: 'range', shows_on: '2026-11-08', shows_until: '2026-11-15', title: 'Runs all week', label: 'Giveaway', opens: 'explorer', url: null, blog_slug: null, position: 1 },
    { id: 'later', shows_on: '2026-11-12', title: 'Starts Thursday', label: 'New', opens: 'host', url: null, blog_slug: null, position: 2 },
    { id: 'bad-until', shows_on: '2026-11-08', shows_until: '2026-11-01', title: 'Until before start', label: 'New', opens: 'host', url: null, blog_slug: null, position: 3 },
    { id: 'junk-until', shows_on: '2026-11-08', shows_until: 'soon', title: 'Junk until', label: 'New', opens: 'host', url: null, blog_slug: null, position: 4 },
  ])
  assert.deepEqual(pins.map((p) => [p.id, p.showsUntil]), [['today', null], ['range', '2026-11-15'], ['later', null], ['bad-until', null], ['junk-until', null]])
  const shown = (slug, now) => week.cityWeek(city(slug), [], pins, now).pins.map((p) => p.id)

  // Sun 8 Nov 23:04 in Cary = Mon 9 Nov 05:04 in Lagos: the strip shows in both.
  const posted = '2026-11-09T04:04:00.000Z'
  const all = ['today', 'range', 'later', 'bad-until', 'junk-until']
  assert.deepEqual(shown('cary-nc', posted), all)
  assert.deepEqual(shown('lagos', posted), all)
  const lagos = week.cityWeek(city('lagos'), [], pins, posted)
  assert.equal(lagos.today, '2026-11-09')
  assert.equal(week.pinWhen(lagos.pins[0], lagos.today), 'From Mingla · Today')
  assert.equal(week.pinWhen(lagos.pins[2], lagos.today), 'New · Thu 12')

  // Once Sunday has ended in the last time zone (UTC-12), the one-day strips go everywhere.
  const gone = '2026-11-09T12:00:01.000Z'
  assert.deepEqual(shown('cary-nc', gone), ['range', 'later'])
  assert.deepEqual(shown('lagos', gone), ['range', 'later'])
  // Just before that, it still shows in Cary (Monday 7 AM there).
  assert.deepEqual(shown('cary-nc', '2026-11-09T11:59:59.000Z'), all)

  // "Show until" keeps the strip up through its last day: Thursday 12 it is running ("Today").
  const thu = week.cityWeek(city('london'), [], pins, '2026-11-12T12:00:00.000Z')
  assert.deepEqual(thu.pins.map((p) => p.id), ['range', 'later'])
  assert.equal(week.pinWhen(thu.pins[0], thu.today), 'Giveaway · Today')
  assert.equal(week.pinDaysLabel(thu.pins[0]), 'Sunday 8 November – Sunday 15 November')
  assert.equal(week.pinDaysLabel(thu.pins[1]), 'Thursday 12 November')
  assert.deepEqual(shown('lagos', '2026-11-16T11:59:59.000Z'), ['range'])
  assert.deepEqual(shown('lagos', '2026-11-16T12:00:01.000Z'), [])
})
