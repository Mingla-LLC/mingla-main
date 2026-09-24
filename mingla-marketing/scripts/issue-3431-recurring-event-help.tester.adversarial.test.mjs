#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8')

const slug = 'create-a-recurring-event-in-nigeria'
const route = `/help/${slug}`
const registry = read('content/help/registry.ts')
const captions = read(`public/help/captions/${slug}.vtt`).replace(/\r\n/g, '\n')
const detailPage = read('app/help/[slug]/page.tsx')
const helpBrowser = read('components/help/help-browser.tsx')
const helpSchema = read('components/help/help-schema.tsx')
const routeRegistry = read('lib/search/route-registry.ts')

const recordStart = registry.indexOf(`    slug: '${slug}',`)
assert.notEqual(recordStart, -1, 'episode 15 must remain in the canonical help registry')
const nextRecord = registry.indexOf('\n  {\n    slug:', recordStart + 1)
const recordsEnd = registry.indexOf('\n]\n', recordStart)
const record = registry.slice(recordStart, nextRecord === -1 ? recordsEnd : nextRecord)

assert.deepEqual(
  [...record.matchAll(/^        title: '([^']+)',$/gm)].map((match) => match[1]),
  [
    'Create a ticketed event from Harmattan Club',
    'Name the night and finish the description',
    'Repeat it across eight Sundays',
    'Choose the venue and withhold its street address',
    'Build the recurring-event look',
    'Create the ₦100 Rooftop Pass',
    'Keep the event public and the remaining count private',
    'Preview, then publish the whole series',
    'Verify what guests can buy',
  ],
  'episode 15 must keep the nine written steps in the filmed journey order',
)
assert.match(record, /Publish the recurring event only when the page is correct/)
assert.match(record, /Mingla confirms that all eight occurrences will be created together/)
assert.doesNotMatch(record, /Unlisted|discovery feed off/i, 'the guide must not reuse the prior episode’s private-event ending')

const blocks = captions.trim().split(/\n{2,}/)
assert.equal(blocks.shift(), 'WEBVTT', 'caption sidecar must begin with a standalone WEBVTT header')
assert.equal(blocks.length, 52, 'caption sidecar must contain the reviewed 52 cues')

const timestampMs = (value) => {
  const match = /^(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/.exec(value)
  assert(match, `invalid WebVTT timestamp: ${value}`)
  const [, hours, minutes, seconds, milliseconds] = match.map(Number)
  assert(minutes < 60 && seconds < 60, `out-of-range WebVTT timestamp: ${value}`)
  return (((hours * 60 + minutes) * 60 + seconds) * 1000) + milliseconds
}

let previousEnd = 0
const spokenLines = []
for (const [offset, block] of blocks.entries()) {
  const [number, timing, ...text] = block.split('\n')
  assert.equal(number, String(offset + 1), `caption cue ${offset + 1} must retain its sequence number`)
  const timingMatch = /^(\S+) --> (\S+)$/.exec(timing)
  assert(timingMatch, `caption cue ${offset + 1} must contain one valid timing line`)
  const start = timestampMs(timingMatch[1])
  const end = timestampMs(timingMatch[2])
  assert(start >= previousEnd, `caption cue ${offset + 1} must not overlap the previous cue`)
  assert(end > start, `caption cue ${offset + 1} must have positive duration`)
  assert(end <= 160_200, `caption cue ${offset + 1} must end within the reviewed 2:40.2 runtime`)
  assert(text.join(' ').trim(), `caption cue ${offset + 1} must contain spoken text`)
  previousEnd = end
  spokenLines.push(text.join(' ').trim())
}

const transcript = spokenLines.join(' ')
for (const [label, pattern] of [
  ['keyboard dismissal', /Close the keyboard/i],
  ['weekly recurrence', /repeat every Sunday/i],
  ['eight occurrences', /keep eight occurrences/i],
  ['hidden address', /Leave Hide address on/i],
  ['ticket price', /Rooftop Pass at one hundred naira/i],
  ['public visibility', /keep it Public/i],
  ['recurring publish action', /publish the recurring event/i],
  ['eight-date live result', /choose from eight Sundays/i],
  ['complete description proof', /full description is clear/i],
  ['private live result', /address stays private until they get tickets/i],
]) {
  assert.match(transcript, pattern, `caption track must narrate the ${label} contract`)
}
assert.doesNotMatch(transcript, /Unlisted|discovery feed off/i, 'caption track must match this public recurring event')

assert.match(detailPage, /generateStaticParams\(\)[\s\S]*HELP_VIDEOS\.map/)
assert.match(detailPage, /helpVideoForSlug\(slug\)/)
assert.match(detailPage, /video\.steps\.map/)
assert.match(detailPage, /captionsUrl=\{captions \?\? undefined\}/)
assert.match(helpBrowser, /\.\.\.v\.steps\.map\(\(s\) => `\$\{s\.title\} \$\{s\.body\}`\)/)
assert.match(helpSchema, /if \(!video\.bambooEntryId\) return null/)
assert.match(routeRegistry, /HELP_VIDEOS\.map\(\(record\) => \(\{[\s\S]*pathname: helpVideoPath\(record\.slug\)/)
assert.match(routeRegistry, /\.\.\.HELP_ROUTE_CONTRACTS,/)

assert.match(record, /bambooEntryId: '0_vorph0mx',/, 'episode 15 must retain the verified Bamboo release entry')
assert.equal(route, '/help/create-a-recurring-event-in-nigeria')

console.log('PASS #3431 episode 15 public recurring-event boundary and nine-step journey')
console.log('PASS #3431 episode 15 WebVTT timing, ordering and narrated end-state')
console.log('PASS #3431 episode 15 static route, search projection and safe media fallback')
