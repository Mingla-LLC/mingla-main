#!/usr/bin/env node

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8')

const slug = 'send-a-campaign-to-a-group'
const route = `/help/${slug}`
const registry = read('content/help/registry.ts')
const verifier = read('scripts/verify-search-foundation.mjs')
const captions = read(`public/help/captions/${slug}.vtt`)

const recordStart = registry.indexOf(`    slug: '${slug}',`)
assert.notEqual(recordStart, -1, 'episode 20 must exist in the help registry')
const nextRecord = registry.indexOf('\n  {\n    slug:', recordStart + 1)
const recordsEnd = registry.indexOf('\n]\n', recordStart)
const record = registry.slice(recordStart, nextRecord === -1 ? recordsEnd : nextRecord)

const allSlugs = [...registry.matchAll(/^    slug: '([^']+)',$/gm)].map((match) => match[1])
const allEpisodes = [...registry.matchAll(/^    episode: (\d+),$/gm)].map((match) => Number(match[1]))
assert.equal(new Set(allSlugs).size, allSlugs.length, 'help slugs must stay unique')
assert.equal(new Set(allEpisodes).size, allEpisodes.length, 'help episode numbers must stay unique')
assert.equal(allSlugs.filter((candidate) => candidate === slug).length, 1, 'episode 20 slug must appear once')
assert.equal(allEpisodes.filter((episode) => episode === 20).length, 1, 'episode 20 number must appear once')

for (const [label, pattern] of [
  ['episode', /episode: 20,/],
  ['title', /title: 'Send a campaign to a group',/],
  ['duration', /duration: '1:40',/],
  ['ISO duration', /durationIso: 'PT1M40S',/],
  ['chapter', /chapter: 'selling',/],
  ['marketing intent', /intents: \['Market to customers'\],/],
  ['web surface', /surfaces: \['Web'\],/],
  ['Bamboo entry', /bambooEntryId: '0_rg1i0r09',/],
  ['upload date', /uploadedAt: '2026-10-07',/],
  ['caption availability', /hasCaptions: true,/],
]) {
  assert.match(record, pattern, `episode 20 must retain its ${label}`)
}

for (const [label, pattern] of [
  ['new campaign', /In Blast, start a new campaign, then pick an audience/],
  ['audience choices', /your whole book, a group, or an automatic group of buyers/],
  ['filmed audience', /the audience is the VIP guests group/],
  ['subject then email', /Write a subject, then the email itself/],
  ['formatting', /bold and italic/],
  ['event card', /Click \+ Event and choose one of your events/],
  ['event card contents', /the date and a Get tickets button/],
  ['link menu', /Open the three-dot menu and choose Link/],
  ['link words', /write the words your reader will see, then click Insert/],
  ['live preview', /The preview on the right shows the email as you write/],
  ['schedule', /pick a date and time with Schedule send/],
  ['review before send', /it shows the audience and how many people can be reached/],
  ['explicit send', /Nothing sends until you click Send now/],
  ['campaign report', /Open a sent campaign to see who it reached, deliveries, opens, link clicks, bounces and unsubscribes/],
  ['opens are an estimate', /Opens are an estimate, so treat them as a trend/],
  ['link clicks signal', /Link clicks are the stronger signal/],
  ['Host CTA', /https:\/\/usemingla\.com\/host/],
]) {
  assert.match(record, pattern, `episode 20 must state the truthful ${label}`)
}

assert.match(captions, /^WEBVTT\n/, 'episode 20 captions must be a WebVTT file')
assert.equal((captions.match(/ --> /g) ?? []).length, 36, 'episode 20 must expose all 36 caption cues')
assert.equal(
  createHash('sha256').update(captions).digest('hex'),
  '62a15d2bf309734ea80a5e0340cc910dd5c1966e9baa948bf16c6358bd52323a',
  'episode 20 captions must stay byte-identical to the reviewed narrated r1 VTT',
)

const searchListEnd = verifier.indexOf('\n]\n\nconst releaseRouteScope')
const sitemapListStart = verifier.indexOf('const SITEMAP_SEARCH_READY_PATHS = [')
const sitemapListEnd = verifier.indexOf('\n]\n\nconst PUBLIC_NOINDEX_PATHS', sitemapListStart)
assert.match(verifier.slice(0, searchListEnd), new RegExp(`  '${route}',`), 'runtime search list must include episode 20')
assert.match(
  verifier.slice(sitemapListStart, sitemapListEnd),
  new RegExp(`  '${route}',`),
  'sitemap search list must include episode 20',
)
assert.equal(verifier.split(`'${route}'`).length - 1, 2, 'episode 20 must appear in exactly both hand-written search lists')

console.log('PASS #3431 episode 20 registry identity and filmed campaign truths')
console.log('PASS #3431 episode 20 exact 36-cue narrated r1 caption asset')
console.log('PASS #3431 episode 20 runtime and sitemap search-ready lists')
