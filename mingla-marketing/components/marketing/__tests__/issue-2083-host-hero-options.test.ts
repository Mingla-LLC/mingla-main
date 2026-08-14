import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../..')
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8')

const hostHero = read('components/sections/organiser-home/hero.tsx')
const hostPage = read('app/host/page.tsx')
const explorerHero = read('components/sections/explorer-home/hero.tsx')
const switcher = read('components/marketing/surface-toggle.tsx')

assert.match(hostHero, /city-waking-up-preview\.mp4/)
assert.match(hostHero, /world-hosts-create-preview\.mp4/)
assert.match(hostHero, /autoPlay=!\{?reduced\}?|autoPlay=\{!reduced\}/)
assert.match(hostHero, /muted/)
assert.match(hostHero, /loop/)
assert.match(hostHero, /playsInline/)
assert.match(hostHero, /Your place deserves to be found\./)
assert.match(hostHero, /resolveBusinessAppTarget/)
assert.match(hostHero, /siteAttribution\('business_hero'\)/)
assert.match(hostHero, /captureMarketing\('get_the_app_clicked'/)
assert.match(hostPage, /requested === 'world' \? 'world' : 'city'/)
assert.match(explorerHero, /\{ href: '\/host', label: 'Host', mobileOnly: true \}/)
assert.match(switcher, /\{ surface: 'organiser', label: 'Host', href: '\/host' \}/)
assert.doesNotMatch(switcher, /label: 'Business'/)

console.log('issue #2083 Host hero option contract: PASS')
