#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8')

const slug = 'create-an-unlisted-rsvp-event-in-nigeria'
const route = `/help/${slug}`
const registry = read('content/help/registry.ts')
const captions = read(`public/help/captions/${slug}.vtt`).replace(/\r\n/g, '\n')
const detailPage = read('app/help/[slug]/page.tsx')
const helpBrowser = read('components/help/help-browser.tsx')
const helpSchema = read('components/help/help-schema.tsx')
const routeRegistry = read('lib/search/route-registry.ts')

const recordStart = registry.indexOf(`    slug: '${slug}',`)
assert.notEqual(recordStart, -1, 'episode 14 must remain in the canonical help registry')
const nextRecord = registry.indexOf('\n  {\n    slug:', recordStart + 1)
const recordsEnd = registry.indexOf('\n]\n', recordStart)
const record = registry.slice(recordStart, nextRecord === -1 ? recordsEnd : nextRecord)

// Adversarial angle 1: the written page must teach a complete journey in the
// intended order, and it must not turn "Unlisted" into an identity promise.
// That boundary matters because a shared link can be forwarded.
assert.deepEqual(
  [...record.matchAll(/^        title: '([^']+)',$/gm)].map((match) => match[1]),
  [
    'Create an RSVP event',
    'Name it, set the atmosphere and describe it',
    'Set Saturday night in Lagos',
    'Choose Harmattan Club and keep its address hidden',
    'Add the dinner cover and gallery',
    'Make every place deliberate',
    'Offer an optional chip-in',
    'Keep attendance details private',
    'Publish Unlisted and share the link',
  ],
  'episode 14 must keep the nine written steps in the filmed journey order',
)
assert.match(record, /Unlisted is link-based, not identity-gated: anyone with the link can open the page/)
assert.match(record, /Mingla does not promote it in discovery/)
assert.doesNotMatch(
  record,
  /(?:only|just) (?:the )?(?:invited|approved|named) (?:people|guests) can (?:open|view|access)|identity-gated private event/i,
  'the guide must not misrepresent an Unlisted link as identity-gated access',
)

// Adversarial angle 2: parse the VTT as timed data rather than trusting a cue
// count or byte hash. A byte-perfect file can still be unusable if its timing
// is non-monotonic, overlapping, malformed, or beyond the published runtime.
const blocks = captions.trim().split(/\n{2,}/)
assert.equal(blocks.shift(), 'WEBVTT', 'caption sidecar must begin with a standalone WEBVTT header')
assert.equal(blocks.length, 49, 'caption sidecar must contain the reviewed 49 cues')

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
  assert(end <= 153_000, `caption cue ${offset + 1} must end within the published 2:33 runtime`)
  assert(text.join(' ').trim(), `caption cue ${offset + 1} must contain spoken text`)
  previousEnd = end
  spokenLines.push(text.join(' ').trim())
}

const transcript = spokenLines.join(' ')
for (const [label, pattern] of [
  ['manual RSVP approval', /approve each RSVP yourself/i],
  ['optional contribution', /It is still optional/i],
  ['Unlisted visibility', /Choose Unlisted/i],
  ['discovery disabled', /leave the discovery feed off/i],
  ['publish action', /Publish, then share the link directly/i],
  ['hidden live result', /address and spots-left count stay hidden/i],
]) {
  assert.match(transcript, pattern, `caption track must narrate the ${label} contract`)
}

// Adversarial angle 3: prove the content record reaches every generic route
// consumer. The page must be statically generated and searchable even while a
// Bamboo id is pending, but it must not emit a fake VideoObject until media is
// real. Once the release id lands, the same generic wiring creates the player.
assert.match(detailPage, /generateStaticParams\(\)[\s\S]*HELP_VIDEOS\.map/)
assert.match(detailPage, /helpVideoForSlug\(slug\)/)
assert.match(detailPage, /video\.steps\.map/)
assert.match(detailPage, /captionsUrl=\{captions \?\? undefined\}/)
assert.match(helpBrowser, /\.\.\.v\.steps\.map\(\(s\) => `\$\{s\.title\} \$\{s\.body\}`\)/)
assert.match(helpSchema, /if \(!video\.bambooEntryId\) return null/)
assert.match(routeRegistry, /HELP_VIDEOS\.map\(\(record\) => \(\{[\s\S]*pathname: helpVideoPath\(record\.slug\)/)
assert.match(routeRegistry, /\.\.\.HELP_ROUTE_CONTRACTS,/)

const bambooValue = record.match(/bambooEntryId: (null|'0_[a-z0-9]+'),/)?.[1]
assert(bambooValue, 'episode 14 Bamboo id must be truthful null while pending or a real 0_<id> entry')
assert.equal(route, '/help/create-an-unlisted-rsvp-event-in-nigeria')

console.log('PASS #3431 episode 14 truthful Unlisted boundary and nine-step journey')
console.log('PASS #3431 episode 14 WebVTT timing, ordering and narrated end-state')
console.log('PASS #3431 episode 14 static route, search projection and safe media fallback')
