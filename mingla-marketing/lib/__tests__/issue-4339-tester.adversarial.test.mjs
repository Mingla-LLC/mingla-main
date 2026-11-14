// #4339 — TESTER adversarial guard (a different angle from the implementor's
// tests): the city section must never come back to /links, and a hard-coded
// city list must never come back to /cities, the Home row or /going-out.
//
// Source attacks run on the shipped files with comments stripped (so a comment
// that mentions a retired name cannot trip them, and a comment cannot hide a
// real use). The behaviour attack runs the REAL pure model with a live list that
// no hard-coded registry could produce: a city that has no guide and a guide
// city that is switched off.
//
// Run from mingla-marketing/ (Node 22.13+):
//   node --test lib/__tests__/issue-4339-tester.adversarial.test.mjs

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { stripTypeScriptTypes } from 'node:module'
import { after, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const MARKETING = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => fs.readFileSync(path.join(MARKETING, rel), 'utf8')
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

// ---------------------------------------------------------------- /links

// Every identifier or phrase that only the retired city section used.
const CITY_SECTION = [
  /links_page_(week|cities|places)/,
  /\bgetLinksData\b/,
  /\bgetLinksCities\b/,
  /\bLinksCity\b/,
  /\bCITY_HUBS?\b/,
  /\bQUIET_WEEK/i,
  /quiet week/i,
  /pick (a|your) city/i,
  /choose (a|your) city/i,
  /\bcityPicker\b|\bCityPicker\b|\bsetCity\b|\bactiveCity\b|\bselectedCity\b/,
  /\bweekSheet\b|\bfull week\b/i,
  /\bnormalisePlaces\b|\blinksPlacesArgs\b/,
]

test('/links page, experience and fit rule carry no city section (identifiers, reads, copy)', () => {
  for (const rel of ['app/links/page.tsx', 'components/marketing/links-experience.tsx', 'lib/links-fit.ts']) {
    const src = code(read(rel))
    for (const pattern of CITY_SECTION) {
      assert.ok(!pattern.test(src), `${rel} brings back the city section: ${pattern}`)
    }
  }
})

test('/links reads exactly one thing: getLinksStrips, and that reads only links_page_strips', () => {
  const page = code(read('app/links/page.tsx'))
  assert.match(page, /getLinksStrips\(\)/, '/links must read the Admin strips')
  const imports = [...page.matchAll(/from '@\/lib\/links-data'/g)]
  assert.equal(imports.length, 1)
  assert.doesNotMatch(page, /import\s*\{[^}]*\b(getLinksData|getLinksPlaces|getLinksWeek)\b[^}]*\}\s*from '@\/lib\/links-data'/)
  const data = code(read('lib/links-data.ts'))
  const start = data.indexOf('export async function getLinksStrips')
  assert.ok(start > 0, 'getLinksStrips must exist')
  const body = data.slice(start, data.indexOf('\n}\n', start))
  const rpcs = [...body.matchAll(/rpc<[^>]*>\('([a-z_]+)'/g)].map((m) => m[1])
  assert.deepEqual(rpcs, ['links_page_strips'], `getLinksStrips must call only links_page_strips, calls ${rpcs}`)
})

test('/links keeps its contract: banners, then strips, "More" row, socials; one-screen lock', () => {
  const src = code(read('components/marketing/links-experience.tsx'))
  const order = ['lk-ban', 'lk-pinwrap', 'lk-foot'].map((cls) => src.indexOf(`styles['${cls}']`))
  assert.ok(order.every((i) => i > 0), 'banner, strips and footer blocks must all exist')
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'order must be banners, strips, socials')
  assert.match(src, /100svh/, 'the one-screen lock must stay')
  assert.match(src, /overflow-hidden/)
})

// ---------------------------------------------------------------- /cities, Home, /going-out

const LISTS = ['app/(core)/cities/page.tsx', 'app/(core)/going-out/page.tsx', 'components/site/home-page.tsx']

test('/cities, /going-out and the Home row all read the live list and never map the registry', () => {
  for (const rel of LISTS) {
    const src = code(read(rel))
    assert.match(src, /\bgetCityTiles\(\)/, `${rel} must read the live list (getCityTiles)`)
    assert.ok(!/\bCITY_HUBS\b/.test(src), `${rel} maps or reads CITY_HUBS (a hard-coded list)`)
    assert.ok(!/\bCITY_HUB_SLUGS\b/.test(src), `${rel} reads CITY_HUB_SLUGS (a hard-coded list)`)
    assert.ok(!/\bregistryCityTiles\b/.test(src), `${rel} must not pick the registry fallback itself`)
  }
})

test('no page re-types the city names: no literal array of city names in the three lists or the reader', () => {
  const names = ['Lagos', 'Paris', 'London', 'Raleigh', 'Durham', 'Cary', 'Brussels', 'Abuja', 'Kano', 'Ibadan', 'Kaduna']
  for (const rel of [...LISTS, 'lib/live-cities.ts']) {
    const src = code(read(rel))
    const quoted = names.filter((n) => new RegExp(`['"\`]${n}['"\`]`).test(src))
    assert.ok(quoted.length < 2, `${rel} hard-codes city names: ${quoted.join(', ')}`)
  }
})

