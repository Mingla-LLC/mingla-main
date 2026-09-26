#!/usr/bin/env node

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8')

const slug = 'polish-your-listing-and-go-live'
const route = `/help/${slug}`
const registry = read('content/help/registry.ts')
const verifier = read('scripts/verify-search-foundation.mjs')
const captions = read(`public/help/captions/${slug}.vtt`)

const recordStart = registry.indexOf(`    slug: '${slug}',`)
assert.notEqual(recordStart, -1, 'episode 17 must exist in the help registry')
const nextRecord = registry.indexOf('\n  {\n    slug:', recordStart + 1)
const recordsEnd = registry.indexOf('\n]\n', recordStart)
const record = registry.slice(recordStart, nextRecord === -1 ? recordsEnd : nextRecord)

const allSlugs = [...registry.matchAll(/^    slug: '([^']+)',$/gm)].map((match) => match[1])
const allEpisodes = [...registry.matchAll(/^    episode: (\d+),$/gm)].map((match) => Number(match[1]))
assert.equal(new Set(allSlugs).size, allSlugs.length, 'help slugs must stay unique')
assert.equal(new Set(allEpisodes).size, allEpisodes.length, 'help episode numbers must stay unique')
assert.equal(allSlugs.filter((candidate) => candidate === slug).length, 1, 'episode 17 slug must appear once')
assert.equal(allEpisodes.filter((episode) => episode === 17).length, 1, 'episode 17 number must appear once')

for (const [label, pattern] of [
  ['episode', /episode: 17,/],
  ['title', /title: 'Polish your listing and go live',/],
  ['duration', /duration: '2:05',/],
  ['ISO duration', /durationIso: 'PT2M5S',/],
  ['chapter', /chapter: 'creating',/],
  ['venue intent', /intents: \['Run a venue'\],/],
  ['iOS surface', /surfaces: \['iOS'\],/],
  ['Bamboo entry', /bambooEntryId: '0_dmy8rvuu',/],
  ['upload date', /uploadedAt: '2026-09-26',/],
  ['caption availability', /hasCaptions: true,/],
]) {
  assert.match(record, pattern, `episode 17 must retain its ${label}`)
}

for (const [label, pattern] of [
  ['venue name', /Lantern Room/],
  ['initial status', /In review/],
  ['reservation setting', /reservations are on/],
  ['fees', /fees are off/],
  ['protected identity boundary', /Name, address and category are protected identity fields/],
  ['change request', /Request a change/],
  ['Sunday correction', /23:00 to 22:00/],
  ['saved hours action', /Save hours/],
  ['cover type', /real venue video/],
  ['gallery count', /six clear Lantern Room photos/],
  ['website', /https:\/\/lanternroom\.example/],
  ['typical spend', /\$25–\$75/],
  ['venue-fit answers', /groups, live music, reservations, meals, drinks, vegetarian options and service types/],
  ['save confirmation', /Changes saved/],
  ['review boundary', /listing remains In review while Mingla checks/],
  ['approved status', /green Live on Mingla badge/],
  ['category', /Restaurant category/],
  ['city', /New York location/],
  ['booking state', /Booking Available/],
  ['public Sunday hours', /Sunday 12:00–22:00/],
  ['guest action', /Reserve a table/],
]) {
  assert.match(record, pattern, `episode 17 must state the truthful ${label}`)
}

assert.match(captions, /^WEBVTT\n/, 'episode 17 captions must be a WebVTT file')
assert.equal((captions.match(/ --> /g) ?? []).length, 49, 'episode 17 must expose all 49 caption cues')
assert.equal(
  createHash('sha256').update(captions).digest('hex'),
  'c3d293ef035a90bb959eaaf773c63bc4b7b5a7b0708231110eecb740de3a3b76',
  'episode 17 captions must stay byte-identical to the reviewed r6 VTT',
)

const searchListEnd = verifier.indexOf('\n]\n\nconst releaseRouteScope')
const sitemapListStart = verifier.indexOf('const SITEMAP_SEARCH_READY_PATHS = [')
const sitemapListEnd = verifier.indexOf('\n]\n\nconst PUBLIC_NOINDEX_PATHS', sitemapListStart)
assert.match(verifier.slice(0, searchListEnd), new RegExp(`  '${route}',`), 'runtime search list must include episode 17')
assert.match(
  verifier.slice(sitemapListStart, sitemapListEnd),
  new RegExp(`  '${route}',`),
  'sitemap search list must include episode 17',
)
assert.equal(verifier.split(`'${route}'`).length - 1, 2, 'episode 17 must appear in exactly both hand-written search lists')

console.log('PASS #3431 episode 17 registry identity and filmed venue settings')
console.log('PASS #3431 episode 17 exact 49-cue r6 caption asset')
console.log('PASS #3431 episode 17 runtime and sitemap search-ready lists')
