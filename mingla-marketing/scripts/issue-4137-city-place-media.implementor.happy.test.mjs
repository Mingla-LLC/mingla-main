#!/usr/bin/env node
// #4137 wave 2 — implementor happy path (source): /api/city-place-media.
//
// Seth's 27 Oct 2026 decision means city pages no longer call this route (they
// show stored thumbnails). It still serves the internal page-system routes, so
// it is hardened in case a Google key is ever added:
//   AC-A1  listed places only: an unlisted, well-formed id answers 404
//          `unlisted_place` with ZERO outbound fetches; no key answers
//          `provider_not_configured`, private, no-store.
//   AC-A2  success is cached only in the visitor's browser (private,
//          max-age=900, no s-maxage, no stale-while-revalidate); missing author
//          attribution or a non-https Maps link yields no_photo; a Google call
//          that exceeds 5s yields no_photo/provider_timeout.
// Fails on revert: the old route accepts any id and sets s-maxage=604800.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const catalogue = JSON.parse(read('content/cities/catalogues.generated.json'))

function load(relative, modules) {
  const compiled = ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const module = { exports: {} }
  const require = (id) => {
    if (!(id in modules)) throw new Error(`#4137 test: unexpected import ${id} from ${relative}`)
    return modules[id]
  }
  Function('module', 'exports', 'require', compiled)(module, module.exports, require)
  return module.exports
}

const shared = { EXPLORER_CATEGORIES: [...read('content/page-system/shared.ts').matchAll(/\{ slug: '([a-z_]+)', label: '([^']+)' \}/g)].map(([, slug, label]) => ({ slug, label })) }
const catalogueServer = load('lib/page-system/city-catalogue.server.ts', {
  'server-only': {},
  '@/content/cities/catalogues.generated.json': catalogue,
  '@/lib/lagos-intent-plans': { LAGOS_INTENT_PLANS: [] },
  '@/content/page-system/shared': shared,
  '@/lib/search/historical-city-build': { historicalCityBuildEnabled: () => false },
})
const listed = catalogueServer.listedGooglePlaceIds()
const allIds = Object.values(catalogue.cities).flatMap((city) => city.places.map((place) => place.googlePlaceId))
assert.equal(listed.size, new Set(allIds).size, '#4137: every listed city place is allowed')
for (const id of allIds) assert(listed.has(id), `#4137: ${id} must be allowed`)

class FakeResponse {
  constructor(body, init = {}) { this.body = body; this.status = init.status ?? 200; this.headers = new Map(Object.entries(init.headers ?? {})) }
}
const route = load('app/api/city-place-media/route.ts', {
  'next/server': { NextResponse: { json: (body, init) => new FakeResponse(body, init) } },
  '@/lib/page-system/city-catalogue.server': catalogueServer,
})
const LISTED = 'ChIJF1nRfeb0rIkRcOIaLLNq5jc'
assert(listed.has(LISTED), '#4137: the Raleigh probe place must be listed')
const UNLISTED = 'ChIJ_definitely_not_listed_123'
const get = (placeId) => route.GET({ nextUrl: new URL(`https://usemingla.com/api/city-place-media?placeId=${encodeURIComponent(placeId)}`) })

let calls = []
let responder = () => { throw new Error('unexpected fetch') }
globalThis.fetch = async (url, init) => { calls.push(String(url)); return responder(String(url), init) }
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

// AC-A1
delete process.env.GOOGLE_MAPS_API_KEY
let response = await get(LISTED)
assert.equal(response.status, 200)
assert.equal(response.body.status, 'no_photo')
assert.equal(response.body.reason, 'provider_not_configured')
assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
process.env.GOOGLE_MAPS_API_KEY = 'test-key-not-real'
calls = []
response = await get(UNLISTED)
assert.equal(response.status, 404, '#4137 AC-A1: unlisted ids are refused')
assert.deepEqual(response.body, { error: 'unlisted_place' })
assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
assert.equal(calls.length, 0, '#4137 AC-A1: no Google call for an unlisted place')
assert.equal((await get('bad id!')).status, 400)

// AC-A2 success
const goodPlace = { googleMapsUri: 'https://maps.google.com/?cid=1', photos: [{ name: 'places/x/photos/y', authorAttributions: [{ displayName: 'A. Person', uri: 'https://maps.google.com/contrib/1' }] }] }
responder = (url) => url.includes('/media?') ? json({ photoUri: 'https://lh3.googleusercontent.com/p' }) : json(goodPlace)
calls = []
response = await get(LISTED)
assert.equal(response.body.status, 'current')
assert.equal(calls.length, 2)
const cache = response.headers.get('Cache-Control')
assert.equal(cache, 'private, max-age=900', '#4137 AC-A2: browser-only cache')
assert.doesNotMatch(cache, /s-maxage|stale-while-revalidate|public/, '#4137 AC-A2: no shared CDN copy of Google content')

// AC-A2 attribution failures
responder = () => json({ ...goodPlace, photos: [{ name: 'places/x/photos/y', authorAttributions: [] }] })
assert.equal((await get(LISTED)).body.reason, 'current_attribution_unavailable')
responder = () => json({ ...goodPlace, googleMapsUri: 'http://maps.google.com/?cid=1' })
response = await get(LISTED)
assert.equal(response.body.status, 'no_photo')
assert.equal(response.headers.get('Cache-Control'), 'private, no-store')

// AC-A2 timeout: the route must pass a timeout signal, and a timeout yields no_photo.
responder = (url, init) => {
  assert(init?.signal instanceof AbortSignal, '#4137 AC-A2: every Google call carries a timeout signal')
  throw new DOMException('The operation timed out.', 'TimeoutError')
}
response = await get(LISTED)
assert.equal(response.body.reason, 'provider_timeout', '#4137 AC-A2: a slow Google call yields provider_timeout')
assert.match(read('app/api/city-place-media/route.ts'), /PROVIDER_TIMEOUT_MS = 5_000/)

process.stdout.write('PASS #4137 city place media: listed places only with zero outbound calls otherwise (AC-A1), browser-only cache, attribution and 5s timeout guards (AC-A2)\n')
