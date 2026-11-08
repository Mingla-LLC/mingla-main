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
for (const name of ['links-week', 'links-fit', 'links-handoff', 'store-links']) emit(name, out, seen)
after(() => fs.rmSync(out, { recursive: true, force: true }))
const load = (name) => import(pathToFileURL(path.join(out, `${name}.mjs`)).href)
const week = await load('links-week')
const fit = await load('links-fit')
const handoff = await load('links-handoff')
const stores = await load('store-links')

// ---------------------------------------------------------------- fixtures

const CITIES = [
  { slug: 'lagos', name: 'Lagos', region: 'Nigeria', timezone: 'Africa/Lagos', lat: 6.4281, lng: 3.4219 },
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

test('the page opens on ?city=, then the visitor location, then the remembered city, then the busiest city', () => {
  const listings = week.bucketListings(
    [
      row({ lat: 35.7796, lng: -78.6382, item_slug: 'r1' }),
      row({ lat: 35.7796, lng: -78.6382, item_slug: 'r2' }),
      row({ lat: 6.45, lng: 3.42, tz: 'Africa/Lagos', starts_at: '2026-11-08T18:00:00Z', item_slug: 'l1' }),
      row({ lat: 51.5, lng: -0.12, tz: 'Europe/London', starts_at: '2026-11-08T19:00:00Z', item_slug: 'k1' }),
    ],
    CITIES,
  )
  const live = week.liveCities(CITIES, listings, [], NOW)
  assert.deepEqual(live.map((l) => [l.city.slug, l.count]), [['lagos', 1], ['raleigh-nc', 2], ['london', 1]])
  const resolve = (over) => week.resolveCity({ cities: CITIES, live, query: null, geo: null, cookie: null, ...over })

  // 1. ?city= always wins, even over location, and even for a quiet city.
  assert.deepEqual(resolve({ query: 'brussels', geo: { lat: 35.9, lng: -79 } }), { slug: 'brussels', source: 'query' })
  // 2. location: the nearest LIVE city, however far (Berlin → London, Abuja → Lagos).
  assert.deepEqual(resolve({ geo: { lat: 52.52, lng: 13.4 }, cookie: 'lagos' }), { slug: 'london', source: 'geo' })
  assert.deepEqual(resolve({ geo: { lat: 9.07, lng: 7.4 } }), { slug: 'lagos', source: 'geo' })
  // 3. no location: the remembered city, when it is live.
  assert.deepEqual(resolve({ cookie: 'lagos' }), { slug: 'lagos', source: 'cookie' })
  assert.notEqual(resolve({ cookie: 'brussels' }).source, 'cookie', 'a remembered city with nothing on is skipped')
  // 4. else the busiest live city.
  assert.deepEqual(resolve({}), { slug: 'raleigh-nc', source: 'busiest' })
  // Nothing live anywhere: still a real registry city, never a crash.
  assert.equal(week.resolveCity({ cities: CITIES, live: [], query: null, geo: null, cookie: null }).source, 'fallback')
  // Geo headers are parsed defensively.
  assert.deepEqual(week.parseGeoHeaders('35.9', '-79.05'), { lat: 35.9, lng: -79.05 })
  assert.equal(week.parseGeoHeaders('', '1'), null)
  assert.equal(week.parseGeoHeaders('95', '1'), null)
})

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
    { id: 'p1', city_slug: null, shows_on: '2026-11-12', title: 'Every city', label: 'Giveaway', opens: 'explorer', url: null, blog_slug: null, position: 2 },
    { id: 'p2', city_slug: 'raleigh-nc', shows_on: '2026-11-09', title: 'Raleigh only', label: 'From Mingla', opens: 'web', url: 'host.usemingla.com/e/apexmanager/beach-unwind-2-0?ref=bio', blog_slug: null, position: 1 },
    { id: 'p3', city_slug: 'lagos', shows_on: '2026-11-09', title: 'Lagos only', label: 'New', opens: 'host', url: null, blog_slug: null, position: 0 },
    { id: 'p4', city_slug: 'raleigh-nc', shows_on: '2026-11-06', title: 'Expired', label: 'New', opens: 'host', url: null, blog_slug: null, position: -1 },
    { id: 'p5', city_slug: 'raleigh-nc', shows_on: '2026-11-09', title: 'Bad web link', label: 'New', opens: 'web', url: 'not a url', blog_slug: null, position: 3 },
  ])
  const w = week.cityWeek(city('raleigh-nc'), listings, pins, NOW)
  assert.equal(w.today, '2026-11-07')
  assert.deepEqual(w.keys, ['2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'])
  assert.deepEqual(w.listings.map((l) => l.title), ['Tonight', 'Sunday brunch', 'Friday trip'])
  assert.deepEqual(w.days.map((d) => [d.key, d.listings.length]), [['2026-11-07', 1], ['2026-11-08', 1], ['2026-11-13', 1]])
  // Admin order (position), this city's strips plus every-city ones, never expired or invalid.
  assert.deepEqual(w.pins.map((p) => p.title), ['Raleigh only', 'Every city'])
  // Labels: Tonight for today from 5 PM, else kind and day; admin strips show label and day only.
  assert.deepEqual(week.listingWhen(w.listings[0], w.today), { tonight: true, text: 'Tonight' })
  assert.deepEqual(week.listingWhen(w.listings[1], w.today), { tonight: false, text: 'Experience · Sun 8' })
  assert.equal(week.pinWhen(w.pins[1], w.today), 'Giveaway · Thu 12')
  assert.equal(week.timeLabel(w.listings[0].startsAt, w.listings[0].tz), '6:30 PM')
  // An every-city strip does not make a quiet city live on its own.
  assert.deepEqual(week.liveCities(CITIES, listings, pins, NOW).map((l) => l.city.slug), ['lagos', 'raleigh-nc'])
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

