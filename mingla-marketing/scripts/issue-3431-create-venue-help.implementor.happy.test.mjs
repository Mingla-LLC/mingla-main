#!/usr/bin/env node

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8')

const slug = 'create-and-submit-your-venue'
const route = `/help/${slug}`
const registry = read('content/help/registry.ts')
const verifier = read('scripts/verify-search-foundation.mjs')
const captions = read(`public/help/captions/${slug}.vtt`)

const recordStart = registry.indexOf(`    slug: '${slug}',`)
assert.notEqual(recordStart, -1, 'episode 16 must exist in the help registry')
const nextRecord = registry.indexOf('\n  {\n    slug:', recordStart + 1)
const recordsEnd = registry.indexOf('\n]\n', recordStart)
const record = registry.slice(recordStart, nextRecord === -1 ? recordsEnd : nextRecord)

const allSlugs = [...registry.matchAll(/^    slug: '([^']+)',$/gm)].map((match) => match[1])
const allEpisodes = [...registry.matchAll(/^    episode: (\d+),$/gm)].map((match) => Number(match[1]))
assert.equal(new Set(allSlugs).size, allSlugs.length, 'help slugs must stay unique')
assert.equal(new Set(allEpisodes).size, allEpisodes.length, 'help episode numbers must stay unique')
assert.equal(allSlugs.filter((candidate) => candidate === slug).length, 1, 'episode 16 slug must appear once')
assert.equal(allEpisodes.filter((episode) => episode === 16).length, 1, 'episode 16 number must appear once')

for (const [label, pattern] of [
  ['episode', /episode: 16,/],
  ['title', /title: 'Create and submit your venue',/],
  ['duration', /duration: '2:38',/],
  ['ISO duration', /durationIso: 'PT2M38S',/],
  ['chapter', /chapter: 'creating',/],
  ['venue intent', /intents: \['Run a venue'\],/],
  ['iOS surface', /surfaces: \['iOS'\],/],
  ['Bamboo entry', /bambooEntryId: '0_btn0u3q2',/],
  ['upload date', /uploadedAt: '2026-09-25',/],
  ['caption availability', /hasCaptions: true,/],
]) {
  assert.match(record, pattern, `episode 16 must retain its ${label}`)
}

for (const [label, pattern] of [
  ['venue name', /Lantern Room/],
  ['directory check', /check the venue directory/],
  ['fresh listing boundary', /create from scratch/],
  ['category', /Restaurant/],
  ['address', /61 Wythe Avenue/],
  ['city', /Brooklyn, New York/],
  ['public link', /public-page address/],
  ['weekday hours', /Monday to Friday at 17:00–23:00/],
  ['weekend hours', /Saturday and Sunday at 12:00–23:00/],
  ['gallery count', /six existing Lantern Room venue photos/],
  ['cover type', /short venue video/],
  ['cover ready state', /green ready confirmation/],
  ['single video boundary', /one video, not a two-picture selection/],
  ['contact details', /public phone, email and website/],
  ['typical spend', /\$25–\$75/],
  ['reservations', /turn reservations on/],
  ['review action', /Submit for review/],
  ['not-live boundary', /listing is not live yet/],
  ['status', /Venue Hub shows In review/],
  ['saved proof', /saved weekday and weekend hours/],
]) {
  assert.match(record, pattern, `episode 16 must state the truthful ${label}`)
}

assert.match(captions, /^WEBVTT\n/, 'episode 16 captions must be a WebVTT file')
assert.equal((captions.match(/ --> /g) ?? []).length, 39, 'episode 16 must expose all 39 caption cues')
assert.equal(
  createHash('sha256').update(captions).digest('hex'),
  'db15054f3080e38c7a1cce025f7c7228b5fe3035931f05ff1006e4af0816083d',
  'episode 16 captions must stay byte-identical to the reviewed r4 VTT',
)

const searchListEnd = verifier.indexOf('\n]\n\nconst releaseRouteScope')
const sitemapListStart = verifier.indexOf('const SITEMAP_SEARCH_READY_PATHS = [')
const sitemapListEnd = verifier.indexOf('\n]\n\nconst PUBLIC_NOINDEX_PATHS', sitemapListStart)
assert.match(verifier.slice(0, searchListEnd), new RegExp(`  '${route}',`), 'runtime search list must include episode 16')
assert.match(
  verifier.slice(sitemapListStart, sitemapListEnd),
  new RegExp(`  '${route}',`),
  'sitemap search list must include episode 16',
)
assert.equal(verifier.split(`'${route}'`).length - 1, 2, 'episode 16 must appear in exactly both hand-written search lists')

console.log('PASS #3431 episode 16 registry identity and filmed venue settings')
console.log('PASS #3431 episode 16 exact 39-cue r4 caption asset')
console.log('PASS #3431 episode 16 runtime and sitemap search-ready lists')