test('the live list is the only owner: the reader derives from the pure model, nothing else filters cities', () => {
  const reader = code(read('lib/live-cities.ts'))
  assert.match(reader, /resolveCityTiles\(/)
  assert.match(reader, /getLinksData\(\)/)
  for (const rel of LISTS) {
    assert.ok(!/is_live_for_consumers|seeding_cities/.test(code(read(rel))), `${rel} reads the city table itself`)
  }
})

// ---------------------------------------------------------------- behaviour of the real pure model

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-4339-tester-'))
after(() => fs.rmSync(out, { recursive: true, force: true }))
const IMPORT = /from\s+'(@\/lib\/|\.\/)([\w-]+)'/g
function emit(name, seen = new Set()) {
  if (seen.has(name)) return
  seen.add(name)
  const deps = []
  const js = stripTypeScriptTypes(read(`lib/${name}.ts`)).replace(IMPORT, (_m, _p, dep) => {
    deps.push(dep)
    return `from './${dep}.mjs'`
  })
  fs.writeFileSync(path.join(out, `${name}.mjs`), js)
  for (const dep of deps) emit(dep, seen)
}
emit('cities-page')
const model = () => import(pathToFileURL(path.join(out, 'cities-page.mjs')).href)

const HUBS = [
  { slug: 'lagos', city: 'Lagos', countryCode: 'NG', timezone: 'Africa/Lagos', region: 'x', lat: 6.5244, lng: 3.3792 },
  { slug: 'paris', city: 'Paris', countryCode: 'FR', timezone: 'Europe/Paris', region: 'x', lat: 48.8566, lng: 2.3522 },
  { slug: 'london', city: 'London', countryCode: 'GB', timezone: 'Europe/London', region: 'x', lat: 51.5074, lng: -0.1278 },
]
let n = 0
const row = (name, country, lat, lng) => ({ city_id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, name, country_code: country, center_lat: lat, center_lng: lng, has_places: true })

test('a live city nobody hard-coded shows, a switched-off guide city leaves, order is A to Z', async () => {
  const { resolveCityTiles } = await model()
  const live = [row('Zanzibar', 'TZ', -6.16, 39.2), row('Lagos', 'NG', 6.52, 3.37), row('Aachen', 'DE', 50.77, 6.08)]
  const { tiles, source } = resolveCityTiles(live, HUBS)
  assert.equal(source, 'live')
  assert.deepEqual(tiles.map((t) => t.name), ['Aachen', 'Lagos', 'Zanzibar'])
  assert.ok(!tiles.some((t) => t.slug === 'paris' || t.slug === 'london'), 'switched-off guide cities must not be listed')
  const z = tiles.find((t) => t.name === 'Zanzibar')
  assert.equal(z.guide, false, 'a city with no guide is not a guide (so it stays noindex)')
  assert.equal(tiles.find((t) => t.slug === 'lagos').guide, true)
})

test('hostile or partial rows never add a tile; an empty or all-bad read falls back to the guides, never to nothing', async () => {
  const { resolveCityTiles } = await model()
  const bad = [row('', 'NG', 1, 1), row('Nowhere', 'NG', 999, 1), { city_id: 'not-a-uuid', name: 'Fake', country_code: 'NG', center_lat: 1, center_lng: 1 }, null, 'x', 7]
  const r = resolveCityTiles(bad, HUBS)
  assert.equal(r.source, 'registry')
  assert.deepEqual(r.tiles.map((t) => t.slug), ['lagos', 'london', 'paris'])
  assert.equal(resolveCityTiles([], HUBS).source, 'registry')
  const mixed = resolveCityTiles([...bad, row('Kano', 'NG', 12, 8.59)], HUBS)
  assert.deepEqual(mixed.tiles.map((t) => t.name), ['Kano'])
})

test('route decision: off guide city redirects, off or unknown new city is a 404, a live new city is not a guide', async () => {
  const { resolveCityTiles, decideCityRoute } = await model()
  const resolved = resolveCityTiles([row('Lagos', 'NG', 6.52, 3.37), row('Kano', 'NG', 12, 8.59)], HUBS)
  const guides = HUBS.map((h) => h.slug)
  assert.equal(decideCityRoute('lagos', resolved, guides).kind, 'guide')
  assert.equal(decideCityRoute('kano', resolved, guides).kind, 'live')
  assert.equal(decideCityRoute('paris', resolved, guides).kind, 'redirect')
  assert.equal(decideCityRoute('abuja', resolved, guides).kind, 'not_found')
  assert.equal(decideCityRoute('__proto__', resolved, guides).kind, 'not_found')
  assert.equal(decideCityRoute('', resolved, guides).kind, 'not_found')
})
