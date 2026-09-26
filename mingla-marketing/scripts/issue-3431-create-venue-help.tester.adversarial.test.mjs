#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8')

const slug = 'create-and-submit-your-venue'
const route = `/help/${slug}`
const registry = read('content/help/registry.ts')
const captions = read(`public/help/captions/${slug}.vtt`).replace(/\r\n/g, '\n')
const detailPage = read('app/help/[slug]/page.tsx')
const helpBrowser = read('components/help/help-browser.tsx')
const helpSchema = read('components/help/help-schema.tsx')
const routeRegistry = read('lib/search/route-registry.ts')

const recordStart = registry.indexOf(`    slug: '${slug}',`)
assert.notEqual(recordStart, -1, 'episode 16 must remain in the canonical help registry')
const nextRecord = registry.indexOf('\n  {\n    slug:', recordStart + 1)
const recordsEnd = registry.indexOf('\n]\n', recordStart)
const record = registry.slice(recordStart, nextRecord === -1 ? recordsEnd : nextRecord)

assert.deepEqual(
  [...record.matchAll(/^        title: '([^']+)',$/gm)].map((match) => match[1]),
  [
    'Start a venue listing from Home',
    'Create a fresh Restaurant listing',
    'Choose the Brooklyn address',
    'Confirm the public name and link',
    'Set the weekly opening hours',
    'Add the six venue photos',
    'Use a short venue video as the cover',
    'Add contact, spend and reservation details',
    'Review, submit and verify In review',
  ],
  'episode 16 must keep the nine written steps in the filmed journey order',
)
assert.match(record, /Submit for review/)
assert.match(record, /not live yet/)
assert.match(record, /Venue Hub shows In review/)
assert.doesNotMatch(record, /venue is (?:approved|live)|go live now/i, 'the guide must not overstate the review-only ending')

const blocks = captions.trim().split(/\n{2,}/)
assert.equal(blocks.shift(), 'WEBVTT', 'caption sidecar must begin with a standalone WEBVTT header')
assert.equal(blocks.length, 39, 'caption sidecar must contain the reviewed 39 cues')

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
  assert(end <= 157_900, `caption cue ${offset + 1} must end within the reviewed 2:37.9 runtime`)
  assert(text.join(' ').trim(), `caption cue ${offset + 1} must contain spoken text`)
  previousEnd = end
  spokenLines.push(text.join(' ').trim())
}

const transcript = spokenLines.join(' ')
for (const [label, pattern] of [
  ['venue path', /Create venue listing/i],
  ['directory decision', /check the directory/i],
  ['address', /61 Wythe Avenue/i],
  ['weekday hours', /Monday to Friday/i],
  ['gallery count', /six existing venue photos/i],
  ['video cover', /upload a short venue video/i],
  ['public contact', /public phone.*email and website/i],
  ['typical spend', /twenty-five.*seventy-five dollars/i],
  ['reservations', /Turn reservations on/i],
  ['review action', /submit the venue for review/i],
  ['review status', /now in review/i],
  ['not-live result', /not live yet/i],
  ['saved hours', /weekdays five to eleven.*weekends noon to eleven/i],
]) {
  assert.match(transcript, pattern, `caption track must narrate the ${label} contract`)
}
assert.doesNotMatch(transcript, /now live|approved and live/i, 'caption track must preserve the review-only ending')

assert.match(detailPage, /generateStaticParams\(\)[\s\S]*HELP_VIDEOS\.map/)
assert.match(detailPage, /helpVideoForSlug\(slug\)/)
assert.match(detailPage, /video\.steps\.map/)
assert.match(detailPage, /captionsUrl=\{captions \?\? undefined\}/)
assert.match(helpBrowser, /\.\.\.v\.steps\.map\(\(s\) => `\$\{s\.title\} \$\{s\.body\}`\)/)
assert.match(helpSchema, /if \(!video\.bambooEntryId\) return null/)
assert.match(routeRegistry, /HELP_VIDEOS\.map\(\(record\) => \(\{[\s\S]*pathname: helpVideoPath\(record\.slug\)/)
assert.match(routeRegistry, /\.\.\.HELP_ROUTE_CONTRACTS,/)

assert.match(record, /bambooEntryId: '0_btn0u3q2',/, 'episode 16 must retain the verified Bamboo release entry')
assert.equal(route, '/help/create-and-submit-your-venue')

console.log('PASS #3431 episode 16 review-only boundary and nine-step venue journey')
console.log('PASS #3431 episode 16 WebVTT timing, ordering and narrated end-state')
console.log('PASS #3431 episode 16 static route, search projection and safe media fallback')
