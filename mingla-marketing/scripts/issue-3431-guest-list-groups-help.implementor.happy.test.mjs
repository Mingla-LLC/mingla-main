#!/usr/bin/env node

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8')

const slug = 'build-your-guest-list-and-groups'
const route = `/help/${slug}`
const registry = read('content/help/registry.ts')
const verifier = read('scripts/verify-search-foundation.mjs')
const captions = read(`public/help/captions/${slug}.vtt`)

const recordStart = registry.indexOf(`    slug: '${slug}',`)
assert.notEqual(recordStart, -1, 'episode 19 must exist in the help registry')
const nextRecord = registry.indexOf('\n  {\n    slug:', recordStart + 1)
const recordsEnd = registry.indexOf('\n]\n', recordStart)
const record = registry.slice(recordStart, nextRecord === -1 ? recordsEnd : nextRecord)

const allSlugs = [...registry.matchAll(/^    slug: '([^']+)',$/gm)].map((match) => match[1])
const allEpisodes = [...registry.matchAll(/^    episode: (\d+),$/gm)].map((match) => Number(match[1]))
assert.equal(new Set(allSlugs).size, allSlugs.length, 'help slugs must stay unique')
assert.equal(new Set(allEpisodes).size, allEpisodes.length, 'help episode numbers must stay unique')
assert.equal(allSlugs.filter((candidate) => candidate === slug).length, 1, 'episode 19 slug must appear once')
assert.equal(allEpisodes.filter((episode) => episode === 19).length, 1, 'episode 19 number must appear once')

for (const [label, pattern] of [
  ['episode', /episode: 19,/],
  ['title', /title: 'Build your guest list and groups',/],
  ['duration', /duration: '1:40',/],
  ['ISO duration', /durationIso: 'PT1M40S',/],
  ['chapter', /chapter: 'selling',/],
  ['marketing intent', /intents: \['Market to customers'\],/],
  ['web surface', /surfaces: \['Web'\],/],
  ['Bamboo entry', /bambooEntryId: '0_r4uiil4e',/],
  ['upload date', /uploadedAt: '2026-10-06',/],
  ['caption availability', /hasCaptions: true,/],
]) {
  assert.match(record, pattern, `episode 19 must retain its ${label}`)
}

for (const [label, pattern] of [
  ['Blast People', /In Blast, open People/],
  ['your book', /Your book holds the people who gave your brand their details/],
  ['add a person', /Click Add, then type their name and an email or a phone number/],
  ['country before number', /pick the country first, then type the number/],
  ['add person button', /Click Add person/],
  ['CSV import', /click Import and choose a CSV file/],
  ['column matching', /matches your name, email and phone columns/],
  ['ignored columns', /Columns it does not need are ignored/],
  ['preview before adding', /The preview shows what will happen before anything is added/],
  ['permission to contact', /Confirm you have permission to contact them, then import/],
  ['create group', /Click Create group and name it/],
  ['select from book', /Select from Book/],
  ['nothing sent', /Nothing is sent now/],
  ['start campaign', /click Start campaign/],
  ['group as audience', /The group is already the audience/],
  ['email or SMS', /email or an SMS/],
  ['Host CTA', /https:\/\/usemingla\.com\/host/],
]) {
  assert.match(record, pattern, `episode 19 must state the truthful ${label}`)
}

assert.match(captions, /^WEBVTT\n/, 'episode 19 captions must be a WebVTT file')
assert.equal((captions.match(/ --> /g) ?? []).length, 37, 'episode 19 must expose all 37 caption cues')
assert.equal(
  createHash('sha256').update(captions).digest('hex'),
  'af634c3ec7b3ea27cef4d80286d005d36b4eb73b311dd5eedf1c265e0b2b6f8a',
  'episode 19 captions must stay byte-identical to the reviewed narrated r1 VTT',
)

const searchListEnd = verifier.indexOf('\n]\n\nconst releaseRouteScope')
const sitemapListStart = verifier.indexOf('const SITEMAP_SEARCH_READY_PATHS = [')
const sitemapListEnd = verifier.indexOf('\n]\n\nconst PUBLIC_NOINDEX_PATHS', sitemapListStart)
assert.match(verifier.slice(0, searchListEnd), new RegExp(`  '${route}',`), 'runtime search list must include episode 19')
assert.match(
  verifier.slice(sitemapListStart, sitemapListEnd),
  new RegExp(`  '${route}',`),
  'sitemap search list must include episode 19',
)
assert.equal(verifier.split(`'${route}'`).length - 1, 2, 'episode 19 must appear in exactly both hand-written search lists')

console.log('PASS #3431 episode 19 registry identity and filmed guest-list truths')
console.log('PASS #3431 episode 19 exact 37-cue narrated r1 caption asset')
console.log('PASS #3431 episode 19 runtime and sitemap search-ready lists')
