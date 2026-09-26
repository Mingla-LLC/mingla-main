#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8')

const slug = 'polish-your-listing-and-go-live'
const route = `/help/${slug}`
const registry = read('content/help/registry.ts')
const captions = read(`public/help/captions/${slug}.vtt`).replace(/\r\n/g, '\n')
const detailPage = read('app/help/[slug]/page.tsx')
const helpBrowser = read('components/help/help-browser.tsx')
const helpSchema = read('components/help/help-schema.tsx')
const routeRegistry = read('lib/search/route-registry.ts')

const recordStart = registry.indexOf(`    slug: '${slug}',`)
assert.notEqual(recordStart, -1, 'episode 17 must remain in the canonical help registry')
const nextRecord = registry.indexOf('\n  {\n    slug:', recordStart + 1)
const recordsEnd = registry.indexOf('\n]\n', recordStart)
const record = registry.slice(recordStart, nextRecord === -1 ? recordsEnd : nextRecord)

assert.deepEqual(
  [...record.matchAll(/^        title: '([^']+)',$/gm)].map((match) => match[1]),
  [
    'Review the listing while it is In review',
    'Check reservations and protected details',
    'Correct Sunday closing time',
    'Check Deck readiness',
    'Add the public website and check spend',
    'Answer the venue-fit questions',
    'Save the profile changes',
    'Confirm the green Live on Mingla badge',
    'Audit the public venue page',
  ],
  'episode 17 must keep the nine written steps in the filmed journey order',
)
assert.match(record, /remains In review while Mingla checks/)
assert.match(record, /After Mingla approves the listing/)
assert.match(record, /Live on Mingla badge is the proof/)
assert.doesNotMatch(record, /approval is automatic|go live immediately/i, 'the guide must not erase the Mingla review boundary')

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
  assert(end <= 124_667, `caption cue ${offset + 1} must end within the reviewed 2:04.667 runtime`)
  assert(text.join(' ').trim(), `caption cue ${offset + 1} must contain spoken text`)
  previousEnd = end
  spokenLines.push(text.join(' ').trim())
}

const transcript = spokenLines.join(' ')
for (const [label, pattern] of [
  ['settings', /check reservations.*fees.*no-show policy.*weekly hours/i],
  ['protected identity boundary', /Name, address or category changes.*Request a change/i],
  ['Sunday correction', /update Sunday.*closing time.*ten at night/i],
  ['saved hours', /twenty-two hundred.*save the hours/i],
  ['video cover', /video cover is strong/i],
  ['gallery requirement', /at least five clear venue photos/i],
  ['public website', /Add the public website/i],
  ['typical spend', /twenty-five to seventy-five dollars/i],
  ['venue-fit answers', /groups.*live music.*reservations.*meals.*drinks.*vegetarian options.*service types/i],
  ['save confirmation', /Changes saved confirmation/i],
  ['review boundary', /listing stays In review while Mingla checks/i],
  ['approval transition', /After approval, return Home/i],
  ['live proof', /green Live on Mingla badge.*confirms it is public/i],
  ['public page audit', /video cover.*gallery.*category.*city.*title.*typical spend.*current status.*Booking Available/i],
  ['street details', /recommendation.*map.*address.*weekly hours/i],
  ['Sunday result', /Sunday now closes at ten/i],
  ['guest action', /Reserve a table is ready for guests/i],
]) {
  assert.match(transcript, pattern, `caption track must narrate the ${label} contract`)
}
assert.doesNotMatch(transcript, /automatically approved|live immediately/i, 'caption track must preserve the review-before-live transition')

assert.match(detailPage, /generateStaticParams\(\)[\s\S]*HELP_VIDEOS\.map/)
assert.match(detailPage, /helpVideoForSlug\(slug\)/)
assert.match(detailPage, /video\.steps\.map/)
assert.match(detailPage, /captionsUrl=\{captions \?\? undefined\}/)
assert.match(helpBrowser, /\.\.\.v\.steps\.map\(\(s\) => `\$\{s\.title\} \$\{s\.body\}`\)/)
assert.match(helpSchema, /if \(!video\.bambooEntryId\) return null/)
assert.match(routeRegistry, /HELP_VIDEOS\.map\(\(record\) => \(\{[\s\S]*pathname: helpVideoPath\(record\.slug\)/)
assert.match(routeRegistry, /\.\.\.HELP_ROUTE_CONTRACTS,/)

assert.match(record, /bambooEntryId: '0_dmy8rvuu',/, 'episode 17 must retain the verified Bamboo release entry')
assert.equal(route, '/help/polish-your-listing-and-go-live')

console.log('PASS #3431 episode 17 review-to-live boundary and nine-step venue journey')
console.log('PASS #3431 episode 17 WebVTT timing, ordering and narrated end-state')
console.log('PASS #3431 episode 17 static route, search projection and safe media fallback')
