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
  // 2. location: the nearest live city, however far, quiet or not. Live cities
  //    ruling (8 Nov): every city live in Explorer is a landing city, so Berlin
  //    lands on quiet Brussels (its places and "Plans in London →"), no longer
  //    on London just because London has plans; Abuja still lands on Lagos.
  assert.deepEqual(resolve({ geo: { lat: 52.52, lng: 13.4 }, cookie: 'lagos' }), { slug: 'brussels', source: 'geo' })
  assert.deepEqual(resolve({ geo: { lat: 9.07, lng: 7.4 } }), { slug: 'lagos', source: 'geo' })
  // 3. no location: the remembered city, while it is live. Same ruling: a
  //    remembered quiet city opens too (it is live in Explorer).
  assert.deepEqual(resolve({ cookie: 'lagos' }), { slug: 'lagos', source: 'cookie' })
  assert.deepEqual(resolve({ cookie: 'brussels' }), { slug: 'brussels', source: 'cookie' })
  assert.notEqual(resolve({ cookie: 'atlanta' }).source, 'cookie', 'a remembered city that is not live is skipped')
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
  // 320x568: at least one admin strip always shows (#4318 ruling), so no listing fits there.
  const expected = { '320x568': [1, 0], '360x640': [1, 1], '390x844': [1, 3], '820x1180': [4, 3], '1440x900': [4, 5] }
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

test('leftover room never sits as one blank block: it spreads evenly over the section gaps, capped at 24 px, rest at the bottom', () => {
  // Phones: banners, admin strips, city, chips, strip block, socials = 5 gaps.
  for (const size of ['320x568', '360x640', '390x844', '820x1180']) {
    const r = fitAt(size)
    const spread = fit.spreadLeftover(r.leftover, 5)
    assert.ok(spread.perGap > 0, `${size}: the ${r.leftover}px left must be spread, not left as one block`)
    assert.ok(spread.perGap <= fit.FILL_CAP_PER_GAP_PX, `${size}: at most 24px extra per gap`)
    assert.ok(Math.abs(spread.perGap * 5 + spread.bottom - r.leftover) < 0.06, `${size}: every pixel is placed`)
    assert.ok(r.leftover - spread.perGap * 5 - spread.bottom < 2, `${size}: no blank block remains under the more link`)
  }
  // 360x640: 61px over 5 gaps → 12.2px each, nothing at the bottom.
  assert.deepEqual(fit.spreadLeftover(61, 5), { perGap: 12.2, bottom: 0 })
  // Past the cap the rest goes to the very bottom.
  assert.deepEqual(fit.spreadLeftover(200, 5), { perGap: 24, bottom: 80 })
  assert.deepEqual(fit.spreadLeftover(-3, 5), { perGap: 0, bottom: 0 })
  // Sub-pixel: a strip 1.5px past the line still fits (2px tolerance).
  assert.equal(fit.stripsThatFit([54, 118], 118 + 10 + 40 + 1.5 - 1.5 - 1.5, 40, 10), 2)
})

test('rulings: Lagos reaches 80 km, admin strips always first, and the empty copy', () => {
  // Lekki Free Trade Zone is ~70 km from the Lagos centre: Lagos, not dropped.
  const [ftz] = week.bucketListings([row({ lat: 6.4526, lng: 4.057, tz: 'Africa/Lagos', item_slug: 'ftz' })], CITIES)
  assert.equal(ftz?.citySlug, 'lagos')
  // 80.5 km out of Lagos is still dropped; another city keeps its 60 km.
  assert.equal(week.bucketListings([row({ lat: 6.4281 + 80.5 / 111.2, lng: 3.4219 })], CITIES).length, 0)

  // At least one admin strip whenever any exist, even when it costs the floor.
  assert.deepEqual(fitAt('320x568').pinsShown, 1)
  // 0 listings and 10 admin strips: they fill what fits, the rest fold.
  const none = fit.computeLinksFit({ pinCount: 10, listCount: 0, short: true, desk: false, fitList: () => 0, leftOverflows: (n) => n > 4 })
  assert.deepEqual(none, { pinsShown: 4, listShown: 0 })
  assert.equal(fit.pinsMoreLabel(10, none.pinsShown), 'See 6 more from Mingla')
  // Even the first admin strip folds if it alone would clip something.
  assert.equal(fit.computeLinksFit({ pinCount: 3, listCount: 0, short: true, desk: false, fitList: () => 0, leftOverflows: () => true }).pinsShown, 0)

  // Empty copy.
  const text = (over) => week.emptyListText({ nothingAnywhere: false, cityHasListings: false, cityName: 'Cary', plural: 'plans', otherLiveCity: true, ...over })
  assert.equal(text({}), 'Nothing is listed in Cary this week yet. Try another city.')
  assert.equal(text({ otherLiveCity: false }), 'Nothing is listed in Cary this week yet.')
  assert.equal(text({ nothingAnywhere: true }), 'Nothing is listed this week yet. Check back soon.')
  assert.equal(text({ cityHasListings: true, plural: 'trips' }), 'No trips listed in Cary this week yet.')
})

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

