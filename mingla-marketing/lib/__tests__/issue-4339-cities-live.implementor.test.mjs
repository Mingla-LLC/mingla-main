// #4339 — /cities, the Home cities row and /going-out follow the live city list.
//
// Loads the REAL lib/cities-page.ts (with #4318's lib/links-week.ts underneath)
// and the REAL content/cities/registry.ts with node's TypeScript type
// stripping (no install), against fixture rows shaped exactly like
// `links_page_cities()`. Pins:
//   1. fifteen live cities -> fifteen tiles, A to Z (fails if a hard-coded
//      list returns: the registry has ten);
//   2. the 14 production rows (14 Nov): ten guide tiles keep their registry
//      slugs (new-york -> new-york-city, washington -> washington-dc through the
//      alias) and four new cities get their own;
//   3. a city switched off disappears and its guide route redirects to /cities;
//      an unknown slug is a 404;
//   4. a failed, empty or hostile read lists the ten registry guides, never an
//      empty page, and is logged (source check on lib/live-cities.ts);
//   5. a new city's page is noindex and absent from the sitemap and ItemList;
//   6. adding an eleventh guide never de-indexes the ten (F-4);
//   7. the four new clips exist in every size, are wired, and are recorded.
//
// Run from mingla-marketing/ (Node 22.13+):
//   node --test lib/__tests__/issue-4339-cities-live.implementor.test.mjs

import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { stripTypeScriptTypes } from 'node:module'
import { after, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const MARKETING = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => fs.readFileSync(path.join(MARKETING, rel), 'utf8')
const code = (source) => source.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

// ---- strip-types loader ------------------------------------------------------
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-4339-cities-live-'))
after(() => fs.rmSync(out, { recursive: true, force: true }))
const IMPORT = /from\s+'(?:@\/lib\/|\.\/|\.\.\/\.\.\/lib\/search\/)([\w-]+)'/g
const seen = new Set()
function emit(sourceRel, outName) {
  if (seen.has(outName)) return
  seen.add(outName)
  const deps = []
  const js = stripTypeScriptTypes(read(sourceRel)).replace(IMPORT, (_m, name) => {
    deps.push(name)
    return `from './${name}.mjs'`
  })
  // Test-only: expose the registry's two private tables so an eleventh guide can be added whole.
  const exposed = outName === 'registry' ? '\nexport { APPROVED_CITY_CONTENT_FINGERPRINTS, CITY_CATALOGUE_RECEIPTS }\n' : ''
  fs.writeFileSync(path.join(out, `${outName}.mjs`), js + exposed)
  for (const name of deps) emit(name === 'historical-city-build' ? 'lib/search/historical-city-build.ts' : `lib/${name}.ts`, name)
}
emit('lib/cities-page.ts', 'cities-page')
emit('content/cities/registry.ts', 'registry')
const load = (name) => import(pathToFileURL(path.join(out, `${name}.mjs`)).href)
const model = await load('cities-page')
const registry = await load('registry')

// ---- fixtures ----------------------------------------------------------------
const hubs = registry.CITY_HUBS.map((hub) => ({
  slug: hub.slug,
  city: hub.city,
  countryCode: hub.countryCode,
  region: registry.CITY_HUB_REGIONS[hub.slug],
  timezone: hub.timezone,
  ...registry.CITY_HUB_CENTRES[hub.slug],
}))
let n = 0
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
// The 14 live cities on 14 Nov (links_page_cities()), with the names the database uses.
const PROD = [
  ['Abuja', 'NG', 9.0765, 7.3986], ['Brussels', 'BE', 50.8503, 4.3517], ['Cary', 'US', 35.7915, -78.7811],
  ['Durham', 'US', 35.994, -78.8986], ['Fort Lauderdale', 'US', 26.1224, -80.1373], ['Ibadan', 'NG', 7.3775, 3.947],
  ['Kaduna', 'NG', 10.5105, 7.4165], ['Kano', 'NG', 12.0022, 8.592], ['Lagos', 'NG', 6.5244, 3.3792],
  ['London', 'GB', 51.5074, -0.1278], ['New York', 'US', 40.7128, -74.006], ['Paris', 'FR', 48.8566, 2.3522],
  ['Raleigh', 'US', 35.7796, -78.6382], ['Washington', 'US', 38.9072, -77.0369],
]
const row = ([name, country_code, center_lat, center_lng]) => ({ city_id: id(), name, country_code, center_lat, center_lng, has_places: true })
const rows14 = PROD.map(row)
const sortedAZ = (names) => [...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))

test('1. fifteen live cities -> fifteen tiles, A to Z (a hard-coded list of ten fails this)', () => {
  const rows = [...rows14, row(['Accra', 'GH', 5.6037, -0.187])]
  const { tiles, source } = model.resolveCityTiles(rows, hubs)
  assert.equal(source, 'live')
  assert.equal(tiles.length, 15)
  assert.deepEqual(tiles.map((t) => t.name), sortedAZ(tiles.map((t) => t.name)))
  assert.ok(tiles.some((t) => t.slug === 'accra' && !t.guide && t.city?.cityId))
  assert.ok(registry.CITY_HUBS.length < tiles.length, 'the registry alone could never produce these tiles')
})

