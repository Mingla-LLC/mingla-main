#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const MENU_PATH = 'mingla-marketing/components/cutout/audience-menu-content.tsx'
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const SELF_TEST = process.argv.includes('--self-test')

function verify(menu = read(MENU_PATH)) {
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

  assert.match(menu, /aria-current=\{pathname === href \|\| \(href !== '\/' && pathname\.startsWith\(`\$\{href\}\/`\)\) \? 'page' : undefined\}/, 'supporting links must expose their current route')
  assert.match(menu, /label="Explore Your City"[\s\S]*label="Host Your City"/, 'device-aware audience actions must remain stacked at the bottom')

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
  const reverted = read(MENU_PATH).replace("{ href: '/cities', label: 'Cities' },", "...(coreReady ? [{ href: '/cities', label: 'Cities' }] : []),")
  assert.throws(() => verify(reverted), /indexing-readiness gate|must exist once/, 'restoring the hidden Cities link must prove RED')
  process.stdout.write('RED proof: hiding Cities behind an indexing gate was rejected\n')
}
process.stdout.write('PASS #3176 shared side menu exposes the approved core navigation everywhere\n')