test('admin strips push the listings down until 3 are left, then fold (iPhone 390x844 shows 4)', () => {
  const at = (pins) => phone({ room: 4, pins, list: 13 })
  assert.deepEqual(at(0), { pinsShown: 0, listShown: 4 })
  assert.deepEqual(at(1), { pinsShown: 1, listShown: 3 })
  assert.deepEqual(at(4), { pinsShown: 1, listShown: 3 })
  assert.deepEqual(at(10), { pinsShown: 1, listShown: 3 })
  assert.equal(fit.pinsMoreLabel(4, at(4).pinsShown), 'See 3 more from Mingla')
  assert.equal(fit.pinsMoreLabel(1, at(1).pinsShown), null)
  assert.deepEqual(fit.moreLabel(13, at(4).listShown), { hidden: 10, text: 'See 10 more', count: '13 this week' })
  // Tablet (820x1180 shows 6): 3 admin strips fit with 3 listings.
  assert.deepEqual(phone({ room: 6, pins: 4, list: 13 }), { pinsShown: 3, listShown: 3 })
})

test('short screens keep 1 listing, so admin strips still come first (small Android 360x640 shows 3)', () => {
  assert.deepEqual(phone({ room: 3, pins: 0, list: 13, short: true }), { pinsShown: 0, listShown: 3 })
  assert.deepEqual(phone({ room: 3, pins: 4, list: 13, short: true }), { pinsShown: 2, listShown: 1 })
  // Fewer listings than the floor: the floor is all of them.
  assert.deepEqual(phone({ room: 4, pins: 4, list: 2 }), { pinsShown: 2, listShown: 2 })
  // No listings at all: every admin strip that fits shows.
  assert.deepEqual(phone({ room: 4, pins: 3, list: 0 }), { pinsShown: 3, listShown: 0 })
  assert.deepEqual(fit.moreLabel(0, 0), { hidden: 0, text: 'Open the full week', count: null })
})

test('desktop: admin strips stay in the left column and fold only when it is full', () => {
  const desk = (pins, capacity) =>
    fit.computeLinksFit({
      pinCount: pins,
      listCount: 13,
      short: false,
      desk: true,
      fitList: () => 6,
      leftOverflows: (shown) => shown > capacity,
    })
  assert.deepEqual(desk(2, 3), { pinsShown: 2, listShown: 6 })
  assert.deepEqual(desk(10, 3), { pinsShown: 3, listShown: 6 })
})

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

test('flush: the more link sits under the last strip, fits whole, and no strip-height gap is left while anything is hidden', () => {
  const expected = { '320x568': [0, 1], '360x640': [1, 1], '390x844': [1, 3], '820x1180': [4, 3], '1440x900': [4, 5] }
  for (const size of Object.keys(MEASURED)) {
    const r = fitAt(size)
    assert.deepEqual([r.pinsShown, r.listShown], expected[size], `${size}: admin strips and listings shown`)
    assert.ok(r.leftover >= 0, `${size}: the more link must fit inside the box (leftover ${r.leftover})`)
    const gap = fit.leavesStripGap({
      leftover: r.leftover,
      stripStep: r.g.stripH + r.g.gap,
      pinsHidden: r.g.desk ? 0 : PINS - r.pinsShown,
      listHidden: LISTINGS - r.listShown,
    })
    assert.equal(gap, false, `${size}: ${r.leftover}px left under the more link is a whole strip while items are hidden`)
  }
})

// Chip row widths MEASURED in Chrome (scrollWidth per fit level vs the row's box).
const CHIPS = {
  '320x568': { box: 292, widths: [311, 311, 292] },
  '360x640': { box: 332, widths: [332, 332, 332] },
  '390x844': { box: 358, widths: [377, 358, 358] },
  '820x1180': { box: 576, widths: [576, 576, 576] },
  '1440x900': { box: 484, widths: [484, 484, 484] },
}

test('the chip row never overflows: counts hide first, then the chips tighten', () => {
  const levels = {}
  for (const [size, c] of Object.entries(CHIPS)) {
    const level = fit.chipFitLevel((l) => c.widths[l] > c.box + 0.5)
    levels[size] = level
    assert.ok(c.widths[level] <= c.box + 0.5, `${size}: chip row overflows at level ${level}`)
  }
  assert.deepEqual(levels, { '320x568': 2, '360x640': 0, '390x844': 1, '820x1180': 0, '1440x900': 0 })
})