test('2. the 14 production rows: ten guide tiles (registry slugs, aliases) and four new cities', () => {
  const { tiles } = model.resolveCityTiles(rows14, hubs)
  assert.equal(tiles.length, 14)
  const guides = tiles.filter((t) => t.guide).map((t) => t.slug).sort()
  assert.deepEqual(guides, registry.CITY_HUBS.map((h) => h.slug).sort())
  assert.equal(tiles.find((t) => t.slug === 'new-york-city')?.name, 'New York City')
  assert.equal(tiles.find((t) => t.slug === 'washington-dc')?.name, 'Washington, DC')
  const fresh = tiles.filter((t) => !t.guide)
  assert.deepEqual(fresh.map((t) => t.slug), ['abuja', 'ibadan', 'kaduna', 'kano'])
  for (const t of fresh) {
    assert.equal(t.countryCode, 'NG')
    assert.equal(t.city?.timezone, 'Africa/Lagos', `${t.slug} has a zone for its weekend`)
    assert.match(t.city?.cityId ?? '', /^[0-9a-f-]{36}$/)
  }
})

test('3. a city switched off disappears; its guide route redirects to /cities; an unknown slug is a 404', () => {
  const guideSlugs = registry.CITY_HUBS.map((h) => h.slug)
  const without = (name) => rows14.filter((r) => r.name !== name)
  const off = model.resolveCityTiles(without('Lagos'), hubs)
  assert.equal(off.tiles.length, 13)
  assert.ok(!off.tiles.some((t) => t.slug === 'lagos'))
  assert.deepEqual(model.decideCityRoute('lagos', off, guideSlugs), { kind: 'redirect' })
  assert.equal(model.decideCityRoute('lagos', model.resolveCityTiles(rows14, hubs), guideSlugs).kind, 'guide')
  // A new city: live -> its own page; switched off -> 404 (it never had a guide URL to keep).
  assert.equal(model.decideCityRoute('kano', model.resolveCityTiles(rows14, hubs), guideSlugs).kind, 'live')
  assert.deepEqual(model.decideCityRoute('kano', model.resolveCityTiles(without('Kano'), hubs), guideSlugs), { kind: 'not_found' })
  assert.deepEqual(model.decideCityRoute('atlantis', off, guideSlugs), { kind: 'not_found' })
})

