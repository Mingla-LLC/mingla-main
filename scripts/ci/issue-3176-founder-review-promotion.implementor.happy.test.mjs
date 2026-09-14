#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildRouteLedgerRows } from '../search/workbook-contract.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const MARKETING = path.join(ROOT, 'mingla-marketing')
const marketingRequire = createRequire(path.join(MARKETING, 'package.json'))
const ts = marketingRequire('typescript')
const SELF_TEST = process.argv.includes('--self-test')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const promotedPaths = [
  '/about', '/explorer', '/cities',
  '/cities/lagos', '/cities/durham-nc', '/cities/cary-nc', '/cities/raleigh-nc',
  '/cities/new-york-city', '/cities/brussels', '/cities/paris', '/cities/london',
  '/cities/fort-lauderdale', '/cities/washington-dc',
]

function loadCityRegistry(source) {
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} }
  const testRequire = (specifier) => {
    if (specifier === '../../lib/search/historical-city-build') return { historicalCityBuildEnabled: () => false }
    throw new Error(`Unexpected city registry dependency: ${specifier}`)
  }
  new Function('exports', 'module', 'require', javascript)(module.exports, module, testRequire)
  return module.exports
}

function verifySource(overrides = {}) {
  const source = (relative) => overrides[relative] ?? read(relative)
  const registrySource = source('mingla-marketing/content/cities/registry.ts')
  const registry = loadCityRegistry(registrySource)
  assert.equal(registry.CITY_HUBS.length, 10, 'the launch cohort must contain exactly ten cities')
  for (const city of registry.CITY_HUBS) {
    assert.equal(city.lifecycle, 'search_ready', `${city.slug} must carry the approved lifecycle`)
    assert.equal(city.wasSearchReady, true, `${city.slug} must retain canonical history after promotion`)
    assert.deepEqual(city.localReview, {
      status: 'reviewed',
      name: 'Seth Ogieva',
      relationship: 'Mingla founder and launch-market reviewer',
      reviewedAt: '2026-09-12',
    }, `${city.slug} founder review receipt`)
  }
  assert.equal(registry.allCityHubsSearchReady({ asOf: '2026-09-12' }), true, 'the approved ten-city cohort must satisfy the existing readiness predicate')
  assert.match(registrySource, /if \(historicalCityBuildEnabled\(\)\) return false/, 'the immutable historical test artifact must stay explicit')
  assert.match(registrySource, /!isCityHubSearchReady\(record\) \|\| !allCityHubsSearchReady\(\)/, 'effective lifecycle must fail closed for both a city and the full cohort')

  const corePages = source('mingla-marketing/content/core-pages.ts')
  assert.match(corePages, /CORE_PAGE_RELEASE_LIFECYCLE = allCityHubsSearchReady\(\) \? 'search_ready' : 'public_noindex'/, 'core routes must share the ten-city promotion gate')
  assert.equal((corePages.match(/lifecycle: CORE_PAGE_RELEASE_LIFECYCLE/g) ?? []).length, 3, 'all three approved core routes must share the release lifecycle')

  const routeRegistry = source('mingla-marketing/lib/search/route-registry.ts')
  const metadata = source('mingla-marketing/lib/search/metadata.ts')
  const schema = source('mingla-marketing/lib/search/city-schema.ts')
  const sitemap = source('mingla-marketing/app/sitemap.ts')
  const cityHub = source('mingla-marketing/components/cities/city-hub.tsx')
  assert.match(routeRegistry, /Object\.values\(CORE_PAGES\)[\s\S]*\.filter\(\(record\) => record\.lifecycle === 'search_ready'\)/, 'core route contracts must project the shared lifecycle')
  assert.match(routeRegistry, /lifecycle: cityHubEffectiveLifecycle\(record\)/, 'city route contracts must project the cohort-effective lifecycle')
  assert.match(metadata, /const lifecycle = cityHubEffectiveLifecycle\(record\)/, 'city robots and canonicals must use the cohort lifecycle owner')
  assert.match(metadata, /record\.lifecycle === 'search_ready'[\s\S]*searchRouteMetadata\(record\.pathname\)/, 'core robots and canonicals must use the core lifecycle owner')
  assert.match(schema, /cityHubEffectiveLifecycle\(record\) !== 'search_ready'/, 'city schema must use the cohort lifecycle owner')
  assert.match(sitemap, /searchReadyRoutes\(\)\.map/, 'sitemap membership must use the route registry lifecycle owner')
  assert.match(cityHub, /cityHubEffectiveLifecycle\(city\) !== 'search_ready'/, 'city-to-city navigation must use the cohort lifecycle owner')

  const fixture = JSON.parse(source('scripts/search/fixtures/release-route-scope.json'))
  assert.equal(fixture.marketing.length, 23, 'release route ledger must retain all 23 marketing routes')
  for (const pathname of promotedPaths) {
    assert.equal(fixture.marketing.find((record) => record.path === pathname)?.lifecycle, 'search_ready', `${pathname} must be promoted in the crawler and Bing/IndexNow plan`)
  }
  assert.equal(fixture.marketing.some((record) => record.path === '/editorial-standards'), false, 'deleted editorial route must not re-enter the release plan')

  const packageJson = JSON.parse(source('mingla-marketing/package.json'))
  for (const scriptName of ['test:issue-3176', 'prebuild', 'build']) {
    assert.match(packageJson.scripts[scriptName], /issue-3176-founder-review-promotion\.implementor\.happy\.test\.mjs/, `${scriptName} must run the founder-promotion guard`)
  }
}

verifySource()
const ledgerRows = buildRouteLedgerRows()
for (const pathname of promotedPaths) {
  const row = ledgerRows.find((candidate) => candidate.path === pathname)
  assert(row, `${pathname} route-ledger row`)
  assert.equal(row.lifecycle, 'search_ready', `${pathname} route-ledger lifecycle`)
  assert.equal(row.expected_robots, 'index,follow', `${pathname} route-ledger robots plan`)
  assert.equal(row.expected_canonical, `https://usemingla.com${pathname}`, `${pathname} route-ledger canonical plan`)
  assert.equal(row.expected_sitemap_membership, 'yes', `${pathname} route-ledger sitemap plan`)
}

if (SELF_TEST) {
  const registryRelative = 'mingla-marketing/content/cities/registry.ts'
  const registrySource = read(registryRelative)
  const missingRelationship = registrySource.replace("  relationship: 'Mingla founder and launch-market reviewer',\n", '')
  assert.throws(() => verifySource({ [registryRelative]: missingRelationship }), /relationship|founder review|readiness predicate/, 'deleting the founder relationship must prove RED')
  const partialCityRevert = registrySource.replace("lifecycle: 'search_ready', wasSearchReady: true", "lifecycle: 'public_noindex', wasSearchReady: true")
  assert.throws(() => verifySource({ [registryRelative]: partialCityRevert }), /approved lifecycle|readiness predicate/, 'reverting one city must prove RED')
  const fixtureRelative = 'scripts/search/fixtures/release-route-scope.json'
  const fixture = read(fixtureRelative).replace('{ "path": "/cities/lagos", "lifecycle": "search_ready" }', '{ "path": "/cities/lagos", "lifecycle": "public_noindex" }')
  assert.throws(() => verifySource({ [fixtureRelative]: fixture }), /crawler and Bing\/IndexNow plan/, 'reverting the discovery plan must prove RED')
  process.stdout.write('RED proof: missing review truth, partial city promotion and stale crawler plan were rejected\n')
}

process.stdout.write('PASS #3176 founder review promotion: ten-city cohort, three core routes and every search surface share one fail-closed lifecycle\n')
