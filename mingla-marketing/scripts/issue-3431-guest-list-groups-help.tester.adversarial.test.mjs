#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8')

const slug = 'build-your-guest-list-and-groups'
const route = `/help/${slug}`
const registry = read('content/help/registry.ts')
const captions = read(`public/help/captions/${slug}.vtt`).replace(/\r\n/g, '\n')
const detailPage = read('app/help/[slug]/page.tsx')
const helpBrowser = read('components/help/help-browser.tsx')
const helpSchema = read('components/help/help-schema.tsx')
const routeRegistry = read('lib/search/route-registry.ts')

const recordStart = registry.indexOf(`    slug: '${slug}',`)
assert.notEqual(recordStart, -1, 'episode 19 must remain in the canonical help registry')
const nextRecord = registry.indexOf('\n  {\n    slug:', recordStart + 1)
const recordsEnd = registry.indexOf('\n]\n', recordStart)
const record = registry.slice(recordStart, nextRecord === -1 ? recordsEnd : nextRecord)

assert.deepEqual(
  [...record.matchAll(/^        title: '([^']+)',$/gm)].map((match) => match[1]),
  [
    'Open People in Blast',
    'Add a person by hand',
    'Import a CSV file',
    'Check the preview, then import',
    'Create a group',
    'Review and create the group',
    'Start a campaign to the group',
  ],
  'episode 19 must keep the seven written steps in the filmed journey order',
)

// Product truth: nothing is sent on its own; the host writes and starts the campaign.
assert.doesNotMatch(
  record,
  /sent automatically|automatically (sends?|emails?|texts?|messages?)|sends? (it )?(right away|instantly|immediately)|auto-?send/i,
  'the guide must never claim anything is sent automatically',
)
// The video never shows followers or the extended circle working; they may not be described.
assert.doesNotMatch(record, /follower|extended circle/i, 'followers and the extended circle are not filmed and may not be described')
// The email footer is not narrated; it must not be quoted.
assert.doesNotMatch(record, /footer|unsubscribe/i, 'the email footer must not be quoted')
// Import must not be described as adding people before the preview is confirmed.
const importStep = record.slice(record.indexOf("title: 'Check the preview, then import'"))
assert.match(importStep, /before anything is added/)
assert.match(importStep, /permission to contact/)
// The phone row asks for the country first.
assert.doesNotMatch(record, /type the number,? then (pick|choose) the country/i)
// Filmed on desktop web only.
assert.doesNotMatch(record, /surfaces: \[[^\]]*(iOS|Android)/, 'episode 19 was filmed on desktop web only')

const blocks = captions.trim().split(/\n{2,}/)
assert.equal(blocks.shift(), 'WEBVTT', 'caption sidecar must begin with a standalone WEBVTT header')
assert.equal(blocks.length, 37, 'caption sidecar must contain the reviewed 37 cues')

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
  assert(end <= 99_633, `caption cue ${offset + 1} must end within the reviewed 1:39.633 runtime`)
  assert(text.join(' ').trim(), `caption cue ${offset + 1} must contain spoken text`)
  previousEnd = end
  spokenLines.push(text.join(' ').trim())
}
assert.equal(previousEnd, 99_455, 'the last caption cue must end at 1:39.455, on the end card')

const transcript = spokenLines.join(' ')
for (const [label, pattern] of [
  ['your book', /Your book holds the people who gave your brand their details\./i],
  ['country first', /pick the country first, then type the number/i],
  ['column matching', /Mingla matches your columns for you: name, email and phone\./i],
  ['ignored columns', /Columns it doesn't need are ignored\./i],
  ['preview', /The preview shows what will happen before anything is added/i],
  ['permission', /Confirm you have permission to contact them/i],
  ['nothing sent', /Nothing is sent now\./i],
  ['audience', /Regulars is already the audience\./i],
  ['email or SMS', /Write it as an email or an SMS\./i],
  ['Host CTA', /Get Mingla Host at usemingla dot com slash host\./i],
]) {
  assert.match(transcript, pattern, `caption track must narrate the ${label} contract`)
}
assert.doesNotMatch(transcript, /Mingler/, 'caption track must spell the brand correctly')
assert.doesNotMatch(transcript, /follower|extended circle|automatically/i, 'caption track must not narrate unfilmed audiences or automatic sends')

assert.match(detailPage, /generateStaticParams\(\)[\s\S]*HELP_VIDEOS\.map/)
assert.match(detailPage, /helpVideoForSlug\(slug\)/)
assert.match(detailPage, /video\.steps\.map/)
assert.match(detailPage, /captionsUrl=\{captions \?\? undefined\}/)
assert.match(helpBrowser, /\.\.\.v\.steps\.map\(\(s\) => `\$\{s\.title\} \$\{s\.body\}`\)/)
assert.match(helpSchema, /if \(!video\.bambooEntryId\) return null/)
assert.match(routeRegistry, /HELP_VIDEOS\.map\(\(record\) => \(\{[\s\S]*pathname: helpVideoPath\(record\.slug\)/)
assert.match(routeRegistry, /\.\.\.HELP_ROUTE_CONTRACTS,/)

assert.equal(route, '/help/build-your-guest-list-and-groups')

console.log('PASS #3431 episode 19 no automatic sends, no unfilmed audiences and seven-step guest-list journey')
console.log('PASS #3431 episode 19 WebVTT timing, end-card alignment and narrated contracts')
console.log('PASS #3431 episode 19 static route, search projection and safe media fallback')
