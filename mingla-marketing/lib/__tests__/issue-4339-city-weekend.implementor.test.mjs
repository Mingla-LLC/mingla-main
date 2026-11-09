// #4339 phase 4a — implementor regression test for the city page's "This
// weekend" on #4318's live readers (§4).
//
// Source mode (default, no install): runs the REAL lib/city-weekend.ts (with
// #4318's lib/links-week.ts underneath) and the REAL lib/app-handoff.ts seam
// with node's TypeScript type stripping, against stubbed reader rows shaped
// exactly like `links_page_week()`, `links_page_strips()` and
// `links_page_places(...)`. The registry centres, reaches and time zones are
// read from content/cities/registry.ts, so the test follows the registry.
// Built mode (ISSUE_4339_BUILT=1 after `npm run build`): the prerendered city
// pages carry the section, its fallback line (the build has no database) and
// the ranked places below it.
//
// Pins:
//   - every branch of the empty-week rule: weekend listings; weekday plans;
//     a quiet week with places + "Plans in <nearest live city>" + "Host
//     something in <City>"; a quiet week with no other live city; nothing live
//     anywhere and no places; a failed read;
//   - admin strips first, in admin order, in every branch, never by city;
//   - Friday to Sunday in the city's own zone, each listing's day in its own
//     `tz`: Lagos (UTC+1) and Raleigh (UTC-5 in November) at the edges;
//   - the chips filter by kind (trips under Experiences);
//   - every tap goes through the seam (lib/app-handoff.ts → cta-destination);
//   - no /render/image anywhere; place photos are the stored thumbnails on
//     the public object endpoint;
//   - #4318's files are imported, not edited;
//   - #4349: one card per plan (brand_slug + item_slug) AFTER the Friday–Sunday
//     filter, labelled with its day span, counts per plan (the Lagos boat
//     charter listed 6 times is one card); the page's city resolves to its
//     `city_id` through `links_page_cities()` and the places read passes
//     `p_city_id` (the fast path; London timed out without it).
//
// Run from mingla-marketing/ (Node 22.13+):
//   node --test lib/__tests__/issue-4339-city-weekend.implementor.test.mjs

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { stripTypeScriptTypes } from 'node:module'
import { after, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const MARKETING = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => fs.readFileSync(path.join(MARKETING, rel), 'utf8')
const code = (source) => source.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const BUILT = process.env.ISSUE_4339_BUILT === '1'

// ---- strip-types loader ------------------------------------------------------
const IMPORT = /from\s+'(@\/lib\/|\.\/)([\w-]+)'/g
function emit(sourcePath, outName, out, seen) {
  if (seen.has(outName)) return
  seen.add(outName)
  const deps = []
  const js = stripTypeScriptTypes(fs.readFileSync(sourcePath, 'utf8')).replace(IMPORT, (_m, _p, name) => {
    deps.push(name)
    return `from './${name}.mjs'`
  })
  fs.writeFileSync(path.join(out, `${outName}.mjs`), js)
  for (const name of deps) emit(path.join(MARKETING, 'lib', `${name}.ts`), name, out, seen)
}
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-4339-city-weekend-'))
after(() => fs.rmSync(out, { recursive: true, force: true }))
const seen = new Set()
emit(path.join(MARKETING, 'lib/city-weekend.ts'), 'city-weekend', out, seen)
emit(path.join(MARKETING, 'lib/app-handoff.ts'), 'app-handoff', out, seen)
const load = (name) => import(pathToFileURL(path.join(out, `${name}.mjs`)).href)
const weekend = await load('city-weekend')
const week = await load('links-week')
const handoff = await load('app-handoff')
const stores = await load('store-links')

// ---- the registry, read from its source ---------------------------------------
const registry = read('content/cities/registry.ts')
const block = (name) => {
  const start = registry.indexOf(`export const ${name}`)
  return registry.slice(registry.indexOf('= {', start), registry.indexOf('\n}\n', start) + 2)
}
const centres = Object.fromEntries(
  [...block('CITY_HUB_CENTRES').matchAll(/'?([a-z-]+)'?: \{ lat: (-?[\d.]+), lng: (-?[\d.]+) \}/g)].map((m) => [m[1], { lat: Number(m[2]), lng: Number(m[3]) }]),
)
const reach = Object.fromEntries([...block('CITY_HUB_REACH_KM').matchAll(/'?([a-z-]+)'?: (\d+)/g)].map((m) => [m[1], Number(m[2])]))
const hubs = [...registry.matchAll(/slug: '([a-z-]+)', city: '([^']+)',[^\n]*timezone: '([^']+)'/g)].map((m) => ({ slug: m[1], name: m[2], timezone: m[3] }))
const CITIES = hubs.map((h) => ({ ...h, region: '', reachKm: reach[h.slug], ...centres[h.slug] }))
const city = (slug) => CITIES.find((c) => c.slug === slug)

test('the registry was read: every city has a centre, a reach and a zone', () => {
  assert.equal(CITIES.length, 10)
  for (const c of CITIES) {
    assert.ok(Number.isFinite(c.lat) && Number.isFinite(c.lng) && c.reachKm >= 60 && c.timezone.includes('/'), c.slug)
  }
  assert.equal(city('lagos').timezone, 'Africa/Lagos')
  assert.equal(city('raleigh-nc').timezone, 'America/New_York')
})

// ---- stubbed reader rows -----------------------------------------------------
// Wednesday 11 November 2026, 15:00 UTC (16:00 in Lagos, 10:00 in Raleigh).
const NOW = '2026-11-11T15:00:00.000Z'
const near = (slug, dLat = 0.01) => ({ lat: city(slug).lat + dLat, lng: city(slug).lng })
let n = 0
function row(slug, startsAt, kind = 'event', extra = {}) {
  n += 1
  return {
    kind,
    title: `${kind} ${n} in ${slug}`,
    place_label: 'Somewhere real',
    starts_at: startsAt,
    ends_at: null,
    tz: city(slug).timezone,
    ...near(slug),
    cover_url: 'https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/event-covers/x.jpg',
    brand_slug: 'blue-note',
    item_slug: `item-${n}`,
    ...extra,
  }
}
const STRIPS = [
  { id: 'b', shows_on: '2026-11-13', title: 'Second strip', label: 'Featured', opens: 'blog', url: null, blog_slug: 'weekend-guide', position: 2 },
  { id: 'a', shows_on: '2026-11-13', title: 'Free tools for hosts', label: 'From Mingla', opens: 'web', url: 'usemingla.com/tools', blog_slug: null, position: 1 },
  { id: 'c', shows_on: '2026-11-10', title: 'Expired yesterday', label: 'New', opens: 'explorer', url: null, blog_slug: null, position: 0 },
  { id: 'd', shows_on: '2026-11-14', title: 'Get the app', label: 'Giveaway', opens: 'explorer', url: null, blog_slug: null, position: 3 },
]
const PLACES = [
  { id: 'aaaaaaaa-1111-2222-3333-444444444444', name: 'Spin Art Nation', category: 'Art studio', area: 'Cary', photo: 'https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-photos/aaaaaaaa-1111-2222-3333-444444444444/0_thumb.jpg', citySlug: 'cary-nc' },
]
const model = (slug, rows, extra = {}) =>
  weekend.cityWeekendModel({ city: city(slug), cities: CITIES, rows, strips: STRIPS, places: [], readFailed: false, nowIso: NOW, ...extra })

test('weekend keys: Monday–Thursday → the coming Fri/Sat/Sun; Friday → Fri–Sun; Saturday → Sat–Sun; Sunday → Sunday', () => {
  assert.deepEqual(weekend.weekendKeys('2026-11-09'), ['2026-11-13', '2026-11-14', '2026-11-15'])
  assert.deepEqual(weekend.weekendKeys('2026-11-11'), ['2026-11-13', '2026-11-14', '2026-11-15'])
  assert.deepEqual(weekend.weekendKeys('2026-11-12'), ['2026-11-13', '2026-11-14', '2026-11-15'])
  assert.deepEqual(weekend.weekendKeys('2026-11-13'), ['2026-11-13', '2026-11-14', '2026-11-15'])
  assert.deepEqual(weekend.weekendKeys('2026-11-14'), ['2026-11-14', '2026-11-15'])
  assert.deepEqual(weekend.weekendKeys('2026-11-15'), ['2026-11-15'])
  assert.deepEqual(weekend.weekendKeys('2026-12-31'), ['2027-01-01', '2027-01-02', '2027-01-03'], 'across a year end')
})

test('Lagos: Friday to Sunday in Lagos time (UTC+1), at both edges', () => {
  const rows = [
    row('lagos', '2026-11-12T22:30:00Z'), // Thu 23:30 Lagos: a weekday
    row('lagos', '2026-11-12T23:30:00Z'), // Fri 00:30 Lagos (still Thursday in UTC): the weekend
    row('lagos', '2026-11-15T22:30:00Z'), // Sun 23:30 Lagos: the weekend
    row('lagos', '2026-11-15T23:30:00Z'), // Mon 00:30 Lagos (still Sunday in UTC): not the weekend
  ]
  const m = model('lagos', rows)
  assert.equal(m.mode, 'weekend')
  assert.deepEqual(m.weekend, ['2026-11-13', '2026-11-14', '2026-11-15'])
  assert.deepEqual(m.listings.map((l) => l.startsAt), ['2026-11-12T23:30:00.000Z', '2026-11-15T22:30:00.000Z'])
})

test('Raleigh: Friday to Sunday in New York time (UTC-5), at both edges', () => {
  const rows = [
    row('raleigh-nc', '2026-11-13T04:30:00Z'), // Thu 23:30 New York (Friday in UTC): a weekday
    row('raleigh-nc', '2026-11-13T05:30:00Z'), // Fri 00:30 New York: the weekend
    row('raleigh-nc', '2026-11-16T04:30:00Z'), // Sun 23:30 New York (Monday in UTC): the weekend
    row('raleigh-nc', '2026-11-16T05:30:00Z'), // Mon 00:30 New York: not the weekend
  ]
  const m = model('raleigh-nc', rows)
  assert.equal(m.mode, 'weekend')
  assert.deepEqual(m.listings.map((l) => l.startsAt), ['2026-11-13T05:30:00.000Z', '2026-11-16T04:30:00.000Z'])
  // The same rows seen from Lagos belong to no one there: rows go to their owning city by centre and reach.
  const lagos = model('lagos', rows)
  assert.equal(lagos.mode, 'fallback', 'no places to show: the fallback line (#4349 rule)')
  assert.equal(lagos.plansIn.slug, 'raleigh-nc', '… then Plans in the nearest live city')
})

test('rows are assigned to a city by the registry centre and reach, the #4318 rule', () => {
  const rows = [
    row('cary-nc', '2026-11-14T15:00:00Z'), // at Cary's centre
    row('lagos', '2026-11-14T15:00:00Z', 'event', { lat: 6.4281 + 0.65, lng: 3.4219 }), // ~72 km out: inside Lagos's 80 km
    row('lagos', '2026-11-14T16:00:00Z', 'event', { lat: 6.4281 + 0.85, lng: 3.4219 }), // ~95 km out: no city
  ]
  assert.equal(model('cary-nc', rows).listings.length, 1)
  assert.equal(model('raleigh-nc', rows).mode === 'weekend', false, 'a Cary listing is Cary’s (nearest centre), not Raleigh’s')
  assert.equal(model('lagos', rows).listings.length, 1, 'only the row inside Lagos’s own 80 km reach')
})

test('rule 1: admin strips first, admin order, unexpired, not by city, in EVERY branch', () => {
  const branches = [
    model('raleigh-nc', [row('raleigh-nc', '2026-11-14T15:00:00Z')]),
    model('raleigh-nc', [row('raleigh-nc', '2026-11-12T15:00:00Z')]),
    model('cary-nc', [row('lagos', '2026-11-14T15:00:00Z')], { places: PLACES }),
    model('paris', []),
    model('paris', [], { readFailed: true }),
  ]
  assert.deepEqual(branches.map((b) => b.mode), ['weekend', 'weekday', 'quiet', 'fallback', 'fallback'])
  for (const b of branches) {
    assert.deepEqual(b.strips.map((s) => s.pin.id), ['a', 'b', 'd'], `${b.mode}: strips first, in admin order, expired dropped`)
    assert.equal(b.strips[0].when, 'From Mingla · Fri 13')
    assert.equal(b.strips[2].when, 'Giveaway · Sat 14')
  }
})

test('rule 2: no weekend listings but some this week → this week’s weekday plans', () => {
  const m = model('raleigh-nc', [row('raleigh-nc', '2026-11-12T23:00:00Z', 'trip'), row('raleigh-nc', '2026-11-17T01:00:00Z', 'experience')])
  assert.equal(m.mode, 'weekday')
  assert.equal(m.listings.length, 2)
})

test('rules 3 and 4: a quiet week → "A quiet week in <City>." + up to 3 places + Plans in the nearest live city + Host', () => {
  const rows = [row('raleigh-nc', '2026-11-14T15:00:00Z'), row('lagos', '2026-11-14T15:00:00Z')]
  const many = [...PLACES, ...PLACES.map((p, i) => ({ ...p, id: `${p.id.slice(0, -1)}${i + 5}` })), { ...PLACES[0], id: 'bbbbbbbb-1111-2222-3333-444444444444' }, { ...PLACES[0], id: 'cccccccc-1111-2222-3333-444444444444' }]
  const m = model('cary-nc', rows, { places: many })
  assert.equal(m.mode, 'quiet')
  assert.equal(m.heading, 'A quiet week in Cary.')
  assert.equal(m.places.length, 3, 'never more than 3 places')
  assert.equal(m.plansIn.slug, 'raleigh-nc', 'the NEAREST live city, not the busiest')
  assert.equal(m.hostCity, 'Cary')
  // A quiet week with places but no other live city still shows the places, without "Plans in".
  const alone = model('cary-nc', [], { places: PLACES })
  assert.equal(alone.mode, 'quiet')
  assert.equal(alone.plansIn, null)
  // #4349 (mirrors /links): no places to show → the fallback line, then "Plans in" the nearest live city and Host.
  const noPlaces = model('cary-nc', rows, { places: [] })
  assert.deepEqual([noPlaces.mode, noPlaces.text, noPlaces.hostCity], ['fallback', 'Nothing is listed this week yet. Check back soon.', 'Cary'])
  assert.equal(noPlaces.plansIn.slug, 'raleigh-nc')
})

test('rule 5: nothing live anywhere and no places, or a failed read → "Nothing is listed this week yet. Check back soon."', () => {
  const nothing = model('paris', [])
  assert.deepEqual([nothing.mode, nothing.text, nothing.hostCity], ['fallback', 'Nothing is listed this week yet. Check back soon.', 'Paris'])
  const failed = model('raleigh-nc', [row('raleigh-nc', '2026-11-14T15:00:00Z')], { readFailed: true, places: PLACES })
  assert.deepEqual([failed.mode, failed.text], ['fallback', 'Nothing is listed this week yet. Check back soon.'], 'a failed read never shows stale or partial plans')
  assert.equal(failed.plansIn, null, 'a failed read offers no other city')
  assert.equal(nothing.plansIn, null, 'nothing live anywhere: no "Plans in"')
  assert.equal(weekend.FALLBACK_TEXT, 'Nothing is listed this week yet. Check back soon.')
})

test('the chips filter by kind: events under Events, experiences and trips under Experiences', () => {
  const m = model('raleigh-nc', [row('raleigh-nc', '2026-11-14T15:00:00Z', 'event'), row('raleigh-nc', '2026-11-14T16:00:00Z', 'trip'), row('raleigh-nc', '2026-11-14T17:00:00Z', 'experience')])
  assert.deepEqual(m.listings.map(weekend.listingChip), ['Events', 'Experiences', 'Experiences'])
  const ui = code(read('components/cities/city-this-weekend.tsx'))
  assert.match(ui, /const KINDS = \['All', 'Events', 'Experiences', 'Places'\] as const/)
  assert.match(ui, /<FilterChips label=\{`Filter \$\{cityName\} listings`\} options=\{KINDS\} value=\{kind\} onChange=\{selectKind\} \/>/)
  assert.match(ui, /kind === 'All' \? plans : kind === 'Places' \? \[\] : plans\.filter\(\(p\) => planChip\(p\) === kind\)/)
  assert.match(ui, /const shownPlaces = kind === 'All' \|\| kind === 'Places' \? places : \[\]/)
})

test('every tap goes through the seam: listings, places and strips, phone and computer', () => {
  const [event, experience] = model('raleigh-nc', [row('raleigh-nc', '2026-11-14T15:00:00Z', 'event'), row('raleigh-nc', '2026-11-14T16:00:00Z', 'experience')]).listings
  const eventPhone = handoff.resolveSiteTargetHandoff({ type: 'listing', listing: event }, 'ios')
  assert.equal(eventPhone.action, 'navigate')
  assert.ok(eventPhone.href.startsWith(`${stores.EXPLORER_ONELINK_URL}?`), eventPhone.href)
  assert.match(eventPhone.href, /deep_link_value=event&deep_link_sub1=blue-note&deep_link_sub2=item-/)
  assert.match(eventPhone.href, /c=explorer_nav/, 'the governed site campaign, not the /links bio one')
  assert.deepEqual(handoff.resolveSiteTargetHandoff({ type: 'listing', listing: event }, 'other'), {
    action: 'navigate',
    href: `${stores.BUSINESS_WEB_URL}/e/blue-note/${event.itemSlug}`,
    newTab: true,
  }, 'an event on a computer opens its public host web page')
  assert.deepEqual(handoff.resolveSiteTargetHandoff({ type: 'listing', listing: experience }, 'other'), { action: 'sheet', sheet: 'item' })
  assert.equal(handoff.resolveSiteTargetHandoff({ type: 'listing', listing: experience }, 'android').action, 'navigate')
  const place = PLACES[0]
  assert.deepEqual(handoff.resolveSiteTargetHandoff({ type: 'place', place }, 'other'), { action: 'sheet', sheet: 'item' })
  assert.equal(handoff.resolveSiteTargetHandoff({ type: 'place', place }, 'ios').href, handoff.siteTargetHrefs({ type: 'place', place }).phoneHref)
  const pins = week.normalisePins(STRIPS)
  const web = pins.find((p) => p.opens === 'web')
  for (const platform of ['ios', 'other']) {
    assert.deepEqual(handoff.resolveSiteTargetHandoff({ type: 'pin', pin: web }, platform), { action: 'navigate', href: 'https://usemingla.com/tools', newTab: true })
  }
  const blog = pins.find((p) => p.opens === 'blog')
  assert.deepEqual(handoff.resolveSiteTargetHandoff({ type: 'pin', pin: blog }, 'other'), { action: 'navigate', href: '/blog/weekend-guide', newTab: false })
  const explorer = pins.find((p) => p.opens === 'explorer')
  assert.deepEqual(handoff.resolveSiteTargetHandoff({ type: 'pin', pin: explorer }, 'other'), { action: 'sheet', sheet: 'explore' })
  assert.deepEqual(
    handoff.resolveSiteTargetHandoff({ type: 'pin', pin: { ...explorer, opens: 'host' } }, 'ios'),
    { action: 'navigate', href: handoff.siteTargetHrefs({ type: 'pin', pin: { ...explorer, opens: 'host' } }).phoneHref, newTab: false },
  )
  assert.match(handoff.siteTargetHrefs({ type: 'pin', pin: { ...explorer, opens: 'host' } }).phoneHref, /c=business_hero/)
  // The UI uses the seam and the shared hand-off buttons, never a URL of its own.
  const ui = code(read('components/cities/city-this-weekend.tsx'))
  assert.match(ui, /resolveSiteTargetHandoff\(target, detectClientPlatform\(\)\)/)
  assert.match(ui, /<ExplorerHandoffButton location="city_strip" className="astrip">/)
  assert.match(ui, /<HostHandoffButton location="city_strip" className="astrip">/)
  assert.match(ui, /<HostHandoffButton location="city_quiet" className="btn soft">\s*Host something in \{model\.hostCity\}/)
  assert.doesNotMatch(ui, /https?:\/\/|onelink|apps\.apple|play\.google/i, 'no URL in the component')
})

test('strips render first and the empty-rule copy is verbatim', () => {
  const ui = code(read('components/cities/city-this-weekend.tsx'))
  const strips = ui.indexOf('data-weekend-strips')
  assert.ok(strips > 0 && strips < ui.lastIndexOf('{body}'), 'the strips render before every branch body')
  assert.match(ui, /A quiet week in <em>\{cityName\}\.<\/em>/)
  assert.match(ui, /Plans in \{model\.plansIn\.name\} <ArrowRight/)
  assert.match(ui, /<p className="filter-note">\{model\.text\}<\/p>\s*<div className="row quiet-row">\s*\{model\.plansIn \? \(/, 'the fallback line, then Plans in')
  // The page keeps its existing content below "This weekend".
  const page = code(read('components/cities/city-page.tsx'))
  const order = ['<CityHero', '<CityThisWeekend', '<CityWeekend', '<CityGuideBand', '<CityQuestions', '<CityHostBand'].map((tag) => page.indexOf(tag))
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'hero, This weekend, the ranked places, plans, FAQ, host band')
  assert.ok(order.every((i) => i > 0))
  assert.match(code(read('components/cities/city-weekend.tsx')), /Top places <em>in \{cityName\}\.<\/em>/)
})

test('no /render/image anywhere, and place photos are the stored thumbnails on the public object endpoint', () => {
  for (const rel of ['lib/city-weekend.ts', 'lib/city-weekend-data.ts', 'components/cities/city-this-weekend.tsx', 'components/cities/city-page.tsx', 'app/cities/[city]/page.tsx']) {
    assert.doesNotMatch(code(read(rel)), /render\/image/, `${rel}: no /render/image outside comments`)
  }
  assert.equal(
    week.placePhotoUrl('https://gqnoajqerqhnvulmnyvv.supabase.co', 'aaaaaaaa-1111/0_thumb.jpg'),
    'https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-photos/aaaaaaaa-1111/0_thumb.jpg',
  )
  assert.equal(week.placePhotoUrl('https://x.supabase.co', 'aaaaaaaa-1111/0.jpg'), null, 'only pre-generated thumbnails')
})

test('the server read uses #4318’s data layer (same cache and tag) and does not edit #4318’s files', () => {
  const data = code(read('lib/city-weekend-data.ts'))
  assert.match(data, /import \{ getLinksData, getLinksPlaces \} from '\.\/links-data'/)
  assert.match(data, /const places = quiet \? \(await getLinksPlaces\(\[city\]\)\)\.places\[city\.slug\] \?\? \[\] : \[\]/, 'places are read only for a quiet week')
  assert.match(data, /const city = withLiveCityId\(registryCity, linksCitiesFromRows\(data\.cities, registryLinksHints\(\)\)\)/, 'the city is resolved to its city_id before the places read')
  assert.match(code(read('app/cities/[city]/page.tsx')), /await getCityWeekend\(record\.slug, new Date\(\)\.toISOString\(\)\)/)
  assert.match(code(read('lib/links-data.ts')), /next: \{ revalidate: LINKS_REVALIDATE_SECONDS, tags: \[LINKS_CACHE_TAG\] \}/)
})

// ---- #4349: one card per plan, and the places read by city_id ---------------------
test('#4349 Lagos: the same plan listed 6 times this week is ONE weekend card, "Event · Fri–Sun", opening its next date', () => {
  const charter = (startsAt) => row('lagos', startsAt, 'event', { title: 'Sunset boat charter', brand_slug: 'blue-boat', item_slug: 'sunset-charter' })
  const rows = [
    charter('2026-11-12T15:00:00Z'), // Thu: in the week, not the weekend
    charter('2026-11-13T15:00:00Z'), // Fri
    charter('2026-11-14T09:00:00Z'), // Sat morning
    charter('2026-11-14T15:00:00Z'), // Sat afternoon
    charter('2026-11-15T15:00:00Z'), // Sun
    charter('2026-11-16T15:00:00Z'), // Mon: in the week, not the weekend
    row('lagos', '2026-11-14T18:00:00Z', 'experience', { brand_slug: 'lekki-art', item_slug: 'paint-night' }),
  ]
  const m = model('lagos', rows)
  assert.equal(m.mode, 'weekend')
  assert.equal(m.listings.length, 5, 'the weekend dates are all still there underneath')
  assert.equal(m.plans.length, 2, 'one card per (brand_slug, item_slug) plan, not one per date')
  const [boat, art] = m.plans
  assert.equal(boat.next.title, 'Sunset boat charter')
  assert.equal(boat.dates.length, 4, 'the plan carries its four weekend dates (Thu and Mon are outside the weekend)')
  assert.equal(boat.next.startsAt, '2026-11-13T15:00:00.000Z', 'a tap opens the next date')
  assert.deepEqual(week.planWhen(boat, m.today), { tonight: false, text: 'Event · Fri–Sun' })
  assert.equal(week.planWhen(art, m.today).text, 'Experience · Sat 14')
  // Weekday mode groups the same way.
  const weekday = model('lagos', [charter('2026-11-12T15:00:00Z'), charter('2026-11-16T15:00:00Z'), charter('2026-11-17T15:00:00Z')])
  assert.equal(weekday.mode, 'weekday')
  assert.equal(weekday.plans.length, 1)
  assert.equal(week.planWhen(weekday.plans[0], weekday.today).text, 'Event · Thu, Mon, Tue')
})

test('#4349 the card list renders one card per plan with the planWhen label, and counts plans', () => {
  const ui = code(read('components/cities/city-this-weekend.tsx'))
  assert.match(ui, /\{shownPlans\.map\(\(plan, index\) => \{/, 'one card per plan')
  assert.match(ui, /const l = plan\.next/, 'a card opens its next date')
  assert.match(ui, /const when = planWhen\(plan, model\.today\)/)
  assert.match(ui, /<li key=\{plan\.id\}/)
  assert.doesNotMatch(ui, /listings\.map\(|listingWhen\(/, 'no card per date')
  assert.match(ui, /\? plans\.length \+ places\.length/, 'the chip announcement counts plans')
  assert.match(ui, /plans\.filter\(\(p\) => planChip\(p\) === value\)\.length/)
})

test('#4349 the page city resolves to its city_id by slug or older registry slug, never by distance', () => {
  const ID = (n) => `0000000${n}-aaaa-4bbb-8ccc-dddddddddddd`
  const hints = CITIES.map((c) => ({ slug: c.slug, countryCode: c.slug === 'lagos' ? 'NG' : c.slug === 'london' ? 'GB' : c.slug === 'paris' ? 'FR' : c.slug === 'brussels' ? 'BE' : 'US', region: '', timezone: c.timezone, lat: c.lat, lng: c.lng }))
  const live = week.linksCitiesFromRows([
    { city_id: ID(1), name: 'Lagos', country_code: 'NG', center_lat: city('lagos').lat, center_lng: city('lagos').lng, has_places: true },
    { city_id: ID(2), name: 'Raleigh', country_code: 'US', center_lat: city('raleigh-nc').lat, center_lng: city('raleigh-nc').lng, has_places: true },
    { city_id: ID(3), name: 'London', country_code: 'GB', center_lat: city('london').lat, center_lng: city('london').lng, has_places: false },
  ], hints)
  assert.equal(weekend.withLiveCityId(city('lagos'), live).cityId, ID(1))
  assert.equal(weekend.withLiveCityId(city('raleigh-nc'), live).cityId, ID(2), 'raleigh-nc is the live "raleigh" through its alias')
  assert.equal(weekend.withLiveCityId(city('london'), live).hasPlaces, false)
  const cary = weekend.withLiveCityId(city('cary-nc'), live)
  assert.equal(cary.cityId, undefined, 'Cary is 15 km from Raleigh: never matched by distance')
  assert.equal(cary.slug, 'cary-nc', 'the registry city keeps its own slug (Plans in / links stay /cities/<slug>)')
  // The places arguments then carry p_city_id (the fast per-city path); without an id, lat/lng only.
  assert.equal(week.linksPlacesArgs(weekend.withLiveCityId(city('lagos'), live), 3).p_city_id, ID(1))
  assert.equal('p_city_id' in week.linksPlacesArgs(cary, 3), false)
})

test('#4349 the server read: links_page_places is called with p_city_id from links_page_cities()', async () => {
  // Load the real lib/city-weekend-data.ts (registry and #4318 data layer included) and stub PostgREST.
  const dataOut = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-4339-city-weekend-data-'))
  after(() => fs.rmSync(dataOut, { recursive: true, force: true }))
  const dataSeen = new Set()
  emit(path.join(MARKETING, 'lib/city-weekend.ts'), 'city-weekend', dataOut, dataSeen)
  emit(path.join(MARKETING, 'lib/links-data.ts'), 'links-data', dataOut, dataSeen)
  fs.writeFileSync(
    path.join(dataOut, 'historical-city-build.mjs'),
    stripTypeScriptTypes(read('lib/search/historical-city-build.ts')),
  )
  fs.writeFileSync(
    path.join(dataOut, 'registry.mjs'),
    stripTypeScriptTypes(read('content/cities/registry.ts')).replace("'../../lib/search/historical-city-build'", "'./historical-city-build.mjs'"),
  )
  fs.writeFileSync(
    path.join(dataOut, 'city-weekend-data.mjs'),
    stripTypeScriptTypes(read('lib/city-weekend-data.ts'))
      .replace("'@/content/cities/registry'", "'./registry.mjs'")
      .replace(IMPORT, (_m, _p, name) => `from './${name}.mjs'`),
  )
  const data = await import(pathToFileURL(path.join(dataOut, 'city-weekend-data.mjs')).href)
  const LONDON_ID = '11111111-2222-4333-8444-555555555555'
  const calls = []
  const realFetch = globalThis.fetch
  const env = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY }
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://stub.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'stub-anon'
  globalThis.fetch = async (url, init) => {
    const name = String(url).split('/rpc/')[1]
    const body = JSON.parse(init.body)
    calls.push({ name, body })
    const reply = {
      links_page_week: [],
      links_page_strips: [],
      links_page_cities: [{ city_id: LONDON_ID, name: 'London', country_code: 'GB', center_lat: city('london').lat, center_lng: city('london').lng, has_places: true }],
      links_page_places: [{ place_id: 'ChIJplace0001', name: 'Sky Garden', category: 'Viewpoint', area_label: 'City of London', lat: 51.51, lng: -0.08, photo_path: 'ChIJplace0001/0_thumb.jpg' }],
    }[name]
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  try {
    const m = await data.getCityWeekend('london', NOW)
    const places = calls.filter((c) => c.name === 'links_page_places')
    assert.equal(places.length, 1)
    assert.equal(places[0].body.p_city_id, LONDON_ID, 'the fast per-city path')
    assert.equal(places[0].body.p_limit, 3)
    assert.equal(m.mode, 'quiet')
    assert.equal(m.heading, 'A quiet week in London.')
    assert.deepEqual(m.places.map((p) => p.name), ['Sky Garden'])
    // Paris is not in the live list: no id, the centre-and-reach path.
    calls.length = 0
    await data.getCityWeekend('paris', NOW)
    const paris = calls.find((c) => c.name === 'links_page_places')
    assert.ok(paris && !('p_city_id' in paris.body) && paris.body.p_radius_km === 60, JSON.stringify(paris))
  } finally {
    globalThis.fetch = realFetch
    for (const [k, v] of [['NEXT_PUBLIC_SUPABASE_URL', env.url], ['NEXT_PUBLIC_SUPABASE_ANON_KEY', env.key]]) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
})

// ---- built mode ---------------------------------------------------------------
// #4339 (release fix): the Vercel production build has the public Supabase
// env and renders live data (any mode); a build without it renders the fallback.
test('built: each city page carries "This weekend" (live mode with the Supabase env, the fallback without) above its 50 ranked places', { skip: !BUILT }, () => {
  const hasDatabase = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim())
  for (const slug of ['lagos', 'raleigh-nc', 'cary-nc']) {
    const html = fs.readFileSync(path.join(MARKETING, `.next/server/app/cities/${slug}.html`), 'utf8')
    assert.match(html, hasDatabase ? /data-weekend="(weekend|weekday|quiet|fallback)"/ : /data-weekend="fallback"/, slug)
    const weekendAt = html.indexOf('id="weekend"')
    const placesAt = html.indexOf('id="places"')
    assert.ok(weekendAt > 0 && placesAt > weekendAt, `${slug}: This weekend sits above the places`)
    assert.equal((html.match(/data-city-place-card=""/g) ?? []).length, 50, `${slug}: the ranked places stay`)
    assert.doesNotMatch(html, /render\/image/)
  }
})
