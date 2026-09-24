#!/usr/bin/env node

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8')

const slug = 'create-a-recurring-event-in-nigeria'
const route = `/help/${slug}`
const registry = read('content/help/registry.ts')
const verifier = read('scripts/verify-search-foundation.mjs')
const captions = read(`public/help/captions/${slug}.vtt`)

const recordStart = registry.indexOf(`    slug: '${slug}',`)
assert.notEqual(recordStart, -1, 'episode 15 must exist in the help registry')
const nextRecord = registry.indexOf('\n  {\n    slug:', recordStart + 1)
const recordsEnd = registry.indexOf('\n]\n', recordStart)
const record = registry.slice(recordStart, nextRecord === -1 ? recordsEnd : nextRecord)

const allSlugs = [...registry.matchAll(/^    slug: '([^']+)',$/gm)].map((match) => match[1])
const allEpisodes = [...registry.matchAll(/^    episode: (\d+),$/gm)].map((match) => Number(match[1]))
assert.equal(new Set(allSlugs).size, allSlugs.length, 'help slugs must stay unique')
assert.equal(new Set(allEpisodes).size, allEpisodes.length, 'help episode numbers must stay unique')
assert.equal(allSlugs.filter((candidate) => candidate === slug).length, 1, 'episode 15 slug must appear once')
assert.equal(allEpisodes.filter((episode) => episode === 15).length, 1, 'episode 15 number must appear once')

for (const [label, pattern] of [
  ['episode', /episode: 15,/],
  ['title', /title: 'Create a recurring event in Nigeria',/],
  ['duration', /duration: '2:40',/],
  ['ISO duration', /durationIso: 'PT2M40S',/],
  ['chapter', /chapter: 'creating',/],
  ['ticket intent', /intents: \['Sell tickets'\],/],
  ['iOS surface', /surfaces: \['iOS'\],/],
  ['Bamboo entry', /bambooEntryId: '0_vorph0mx',/],
  ['upload date', /uploadedAt: '2026-09-24',/],
  ['caption availability', /hasCaptions: true,/],
]) {
  assert.match(record, pattern, `episode 15 must retain its ${label}`)
}

for (const [label, pattern] of [
  ['event name', /Sunday Rooftop Sessions/],
  ['event type', /Club Night/],
  ['moods', /Social, Vibrant and Laid-back/],
  ['genres', /Afrobeats, Afro House and Amapiano/],
  ['keyboard-free description proof', /Close the keyboard and review the complete rooftop description/],
  ['start date', /Sunday 18 October 2026/],
  ['time', /19:00 to 23:00/],
  ['weekly recurrence', /repeat every Sunday/],
  ['occurrence count', /eight occurrences/],
  ['timezone', /Africa\/Lagos/],
  ['venue', /Harmattan Club/],
  ['hidden address', /leave Hide address on/],
  ['cover type', /static cover/],
  ['gallery count', /three gallery photos/],
  ['theme', /warm orange theme/],
  ['font', /Poppins/],
  ['reveal', /Shimmer reveal/],
  ['ticket name', /Rooftop Pass/],
  ['ticket price', /₦100/],
  ['capacity', /60 tickets per night/],
  ['sales channels', /online and at the door/],
  ['waitlist', /enable the waitlist/],
  ['buyer limit', /limit each buyer to four/],
  ['transfers', /allow transfers/],
  ['Paystack', /paid through Paystack/],
  ['Public visibility', /keep the event Public/],
  ['approval disabled', /Leave approval off/],
  ['in-person payments', /in-person payments on/],
  ['hidden remaining count', /hide the remaining ticket count/],
  ['recurring publish dialog', /all eight occurrences will be created together/],
  ['live schedule proof', /choose from eight Sundays/],
  ['live address proof', /street address remains private until they get tickets/],
]) {
  assert.match(record, pattern, `episode 15 must state the truthful ${label} setting`)
}

assert.match(captions, /^WEBVTT\n/, 'episode 15 captions must be a WebVTT file')
assert.equal((captions.match(/ --> /g) ?? []).length, 52, 'episode 15 must expose all 52 caption cues')
assert.equal(
  createHash('sha256').update(captions).digest('hex'),
  '0e88eb1c5a0ca0b78e3510fd01899a1c5a7d1845c827b0627b7efca53f1c03bc',
  'episode 15 captions must stay byte-identical to the reviewed final VTT',
)

const searchListEnd = verifier.indexOf('\n]\n\nconst releaseRouteScope')
const sitemapListStart = verifier.indexOf('const SITEMAP_SEARCH_READY_PATHS = [')
const sitemapListEnd = verifier.indexOf('\n]\n\nconst PUBLIC_NOINDEX_PATHS', sitemapListStart)
assert.match(verifier.slice(0, searchListEnd), new RegExp(`  '${route}',`), 'runtime search list must include episode 15')
assert.match(
  verifier.slice(sitemapListStart, sitemapListEnd),
  new RegExp(`  '${route}',`),
  'sitemap search list must include episode 15',
)
assert.equal(verifier.split(`'${route}'`).length - 1, 2, 'episode 15 must appear in exactly both hand-written search lists')

console.log('PASS #3431 episode 15 registry identity and filmed settings')
console.log('PASS #3431 episode 15 exact 52-cue caption asset')
console.log('PASS #3431 episode 15 runtime and sitemap search-ready lists')
