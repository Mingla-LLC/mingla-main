#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

const hub = read('components/cities/city-hub.tsx')
const registry = read('content/cities/registry.ts')
const packageJson = JSON.parse(read('package.json'))
const hero = hub.match(/function CityHero\b[\s\S]*?(?=\nfunction CityAudienceFork\b)/)?.[0]
const evidencePanel = hub.match(/function CityEvidencePanel\b[\s\S]*?(?=\nfunction CityNavigator\b)/)?.[0]

assert(hero, 'CityHero function must remain present')
assert.doesNotMatch(hero, /<EvidenceLinks\b/, 'the city hero must not show source-link metadata')
assert.doesNotMatch(hero, /city-coverage|\bCoverage:|\bLast reviewed\b/, 'the city hero must not show review metadata')
assert.doesNotMatch(hero, /sourcesCheckedAt|formatDate\(/, 'the city hero must not calculate removed review metadata')

assert.match(hub, /function EvidenceLinks\b/, 'shared evidence links must remain available outside the hero')
assert.doesNotMatch(
  hub,
  /<EvidenceLinks record=\{record\} evidenceIds=\{record\.directAnswerEvidenceIds\} \/>/,
  'the removed direct-answer Sources row must not be relocated elsewhere in the CityHub presentation',
)
assert(evidencePanel, 'the evidence panel must remain present')
assert.match(evidencePanel, /record\.sourcesCheckedAt/)
assert.match(evidencePanel, /formatDate\(record\.sourcesCheckedAt, record\.locale\)/)
assert.match(evidencePanel, /record\.sources\.map\(\(entry, index\) => \(/, 'the full evidence source list must remain')
assert.match(registry, /readonly directAnswerEvidenceIds:/, 'direct-answer evidence ownership must remain in city data')
assert.match(registry, /readonly sourcesCheckedAt:/, 'review-date evidence must remain in city data')
assert.match(registry, /directAnswer: \[normalizedContent\(record\.directAnswer\), \[\.\.\.record\.directAnswerEvidenceIds\]\]/)
assert.match(
  packageJson.scripts.build,
  /issue-2983-city-hero-metadata-removal\.implementor\.happy\.test\.mjs/,
  'the city hero cleanup contract must run in the production build gate',
)
assert.equal(
  packageJson.scripts['test:city-hero-metadata-removal'],
  'node scripts/issue-2983-city-hero-metadata-removal.implementor.happy.test.mjs',
)

process.stdout.write('PASS #2983 city hero removes review metadata while evidence remains owned below the fold\n')
