// #4318 — TESTER adversarial test for usemingla.com/links (the city week
// calendar). It attacks different angles from the implementor's happy-path
// test (issue-4318-links.implementor.test.mjs):
//
//   - city resolution with hostile input: unknown, mixed-case and injection
//     `?city=` values (through the page's own parser, read from page.tsx),
//     missing / malformed / out-of-range / mid-ocean geo headers, and a
//     remembered cookie for a city that is no longer live;
//   - bucketing against the REAL registry (not a fixture): the 60 km edge,
//     a point between two cities, and Ibeju-Lekki (Lagos State) going to Lagos;
//   - the week across local midnight and across a DST change;
//   - every hand-off per opens value and per device, host event URLs with a
//     path and query, `javascript:`-style URLs that must never become links,
//     `?src=` on every listing hand-off, and no store/host URL outside #4137;
//   - fit edge cases (0 / 1 / 40 listings, 0 / 10 admin strips);
//   - the data layer when the database errors or returns nothing;
//   - socials (exactly 7 @usemingla, no X, no @minglahost), no Privacy
//     choices link, and noindex.
//
// Run from mingla-marketing/ (Node 22.13+):
//   node --test lib/__tests__/issue-4318-links.tester.adversarial.test.mjs

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { stripTypeScriptTypes } from 'node:module'
import { after, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const MARKETING = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const IMPORT = /from\s+'(@\/lib\/|\.\/)([\w-]+)'/g
const read = (rel) => fs.readFileSync(path.join(MARKETING, rel), 'utf8')

function emit(name, out, seen) {
  if (seen.has(name)) return
  seen.add(name)
  const deps = []
  const js = stripTypeScriptTypes(read(`lib/${name}.ts`)).replace(IMPORT, (_m, _prefix, dep) => {
    deps.push(dep)
    return `from './${dep}.mjs'`
  })
  fs.writeFileSync(path.join(out, `${name}.mjs`), js)
  for (const dep of deps) emit(dep, out, seen)
}

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-4318-tester-'))
const seen = new Set()
for (const name of ['links-week', 'links-fit', 'links-handoff', 'links-data', 'links-config', 'links-src', 'store-links']) {
  emit(name, out, seen)
}
after(() => fs.rmSync(out, { recursive: true, force: true }))
const load = (name) => import(pathToFileURL(path.join(out, `${name}.mjs`)).href)
const week = await load('links-week')
const fit = await load('links-fit')
const handoff = await load('links-handoff')
const data = await load('links-data')
const config = await load('links-config')
const linksSrc = await load('links-src')
const stores = await load('store-links')

// ---------------------------------------------------------------- the REAL registry

// Read the live cities straight from content/cities/registry.ts (the one owner),
// so this test can never drift onto a friendlier fixture.
const REGISTRY = read('content/cities/registry.ts')
function registryCities() {
  const centres = REGISTRY.match(/CITY_HUB_CENTRES[^=]*=\s*\{([\s\S]*?)\n\}/)[1]
  const regions = REGISTRY.match(/CITY_HUB_REGIONS[^=]*=\s*\{([\s\S]*?)\n\}/)[1]
  // Conductor ruling (#4318, 3): each city owns its reach in the registry (Lagos 80 km).
  const reaches = REGISTRY.match(/CITY_HUB_REACH_KM[^=]*=\s*\{([\s\S]*?)\n\}/)[1]
  const cities = []
  for (const m of centres.matchAll(/'?([a-z0-9-]+)'?:\s*\{\s*lat:\s*(-?[\d.]+),\s*lng:\s*(-?[\d.]+)\s*\}/g)) {
    const slug = m[1]
    const rec = REGISTRY.match(new RegExp(`slug: '${slug}', city: '([^']+)'[^\\n]*?timezone: '([^']+)'`))
    const region = regions.match(new RegExp(`'?${slug}'?:\\s*'([^']+)'`))
    assert.ok(rec && region, `registry record for ${slug}`)
    const reach = reaches.match(new RegExp(`'?${slug}'?:\\s*(\\d+)`))
    assert.ok(reach, `registry reach for ${slug}`)
    cities.push({ slug, name: rec[1], region: region[1], timezone: rec[2], lat: Number(m[2]), lng: Number(m[3]), reachKm: Number(reach[1]) })
  }
  return cities
}
const CITIES = registryCities()
const city = (slug) => CITIES.find((c) => c.slug === slug)

test('the registry the page reads has the 10 live cities, each with a centre and a real time zone', () => {
  assert.equal(CITIES.length, 10)
  for (const c of CITIES) {
    assert.ok(Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180, c.slug)
    assert.doesNotThrow(() => new Intl.DateTimeFormat('en-US', { timeZone: c.timezone }), c.slug)
  }
})

// ---------------------------------------------------------------- fixtures

const NOW = '2026-11-07T14:00:00.000Z' // Sat 7 Nov: 9 AM Raleigh, 3 PM Lagos
let seq = 0
function row(over) {
  seq += 1
  return {
    kind: 'event',
    title: `Plan ${seq}`,
    place_label: 'Somewhere',
    starts_at: '2026-11-08T18:00:00Z',
    ends_at: null,
    tz: 'America/New_York',
    lat: 35.7796,
    lng: -78.6382,
    cover_url: null,
    brand_slug: 'brand',
    item_slug: `item-${seq}`,
    ...over,
  }
}
function pinRow(over) {
  seq += 1
  return {
    id: `pin-${seq}`,
    city_slug: null,
    shows_on: '2026-11-10',
    title: `Strip ${seq}`,
    label: 'From Mingla',
    opens: 'explorer',
    url: null,
    blog_slug: null,
    position: seq,
    ...over,
  }
}
/** A point `km` due north of a city centre. */
function northOf(c, km) {
  return { lat: c.lat + (km / 6371) * (180 / Math.PI), lng: c.lng }
}

// The page's own `?city=` / cookie parser, lifted out of app/links/page.tsx so
// this test exercises the shipped code, not a copy.
function pageParam() {
  const page = read('app/links/page.tsx')
  const slugLine = page.match(/const CITY_SLUG = .*\n/)
  const fn = page.match(/function oneParam\([\s\S]*?\n\}\n/)
  assert.ok(slugLine && fn, 'app/links/page.tsx still has CITY_SLUG and oneParam')
  const js = stripTypeScriptTypes(`${slugLine[0]}${fn[0]}`)
  return new Function(`${js}; return oneParam`)()
}
const oneParam = pageParam()

// ================================================================= 1. city resolution

test('?city= — unknown, mixed-case, padded, repeated and injection values', () => {
  const listings = week.bucketListings(
    [row({}), row({}), row({ lat: 6.45, lng: 3.42, tz: 'Africa/Lagos', starts_at: '2026-11-08T18:00:00Z' })],
    CITIES,
  )
  const live = week.liveCities(CITIES, listings, [], NOW)
  const resolve = (raw, over = {}) =>
    week.resolveCity({ cities: CITIES, live, query: oneParam(raw), geo: null, cookie: null, ...over })

  // Mixed case and stray spaces from a hand-typed bio link still land.
  assert.deepEqual(resolve('LaGoS'), { slug: 'lagos', source: 'query' })
  assert.deepEqual(resolve('  Raleigh-NC '), { slug: 'raleigh-nc', source: 'query' })
  // A real but quiet city still wins (city-specific bio links work on first load).
  assert.deepEqual(resolve('paris'), { slug: 'paris', source: 'query' })
  // Unknown slugs fall through to the normal order, never to a phantom city.
  for (const raw of ['atlantis', 'lagos-', 'raleigh', 'new_york_city', '']) {
    const r = resolve(raw)
    assert.notEqual(r.source, 'query', `unknown ?city=${raw} must not win`)
    assert.ok(CITIES.some((c) => c.slug === r.slug))
  }
  // Injection and junk never reach the resolver at all.
  for (const raw of [
    '"><script>alert(1)</script>',
    "lagos' OR '1'='1",
    'lagos%00',
    '../../etc/passwd',
    'javascript:alert(1)',
    'lagos\nSet-Cookie: x=1',
    'x'.repeat(61),
  ]) {
    assert.equal(oneParam(raw), null, `?city=${JSON.stringify(raw)} must be rejected by the page parser`)
  }
  // Next hands a repeated param over as an array: ambiguous, so ignored.
  assert.equal(oneParam(['lagos', 'paris']), null)
  assert.equal(oneParam(undefined), null)
})

test('geo headers — missing, malformed, out of range, and the middle of the ocean', () => {
  const bad = [
    [null, null],
    [null, '3.4'],
    ['6.4', null],
    ['', ''],
    ['   ', '3.4'],
    ['NaN', '3.4'],
    ['6.4', 'NaN'],
    ['Infinity', '3.4'],
    ['abc', 'def'],
    ['90.0001', '0'],
    ['-90.5', '0'],
    ['0', '180.5'],
    ['0', '-181'],
    ['1e3', '0'],
  ]
  for (const [lat, lng] of bad) {
    assert.equal(week.parseGeoHeaders(lat, lng), null, `geo ${lat},${lng} must be ignored`)
  }
  assert.deepEqual(week.parseGeoHeaders(' 6.4541 ', '3.3947'), { lat: 6.4541, lng: 3.3947 })
  assert.deepEqual(week.parseGeoHeaders('-90', '180'), { lat: -90, lng: 180 })

  const listings = week.bucketListings(
    [row({}), row({ lat: 6.45, lng: 3.42, tz: 'Africa/Lagos' }), row({ lat: 51.5, lng: -0.12, tz: 'Europe/London' })],
    CITIES,
  )
  const live = week.liveCities(CITIES, listings, [], NOW)
  const liveSlugs = live.map((l) => l.city.slug)
  // Mid-Atlantic, the Gulf of Guinea, the South Pacific, Null Island: always a
  // LIVE city (the nearest one), never a quiet city and never a crash.
  for (const point of [
    { lat: 30, lng: -40 },
    { lat: 0, lng: 0 },
    { lat: -40, lng: -140 },
    { lat: -60, lng: 100 },
  ]) {
    const r = week.resolveCity({ cities: CITIES, live, query: null, geo: point, cookie: null })
    assert.equal(r.source, 'geo')
    assert.ok(liveSlugs.includes(r.slug), `${JSON.stringify(point)} opened on quiet city ${r.slug}`)
    assert.equal(r.slug, week.nearestCity(live.map((l) => l.city), point).city.slug)
  }
  // Gulf of Guinea → Lagos; North Atlantic off Ireland → London.
  assert.equal(week.resolveCity({ cities: CITIES, live, query: null, geo: { lat: 2, lng: 3 }, cookie: null }).slug, 'lagos')
  assert.equal(week.resolveCity({ cities: CITIES, live, query: null, geo: { lat: 53, lng: -15 }, cookie: null }).slug, 'london')
})

test('a remembered cookie for a city that is no longer live is ignored, unless nothing is live at all', () => {
  const listings = week.bucketListings([row({}), row({}), row({ lat: 6.45, lng: 3.42, tz: 'Africa/Lagos' })], CITIES)
  const live = week.liveCities(CITIES, listings, [], NOW)
  // Brussels had plans last month; this week it has none.
  const r = week.resolveCity({ cities: CITIES, live, query: null, geo: null, cookie: oneParam('brussels') })
  assert.deepEqual(r, { slug: 'raleigh-nc', source: 'busiest' })
  // A cookie for a city that left the registry entirely.
  assert.equal(week.resolveCity({ cities: CITIES, live, query: null, geo: null, cookie: oneParam('atlanta') }).source, 'busiest')
  // A tampered cookie never reaches the resolver.
  assert.equal(oneParam('lagos; Path=/'), null)
  // A city that is live only through its own admin strip counts as live.
  const pins = week.normalisePins([pinRow({ city_slug: 'brussels', shows_on: '2026-11-09' })])
  const live2 = week.liveCities(CITIES, listings, pins, NOW)
  assert.deepEqual(week.resolveCity({ cities: CITIES, live: live2, query: null, geo: null, cookie: 'brussels' }), {
    slug: 'brussels',
    source: 'cookie',
  })
  // Nothing live anywhere: the remembered city still opens (it is a real registry city).
  assert.deepEqual(week.resolveCity({ cities: CITIES, live: [], query: null, geo: null, cookie: 'brussels' }), {
    slug: 'brussels',
    source: 'cookie',
  })
})

// ================================================================= 2. nearest-city bucketing

test('each city\u2019s reach edge (60 km, Lagos 80 km): just inside is kept, just outside is dropped', () => {
  // Conductor ruling (#4318, 3): the edge is the city's own registry reach.
  assert.equal(city('lagos').reachKm, 80)
  for (const c of CITIES) {
    if (c.slug !== 'lagos') assert.equal(c.reachKm, 60, c.slug)
    const inside = northOf(c, c.reachKm - 0.1)
    const outside = northOf(c, c.reachKm + 0.1)
    // Only test a city whose 60 km ring does not reach another city's ring.
    const neighbour = week.nearestCity(CITIES.filter((x) => x.slug !== c.slug), outside)
    if (neighbour.km < 70) continue
    const got = week.bucketListings([row({ ...inside, item_slug: 'in' }), row({ ...outside, item_slug: 'out' })], CITIES)
    assert.deepEqual(
      got.map((l) => [l.itemSlug, l.citySlug]),
      [['in', c.slug]],
      `${c.slug}: ${c.reachKm - 0.1} km kept, ${c.reachKm + 0.1} km dropped`,
    )
  }
  // Exactly on the line: the radius is inclusive (km <= 60).
  const edge = northOf(city('london'), 60)
  const km = week.haversineKm(edge, city('london'))
  assert.ok(Math.abs(km - 60) < 1e-6)
  const at60 = week.bucketListings([row({ ...edge, tz: 'Europe/London' })], CITIES)
  assert.equal(at60.length, km <= 60 ? 1 : 0)
})

test('a listing near two cities goes to the nearer one, whichever order the registry lists them in', () => {
  const raleigh = city('raleigh-nc')
  const cary = city('cary-nc')
  const mid = { lat: (raleigh.lat + cary.lat) / 2, lng: (raleigh.lng + cary.lng) / 2 }
  const towardCary = { lat: mid.lat, lng: mid.lng - 0.001 }
  const towardRaleigh = { lat: mid.lat, lng: mid.lng + 0.001 }
  for (const order of [CITIES, [...CITIES].reverse()]) {
    const got = week.bucketListings([row({ ...towardCary, item_slug: 'c' }), row({ ...towardRaleigh, item_slug: 'r' })], order)
    assert.deepEqual(Object.fromEntries(got.map((l) => [l.itemSlug, l.citySlug])), { c: 'cary-nc', r: 'raleigh-nc' })
  }
  // Research Triangle Park sits between Durham, Raleigh and Cary: exactly one city.
  const rtp = week.bucketListings([row({ lat: 35.8992, lng: -78.8636 })], CITIES)
  assert.equal(rtp.length, 1)
  assert.equal(rtp[0].citySlug, week.nearestCity(CITIES, { lat: 35.8992, lng: -78.8636 }).city.slug)
})

test('Ibeju-Lekki and the Lekki coast (Lagos State) go to Lagos', () => {
  // Places inside Lagos State's Ibeju-Lekki local government area, where many
  // Lagos beach events are held. Each must land on Lagos, not be dropped.
  const places = {
    'Eleko Beach': { lat: 6.4483, lng: 3.8693 },
    'Akodo, Ibeju-Lekki': { lat: 6.4517, lng: 3.9246 },
    'Igando-Oloja (Ibeju-Lekki LGA headquarters)': { lat: 6.4719, lng: 3.9833 },
    'Lekki Free Trade Zone, Ibeju-Lekki': { lat: 6.4526, lng: 4.057 },
  }
  const rows = Object.entries(places).map(([title, p]) => row({ title, ...p, tz: 'Africa/Lagos' }))
  const got = Object.fromEntries(week.bucketListings(rows, CITIES).map((l) => [l.title, l.citySlug]))
  const kmFromLagos = Object.fromEntries(
    Object.entries(places).map(([t, p]) => [t, Math.round(week.haversineKm(p, city('lagos')))]),
  )
  for (const title of Object.keys(places)) {
    assert.equal(
      got[title],
      'lagos',
      `${title} (${kmFromLagos[title]} km from the Lagos centre) must go to Lagos; it was ${got[title] ?? 'dropped'}`,
    )
  }
})

// ================================================================= 3. week grouping

test('the week turns over at the city’s own local midnight, not UTC', () => {
  // 23:30 UTC on Sat 7 Nov = 00:30 Sun 8 Nov in Lagos, 6:30 PM Sat 7 in Raleigh.
  const now = '2026-11-07T23:30:00.000Z'
  const rows = [
    row({ title: 'Lagos 23:59 Sat', starts_at: '2026-11-07T22:59:00Z', tz: 'Africa/Lagos', lat: 6.45, lng: 3.42 }),
    row({ title: 'Lagos 00:00 Sun', starts_at: '2026-11-07T23:00:00Z', tz: 'Africa/Lagos', lat: 6.45, lng: 3.42 }),
    row({ title: 'Lagos 23:59 Sat 14', starts_at: '2026-11-14T22:59:00Z', tz: 'Africa/Lagos', lat: 6.45, lng: 3.42 }),
    row({ title: 'Lagos 00:00 Sun 15', starts_at: '2026-11-14T23:00:00Z', tz: 'Africa/Lagos', lat: 6.45, lng: 3.42 }),
  ]
  const listings = week.bucketListings(rows, CITIES)
  const lagos = week.cityWeek(city('lagos'), listings, [], now)
  assert.equal(lagos.today, '2026-11-08')
  assert.deepEqual(lagos.listings.map((l) => l.title), ['Lagos 00:00 Sun', 'Lagos 23:59 Sat 14'])
  assert.equal(lagos.keys.at(-1), '2026-11-14')
  // Same instant, Raleigh is still on Saturday.
  assert.equal(week.cityWeek(city('raleigh-nc'), listings, [], now).today, '2026-11-07')

  // An every-city strip for Sat 7 has expired in Lagos but still shows in Raleigh.
  const pins = week.normalisePins([pinRow({ shows_on: '2026-11-07' })])
  assert.equal(week.cityWeek(city('lagos'), listings, pins, now).pins.length, 0)
  assert.equal(week.cityWeek(city('raleigh-nc'), listings, pins, now).pins.length, 1)
})

test('the week across a DST change keeps seven calendar days and the right local day for each plan', () => {
  // US clocks fall back at 2 AM on Sun 1 Nov 2026. Now: Sat 31 Oct, 8 AM EDT.
  const now = '2026-10-31T12:00:00.000Z'
  const rows = [
    row({ title: 'Sun 00:30 EDT', starts_at: '2026-11-01T04:30:00Z' }),
    row({ title: 'Sun 01:30 EST (second 1:30)', starts_at: '2026-11-01T06:30:00Z' }),
    row({ title: 'Fri 6 23:30 EST', starts_at: '2026-11-07T04:30:00Z' }),
    row({ title: 'Sat 7 00:30 EST', starts_at: '2026-11-07T05:30:00Z' }),
  ]
  const w = week.cityWeek(city('raleigh-nc'), week.bucketListings(rows, CITIES), [], now)
  assert.deepEqual(w.keys, ['2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'])
  assert.deepEqual(w.days.map((d) => [d.key, d.listings.map((l) => l.title)]), [
    ['2026-11-01', ['Sun 00:30 EDT', 'Sun 01:30 EST (second 1:30)']],
    ['2026-11-06', ['Fri 6 23:30 EST']],
  ])
  assert.equal(week.timeLabel('2026-11-01T06:30:00Z', 'America/New_York'), '1:30 AM')

  // Europe springs forward at 1 AM UTC on Sun 29 Mar 2026: London still gets 7 days.
  const spring = week.cityWeek(city('london'), [], [], '2026-03-28T23:30:00.000Z')
  assert.deepEqual(spring.keys, ['2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31', '2026-04-01', '2026-04-02', '2026-04-03'])
  // "Tonight" uses the local hour after the change (5 PM BST = 16:00 UTC).
  const [bst] = week.bucketListings(
    [row({ starts_at: '2026-03-29T16:00:00Z', tz: 'Europe/London', lat: 51.5, lng: -0.12 })],
    CITIES,
  )
  assert.deepEqual(week.listingWhen(bst, '2026-03-29'), { tonight: true, text: 'Tonight' })
})

test('a row with a bogus time zone falls back to its city’s zone instead of throwing', () => {
  const [l] = week.bucketListings([row({ tz: 'Mars/Olympus_Mons', lat: 6.45, lng: 3.42 })], CITIES)
  assert.equal(l.tz, 'Africa/Lagos')
  assert.equal(week.bucketListings([row({ starts_at: 'not a date' })], CITIES).length, 0)
})

// ================================================================= 4. hand-off

const SRC = 'tiktok'
const PLATFORMS = ['ios', 'android', 'other']
const pin = (opens, extra = {}) =>
  week.normalisePins([
    pinRow({
      opens,
      url: opens === 'web' ? 'host.usemingla.com/e/apexmanager/beach-unwind-2-0?ref=bio&utm_source=ig#tickets' : null,
      blog_slug: opens === 'blog' ? 'first-date-ideas' : null,
      ...extra,
    }),
  ])[0]

function parts(href) {
  const u = new URL(href)
  return { base: `${u.origin}${u.pathname}`, params: Object.fromEntries(u.searchParams) }
}

test('every opens value on iOS, Android and desktop goes to exactly the right place', () => {
  const expected = {
    web: {
      ios: { action: 'navigate', href: 'https://host.usemingla.com/e/apexmanager/beach-unwind-2-0?ref=bio&utm_source=ig#tickets', newTab: true },
      android: { action: 'navigate', href: 'https://host.usemingla.com/e/apexmanager/beach-unwind-2-0?ref=bio&utm_source=ig#tickets', newTab: true },
      other: { action: 'sheet', sheet: 'item' },
    },
    blog: {
      ios: { action: 'navigate', href: '/blog/first-date-ideas', newTab: false },
      android: { action: 'navigate', href: '/blog/first-date-ideas', newTab: false },
      other: { action: 'sheet', sheet: 'item' },
    },
  }
  for (const opens of ['web', 'blog']) {
    for (const platform of PLATFORMS) {
      assert.deepEqual(handoff.resolveLinksHandoff({ type: 'pin', pin: pin(opens) }, platform, SRC), expected[opens][platform], `${opens} on ${platform}`)
    }
  }
  const apps = { explorer: [stores.EXPLORER_ONELINK_URL, 'explorer_bio'], host: [stores.BUSINESS_ONELINK_URL, 'business_bio'] }
  for (const [opens, [base, campaign]] of Object.entries(apps)) {
    for (const platform of ['ios', 'android']) {
      const h = handoff.resolveLinksHandoff({ type: 'pin', pin: pin(opens) }, platform, SRC)
      assert.equal(h.action, 'navigate')
      assert.equal(h.newTab, false)
      assert.deepEqual(parts(h.href), { base, params: { pid: `bio_${SRC}`, c: campaign } }, `${opens} on ${platform}`)
    }
    assert.deepEqual(handoff.resolveLinksHandoff({ type: 'pin', pin: pin(opens) }, 'other', SRC), { action: 'sheet', sheet: 'item' })
  }
  // Never crossed: an Explorer strip never yields the Host OneLink, and back.
  assert.ok(!handoff.linksTargetHrefs({ type: 'pin', pin: pin('explorer') }, SRC).phoneHref.startsWith(stores.BUSINESS_ONELINK_URL))
  assert.ok(!handoff.linksTargetHrefs({ type: 'pin', pin: pin('host') }, SRC).phoneHref.startsWith(stores.EXPLORER_ONELINK_URL))
  // The desktop sheets offer the right app's stores.
  assert.equal(handoff.targetApp({ type: 'banner', app: 'host' }), 'host')
  assert.equal(handoff.targetApp({ type: 'pin', pin: pin('blog') }), null)
})

test('a host.usemingla.com event URL keeps its path, query and fragment byte for byte', () => {
  const cases = [
    ['host.usemingla.com/e/apexmanager/beach-unwind-2-0', 'https://host.usemingla.com/e/apexmanager/beach-unwind-2-0'],
    ['host.usemingla.com/e/salsa4life/bring-a-friend-2-for-1-latin-dance-night?ref=bio', 'https://host.usemingla.com/e/salsa4life/bring-a-friend-2-for-1-latin-dance-night?ref=bio'],
    ['https://host.usemingla.com/e/a/b?x=1&y=2&y=3', 'https://host.usemingla.com/e/a/b?x=1&y=2&y=3'],
    ['HTTP://host.usemingla.com/t/a/b?q=a%20b', 'https://host.usemingla.com/t/a/b?q=a%20b'],
    ['host.usemingla.com/exp/a/b?utm_source=instagram&utm_campaign=lagos#book', 'https://host.usemingla.com/exp/a/b?utm_source=instagram&utm_campaign=lagos#book'],
  ]
  for (const [stored, href] of cases) {
    const p = pin('web', { url: stored })
    assert.ok(p, `${stored} must be a valid web strip`)
    assert.equal(week.pinWebHref(stored), href)
    assert.equal(handoff.resolveLinksHandoff({ type: 'pin', pin: p }, 'ios', SRC).href, href)
    assert.equal(handoff.linksTargetHrefs({ type: 'pin', pin: p }, SRC).computerHref, href)
  }
})

test('a javascript:, data: or credential-smuggling URL never becomes a link', () => {
  const hostile = [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(document.cookie)',
    ' javascript:alert(1)',
    'javascript://example.com/%0aalert(1)',
    'javascript:alert(1)//host.usemingla.com',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'ftp://example.com/x',
    'usemingla.com@evil.example/x',
    'user:pass@host.usemingla.com/e/a/b',
    'host.usemingla.com/e/a b',
    'host.usemingla.com\n/evil',
    'localhost/x',
    '',
    '   ',
  ]
  for (const url of hostile) {
    const href = week.pinWebHref(url)
    assert.equal(href, null, `${JSON.stringify(url)} produced ${href}`)
    assert.deepEqual(week.normalisePins([pinRow({ opens: 'web', url })]), [], `${JSON.stringify(url)} must drop the strip`)
  }
  // Belt and braces: whatever a web strip opens, it is https and nothing else.
  for (const url of ['host.usemingla.com/e/a/b', 'http://example.com', 'EXAMPLE.com/X?y=1']) {
    assert.match(week.pinWebHref(url), /^https:\/\/[a-z0-9.-]+\//)
  }
  // A blog strip cannot be turned into a path escape or another origin.
  for (const blog_slug of ['../admin', '//evil.example', 'a/b', 'javascript:alert(1)', '']) {
    assert.deepEqual(week.normalisePins([pinRow({ opens: 'blog', blog_slug })]), [], `blog slug ${blog_slug}`)
  }
  // An unknown opens value or label is dropped, never defaulted.
  assert.deepEqual(week.normalisePins([pinRow({ opens: 'store' })]), [])
  assert.deepEqual(week.normalisePins([pinRow({ label: 'Sponsored' })]), [])
})

test('?src= rides on every listing hand-off, every kind, every phone, and junk falls back to bio_direct', () => {
  const rows = ['event', 'trip', 'experience'].map((kind) => row({ kind, brand_slug: 'Brand-1', item_slug: `${kind}-slug` }))
  const listings = week.bucketListings(rows, CITIES)
  assert.equal(listings.length, 3)
  for (const rawSrc of ['instagram', 'YouTube', ' linkedin ', '<script>', 'a&pid=evil', null, ['ig', 'tt']]) {
    const src = linksSrc.sanitizeLinksSrc(rawSrc)
    assert.match(src, /^[a-z0-9_]{1,32}$/)
    for (const listing of listings) {
      for (const platform of ['ios', 'android']) {
        const h = handoff.resolveLinksHandoff({ type: 'listing', listing }, platform, src)
        const { base, params } = parts(h.href)
        assert.equal(base, stores.EXPLORER_ONELINK_URL)
        assert.deepEqual(params, {
          pid: `bio_${src}`,
          c: 'explorer_bio',
          deep_link_value: listing.kind,
          deep_link_sub1: 'Brand-1',
          deep_link_sub2: `${listing.kind}-slug`,
        })
      }
      // The banner and app-strip hand-offs carry the same pid.
      for (const target of [{ type: 'banner', app: 'explorer' }, { type: 'banner', app: 'host' }]) {
        assert.equal(parts(handoff.resolveLinksHandoff(target, 'ios', src).href).params.pid, `bio_${src}`)
      }
    }
  }
  assert.equal(linksSrc.sanitizeLinksSrc('a&pid=evil'), 'direct')
  // Slugs that could break out of the deep link are dropped at bucketing.
  for (const bad of ['a&deep_link_value=x', 'a/b', '../x', 'a b', '']) {
    assert.equal(week.bucketListings([row({ item_slug: bad })], CITIES).length, 0, `item slug ${JSON.stringify(bad)}`)
    assert.equal(week.bucketListings([row({ brand_slug: bad })], CITIES).length, 0, `brand slug ${JSON.stringify(bad)}`)
  }
})

test('no store, OneLink or host URL constant lives outside the #4137 seam', () => {
  const files = [
    'app/links/page.tsx',
    'app/links/fonts.ts',
    'components/marketing/links-experience.tsx',
    'lib/links-week.ts',
    'lib/links-fit.ts',
    'lib/links-handoff.ts',
    'lib/links-data.ts',
    'lib/links-config.ts',
  ]
  const banned = [
    /apps\.apple\.com/i,
    /play\.google\.com/i,
    /onelink/i,
    /go\.usemingla\.com/i,
    /biz\.usemingla\.com/i,
    /host\.usemingla\.com/i,
    /usemingla\.com\/(host\/)?download/i,
    /market:\/\//i,
    /itms-apps:/i,
  ]
  // The seam's own constants, by value, must not be pasted anywhere either.
  const values = [
    stores.APP_STORE_URL,
    stores.PLAY_STORE_URL,
    stores.BUSINESS_APP_STORE_URL,
    stores.BUSINESS_PLAY_STORE_URL,
    stores.BUSINESS_WEB_URL,
    stores.EXPLORER_ONELINK_URL,
    stores.BUSINESS_ONELINK_URL,
  ]
  for (const file of files) {
    const code = read(file)
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n')
    for (const re of banned) assert.doesNotMatch(code, re, `${file} hardcodes ${re}`)
    for (const v of values) assert.ok(!code.includes(v), `${file} hardcodes ${v}`)
  }
})

// ================================================================= 5. fit edge cases

function phoneFit({ room, pins, list, short = false }) {
  return fit.computeLinksFit({
    pinCount: pins,
    listCount: list,
    short,
    desk: false,
    fitList: (shown) => Math.max(0, Math.min(list, room - shown)),
    leftOverflows: () => false,
  })
}

test('fit: 0, 1 and 40 listings against 0 and 10 admin strips, tall and short screens', () => {
  // Nothing at all.
  assert.deepEqual(phoneFit({ room: 4, pins: 0, list: 0 }), { pinsShown: 0, listShown: 0 })
  assert.deepEqual(fit.moreLabel(0, 0), { hidden: 0, text: 'Open the full week', count: null })
  assert.equal(fit.pinsMoreLabel(0, 0), null)
  // One listing: it is the floor, so admin strips fold to keep it.
  assert.deepEqual(phoneFit({ room: 4, pins: 10, list: 1 }), { pinsShown: 3, listShown: 1 })
  // Conductor ruling (#4318, 2): at least one admin strip always shows when any
  // exist and nothing would be clipped, even at the cost of the listing floor.
  assert.deepEqual(phoneFit({ room: 1, pins: 10, list: 1, short: true }), { pinsShown: 1, listShown: 0 })
  assert.equal(fit.pinsMoreLabel(10, 0), 'See 10 more from Mingla')
  // A screen so small that even the one listing cannot fit: zero, never negative.
  assert.deepEqual(phoneFit({ room: 0, pins: 10, list: 1, short: true }), { pinsShown: 1, listShown: 0 })
  assert.deepEqual(fit.moreLabel(1, 0), { hidden: 1, text: 'See 1 more', count: '1 this week' })
  // Forty listings: the floor of 3 holds on a tall phone, 1 on a short one.
  assert.deepEqual(phoneFit({ room: 4, pins: 10, list: 40 }), { pinsShown: 1, listShown: 3 })
  assert.deepEqual(phoneFit({ room: 3, pins: 10, list: 40, short: true }), { pinsShown: 2, listShown: 1 })
  assert.deepEqual(phoneFit({ room: 4, pins: 0, list: 40 }), { pinsShown: 0, listShown: 4 })
  assert.deepEqual(fit.moreLabel(40, 4), { hidden: 36, text: 'See 36 more', count: '40 this week' })
  // The fit never reports more than exists or less than nothing.
  for (const pins of [0, 1, 10]) {
    for (const list of [0, 1, 40]) {
      for (const room of [0, 1, 3, 6, 50]) {
        for (const short of [true, false]) {
          const r = phoneFit({ room, pins, list, short })
          assert.ok(r.pinsShown >= 0 && r.pinsShown <= pins, JSON.stringify({ pins, list, room, short, r }))
          assert.ok(r.listShown >= 0 && r.listShown <= list, JSON.stringify({ pins, list, room, short, r }))
        }
      }
    }
  }
  // Desktop with 10 admin strips and a left column that holds 2.
  const desk = fit.computeLinksFit({
    pinCount: 10,
    listCount: 40,
    short: false,
    desk: true,
    fitList: () => 6,
    leftOverflows: (n) => n > 2,
  })
  assert.deepEqual(desk, { pinsShown: 2, listShown: 6 })
  // stripsThatFit with no room or no strips.
  assert.equal(fit.stripsThatFit([], 500, 40, 10), 0)
  assert.equal(fit.stripsThatFit([54, 118], 0, 40, 10), 0)
})

test('phones: admin strips that alone overflow the screen fold, even when the city has no listings', () => {
  // Measured in Chrome at 320x568 and 390x844 with 0 listings and 10 admin
  // strips: all 10 rendered, strip 6 (320) / strip 9 (390) cut in half, and the
  // city switcher, chips, empty state and socials pushed off the screen.
  // With no listings the floor is 0, so the phone loop never folds a strip;
  // the probe's overflow signal must still be honoured.
  const capacity = 3 // admin strips that fit above the city switcher on a 320x568 phone
  for (const short of [true, false]) {
    const r = fit.computeLinksFit({
      pinCount: 10,
      listCount: 0,
      short,
      desk: false,
      fitList: () => 0,
      leftOverflows: (shown) => shown > capacity,
    })
    assert.ok(
      r.pinsShown <= capacity,
      `${short ? 'short' : 'tall'} phone with 0 listings showed ${r.pinsShown} admin strips; only ${capacity} fit`,
    )
  }
})

test('sheets trap Tab inside the dialog and close on Escape wherever focus is', () => {
  // Chrome, 390x844 and 1440x900: four Tabs from the city picker (three from the
  // Host sheet) land on the consent bar's "OK" / "Privacy options" and then
  // "Skip to content", outside the aria-modal dialog; Escape then does nothing
  // because the only Escape handler is on <main>. Tapping the sheet's title
  // (focus goes to <body>) breaks Escape the same way.
  const ui = read('components/marketing/links-experience.tsx')
  const code = ui
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n')
  assert.match(code, /key === 'Tab'/, 'no Tab focus trap inside the open sheet')
  assert.match(
    code,
    /(document|window)\.addEventListener\(\s*'keydown'/,
    'Escape is only heard while focus is inside <main>; listen on the document while a sheet is open',
  )
})

test('very long titles survive the model untouched (the CSS clamps them), and blank titles are dropped', () => {
  const long = 'A'.repeat(300)
  const [l] = week.bucketListings([row({ title: `  ${long}  ` })], CITIES)
  assert.equal(l.title, long)
  assert.equal(week.bucketListings([row({ title: '   ' })], CITIES).length, 0)
  assert.equal(week.normalisePins([pinRow({ title: '' })]).length, 0)
  // The strip title and its text block clamp to one line in the stylesheet.
  const css = read('components/marketing/links-experience.module.css')
  const block = css.match(/\.st-txt\s*b\s*\{[^}]*\}/)
  assert.ok(block, 'a .st-txt b rule exists')
  assert.match(block[0], /text-overflow:\s*ellipsis/)
  assert.match(block[0], /white-space:\s*nowrap/)
})

// ================================================================= 6. the data layer fails or is empty

test('the empty state: database errors or empty answers give empty lists and a logged error, never a throw', async () => {
  const realFetch = globalThis.fetch
  const realError = console.error
  const env = { ...process.env }
  const logged = []
  console.error = (...args) => logged.push(args.map(String).join(' '))
  try {
    // Not configured: empty, nothing logged.
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    assert.deepEqual(await data.getLinksData(), { rows: [], strips: [], failed: [] })

    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.example.test/'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
    const calls = []
    const respond = (status, body) => async (url, init) => {
      calls.push({ url: String(url), init })
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
    }
    const scenarios = [
      ['network down', async () => { throw new TypeError('fetch failed') }, ['week', 'strips']],
      ['500', respond(500, { message: 'boom' }), ['week', 'strips']],
      ['404 function missing', respond(404, { code: 'PGRST202' }), ['week', 'strips']],
      ['not a list', respond(200, { rows: [] }), ['week', 'strips']],
      ['bad JSON', respond(200, '<html>'), ['week', 'strips']],
      ['empty', respond(200, []), []],
    ]
    for (const [name, impl, failed] of scenarios) {
      logged.length = 0
      globalThis.fetch = impl
      const got = await data.getLinksData()
      assert.deepEqual(got, { rows: [], strips: [], failed }, name)
      assert.equal(logged.length, failed.length, `${name}: each failed read is logged once`)
    }
    // One read fails, the other still shows.
    globalThis.fetch = async (url) =>
      String(url).endsWith('/links_page_week')
        ? new Response('[]', { status: 503 })
        : new Response(JSON.stringify([pinRow({})]), { status: 200 })
    const half = await data.getLinksData()
    assert.deepEqual(half.failed, ['week'])
    assert.equal(half.strips.length, 1)
    // The anon key, never a service key, and POST to the two RPCs only.
    assert.ok(calls.every((c) => c.init.method === 'POST' && c.init.headers.apikey === 'anon'))
    assert.ok(calls.every((c) => /\/rest\/v1\/rpc\/links_page_(week|strips)$/.test(c.url)), calls.map((c) => c.url).join())
    assert.ok(calls.every((c) => !c.url.includes('//rest')), 'the trailing slash on the URL is trimmed')

    // The model turns garbage rows into nothing rather than a crash.
    const junk = [null, {}, { kind: 'event' }, row({ lat: 'x' }), row({ lat: Number.NaN })].filter(Boolean)
    assert.deepEqual(week.bucketListings(junk.filter((r) => r.title !== undefined || r.kind), CITIES).length, 0)
  } finally {
    globalThis.fetch = realFetch
    console.error = realError
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]
    Object.assign(process.env, env)
  }
  // The page shows the designed empty state when its city has nothing on.
  const ui = read('components/marketing/links-experience.tsx')
  assert.match(ui, /A quiet one\./)
})

// ================================================================= 7 + 8. socials, privacy link, noindex

test('socials: exactly 7 @usemingla links in the approved order, no X and no @minglahost anywhere on /links', () => {
  assert.deepEqual(
    config.LINKS_SOCIALS.map((s) => s.id),
    ['instagram', 'tiktok', 'threads', 'snapchat', 'youtube', 'facebook', 'linkedin'],
  )
  const hosts = {
    instagram: 'www.instagram.com',
    tiktok: 'www.tiktok.com',
    threads: 'www.threads.com',
    snapchat: 'www.snapchat.com',
    youtube: 'www.youtube.com',
    facebook: 'www.facebook.com',
    linkedin: 'www.linkedin.com',
  }
  for (const s of config.LINKS_SOCIALS) {
    const u = new URL(s.href)
    assert.equal(u.protocol, 'https:')
    assert.equal(u.host, hosts[s.id])
    assert.match(u.pathname, /^\/(@|add\/|company\/)?usemingla$/, s.href)
  }
  assert.equal(new Set(config.LINKS_SOCIALS.map((s) => s.href)).size, 7)
  const surfaces = [
    'app/links/page.tsx',
    'components/marketing/links-experience.tsx',
    'lib/links-config.ts',
    'lib/links-handoff.ts',
    'lib/links-week.ts',
  ]
  for (const file of surfaces) {
    const code = read(file)
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n')
    assert.doesNotMatch(code, /minglahost/i, `${file} mentions @minglahost`)
    assert.doesNotMatch(code, /\b(x|twitter)\.com\b/i, `${file} links to X`)
    assert.doesNotMatch(code, /PrivacyChoicesLink|privacy-choices-link|Privacy choices/i, `${file} renders a Privacy choices link`)
    if (file.endsWith('.tsx')) assert.doesNotMatch(code, /@usemingla/, `${file} prints the @usemingla handle text`)
  }
  // The component renders the list, not its own copy of it.
  const ui = read('components/marketing/links-experience.tsx')
  assert.match(ui, /LINKS_SOCIALS\.map/)
  assert.doesNotMatch(ui, /instagram\.com|tiktok\.com|youtube\.com|facebook\.com|linkedin\.com|snapchat\.com|threads\.(net|com)/)
})

test('/links stays noindex, through the shared metadata helper and the route registry', () => {
  const page = read('app/links/page.tsx')
  assert.match(page, /export const metadata = publicNoindexMetadata\('\/links'/)
  assert.doesNotMatch(page, /robots:\s*\{[^}]*index:\s*true/)
  const helper = read('lib/search/metadata.ts')
  const fn = helper.match(/export function publicNoindexMetadata[\s\S]*?\n\}/)
  assert.ok(fn, 'publicNoindexMetadata exists')
  assert.match(fn[0], /index:\s*false/)
  const registry = read('lib/search/route-registry.ts')
  const noindex = registry.match(/const PUBLIC_NOINDEX_ROUTES = \[([\s\S]*?)\n\]/)
  assert.ok(noindex, 'the registry has a PUBLIC_NOINDEX_ROUTES list')
  assert.match(noindex[1], /\['\/links', 'links'\]/, '/links is registered as public noindex')
  const searchReady = registry.match(/SearchReadyRouteContract\[\]/) ? registry.split('PUBLIC_NOINDEX_ROUTES')[0] : ''
  assert.doesNotMatch(searchReady, /pathname: '\/links'/, '/links is never search_ready')
})
