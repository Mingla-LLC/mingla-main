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
//   - the live cities (8 Nov ruling): hostile `links_page_cities()` rows, the
//     REAL guide registry lending older slugs, regions and zones (never adding
//     a city), and the page never rebuilding its list from the registry;
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

// Read the city guides straight from content/cities/registry.ts, so this test
// can never drift onto a friendlier fixture. Live cities ruling (8 Nov): /links
// lists the cities live in Explorer (`links_page_cities()`); the guides only
// lend an older slug, region and zone, and stand in while that read is down.
// Reach is no longer a registry fact: lib/links-week.ts cityReachKm (Lagos 80).
const REGISTRY = read('content/cities/registry.ts')
function registryCities() {
  const centres = REGISTRY.match(/CITY_HUB_CENTRES[^=]*=\s*\{([\s\S]*?)\n\}/)[1]
  const regions = REGISTRY.match(/CITY_HUB_REGIONS[^=]*=\s*\{([\s\S]*?)\n\}/)[1]
  const cities = []
  for (const m of centres.matchAll(/'?([a-z0-9-]+)'?:\s*\{\s*lat:\s*(-?[\d.]+),\s*lng:\s*(-?[\d.]+)\s*\}/g)) {
    const slug = m[1]
    const rec = REGISTRY.match(new RegExp(`slug: '${slug}', city: '([^']+)', country: '[^']+', countryCode: '([A-Z]{2})'[^\\n]*?timezone: '([^']+)'`))
    const region = regions.match(new RegExp(`'?${slug}'?:\\s*'([^']+)'`))
    assert.ok(rec && region, `registry record for ${slug}`)
    cities.push({ slug, name: rec[1], countryCode: rec[2], region: region[1], timezone: rec[3], lat: Number(m[2]), lng: Number(m[3]), reachKm: week.cityReachKm(slug) })
  }
  return cities
}
const CITIES = registryCities()
const city = (slug) => CITIES.find((c) => c.slug === slug)

