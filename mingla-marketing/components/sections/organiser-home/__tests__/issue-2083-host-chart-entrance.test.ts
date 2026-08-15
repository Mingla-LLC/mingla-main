import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../../..')
const read = (file: string): string => readFileSync(resolve(root, file), 'utf8')

const chartEntrance = read('components/ui/chart-entrance.tsx')
assert.match(chartEntrance, /whileInView=\{\{ opacity: 1, y: 0, scale: 1 \}\}/)
assert.match(chartEntrance, /viewport=\{\{ once: true, amount: 0\.18 \}\}/)
assert.match(chartEntrance, /useMinglaReducedMotion/)
assert.match(chartEntrance, /scaleX: 0/)
assert.match(chartEntrance, /scaleY: 0/)

for (const file of [
  'earnings-card.tsx',
  'venue-activity-feed.tsx',
  'event-attendees-card.tsx',
  'dining-dashboard-card.tsx',
  'trip-planner-card.tsx',
  'popup-card.tsx',
  'growth-os-dashboard.tsx',
]) {
  const source = read(`components/sections/organiser-home/${file}`)
  assert.match(source, /<ChartEntrance/, `${file} must use the shared entrance owner`)
}

for (const file of [
  'earnings-card.tsx',
  'event-attendees-card.tsx',
  'dining-dashboard-card.tsx',
  'trip-planner-card.tsx',
  'popup-card.tsx',
  'growth-os-dashboard.tsx',
]) {
  const source = read(`components/sections/organiser-home/${file}`)
  assert.match(source, /AnimatedBar/, `${file} must animate its chart values on entrance`)
}

const growthOs = read('components/sections/organiser-home/growth-os-dashboard.tsx')
assert.doesNotMatch(growthOs, /setInterval|setTimeout|useEffect/)
assert.match(growthOs, /onClick=\{\(\) => setActive\(i\)\}/)

const tabs = read('components/sections/organiser-home/audience-tabs.tsx')
assert.match(tabs, /turn your space into the plan\./)
for (const venueType of ['Bowling alleys', 'climbing gyms', 'pool halls', 'galleries', 'studios', 'cinemas', 'museums', 'resorts', 'spas', 'wellness spaces']) {
  assert.match(tabs, new RegExp(venueType))
}
assert.match(tabs, /Mingla’s AI brain connects your venue/)

console.log('issue #2083 Host chart entrance and inclusive Venues contract: PASS')
