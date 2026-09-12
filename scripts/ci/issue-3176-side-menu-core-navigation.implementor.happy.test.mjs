#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const MENU_PATH = 'mingla-marketing/components/cutout/audience-menu-content.tsx'
const CUTOUT_FOOTER_PATH = 'mingla-marketing/components/cutout/footer.tsx'
const MARKETING_FOOTER_PATH = 'mingla-marketing/components/marketing/footer.tsx'
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const SELF_TEST = process.argv.includes('--self-test')

function verify(
  menu = read(MENU_PATH),
  cutoutFooter = read(CUTOUT_FOOTER_PATH),
  marketingFooter = read(MARKETING_FOOTER_PATH),
) {
  assert.doesNotMatch(menu, /allCoreTrustPagesSearchReady|allCityHubsSearchReady|explorerFallback|coreReady\s*\?/, 'approved navigation must not disappear behind an indexing-readiness gate')

  const orderedLinks = [
    "href: '/explorer', label: 'Explorer'",
    "href: '/host', label: 'Host'",
    "href: '/', label: 'Home'",
    "href: '/cities', label: 'Cities'",
    "href: '/about', label: 'About'",
    "href: '/tools', label: 'Free tools'",
  ]
  let priorIndex = -1
  for (const link of orderedLinks) {
    const linkIndex = menu.indexOf(link)
    assert(linkIndex > priorIndex, `${link} must exist once in the approved menu order`)
    assert.equal(menu.indexOf(link, linkIndex + 1), -1, `${link} must not be duplicated`)
    priorIndex = linkIndex
  }

  assert.match(menu, /aria-current=\{active \? 'page' : undefined\}/, 'all menu links must expose their current route')
  assert.match(menu, /const menuButtonClass = 'cut-btn flex min-h-14 w-full justify-start[^']*font-display text-base focus-ring'/, 'every primary menu destination must inherit the same full-width moulded button anatomy')
  assert.match(menu, /supportingDestinations\.map\([\s\S]*\? `\$\{menuButtonClass\} cut-btn-brand text-white`[\s\S]*: `\$\{menuButtonClass\} cut-btn-light text-\[var\(--cut-ink\)\]`/, 'supporting destinations must use the same active and inactive button treatments as Explorer and Host')
  assert.match(menu, /label="Explore Your City"[\s\S]*label="Host Your City"/, 'device-aware audience actions must remain stacked at the bottom')

  const requiredFooterRoutes = ['/', '/explorer', '/cities', '/host', '/tools', '/help', '/about']
  for (const [owner, source] of [[CUTOUT_FOOTER_PATH, cutoutFooter], [MARKETING_FOOTER_PATH, marketingFooter]]) {
    assert.doesNotMatch(source, /allCoreTrustPagesSearchReady|allCityHubsSearchReady|coreReady/, `${owner} must not hide approved public links behind indexing readiness`)
    for (const route of requiredFooterRoutes) {
      assert.match(source, new RegExp(`href: '${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`), `${owner} must expose ${route} in its footer navigation`)
    }
  }

  for (const owner of [
    'mingla-marketing/components/cutout/cutout-nav.tsx',
    'mingla-marketing/components/page-system/page-system-nav.tsx',
  ]) {
    assert.match(read(owner), /<AudienceMenuContent/, `${owner} must consume the shared site-wide menu owner`)
  }

  const packageJson = JSON.parse(read('mingla-marketing/package.json'))
  assert.match(packageJson.scripts.prebuild, /issue-3176-side-menu-core-navigation\.implementor\.happy\.test\.mjs/, 'the menu contract must run before production builds')
  assert.match(packageJson.scripts['test:issue-3176'], /issue-3176-side-menu-core-navigation\.implementor\.happy\.test\.mjs/, 'focused #3176 verification must own the menu contract')
}

verify()
if (SELF_TEST) {
  const reverted = read(MENU_PATH).replace("{ href: '/cities', label: 'Cities', Icon: MapPinned },", "...(coreReady ? [{ href: '/cities', label: 'Cities', Icon: MapPinned }] : []),")
  assert.throws(() => verify(reverted), /indexing-readiness gate|must exist once/, 'restoring the hidden Cities link must prove RED')
  const flatMenu = read(MENU_PATH).replace("const menuButtonClass = 'cut-btn", "const menuButtonClass = 'flex")
  assert.throws(() => verify(flatMenu), /same full-width moulded button anatomy/, 'restoring flat supporting links must prove RED')
  const missingFooter = read(CUTOUT_FOOTER_PATH).replace("{ href: '/about', label: 'About' }, ", '')
  assert.throws(() => verify(read(MENU_PATH), missingFooter), /must expose/, 'dropping an approved footer destination must prove RED')
  process.stdout.write('RED proof: hidden, flat, and footer-incomplete navigation states were rejected\n')
}
process.stdout.write('PASS #3176 shared side menu and footers expose the complete styled public navigation\n')