test('4. a failed, empty or hostile read lists the ten registry guides (never an empty page) and is logged', () => {
  const hostile = [
    { city_id: 'not-a-uuid', name: 'Bad Id', country_code: 'NG', center_lat: 1, center_lng: 1, has_places: true },
    { city_id: id(), name: '   ', country_code: 'NG', center_lat: 1, center_lng: 1, has_places: true },
    { city_id: id(), name: 'Nowhere', country_code: 'NG', center_lat: 123, center_lng: 1, has_places: true },
  ]
  for (const rows of [[], hostile]) {
    const { tiles, source } = model.resolveCityTiles(rows, hubs)
    assert.equal(source, 'registry')
    assert.equal(tiles.length, registry.CITY_HUBS.length)
    assert.ok(tiles.every((t) => t.guide))
    assert.deepEqual(tiles.map((t) => t.name), sortedAZ(tiles.map((t) => t.name)))
  }
  // In the registry fallback every guide still renders (no redirect during an outage).
  const fallback = model.resolveCityTiles([], hubs)
  assert.equal(model.decideCityRoute('paris', fallback, hubs.map((h) => h.slug)).kind, 'guide')
  const live = code(read('lib/live-cities.ts'))
  assert.match(live, /resolved\.source === 'registry'[\s\S]*console\.error\(`\[#4339 cities\]/, 'the fallback is logged, not silent')
  assert.match(live, /await getLinksData\(\)/, 'one reader, #4318\'s own data layer (5-minute cache, links tag)')
  assert.doesNotMatch(live, /\bfetch\(/)
})

test('5. no page lists a hard-coded city list; a new city is noindex, off the sitemap and out of the ItemList', () => {
  for (const rel of ['app/(core)/cities/page.tsx', 'app/(core)/going-out/page.tsx', 'components/site/home-page.tsx']) {
    const src = code(read(rel))
    assert.match(src, /getCityTiles\(\)/, `${rel} reads the live list`)
    assert.doesNotMatch(src, /CITY_HUBS\.map|CITY_TILES/, `${rel} has no hard-coded city list`)
  }
  assert.match(code(read('app/(core)/cities/page.tsx')), /export const revalidate = 300/)
  const page = code(read('app/cities/[city]/page.tsx'))
  assert.match(page, /export const dynamicParams = true/)
  assert.match(page, /redirect\('\/cities'\)/)
  assert.match(page, /robots: \{ index: false, follow: false \}/, 'a live-only city page is noindex')
  assert.match(page, /generateStaticParams\(\) \{\s*return CITY_HUBS\.map/, 'only the guides prerender; new cities render on demand')
  // The sitemap and route contracts come from the registry only.
  for (const rel of ['app/sitemap.ts', 'lib/search/route-registry.ts', 'lib/search/core-page-schema.ts']) {
    assert.doesNotMatch(read(rel), /live-cities|cities-page/, `${rel} never reads the live list`)
  }
  assert.match(read('lib/search/core-page-schema.ts'), /itemListElement: CITY_HUBS\.map/)
  assert.doesNotMatch(read('lib/search/core-page-schema.ts'), /numberOfItems: 10/)
})

test('6. F-4: an eleventh guide does not flip the ten existing guides to noindex', () => {
  const lagos = registry.CITY_HUBS.find((h) => h.slug === 'lagos')
  const before = registry.cityHubEffectiveLifecycle(lagos)
  const readyBefore = registry.allCityHubsSearchReady()
  assert.equal(before, 'search_ready', 'the ten are search-ready today')
  assert.equal(readyBefore, true)
  // Add an 11th guide the way a content PR does: slug, jurisdiction contract and record together.
  registry.CITY_HUB_SLUGS.push('accra')
  registry.CITY_JURISDICTIONS.accra = { ...registry.CITY_JURISDICTIONS.lagos, city: 'Accra' }
  const accra = { ...lagos, slug: 'accra', city: 'Accra', jurisdiction: registry.CITY_JURISDICTIONS.accra }
  registry.CITY_CATALOGUE_RECEIPTS.accra = registry.CITY_CATALOGUE_RECEIPTS.lagos
  registry.APPROVED_CITY_CONTENT_FINGERPRINTS.accra = registry.cityHubContentFingerprint(accra)
  registry.CITY_HUBS.push(accra)
  try {
    assert.equal(registry.isCityHubSearchReady(accra), true, 'the fixture eleventh guide is itself ready')
    assert.equal(registry.CITY_HUBS.length, 11)
    assert.equal(registry.cityHubEffectiveLifecycle(lagos), before)
    assert.equal(registry.allCityHubsSearchReady(), readyBefore)
  } finally {
    registry.CITY_HUBS.pop()
    registry.CITY_HUB_SLUGS.pop()
    delete registry.CITY_JURISDICTIONS.accra
    delete registry.CITY_CATALOGUE_RECEIPTS.accra
    delete registry.APPROVED_CITY_CONTENT_FINGERPRINTS.accra
  }
  assert.doesNotMatch(code(read('content/cities/registry.ts')), /CITY_HUBS\.length === 10/)
})

test('7. the four new city clips exist in every size, are wired to their city, and are recorded', () => {
  const manifest = JSON.parse(read('public/marketing/cities/asset-manifest.json'))
  const media = code(read('components/site/city-media.tsx'))
  const expected = {
    abuja: { aiGenerated: false, stockId: '1635446' },
    ibadan: { aiGenerated: false, stockId: '5751367' },
    kano: { aiGenerated: true, creationId: 's7oXsWSl8e', model: 'wan-3-0' },
    kaduna: { aiGenerated: true, creationId: 'lJ8BlcFgv9', model: 'wan-3-0' },
  }
  const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(path.join(MARKETING, 'public/marketing/site/m', file))).digest('hex')
  for (const [slug, facts] of Object.entries(expected)) {
    assert.ok(media.includes(`${slug}: 'v:c-${slug}'`), `${slug} is wired in LIVE_CITY_MEDIA`)
    for (const file of [`c-${slug}.mp4`, `c-${slug}-sm.mp4`, `c-${slug}.jpg`, `c-${slug}.webp`]) {
      assert.ok(fs.existsSync(path.join(MARKETING, 'public/marketing/site/m', file)), file)
    }
    assert.ok(fs.statSync(path.join(MARKETING, `public/marketing/site/m/c-${slug}.mp4`)).size < 700 * 1024)
    const entry = manifest.assets.find((a) => a.path === `/marketing/site/m/c-${slug}.mp4`)
    assert.ok(entry, `${slug} is in the asset manifest`)
    for (const [key, value] of Object.entries(facts)) assert.equal(entry[key], value, `${slug}.${key}`)
    assert.equal(entry.sha256, sha(`c-${slug}.mp4`), `${slug} sha256`)
    for (const [file, hash] of Object.entries(entry.files)) assert.equal(hash, sha(file), file)
  }
  // A live city with no clip falls back to a brand-colour card, never a broken video.
  assert.match(media, /if \(media === null\) return <div className=\{`city-field city-field-\$\{cityBrandField\(slug\)\}`\} aria-hidden="true" \/>/)
  for (const field of ['moss', 'night', 'clay', 'sand']) assert.match(read('components/site/pages.css'), new RegExp(`\\.city-field-${field} \\{`))
})
