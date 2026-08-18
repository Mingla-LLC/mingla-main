import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../../..')
const read = (file: string): string => readFileSync(resolve(root, file), 'utf8')

const audienceTabs = read('components/sections/organiser-home/audience-tabs.tsx')
assert.match(audienceTabs, /grid grid-cols-2 gap-2 sm:grid-cols-3/)
assert.match(audienceTabs, /min-h-11 w-full/)
assert.doesNotMatch(audienceTabs, /overflow-x-auto|flex-nowrap/)

const growthOs = read('components/sections/organiser-home/growth-os-dashboard.tsx')
assert.match(growthOs, /grid grid-cols-2 gap-2 sm:grid-cols-4/)
assert.match(growthOs, /min-h-11 w-full/)
assert.doesNotMatch(growthOs, /setInterval|setTimeout|useEffect/)

const activeHook = read('lib/use-active-in-viewport.ts')
assert.match(activeHook, /useInView/)
assert.match(activeHook, /document\.visibilityState === 'visible'/)
assert.match(activeHook, /visibilitychange/)

const hero = read('components/sections/organiser-home/hero.tsx')
assert.match(hero, /useActiveInViewport<HTMLVideoElement>/)
assert.match(hero, /video\.pause\(\)/)
assert.match(hero, /video\.play\(\)/)
assert.match(hero, /autoPlay=\{false\}/)

const ari = read('components/sections/organiser-home/ari-input.tsx')
assert.match(ari, /reduced \|\| !animationActive/)

for (const file of ['venue-activity-feed.tsx', 'event-attendees-card.tsx', 'popup-card.tsx']) {
  const source = read(`components/sections/organiser-home/${file}`)
  assert.match(source, /animationPlayState: animationActive \? 'running' : 'paused'/)
  assert.match(source, /willChange: animationActive \? 'transform' : undefined/)
}

const nav = read('components/marketing/glass-nav.tsx')
assert.match(nav, /surface === 'organiser' \? 'none' : 'blur\(18px\) saturate\(1\.4\)'/)
assert.match(nav, /surface === 'organiser' \? 'rgba\(250, 247, 242, 0\.94\)'/)

console.log('issue #2096 Host responsive dashboards and visibility-paused motion: PASS')
