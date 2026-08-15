import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../../..')
const source = readFileSync(
  resolve(root, 'components/sections/organiser-home/audiences.tsx'),
  'utf8',
)

for (const category of [
  'Restaurants & cafés',
  'Bars, clubs & nightlife',
  'Venues & activity spaces',
  'Events & promoters',
  'Experiences, trips & adventures',
  'Pop-ups & independent creators',
]) {
  assert.match(source, new RegExp(category.replace(/[&]/g, '\\&')))
}

assert.match(source, /md:grid-cols-2 lg:grid-cols-3/)
assert.match(source, /rounded-\[28px\]/)
assert.match(source, /backdrop-blur-xl/)
assert.match(source, /capabilities/)
assert.match(source, /Built for how you host/)
assert.match(source, /Choose your world to see how Mingla helps you create/)
assert.match(source, /motion-safe:hover:-translate-y-1\.5/)
assert.match(source, /motion-safe:group-hover:scale-\[1\.045\]/)
assert.match(source, /motion-safe:group-hover:ring-warm\/55/)
assert.match(source, /motion-safe:group-hover:-translate-y-1/)

assert.doesNotMatch(source, /mingla-marquee-x/)
assert.doesNotMatch(source, /const loop =|\.\.\.AUDIENCES/)
assert.doesNotMatch(source, /CHIPS|function Pin/)
assert.doesNotMatch(source, /line-clamp/)
assert.doesNotMatch(source, /w-max|mask-image|columns-2|break-inside/)
assert.doesNotMatch(source, /ArrowRight/)

console.log('issue #2083 Host audience grid contract: PASS')
