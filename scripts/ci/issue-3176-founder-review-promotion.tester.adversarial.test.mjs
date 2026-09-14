#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const MARKETING = path.join(ROOT, 'mingla-marketing')
const marketingRequire = createRequire(path.join(MARKETING, 'package.json'))
const ts = marketingRequire('typescript')
const SELF_TEST = process.argv.includes('--self-test')
const REVIEW_AS_OF = '2026-09-12'

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8')
}

function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
}

function evaluate(source, requireOverride) {
  const module = { exports: {} }
  new Function('exports', 'module', 'require', transpile(source))(
    module.exports,
    module,
    requireOverride,
  )
  return module.exports
}

function loadRegistry(source) {
  return evaluate(source, (specifier) => {
    if (specifier === '../../lib/search/historical-city-build') {
      return { historicalCityBuildEnabled: () => false }
    }
    throw new Error(`Unexpected city registry dependency: ${specifier}`)
  })
}

function loadCorePages(source, registry) {
  return evaluate(source, (specifier) => {
    if (specifier === './cities/registry') return registry
    throw new Error(`Unexpected core-page dependency: ${specifier}`)
  })
}

function verifyOneBadReviewFailsTheWholeCohort(registrySource = read('mingla-marketing/content/cities/registry.ts')) {
  const registry = loadRegistry(registrySource)
  assert.equal(registry.CITY_HUBS.length, 10, 'the atomic launch cohort must contain exactly ten cities')

  const invalidCityIndex = 4
  const invalidCity = registry.CITY_HUBS[invalidCityIndex]
  invalidCity.localReview = {
    ...invalidCity.localReview,
    relationship: '',
  }

  assert.deepEqual(
    registry.cityHubReadinessReasons(invalidCity, { asOf: REVIEW_AS_OF })
      .filter((reason) => reason.code === 'reviewer_identity_incomplete')
      .map((reason) => reason.path),
    ['localReview'],
    'the isolated reviewer defect must be detected on the affected city',
  )

  const individuallyReadyOtherCities = registry.CITY_HUBS
    .filter((_, index) => index !== invalidCityIndex)
    .filter((city) => registry.isCityHubSearchReady(city, { asOf: REVIEW_AS_OF }))
  assert.equal(individuallyReadyOtherCities.length, 9, 'the other nine cities must remain individually ready so this exercises cohort atomicity')
  assert.equal(registry.allCityHubsSearchReady({ asOf: REVIEW_AS_OF }), false, 'one defective reviewer receipt must fail the whole cohort readiness gate')

  const effectiveCityLifecycles = registry.CITY_HUBS.map((city) => registry.cityHubEffectiveLifecycle(city))
  assert.deepEqual(
    effectiveCityLifecycles,
    Array(10).fill('public_noindex'),
    'one defective reviewer receipt must make all ten city routes fail closed together',
  )

  const corePages = loadCorePages(read('mingla-marketing/content/core-pages.ts'), registry).CORE_PAGES
  assert.deepEqual(
    Object.values(corePages).map((record) => [record.pathname, record.lifecycle]),
    [
      ['/about', 'public_noindex'],
      ['/explorer', 'public_noindex'],
      ['/cities', 'public_noindex'],
    ],
    'all three approved core routes must fail closed with the city cohort',
  )
}

verifyOneBadReviewFailsTheWholeCohort()

if (SELF_TEST) {
  const registrySource = read('mingla-marketing/content/cities/registry.ts')
  const cohortBypass = registrySource.replace(
    "(!isCityHubSearchReady(record) || !allCityHubsSearchReady())",
    "!isCityHubSearchReady(record)",
  )
  assert.notEqual(cohortBypass, registrySource, 'self-test must mutate the cohort-effective lifecycle owner')
  assert.throws(
    () => verifyOneBadReviewFailsTheWholeCohort(cohortBypass),
    /all ten city routes fail closed together/,
    'removing the cohort gate must prove RED',
  )
  process.stdout.write('RED proof: removing cohort atomicity exposed nine search-ready cities and was rejected\n')
}

process.stdout.write('PASS #3176 tester adversarial: one defective city review fails all ten cities and all three core routes closed\n')
