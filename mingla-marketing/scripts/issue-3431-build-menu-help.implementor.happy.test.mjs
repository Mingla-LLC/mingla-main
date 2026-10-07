#!/usr/bin/env node

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8')

const slug = 'build-your-menu'
const route = `/help/${slug}`
const registry = read('content/help/registry.ts')
const verifier = read('scripts/verify-search-foundation.mjs')
const captions = read(`public/help/captions/${slug}.vtt`)

const recordStart = registry.indexOf(`    slug: '${slug}',`)
assert.notEqual(recordStart, -1, 'episode 18 must exist in the help registry')
const nextRecord = registry.indexOf('\n  {\n    slug:', recordStart + 1)
const recordsEnd = registry.indexOf('\n]\n', recordStart)
const record = registry.slice(recordStart, nextRecord === -1 ? recordsEnd : nextRecord)

const allSlugs = [...registry.matchAll(/^    slug: '([^']+)',$/gm)].map((match) => match[1])
const allEpisodes = [...registry.matchAll(/^    episode: (\d+),$/gm)].map((match) => Number(match[1]))
assert.equal(new Set(allSlugs).size, allSlugs.length, 'help slugs must stay unique')
assert.equal(new Set(allEpisodes).size, allEpisodes.length, 'help episode numbers must stay unique')
assert.equal(allSlugs.filter((candidate) => candidate === slug).length, 1, 'episode 18 slug must appear once')
assert.equal(allEpisodes.filter((episode) => episode === 18).length, 1, 'episode 18 number must appear once')

for (const [label, pattern] of [
  ['episode', /episode: 18,/],
  ['title', /title: 'Build your menu',/],
  ['duration', /duration: '4:03',/],
  ['ISO duration', /durationIso: 'PT4M3S',/],
  ['chapter', /chapter: 'creating',/],
  ['venue intent', /intents: \['Run a venue'\],/],
  ['web and iOS surfaces', /surfaces: \['Web', 'iOS'\],/],
  ['Bamboo entry', /bambooEntryId: '0_[a-z0-9]{8}',/],
  ['upload date', /uploadedAt: '2026-10-05',/],
  ['caption availability', /hasCaptions: true,/],
]) {
  assert.match(record, pattern, `episode 18 must retain its ${label}`)
}

for (const [label, pattern] of [
  ['venue name', /Lantern Room/],
  ['menu tab', /Menu/],
  ['category', /Mains/],
  ['guest line', /line guests see/],
  ['dish', /Lantern Burger/],
  ['guest price', /\$22/],
  ['private cost', /only you see it/],
  ['notes', /Let guests add a note/],
  ['kitchen', /Kitchen/],
  ['required choice', /Pick one and Required/],
  ['optional add-ons', /Pick several and optional, up to three/],
  ['priced add-ons', /own price/],
  ['service window', /22:00–23:00, every day/],
  ['smaller portion', /A smaller portion can cost less: type a minus/],
  ['order saved', /Order saved/],
  ['86 removes from public menu', /86\\'d and it disappears from your public menu/],
  ['ordering off by default', /Ordering through Mingla is off by default/],
  ['public menu with ordering off', /dishes, their descriptions and prices/],
  ['choices only with ordering on', /Choices are shown to guests only when ordering is on/],
  ['burger total', /\$28/],
  ['desktop', /host\.usemingla\.com/],
]) {
  assert.match(record, pattern, `episode 18 must state the truthful ${label}`)
}
assert.doesNotMatch(record, /exactly two/i, 'episode 18 must not claim exactly two of anything')

assert.match(captions, /^WEBVTT\n/, 'episode 18 captions must be a WebVTT file')
assert.equal((captions.match(/ --> /g) ?? []).length, 68, 'episode 18 must expose all 68 caption cues')
assert.equal(
  createHash('sha256').update(captions).digest('hex'),
  'c5fc87523edd5cc134f519a9a1f12a9108400a4a60abeeb63192c4e40acf13b2',
  'episode 18 captions must stay byte-identical to the reviewed narrated r3 VTT',
)

const searchListEnd = verifier.indexOf('\n]\n\nconst releaseRouteScope')
const sitemapListStart = verifier.indexOf('const SITEMAP_SEARCH_READY_PATHS = [')
const sitemapListEnd = verifier.indexOf('\n]\n\nconst PUBLIC_NOINDEX_PATHS', sitemapListStart)
assert.match(verifier.slice(0, searchListEnd), new RegExp(`  '${route}',`), 'runtime search list must include episode 18')
assert.match(
  verifier.slice(sitemapListStart, sitemapListEnd),
  new RegExp(`  '${route}',`),
  'sitemap search list must include episode 18',
)
assert.equal(verifier.split(`'${route}'`).length - 1, 2, 'episode 18 must appear in exactly both hand-written search lists')

console.log('PASS #3431 episode 18 registry identity and filmed menu builder truths')
console.log('PASS #3431 episode 18 exact 68-cue narrated r3 caption asset')
console.log('PASS #3431 episode 18 runtime and sitemap search-ready lists')
