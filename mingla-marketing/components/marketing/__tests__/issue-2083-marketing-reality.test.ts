import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

const explorer = read('components/sections/explorer-home/experience-home.tsx')
const host = read('components/sections/organiser-home/host-experience.tsx')
const footer = read('components/marketing/footer.tsx')
const toggle = read('components/marketing/surface-toggle.tsx')
const hostPage = read('app/host/page.tsx')
const explorerLayout = read('app/(explorer)/layout.tsx')
const reveal = read('components/ui/gsap-reveal.tsx')

assert.match(explorer, /Turn the group chat into a real plan\./)
assert.match(explorer, /Find the plan\. Feel the city\. Show up\./)
assert.match(host, /Your place deserves to be found\./)
assert.match(host, /Start faster\. Stay in control\./)
assert.doesNotMatch(hostPage, /ImpactStats|AudienceTabs/)
assert.match(explorerLayout, /Footer surface="explorer"/)
assert.match(toggle, /label: 'Mingla Host'/)
assert.doesNotMatch(toggle, /label: 'Business'/)
assert.match(footer, /socialsForTab/)
assert.match(footer, /socialHref/)
assert.doesNotMatch(footer, /Mingla Business/)
assert.match(reveal, /useGSAP/)
assert.match(reveal, /gsap\.matchMedia/)
assert.match(reveal, /IntersectionObserver/)
assert.match(reveal, /observer\?\.disconnect/)

console.log('issue #2083 marketing reality contract: PASS')
