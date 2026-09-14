#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const SELF_TEST = process.argv.includes('--self-test')

function verify(
  menu = read('mingla-marketing/components/cutout/audience-menu-content.tsx'),
  cutoutFooter = read('mingla-marketing/components/cutout/footer.tsx'),
  marketingFooter = read('mingla-marketing/components/marketing/footer.tsx'),
) {
  const corePages = read('mingla-marketing/content/core-pages.ts')
  const routeRegistry = read('mingla-marketing/lib/search/route-registry.ts')
  const sitemap = read('mingla-marketing/app/sitemap.ts')

  for (const slug of ['about', 'explorer', 'cities']) {
    assert.match(corePages, new RegExp(`slug: '${slug}', pathname: '/${slug}', lifecycle: CORE_PAGE_RELEASE_LIFECYCLE`), `${slug} must share the founder-approved release lifecycle`)
    assert.match(menu, new RegExp(`href: '/${slug}', label: '(?:${slug === 'about' ? 'About' : slug === 'cities' ? 'Cities' : 'Explorer'})'`), `${slug} must remain reachable independently from sitemap state`)
  }
  assert.match(corePages, /CORE_PAGE_RELEASE_LIFECYCLE = allCityHubsSearchReady\(\) \? 'search_ready' : 'public_noindex'/, 'core promotion must fail closed with the ten-city cohort')
  assert.doesNotMatch(menu, /coreReady\s*\?|allCityHubsSearchReady\(\).*Cities|allCoreTrustPagesSearchReady/, 'navigation visibility must not be coupled back to publication readiness')
  assert.match(menu, /const menuButtonClass = 'cut-btn[^']*min-h-14[^']*w-full[^']*justify-start/, 'the shared menu must give every destination one full-width moulded button owner')
  assert.match(menu, /supportingDestinations\.map\([\s\S]*menuButtonClass[\s\S]*cut-btn-brand[\s\S]*cut-btn-light/, 'Home, Cities, About and Free tools must receive the same selected/unselected treatment as the audience links')

  const requiredFooterRoutes = ['/', '/explorer', '/cities', '/host', '/tools', '/help', '/about']
  for (const [name, footer] of [['Cutout footer', cutoutFooter], ['marketing/tools footer', marketingFooter]]) {
    assert.doesNotMatch(footer, /allCoreTrustPagesSearchReady|allCityHubsSearchReady|coreReady/, `${name} must stay visible independently from sitemap promotion`)
    for (const route of requiredFooterRoutes) {
      assert.match(footer, new RegExp(`href: '${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`), `${name} is missing ${route}`)
    }
    assert.match(footer, /https:\/\/career\.usemingla\.com/, `${name} must retain the Careers destination`)
  }

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
    "{ href: '/about', label: 'About', Icon: Info },",
    "...(coreReady ? [{ href: '/about', label: 'About', Icon: Info }] : []),",
  )
  assert.throws(() => verify(coupled), /publication readiness|remain reachable/, 're-coupling About visibility to indexing must prove RED')
  const unstyled = read('mingla-marketing/components/cutout/audience-menu-content.tsx').replace("const menuButtonClass = 'cut-btn", "const menuButtonClass = 'flex")
  assert.throws(() => verify(unstyled), /full-width moulded button owner/, 'flattening the shared menu must prove RED')
  const footerGap = read('mingla-marketing/components/marketing/footer.tsx').replace("{ href: '/cities', label: 'Cities' },", "{ href: '/', label: 'Home duplicate' },")
  assert.throws(() => verify(read('mingla-marketing/components/cutout/audience-menu-content.tsx'), read('mingla-marketing/components/cutout/footer.tsx'), footerGap), /missing \/cities/, 'removing a footer route must prove RED')
  process.stdout.write('RED proof: coupled, flat, and footer-incomplete navigation was rejected\n')
}
process.stdout.write('PASS #3176 independent navigation test: complete styled menu and footer links stay visible while founder-approved indexing remains fail-closed\n')
