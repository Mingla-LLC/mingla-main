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

assert.match(source, /md:grid-cols-2 xl:grid-cols-4 xl:grid-rows-\[repeat\(2,320px\)\]/)
assert.match(source, /xl:row-span-2/)
assert.match(source, /xl:col-span-2/)
assert.match(source, /rounded-\[28px\]/)
assert.match(source, /backdrop-blur-xl/)
assert.match(source, /capabilities/)
assert.match(source, /Built for how you host/)
assert.match(source, /Six ways to host\. One connected system/)
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
assert.doesNotMatch(source, /Stays/)

console.log('issue #2083 Host audience grid contract: PASS')
