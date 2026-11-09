#!/usr/bin/env node
// #4339 — the historical (#2983) build must never share the webpack cache.
//
// Vercel restores the previous deploy's `.next/cache`, written by the RELEASE
// build. When the historical build (MINGLA_HISTORICAL_2983_BUILD=1) reused it,
// webpack served its cached city-route module, the HistoricalCityLayoutPlugin
// swap never ran, and prerender failed: "city page lagos: the release layout
// needs the catalogue and the weekend" (failed mingla-marketing deploys on
// 20c4431c4b and ffa8c46b8a). Reproduced locally by building release, keeping
// only `.next/cache`, then building historical; fixed by `cache = false` there.
//
// FAILS-ON-REVERT: deleting `webpackConfig.cache = false`, or moving it out of
// the historical branch, fails here. Runs in `prebuild`, so Vercel enforces it.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const raw = fs.readFileSync(path.join(root, 'next.config.ts'), 'utf8')
const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const fail = (msg) => {
  console.error(`FAIL #4339 historical build cache: ${msg}`)
  process.exit(1)
}
const branch = /if \(process\.env\.MINGLA_HISTORICAL_2983_BUILD === '1'\) \{([\s\S]*?)\n\s*\}/.exec(src)
if (!branch) fail('next.config.ts has no braced MINGLA_HISTORICAL_2983_BUILD branch in webpack()')
const body = branch[1]
if (!/webpackConfig\.plugins\.push\(new HistoricalCityLayoutPlugin\(\)\)/.test(body)) fail('the historical branch no longer installs HistoricalCityLayoutPlugin')
if (!/webpackConfig\.cache = false/.test(body)) fail('the historical branch must set webpackConfig.cache = false, or a restored release cache skips the city layout swap')
if (/webpackConfig\.cache = false/.test(src.replace(branch[0], ''))) fail('webpackConfig.cache = false appears outside the historical branch; the release build must keep its cache')
console.log('PASS #4339 the historical build never reads or writes the release webpack cache')
