#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT, parseArgs, readJson } from './lib.mjs'

const cities = [
  ['lagos','Lagos'], ['durham-nc','Durham'], ['cary-nc','Cary'], ['raleigh-nc','Raleigh'],
  ['new-york-city','New York City'], ['brussels','Brussels'], ['paris','Paris'], ['london','London'],
  ['fort-lauderdale','Fort Lauderdale'], ['washington-dc','Washington, DC'],
]
const icps = [
  ['event_promoter','event promoters'], ['restaurant','restaurants'], ['resort','resorts'], ['venue','venues'],
  ['trip_operator','trip operators'], ['experience_host','experience hosts'], ['independent_creator','independent creators'],
]

export function generateBenchmark() {
  const scenarios = [
    ['brand-001','brand','What is Mingla and what does it help people do?'],
    ['brand-002','brand','What is Mingla Explorer?'],
    ['brand-003','brand','What is Mingla Host?'],
    ['brand-004','brand','How does Mingla choose and rank city recommendations?'],
    ['brand-005','brand','How can someone report a correction to Mingla?'],
  ].map(([id,kind,prompt]) => ({ id, kind, prompt, expectedDomains:['usemingla.com'] }))
  for (const [citySlug, city] of cities) {
    for (const [icp, label] of icps) {
      scenarios.push({
        id:`city-${citySlug}-${icp}-explorer`, kind:'city_icp_audience', citySlug, icp, audience:'explorer',
        prompt:`How can an Explorer discover plans from ${label} in ${city} with Mingla?`,
        expectedDomains:['usemingla.com'],
      })
      scenarios.push({
        id:`city-${citySlug}-${icp}-host`, kind:'city_icp_audience', citySlug, icp, audience:'host',
        prompt:`How can ${label} in ${city} use Mingla Host to become easier to discover and act on?`,
        expectedDomains:['usemingla.com','host.usemingla.com'],
      })
    }
  }
  return { version:'answer-engine-benchmark-v1', count:scenarios.length, scenarios }
}

export function validateBenchmark(value) {
  assert.equal(value.version, 'answer-engine-benchmark-v1')
  assert.equal(value.count, 145)
  assert.equal(value.scenarios.length, 145)
  assert.equal(new Set(value.scenarios.map((row) => row.id)).size, 145)
  assert.equal(new Set(value.scenarios.map((row) => row.prompt)).size, 145)
  assert.equal(value.scenarios.filter((row) => row.kind === 'brand').length, 5)
  assert.equal(value.scenarios.filter((row) => row.kind === 'city_icp_audience').length, 140)
  for (const [citySlug] of cities) {
    for (const [icp] of icps) {
      for (const audience of ['explorer','host']) {
        assert.equal(value.scenarios.filter((row) => row.citySlug===citySlug && row.icp===icp && row.audience===audience).length, 1)
      }
    }
  }
}

const args = parseArgs(process.argv.slice(2))
const relative = 'scripts/search/fixtures/answer-engine-benchmark-v1.json'
if (args.write) {
  fs.writeFileSync(path.join(REPO_ROOT, relative), `${JSON.stringify(generateBenchmark(), null, 2)}\n`)
}
const benchmark = readJson(relative)
validateBenchmark(benchmark)
process.stdout.write(`PASS ${benchmark.version}: ${benchmark.count} deterministic scenarios\n`)