test('quiet week fit at 320x568 and 390x844: admin strips first, places fill, links fit, no clipping', () => {
  // MEASURED in Chrome (2026-11-08) on a quiet city with 4 admin strips, 3
  // places and both links: the box height per admin strips shown, the heading,
  // the strip, the gap and the two links' block.
  const Q = {
    '320x568': { short: true, headH: 24, stripH: 54, gap: 10, linksH: 70, rooms: [224, 160, 96, 32, 10], expected: [1, 0] },
    '390x844': { short: false, headH: 29, stripH: 60, gap: 10, linksH: 82, rooms: [447, 377, 307, 237, 209], expected: [1, 3] },
  }
  for (const [size, g] of Object.entries(Q)) {
    const bottoms = [1, 2, 3].map((n) => g.headH + g.gap + n * g.stripH + (n - 1) * g.gap)
    const minimum = g.headH + g.gap + g.linksH
    const r = fit.computeLinksFit({
      pinCount: 4,
      listCount: 3,
      short: g.short,
      desk: false,
      fitList: (s) => fit.stripsThatFit(bottoms, g.rooms[s], g.linksH, g.gap),
      leftOverflows: (s) => g.rooms[s] < minimum,
    })
    assert.deepEqual([r.pinsShown, r.listShown], g.expected, size)
    const used = r.listShown ? bottoms[r.listShown - 1] + g.gap + g.linksH : minimum
    assert.ok(used <= g.rooms[r.pinsShown] + fit.FIT_TOLERANCE_PX, `${size}: the quiet block fits (${used} > ${g.rooms[r.pinsShown]})`)
    assert.equal(
      fit.leavesStripGap({ leftover: g.rooms[r.pinsShown] - used, stripStep: g.stripH + g.gap, pinsHidden: 4 - r.pinsShown, listHidden: 3 - r.listShown }),
      false,
      `${size}: no strip-height gap while something is hidden`,
    )
  }
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

test('a city switched live appears with no code change: listed, bucketed, its zone from its listings', () => {
  const abuja = { city_id: '00000000-0000-4000-8000-0000000000ab', name: 'Abuja', country_code: 'NG', center_lat: 9.0765, center_lng: 7.3986, has_places: true }
  const base = week.linksCitiesFromRows([...LIVE_ROWS, abuja], HINTS)
  const listings = week.bucketListings(
    [row({ lat: 9.06, lng: 7.49, tz: 'Africa/Lagos', starts_at: '2026-11-08T18:00:00Z', item_slug: 'abuja-1' })],
    base,
  )
  const cities = week.withListingZones(base, listings)
  const city2 = cities.find((c) => c.slug === 'abuja')
  assert.deepEqual([city2.name, city2.region, city2.reachKm, city2.timezone], ['Abuja', 'Nigeria', 60, 'Africa/Lagos'])
  assert.deepEqual(listings.map((l) => l.citySlug), ['abuja'])
  const counts = week.cityCounts(cities, listings, [], NOW)
  assert.equal(counts.length, 11)
  assert.deepEqual(week.pickerOrder(counts, null)[0], { city: city2, count: 1, km: null })
  assert.deepEqual(week.resolveCity({ cities, live: week.liveCities(cities, listings, [], NOW), query: 'abuja', geo: null, cookie: null }), { slug: 'abuja', source: 'query' })
  // A new live city with no listings and no guide: UTC, still listed.
  assert.equal(week.withListingZones(base, []).find((c) => c.slug === 'abuja').timezone, 'UTC')
})

test('a city switched off disappears: not listed, not bucketed, its ?city= and cookie no longer open it', () => {
  const cities = week.linksCitiesFromRows(LIVE_ROWS.filter((r) => r.name !== 'Paris'), HINTS)
  assert.equal(cities.some((c) => c.slug === 'paris'), false)
  const listings = week.bucketListings([row({ lat: 48.86, lng: 2.35, tz: 'Europe/Paris', item_slug: 'p1' })], cities)
  assert.deepEqual(listings, [], 'a Paris listing belongs to no live city (Brussels is 260 km away)')
  const live = week.liveCities(cities, listings, [], NOW)
  assert.notEqual(week.resolveCity({ cities, live, query: 'paris', geo: null, cookie: null }).source, 'query')
  assert.notEqual(week.resolveCity({ cities, live, query: null, geo: null, cookie: 'paris' }).source, 'cookie')
  // Geo near Paris lands on the nearest city still live.
  assert.equal(week.resolveCity({ cities, live, query: null, geo: { lat: 48.85, lng: 2.35 }, cookie: null }).slug, 'brussels')
})

test('quiet cities are listed: every live city, nearest first, else most plans then name, "Places to explore"', () => {
  const cities = week.withListingZones(week.linksCitiesFromRows(LIVE_ROWS, HINTS), [])
  const listings = week.bucketListings(
    [
      row({ lat: 6.45, lng: 3.42, tz: 'Africa/Lagos', starts_at: '2026-11-08T18:00:00Z', item_slug: 'l1' }),
      row({ lat: 6.45, lng: 3.42, tz: 'Africa/Lagos', starts_at: '2026-11-09T18:00:00Z', item_slug: 'l2' }),
      row({ lat: 35.789, lng: -78.78, item_slug: 'c1' }),
    ],
    cities,
  )
  const counts = week.cityCounts(cities, listings, [], NOW)
  assert.equal(counts.length, 10, 'all ten live cities, quiet ones included')
  // No location: plans this week, then name.
  assert.deepEqual(week.pickerOrder(counts, null).map((r) => r.city.slug), ['lagos', 'cary', 'brussels', 'durham', 'fort-lauderdale', 'london', 'new-york', 'paris', 'raleigh', 'washington'])
  // From Chapel Hill: Durham, Cary, Raleigh first; Lagos last.
  const fromChapelHill = week.pickerOrder(counts, { lat: 35.913, lng: -79.0558 }).map((r) => r.city.slug)
  assert.deepEqual(fromChapelHill.slice(0, 3), ['durham', 'cary', 'raleigh'])
  assert.equal(fromChapelHill.at(-1), 'lagos')
  assert.equal(week.pickerCountLabel(2), '2 this week')
  assert.equal(week.pickerCountLabel(0), 'Places to explore')
  assert.equal(week.pickerCountLabel(0, true), 'Places to explore')
  assert.equal(week.pickerCountLabel(3, false), '3 this week')
  // A visitor in Chapel Hill lands on quiet Durham, which points at plans in Cary.
  const live = week.liveCities(cities, listings, [], NOW)
  const initial = week.resolveCity({ cities, live, query: null, geo: { lat: 35.913, lng: -79.0558 }, cookie: null })
  assert.deepEqual(initial, { slug: 'durham', source: 'geo' })
  const durham = cities.find((c) => c.slug === 'durham')
  const q = week.quietWeek({ city: durham, cityHasListings: false, places: week.normalisePlaces([placeRow(1)], 'durham', STORAGE), live, readFailed: false })
  assert.deepEqual([q.mode, q.heading, q.plansIn.slug], ['quiet', 'A quiet week in Durham.', 'cary'])
})

test('a quiet city with no photo places: "Nothing listed yet" in the picker, and the fallback line plus Host when picked', () => {
  const rows = LIVE_ROWS.map((r) => (r.name === 'Fort Lauderdale' ? { ...r, has_places: false } : r))
  const cities = week.withListingZones(week.linksCitiesFromRows(rows, HINTS), [])
  const listings = week.bucketListings([row({ lat: 35.789, lng: -78.78, item_slug: 'c1' })], cities)
  const counts = week.cityCounts(cities, listings, [], NOW)
  const label = (slug) => {
    const r = counts.find((c) => c.city.slug === slug)
    return week.pickerCountLabel(r.count, r.city.hasPlaces)
  }
  assert.equal(cities.find((c) => c.slug === 'fort-lauderdale').hasPlaces, false)
  assert.equal(label('fort-lauderdale'), 'Nothing listed yet')
  assert.equal(label('cary'), '1 this week')
  assert.equal(label('raleigh'), 'Places to explore')
  // Picked, it shows the fallback line and "Host something in Fort Lauderdale" (and plans in Cary).
  const fll = cities.find((c) => c.slug === 'fort-lauderdale')
  const q = week.quietWeek({ city: fll, cityHasListings: false, places: [], live: week.liveCities(cities, listings, [], NOW), readFailed: false })
  assert.deepEqual([q.mode, q.text, q.hostCity, q.plansIn.slug], ['fallback', 'Nothing is listed this week yet. Check back soon.', 'Fort Lauderdale', 'cary'])
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

test('?city= with an older guide slug opens the live city (washington-dc, new-york-city, durham-nc)', () => {
  const cities = week.linksCitiesFromRows(LIVE_ROWS, HINTS)
  const resolve = (query, cookie = null) => week.resolveCity({ cities, live: [], query, geo: null, cookie })
  assert.deepEqual(resolve('washington-dc'), { slug: 'washington', source: 'query' })
  assert.deepEqual(resolve('washington'), { slug: 'washington', source: 'query' })
  assert.deepEqual(resolve('new-york-city'), { slug: 'new-york', source: 'query' })
  assert.deepEqual(resolve('durham-nc'), { slug: 'durham', source: 'query' })
  // The remembered-city cookie from before the change still opens its city.
  assert.deepEqual(resolve(null, 'raleigh-nc'), { slug: 'raleigh', source: 'cookie' })
  // Nothing on anywhere and nothing asked: the first live city.
  assert.deepEqual(resolve(null), { slug: 'brussels', source: 'fallback' })
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
