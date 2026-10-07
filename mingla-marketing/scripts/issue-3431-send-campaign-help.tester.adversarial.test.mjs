#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8')

const slug = 'send-a-campaign-to-a-group'
const route = `/help/${slug}`
const registry = read('content/help/registry.ts')
const captions = read(`public/help/captions/${slug}.vtt`).replace(/\r\n/g, '\n')
const detailPage = read('app/help/[slug]/page.tsx')
const helpBrowser = read('components/help/help-browser.tsx')
const helpSchema = read('components/help/help-schema.tsx')
const routeRegistry = read('lib/search/route-registry.ts')

const recordStart = registry.indexOf(`    slug: '${slug}',`)
assert.notEqual(recordStart, -1, 'episode 20 must remain in the canonical help registry')
const nextRecord = registry.indexOf('\n  {\n    slug:', recordStart + 1)
const recordsEnd = registry.indexOf('\n]\n', recordStart)
const record = registry.slice(recordStart, nextRecord === -1 ? recordsEnd : nextRecord)

assert.deepEqual(
  [...record.matchAll(/^        title: '([^']+)',$/gm)].map((match) => match[1]),
  [
    'Start a campaign and pick an audience',
    'Write the email',
    'Add an event card',
    'Add a link',
    'Schedule it or send it now',
    'See how it did',
  ],
  'episode 20 must keep the six written steps in the filmed journey order',
)

// Product truth: nothing sends until the host confirms on the review.
assert.doesNotMatch(
  record,
  /sent automatically|automatically (sends?|emails?|texts?|messages?)|sends? (it )?(right away|instantly) (once|when) you|auto-?send/i,
  'the guide must never claim a campaign sends on its own',
)
// The filmed campaign had 0 opens and 0 clicks: the guide may explain the metrics but must not claim results.
assert.doesNotMatch(record, /\d+% (open|click)|open rate of|clicked by \d/i, 'the guide must not claim campaign results')
// Opens are an estimate; they must never be called exact or proof of reading.
assert.doesNotMatch(record, /opens? (are|is) (exact|accurate|proof)|proves? (they|someone) read/i)
// The video shows no test send, SMS send, divider, image or template: none may be described.
assert.doesNotMatch(record, /test (send|email)|send yourself a test|divider|insert an image|from template|personali[sz]e/i, 'unfilmed composer features may not be described')
// Followers and the extended circle are not filmed working.
assert.doesNotMatch(record, /follower|extended circle/i, 'followers and the extended circle are not filmed and may not be described')
// The email footer is not narrated; it must not be quoted.
assert.doesNotMatch(record, /footer|bought tickets from/i, 'the email footer must not be quoted')
// Filmed on desktop web only.
assert.doesNotMatch(record, /surfaces: \[[^\]]*(iOS|Android)/, 'episode 20 was filmed on desktop web only')

const blocks = captions.trim().split(/\n{2,}/)
assert.equal(blocks.shift(), 'WEBVTT', 'caption sidecar must begin with a standalone WEBVTT header')
assert.equal(blocks.length, 36, 'caption sidecar must contain the reviewed 36 cues')

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
  assert(end <= 100_466, `caption cue ${offset + 1} must end within the reviewed 1:40.466 runtime`)
  assert(text.join(' ').trim(), `caption cue ${offset + 1} must contain spoken text`)
  previousEnd = end
  spokenLines.push(text.join(' ').trim())
}
assert.equal(previousEnd, 100_034, 'the last caption cue must end at 1:40.034, on the end card')

const transcript = spokenLines.join(' ')
for (const [label, pattern] of [
  ['new campaign', /In Blast, start a new campaign\./i],
  ['audience choices', /your whole book, a group, or an automatic group of buyers\./i],
  ['event card', /Click plus Event to add an event card\./i],
  ['link', /open the three-dot menu and choose Link\./i],
  ['schedule', /pick a date and time with Schedule send\./i],
  ['explicit send', /Nothing sends until you confirm\./i],
  ['report', /Open a sent campaign to see how it did/i],
  ['opens estimate', /Opens are an estimate, so treat them as a trend\./i],
  ['clicks signal', /Link clicks are the stronger signal\./i],
  ['Host CTA', /Get Mingla Host at usemingla dot com slash host\./i],
]) {
  assert.match(transcript, pattern, `caption track must narrate the ${label} contract`)
}
assert.doesNotMatch(transcript, /Mingler/, 'caption track must spell the brand correctly')
assert.doesNotMatch(transcript, /follower|extended circle|sends? automatically|test send/i, 'caption track must not narrate unfilmed audiences, automatic sends or test sends')

assert.match(detailPage, /generateStaticParams\(\)[\s\S]*HELP_VIDEOS\.map/)
assert.match(detailPage, /helpVideoForSlug\(slug\)/)
assert.match(detailPage, /video\.steps\.map/)
assert.match(detailPage, /captionsUrl=\{captions \?\? undefined\}/)
assert.match(helpBrowser, /\.\.\.v\.steps\.map\(\(s\) => `\$\{s\.title\} \$\{s\.body\}`\)/)
assert.match(helpSchema, /if \(!video\.bambooEntryId\) return null/)
assert.match(routeRegistry, /HELP_VIDEOS\.map\(\(record\) => \(\{[\s\S]*pathname: helpVideoPath\(record\.slug\)/)
assert.match(routeRegistry, /\.\.\.HELP_ROUTE_CONTRACTS,/)

assert.equal(route, '/help/send-a-campaign-to-a-group')

console.log('PASS #3431 episode 20 no automatic sends, no claimed results and six-step campaign journey')
console.log('PASS #3431 episode 20 WebVTT timing, end-card alignment and narrated contracts')
console.log('PASS #3431 episode 20 static route, search projection and safe media fallback')
