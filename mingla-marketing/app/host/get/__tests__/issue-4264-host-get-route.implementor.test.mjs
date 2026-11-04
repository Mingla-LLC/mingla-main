// #4264 — implementor happy-path test for usemingla.com/host/get.
//
// Runs the REAL route handler with no install: node strips the TypeScript
// types from app/host/get/route.ts and the lib modules it imports, the `@/lib`
// imports are pointed at those stripped copies, and GET() is called with a real
// Request. Expected URLs are read from lib/store-links.ts, never written here.
//
// Run from mingla-marketing/ (Node 22.13+):
//   node --test app/host/get/__tests__/issue-4264-host-get-route.implementor.test.mjs

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { stripTypeScriptTypes } from 'node:module'
import { after, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const MARKETING = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const ROUTE = path.join(MARKETING, 'app/host/get/route.ts')
const IMPORT = /from\s+'(@\/lib\/|\.\/)([\w-]+)'/g

const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

// Strip one module's types into `out`, then follow its lib imports.
function emit(sourcePath, outName, out, seen) {
  if (seen.has(outName)) return
  seen.add(outName)
  const source = fs.readFileSync(sourcePath, 'utf8')
  const deps = []
  const js = stripTypeScriptTypes(source).replace(IMPORT, (_m, _prefix, name) => {
    deps.push(name)
    return `from './${name}.mjs'`
  })
  fs.writeFileSync(path.join(out, `${outName}.mjs`), js)
  for (const name of deps) emit(path.join(MARKETING, 'lib', `${name}.ts`), name, out, seen)
}

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-4264-'))
emit(ROUTE, 'route', out, new Set())
after(() => fs.rmSync(out, { recursive: true, force: true }))
const route = await import(pathToFileURL(path.join(out, 'route.mjs')).href)
const links = await import(pathToFileURL(path.join(out, 'store-links.mjs')).href)

const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  ipad:
    'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  desktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  bot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
}

function get(ua) {
  const headers = ua === undefined ? {} : { 'user-agent': ua }
  return route.GET(new Request('https://usemingla.com/host/get', { headers }))
}

function assertOneLink(response) {
  assert.equal(response.status, 307)
  const location = new URL(response.headers.get('location'))
  assert.equal(`${location.origin}${location.pathname}`, links.BUSINESS_ONELINK_URL)
  assert.equal(location.searchParams.get('pid'), 'mingla_web')
  assert.equal(location.searchParams.get('c'), 'business_get')
}

function assertWeb(response) {
  assert.equal(response.status, 307)
  assert.equal(response.headers.get('location'), links.BUSINESS_WEB_URL)
}

test('iPhone and iPad go to the attributed business OneLink', () => {
  assertOneLink(get(UA.iphone))
  assertOneLink(get(UA.ipad))
})

test('Android goes to the attributed business OneLink', () => {
  assertOneLink(get(UA.android))
})

test('desktop Chrome goes to the Mingla Host web app', () => {
  assertWeb(get(UA.desktop))
})

test('an empty, missing or bot User-Agent goes to the web app', () => {
  assertWeb(get(''))
  assertWeb(get(undefined))
  assertWeb(get(UA.bot))
})

test('every answer is noindex, uncached and has no body', async () => {
  for (const ua of Object.values(UA)) {
    const response = get(ua)
    assert.equal(response.headers.get('x-robots-tag'), 'noindex')
    assert.match(response.headers.get('cache-control'), /no-store/)
    assert.equal(await response.text(), '')
  }
})

test('the route is dynamic, server-only and hardcodes no URL', () => {
  const src = stripComments(fs.readFileSync(ROUTE, 'utf8'))
  assert.match(src, /export const dynamic = 'force-dynamic'/)
  assert.match(src, /resolveBusinessAppTarget\(\s*platform\s*,\s*siteAttribution\('business_get'\)\s*\)/)
  assert.doesNotMatch(src, /https?:\/\//, 'URLs live in lib/store-links.ts only')
  assert.doesNotMatch(src, /usemingla\.com|apps\.apple\.com|play\.google\.com|onelink\.me/)
  assert.doesNotMatch(src, /\bnavigator\b|\bwindow\b/)
})

test('/host/get is never in the sitemap or the search route registry', () => {
  for (const rel of ['app/sitemap.ts', 'lib/search/route-registry.ts']) {
    const src = fs.readFileSync(path.join(MARKETING, rel), 'utf8')
    assert.doesNotMatch(src, /\/host\/get\b/, `${rel} must not list /host/get`)
  }
})
