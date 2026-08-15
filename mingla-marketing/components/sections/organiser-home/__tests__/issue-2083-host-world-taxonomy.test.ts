import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../../..')
const audienceGrid = readFileSync(
  resolve(root, 'components/sections/organiser-home/audiences.tsx'),
  'utf8',
)
const audienceTabs = readFileSync(
  resolve(root, 'components/sections/organiser-home/audience-tabs.tsx'),
  'utf8',
)

for (const tab of ['Venues', 'Dining', 'Nightlife', 'Events', 'Experiences', 'Pop-ups']) {
  assert.match(audienceTabs, new RegExp(`label: '${tab}'`))
}

assert.match(audienceGrid, /Venues & activity spaces/)
assert.match(audienceGrid, /Bars, clubs & nightlife/)
assert.match(audienceTabs, /Mingla’s AI brain matches the night/)
assert.doesNotMatch(audienceGrid, /Stays/)
assert.doesNotMatch(audienceTabs, /Stays/)

console.log('issue #2083 Host world taxonomy contract: PASS')
