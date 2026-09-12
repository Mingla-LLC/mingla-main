#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const SELF_TEST = process.argv.includes('--self-test')

function verify(menu = read('mingla-marketing/components/cutout/audience-menu-content.tsx')) {
  const corePages = read('mingla-marketing/content/core-pages.ts')
  const routeRegistry = read('mingla-marketing/lib/search/route-registry.ts')
  const sitemap = read('mingla-marketing/app/sitemap.ts')

  for (const slug of ['about', 'explorer', 'cities']) {
    assert.match(corePages, new RegExp(`slug: '${slug}', pathname: '/${slug}', lifecycle: 'public_noindex'`), `${slug} fixture must still exercise the pre-index navigation state`)
    assert.match(menu, new RegExp(`href: '/${slug}', label: '(?:${slug === 'about' ? 'About' : slug === 'cities' ? 'Cities' : 'Explorer'})'`), `${slug} must remain reachable before sitemap promotion`)
  }
  assert.doesNotMatch(menu, /coreReady\s*\?|allCityHubsSearchReady\(\).*Cities|allCoreTrustPagesSearchReady/, 'navigation visibility must not be coupled back to publication readiness')

  assert.match(routeRegistry, /Object\.values\(CORE_PAGES\)\.filter\(\(record\) => record\.lifecycle === 'public_noindex'\)/, 'core routes must retain their noindex registry owner')
  assert.match(routeRegistry, /Object\.values\(CORE_PAGES\)[\s\S]*\.filter\(\(record\) => record\.lifecycle === 'search_ready'\)/, 'sitemap eligibility must remain lifecycle-derived')
  assert.match(sitemap, /searchReadyRoutes\(\)\.map/, 'sitemap must remain restricted to search-ready routes')

  const packageJson = JSON.parse(read('mingla-marketing/package.json'))
  assert.match(packageJson.scripts.prebuild, /issue-3176-side-menu-core-navigation\.tester\.adversarial\.test\.mjs/, 'independent navigation/publication separation must run before builds')
  assert.match(packageJson.scripts['test:issue-3176'], /issue-3176-side-menu-core-navigation\.tester\.adversarial\.test\.mjs/, 'focused #3176 verification must include the independent guard')
}

verify()
if (SELF_TEST) {
  const coupled = read('mingla-marketing/components/cutout/audience-menu-content.tsx').replace(
    "{ href: '/about', label: 'About' },",
    "...(coreReady ? [{ href: '/about', label: 'About' }] : []),",
  )
  assert.throws(() => verify(coupled), /publication readiness|remain reachable/, 're-coupling About visibility to indexing must prove RED')
  process.stdout.write('RED proof: coupling a public menu link back to indexing readiness was rejected\n')
}
process.stdout.write('PASS #3176 independent navigation test: public links stay visible while indexing remains fail-closed\n')
