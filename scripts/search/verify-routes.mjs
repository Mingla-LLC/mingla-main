#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { SYNTHETIC_CRAWLERS, assertHttpsOrigin, parseArgs, readJson } from './lib.mjs'

const args = parseArgs(process.argv.slice(2))
const scope = readJson('scripts/search/fixtures/release-route-scope.json')
const origin = assertHttpsOrigin(String(args.origin ?? scope.marketingOrigin))
const records = origin === scope.hostOrigin ? scope.host : scope.marketing
if (records.length === 0) process.stdout.write('No independently promoted Host documents are in the release scope.\n')

const canonical = (html) => html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i)?.[1] ?? null
const robots = (html, headers) => headers.get('x-robots-tag') ?? html.match(/<meta[^>]+name=["']robots["'][^>]+content=["']([^"']+)/i)?.[1] ?? ''
const result = []
for (const record of records) {
  const variants = {}
  for (const [crawler, userAgent] of Object.entries(SYNTHETIC_CRAWLERS)) {
    const response = await fetch(new URL(record.path, origin), { headers:{ 'user-agent':userAgent }, redirect:'manual' })
    const body = await response.text()
    variants[crawler] = { status:response.status, robots:robots(body,response.headers), canonical:canonical(body) }
  }
  const baseline = JSON.stringify(variants.browser)
  const parity = Object.entries(variants).every(([name,value]) => name==='browser' || JSON.stringify(value)===baseline)
  const expectedNoindex = record.lifecycle !== 'search_ready'
  assert.equal(variants.browser.status, 200, `${record.path} did not return 200`)
  assert.equal(/noindex/i.test(variants.browser.robots), expectedNoindex, `${record.path} robots disagrees with lifecycle`)
  assert(parity, `${record.path} synthetic crawler/browser parity failed`)
  result.push({ origin, path:record.path, expectedLifecycle:record.lifecycle, synthetic:true, parity, variants })
}
const json = `${JSON.stringify({ generatedAt:new Date().toISOString(), synthetic:true, results:result }, null, 2)}\n`
if (typeof args.output === 'string') fs.writeFileSync(args.output, json)
else process.stdout.write(json)
