import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../..')
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8')

const hostHero = read('components/sections/organiser-home/hero.tsx')
const hostPage = read('app/host/page.tsx')
const explorerHero = read('components/sections/explorer-home/hero.tsx')
const switcher = read('components/marketing/surface-toggle.tsx')

assert.match(hostHero, /world-hosts-create-preview\.mp4/)
assert.doesNotMatch(hostHero, /city-waking-up/)
assert.equal(existsSync(resolve(root, 'public/marketing/host-hero/world-hosts-create-preview.mp4')), true)
assert.equal(existsSync(resolve(root, 'public/marketing/host-hero/world-hosts-create-poster.jpg')), true)
assert.equal(existsSync(resolve(root, 'public/marketing/host-hero/city-waking-up-preview.mp4')), false)
assert.equal(existsSync(resolve(root, 'public/marketing/host-hero/city-waking-up-poster.jpg')), false)
assert.match(hostHero, /autoPlay=!\{?reduced\}?|autoPlay=\{!reduced\}/)
assert.match(hostHero, /muted/)
assert.match(hostHero, /loop/)
assert.match(hostHero, /playsInline/)
assert.match(hostHero, /Your place deserves to be found\./)
assert.doesNotMatch(hostHero, />\s*Mingla Host\s*</)
assert.doesNotMatch(hostHero, />\s*Use on web\s*</)
assert.doesNotMatch(hostHero, /BUSINESS_APP_CHOICE_COPY|resolveBusinessAppTarget/)
assert.doesNotMatch(hostHero, /desktopNote|moreNote/)
assert.doesNotMatch(hostHero, /siteAttribution|captureMarketing/)
assert.doesNotMatch(hostHero, /handleDownloadTheBusinessApp|handleUseBusinessOnWeb/)
assert.match(hostPage, /<OrganiserHero \/>/)
assert.doesNotMatch(hostPage, /searchParams|heroVariant/)
assert.match(explorerHero, /\{ href: '\/host', label: 'Host', mobileOnly: true \}/)
assert.match(switcher, /\{ surface: 'organiser', label: 'Host', href: '\/host' \}/)
assert.doesNotMatch(switcher, /label: 'Business'/)

console.log('issue #2083 approved Host hero contract: PASS')