test('the city guides the page borrows from (and stands in with) have 10 cities, each with a centre and a real time zone', () => {
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

// ================================================================= 1. city resolution

// ================================================================= 2. nearest-city bucketing

test('each city\u2019s reach edge (60 km, Lagos 80 km): just inside is kept, just outside is dropped', () => {
  // Live cities ruling (8 Nov): reach is cityReachKm, an override map (Lagos 80).
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

  // Admin strips are not cut by the city's own midnight (8 Nov live check: a
  // strip posted Sunday evening in the US never showed in Lagos). A Sat 7
  // strip shows in both until Saturday has ended in the last zone (UTC-12),
  // then in neither.
  const pins = week.normalisePins([pinRow({ shows_on: '2026-11-07' })])
  assert.equal(week.cityWeek(city('lagos'), listings, pins, now).pins.length, 1)
  assert.equal(week.cityWeek(city('raleigh-nc'), listings, pins, now).pins.length, 1)
  const later = '2026-11-08T12:00:01.000Z'
  assert.equal(week.cityWeek(city('lagos'), listings, pins, later).pins.length, 0)
  assert.equal(week.cityWeek(city('raleigh-nc'), listings, pins, later).pins.length, 0)
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
    assert.deepEqual(await data.getLinksData(), { rows: [], strips: [], cities: [], failed: [] })

    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.example.test/'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
    const calls = []
    const respond = (status, body) => async (url, init) => {
      calls.push({ url: String(url), init })
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
    }
    const scenarios = [
      ['network down', async () => { throw new TypeError('fetch failed') }, ['week', 'strips', 'cities']],
      ['500', respond(500, { message: 'boom' }), ['week', 'strips', 'cities']],
      ['404 function missing', respond(404, { code: 'PGRST202' }), ['week', 'strips', 'cities']],
      ['not a list', respond(200, { rows: [] }), ['week', 'strips', 'cities']],
      ['bad JSON', respond(200, '<html>'), ['week', 'strips', 'cities']],
      ['empty', respond(200, []), []],
    ]
    for (const [name, impl, failed] of scenarios) {
      logged.length = 0
      globalThis.fetch = impl
      const got = await data.getLinksData()
      assert.deepEqual(got, { rows: [], strips: [], cities: [], failed }, name)
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
    // The anon key, never a service key, and POST to the three readers only.
    assert.ok(calls.every((c) => c.init.method === 'POST' && c.init.headers.apikey === 'anon'))
    assert.ok(calls.every((c) => /\/rest\/v1\/rpc\/links_page_(week|strips|cities)$/.test(c.url)), calls.map((c) => c.url).join())
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
})

// ================================================================= 6b. live cities (8 Nov ruling)

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

test('live cities against the REAL guides: every guide matches its live city, older slugs open it, nothing is added', () => {
  const cities = week.linksCitiesFromRows(LIVE_ROWS, CITIES)
  assert.equal(cities.length, 10, 'the guides never add a city')
  // Every guide finds its live city (centres within 30 km in the same country),
  // so every older slug in a bio link keeps working.
  for (const guide of CITIES) {
    const live = week.cityForSlug(cities, guide.slug)
    assert.ok(live, `?city=${guide.slug}`)
    assert.equal(live.region, guide.region, guide.slug)
    assert.equal(live.timezone, guide.timezone, guide.slug)
  }
  // A guide in another country, or more than 30 km away, lends nothing.
  const far = week.linksCitiesFromRows([{ ...LIVE_ROWS[7], center_lat: 49.2 }], CITIES)
  assert.deepEqual([far[0].aliases, far[0].region, far[0].timezone], [[], 'France', ''])
  const wrongCountry = week.linksCitiesFromRows([{ ...LIVE_ROWS[7], country_code: 'BE' }], CITIES)
  assert.deepEqual(wrongCountry[0].aliases, [])
})

test('hostile links_page_cities() rows: junk dropped, names never break the slug, zero and odd counts handled', () => {
  const base = LIVE_ROWS[0]
  const got = week.linksCitiesFromRows(
    [
      null,
      {},
      { ...base, city_id: "1' OR '1'='1" },
      { ...base, city_id: '00000000-0000-4000-8000-000000000001', name: '"><script>alert(1)</script>' },
      { ...base, city_id: '00000000-0000-4000-8000-000000000002', name: '!!!' },
      { ...base, city_id: '00000000-0000-4000-8000-000000000003', name: 'Zürich', country_code: 'ch' },
      { ...base, city_id: '00000000-0000-4000-8000-000000000004', name: 'Nowhere', center_lng: 'abc' },
      { ...base, city_id: '00000000-0000-4000-8000-000000000005', name: 'Ghost', country_code: null, has_places: 'yes' },
      { ...base, city_id: '00000000-0000-4000-8000-000000000006', name: 'x'.repeat(200), has_places: false },
    ].filter(Boolean),
    CITIES,
  )
  const slugs = got.map((c) => c.slug)
  assert.deepEqual(slugs.slice(0, 3), ['script-alert-1-script', 'zurich', 'ghost'])
  for (const c of got) assert.match(c.slug, /^[a-z0-9-]{2,60}$/, `slug ${c.slug} is clean`)
  // The display name is kept as text (React escapes it); the slug is clean.
  assert.equal(got[0].name, '"><script>alert(1)</script>')
  assert.deepEqual([got[1].region, got[2].region, got[2].hasPlaces, got[3].hasPlaces], ['Switzerland', '', null, false])
  // An empty city list never crashes the resolver silently: it throws loudly.
  assert.throws(() => week.resolveCity({ cities: [], live: [], query: null, geo: null, cookie: null }))
})

test('the quiet-week request sends p_city_id to links_page_places (and lat/lng only as the fallback)', async () => {
  const realFetch = globalThis.fetch
  const env = { ...process.env }
  const bodies = []
  try {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.example.test'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
    globalThis.fetch = async (url, init) => {
      bodies.push({ url: String(url), body: JSON.parse(init.body) })
      return new Response('[]', { status: 200 })
    }
    const [paris] = week.linksCitiesFromRows([LIVE_ROWS[7]], CITIES)
    const guide = city('lagos')
    await data.getLinksPlaces([paris, guide])
    assert.deepEqual(bodies.map((b) => b.url), Array(2).fill('https://db.example.test/rest/v1/rpc/links_page_places'))
    assert.equal(bodies[0].body.p_city_id, '13d9113a-4796-499e-9544-ae4d17c678db')
    assert.equal('p_city_id' in bodies[1].body, false, 'a city with no id uses the lat/lng path')
    assert.equal(bodies[1].body.p_radius_km, 80)
  } finally {
    globalThis.fetch = realFetch
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]
    Object.assign(process.env, env)
  }
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
