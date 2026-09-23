#!/usr/bin/env node

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8')

const slug = 'create-an-unlisted-rsvp-event-in-nigeria'
const route = `/help/${slug}`
const registry = read('content/help/registry.ts')
const verifier = read('scripts/verify-search-foundation.mjs')
const captions = read(`public/help/captions/${slug}.vtt`)

const recordStart = registry.indexOf(`    slug: '${slug}',`)
assert.notEqual(recordStart, -1, 'episode 14 must exist in the help registry')
const nextRecord = registry.indexOf('\n  {\n    slug:', recordStart + 1)
const recordsEnd = registry.indexOf('\n]\n', recordStart)
const record = registry.slice(recordStart, nextRecord === -1 ? recordsEnd : nextRecord)

const allSlugs = [...registry.matchAll(/^    slug: '([^']+)',$/gm)].map((match) => match[1])
const allEpisodes = [...registry.matchAll(/^    episode: (\d+),$/gm)].map((match) => Number(match[1]))
assert.equal(new Set(allSlugs).size, allSlugs.length, 'help slugs must stay unique')
assert.equal(new Set(allEpisodes).size, allEpisodes.length, 'help episode numbers must stay unique')
assert.equal(allSlugs.filter((candidate) => candidate === slug).length, 1, 'episode 14 slug must appear once')
assert.equal(allEpisodes.filter((episode) => episode === 14).length, 1, 'episode 14 number must appear once')

for (const [label, pattern] of [
  ['episode', /episode: 14,/],
  ['title', /title: 'Create an unlisted RSVP event in Nigeria',/],
  ['duration', /duration: '2:33',/],
  ['ISO duration', /durationIso: 'PT2M33S',/],
  ['chapter', /chapter: 'creating',/],
  ['RSVP intent', /intents: \['Take RSVPs'\],/],
  ['iOS surface', /surfaces: \['iOS'\],/],
  ['truthful pending Bamboo id', /bambooEntryId: null,/],
  ['upload date', /uploadedAt: '2026-09-23',/],
  ['caption availability', /hasCaptions: true,/],
]) {
  assert.match(record, pattern, `episode 14 must retain its ${label}`)
}

for (const [label, pattern] of [
  ['RSVP event type', /RSVP event/],
  ['name', /Members' Table: November/],
  ['vibes', /Intimate, Classy and Exclusive/],
  ['genres', /Afrobeats, R and B, and Jazz/],
  ['reviewed description', /every RSVP is reviewed/],
  ['date', /Saturday 7 November 2026/],
  ['time', /19:00 to 23:00/],
  ['timezone', /Africa\/Lagos/],
  ['venue', /Harmattan Club/],
  ['hidden address', /leave Hide address on/],
  ['dinner video', /dinner video/],
  ['three photos', /three photos/],
  ['capacity', /guest list to 40/],
  ['extras off', /keep extras off/],
  ['waitlist', /start a waitlist/],
  ['manual approval', /Approve each RSVP/],
  ['suggested chip-in', /suggest ₦500/],
  ['minimum chip-in', /set ₦100 as the minimum/],
  ['optional contribution', /still optional/],
  ['private guest list', /Keep the guest list private/],
  ['hidden spots-left', /hide the spots-left count/],
  ['Unlisted visibility', /Choose Unlisted/],
  ['discovery off', /leave the discovery feed off/],
  ['publish and share', /publish, then share the live link directly/],
  ['link boundary', /Unlisted is link-based, not identity-gated/],
  ['public result', /live page keeps both the address and spots-left count hidden/],
]) {
  assert.match(record, pattern, `episode 14 must state the truthful ${label} setting`)
}

assert.match(captions, /^WEBVTT\n/, 'episode 14 captions must be a WebVTT file')
assert.equal((captions.match(/ --> /g) ?? []).length, 49, 'episode 14 must expose all 49 caption cues')
assert.equal(
  createHash('sha256').update(captions).digest('hex'),
  'c829668b2e03ac8d5b534517c2d4318846183187d6fc9136b1d547cf339df427',
  'episode 14 captions must stay byte-identical to the reviewed final VTT',
)

const searchListEnd = verifier.indexOf('\n]\n\nconst releaseRouteScope')
const sitemapListStart = verifier.indexOf('const SITEMAP_SEARCH_READY_PATHS = [')
const sitemapListEnd = verifier.indexOf('\n]\n\nconst PUBLIC_NOINDEX_PATHS', sitemapListStart)
assert.match(verifier.slice(0, searchListEnd), new RegExp(`  '${route}',`), 'runtime search list must include episode 14')
assert.match(
  verifier.slice(sitemapListStart, sitemapListEnd),
  new RegExp(`  '${route}',`),
  'sitemap search list must include episode 14',
)
assert.equal(verifier.split(`'${route}'`).length - 1, 2, 'episode 14 must appear in exactly both hand-written search lists')

console.log('PASS #3431 episode 14 registry identity and settings')
console.log('PASS #3431 episode 14 exact 49-cue caption asset')
console.log('PASS #3431 episode 14 runtime and sitemap search-ready lists')
