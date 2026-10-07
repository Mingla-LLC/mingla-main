#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8')

const slug = 'build-your-menu'
const route = `/help/${slug}`
const registry = read('content/help/registry.ts')
const captions = read(`public/help/captions/${slug}.vtt`).replace(/\r\n/g, '\n')
const detailPage = read('app/help/[slug]/page.tsx')
const helpBrowser = read('components/help/help-browser.tsx')
const helpSchema = read('components/help/help-schema.tsx')
const routeRegistry = read('lib/search/route-registry.ts')

const recordStart = registry.indexOf(`    slug: '${slug}',`)
assert.notEqual(recordStart, -1, 'episode 18 must remain in the canonical help registry')
const nextRecord = registry.indexOf('\n  {\n    slug:', recordStart + 1)
const recordsEnd = registry.indexOf('\n]\n', recordStart)
const record = registry.slice(recordStart, nextRecord === -1 ? recordsEnd : nextRecord)

assert.deepEqual(
  [...record.matchAll(/^        title: '([^']+)',$/gm)].map((match) => match[1]),
  [
    'Open the Menu tab',
    'Add a Mains category',
    'Add a dish with a price and a private cost',
    'Allow notes and choose where it is made',
    'Add a required choice',
    'Add optional add-ons with their own prices',
    'Give a category a service window',
    'Let a smaller portion cost less',
    'Build the rest of the menu and put it in order',
    'Mark a dish 86',
    'Check your public menu',
    'Do the same on desktop',
  ],
  'episode 18 must keep the twelve written steps in the filmed journey order',
)

// Product truth: choices reach guests only when ordering through Mingla is on, and it is off by default.
const publicStep = record.slice(record.indexOf("title: 'Check your public menu'"))
assert.match(publicStep, /off by default/)
assert.match(publicStep, /only when ordering is on/)
assert.doesNotMatch(
  record,
  /guests (always|can always) (see|pick) (their |the )?choices|choices are always shown/i,
  'the guide must not claim guests see choices while ordering is off',
)
assert.doesNotMatch(record, /exactly two/i)
assert.doesNotMatch(record, /checkout|pay for (the|their) order/i, 'no checkout is shown in the video, so none may be claimed')
assert.doesNotMatch(record, /22:00–23:30|10 ?pm|11 ?pm/i, 'the service window must be written as 22:00–23:00')

const blocks = captions.trim().split(/\n{2,}/)
assert.equal(blocks.shift(), 'WEBVTT', 'caption sidecar must begin with a standalone WEBVTT header')
assert.equal(blocks.length, 68, 'caption sidecar must contain the reviewed 68 cues')

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
  assert(end <= 242_700, `caption cue ${offset + 1} must end within the reviewed 4:02.7 runtime`)
  assert(text.join(' ').trim(), `caption cue ${offset + 1} must contain spoken text`)
  previousEnd = end
  spokenLines.push(text.join(' ').trim())
}
// r3 re-timed the desktop phrases; the last cue must land on the r3 picture, not r2's shorter one.
assert.equal(previousEnd, 238_700, 'the last caption cue must end at 3:58.700, where the r3 picture ends')

const transcript = spokenLines.join(' ')
for (const [label, pattern] of [
  ['menu tab', /find the Menu tab/i],
  ['private cost', /Add what it costs you\. Only you see it\./i],
  ['required choice', /Pick one, and Required/i],
  ['optional add-ons', /Pick several and optional, up to three/i],
  ['service window', /ten to eleven at night, every day/i],
  ['smaller portion', /A smaller portion can cost less: type a minus/i],
  ['order saved', /Order saved/i],
  ['86', /eighty-six'd.*disappears from your public menu/i],
  ['demo ordering on', /For this demo, ordering is on/i],
  ['ordering off default', /Ordering is off by default, so your public menu shows dishes and prices/i],
  ['desktop', /Everything also works on desktop, at host\.usemingla\.com/i],
  ['desktop basket', /One item, twenty-eight dollars/i],
]) {
  assert.match(transcript, pattern, `caption track must narrate the ${label} contract`)
}
assert.doesNotMatch(transcript, /Mingler/, 'caption track must spell the brand correctly')

assert.match(detailPage, /generateStaticParams\(\)[\s\S]*HELP_VIDEOS\.map/)
assert.match(detailPage, /helpVideoForSlug\(slug\)/)
assert.match(detailPage, /video\.steps\.map/)
assert.match(detailPage, /captionsUrl=\{captions \?\? undefined\}/)
assert.match(helpBrowser, /\.\.\.v\.steps\.map\(\(s\) => `\$\{s\.title\} \$\{s\.body\}`\)/)
assert.match(helpSchema, /if \(!video\.bambooEntryId\) return null/)
assert.match(routeRegistry, /HELP_VIDEOS\.map\(\(record\) => \(\{[\s\S]*pathname: helpVideoPath\(record\.slug\)/)
assert.match(routeRegistry, /\.\.\.HELP_ROUTE_CONTRACTS,/)

assert.equal(route, '/help/build-your-menu')

console.log('PASS #3431 episode 18 ordering-off default, choices boundary and twelve-step menu journey')
console.log('PASS #3431 episode 18 WebVTT timing, r3 end alignment and narrated contracts')
console.log('PASS #3431 episode 18 static route, search projection and safe media fallback')
