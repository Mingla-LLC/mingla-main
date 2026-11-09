#!/usr/bin/env node
// #4339 speed budget — the first-load JavaScript of every redesigned route,
// read from the production build (.next), and the libraries that must never
// ship with them.
//
//   node scripts/issue-4339-first-load-budget.mjs            the built check
//   node scripts/issue-4339-first-load-budget.mjs --self-test the arithmetic on a fixture
//
// First-load JS of a route is measured exactly as `next build` prints "First
// Load JS" (the numbers the budget was set against): the distinct scripts of
// the page's client entry in app-build-manifest.json plus the shared runtime
// (build-manifest rootMainFiles), each gzipped at level 9, in kB of 1,000
// bytes. The budget is Seth's 130 KB (8 Nov, #4339): strictly under 130,000.
//
// `next build` leaves out the root layout's own chunks (the consent banner,
// GA and the analytics provider, ~8 kB, shared by every page). They load too,
// so the report prints the total with layouts beside the budgeted number.
//
// Also pinned: the city route no longer imports the historical #2983 layout,
// so framer-motion never ships with it (nor with any other redesigned route).
//
// Invariant (#4339): every route in BUDGET_ROUTES stays under FIRST_LOAD_BUDGET_BYTES
// first-load gzip; no BUDGET_ROUTES route ships framer-motion. Enforced in the
// marketing `npm run build` chain after the release build.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const FIRST_LOAD_BUDGET_BYTES = 130_000

/** The redesigned routes, as app-build-manifest page entries, with the URL they serve. */
export const BUDGET_ROUTES = [
  ['/(explorer)/page', '/'],
  ['/host/page', '/host'],
  ['/host/[icp]/page', '/host/events, /host/restaurants, …'],
  ['/cities/[city]/page', '/cities/lagos, /cities/raleigh-nc, …'],
  ['/(core)/cities/page', '/cities'],
  ['/(core)/going-out/page', '/going-out'],
  ['/(core)/about/page', '/about'],
  ['/schedule/page', '/schedule'],
  ['/help/page', '/help'],
  ['/help/[slug]/page', '/help/<video>'],
  ['/download/page', '/download'],
  ['/tools/page', '/tools'],
  ['/locals/page', '/locals'],
  ['/creators/page', '/creators'],
]

/** Strings only framer-motion's runtime carries (they survive minification). */
const FRAMER_MARKERS = ['data-framer-portal-id', 'framerAppearId']

/** The layouts on an entry's path: "/cities/[city]/page" → "/layout", "/cities/layout", "/cities/[city]/layout". */
export function layoutEntries(pageEntry) {
  const segments = pageEntry.replace(/\/page$/, '').split('/').filter(Boolean)
  const out = ['/layout']
  for (let i = 1; i <= segments.length; i += 1) out.push(`/${segments.slice(0, i).join('/')}/layout`)
  return out
}

/** The distinct script files of a route's first load: `next build`'s set, or with every layout on its path. */
export function firstLoadFiles(pageEntry, appPages, rootMainFiles, { withLayouts = false } = {}) {
  if (!appPages[pageEntry]) throw new Error(`no client entry for ${pageEntry} in app-build-manifest.json`)
  const files = new Set(rootMainFiles)
  for (const entry of [...(withLayouts ? layoutEntries(pageEntry) : []), pageEntry]) {
    for (const file of appPages[entry] ?? []) files.add(file)
  }
  return [...files].filter((file) => file.endsWith('.js'))
}

export function gzipBytes(buffer) {
  return zlib.gzipSync(buffer, { level: 9 }).length
}

function builtCheck() {
  const next = path.join(ROOT, '.next')
  assert(fs.existsSync(path.join(next, 'BUILD_ID')), 'run the production build (next build) before the #4339 budget check')
  const appPages = JSON.parse(fs.readFileSync(path.join(next, 'app-build-manifest.json'), 'utf8')).pages
  const { rootMainFiles } = JSON.parse(fs.readFileSync(path.join(next, 'build-manifest.json'), 'utf8'))
  const failures = []
  const rows = []
  const measure = (files) => files.reduce((sum, file) => sum + gzipBytes(fs.readFileSync(path.join(next, file))), 0)
  for (const [entry, url] of BUDGET_ROUTES) {
    const bytes = measure(firstLoadFiles(entry, appPages, rootMainFiles))
    const allFiles = firstLoadFiles(entry, appPages, rootMainFiles, { withLayouts: true })
    const withLayouts = measure(allFiles)
    const framer = allFiles.filter((file) => {
      const text = fs.readFileSync(path.join(next, file), 'utf8')
      return FRAMER_MARKERS.some((marker) => text.includes(marker))
    })
    rows.push(`  ${(bytes / 1000).toFixed(1).padStart(6)} kB  (${(withLayouts / 1000).toFixed(1)} kB with layouts)  ${url}`)
    if (bytes >= FIRST_LOAD_BUDGET_BYTES) failures.push(`${url}: first-load JS ${(bytes / 1000).toFixed(1)} kB is not under ${FIRST_LOAD_BUDGET_BYTES / 1000} kB`)
    if (framer.length) failures.push(`${url}: ships framer-motion at first load (${framer.join(', ')})`)
  }
  process.stdout.write(`#4339 first-load JS (gzip):\n${rows.join('\n')}\n`)
  assert.deepEqual(failures, [], `#4339 speed budget:\n${failures.join('\n')}`)
  process.stdout.write(`PASS #4339 speed budget: ${BUDGET_ROUTES.length} redesigned routes under ${FIRST_LOAD_BUDGET_BYTES / 1000} kB first-load JS, none ships framer-motion\n`)
}

function selfTest() {
  assert.deepEqual(layoutEntries('/cities/[city]/page'), ['/layout', '/cities/layout', '/cities/[city]/layout'])
  assert.deepEqual(layoutEntries('/(explorer)/page'), ['/layout', '/(explorer)/layout'])
  const pages = {
    '/layout': ['static/chunks/a.js', 'static/css/x.css'],
    '/cities/layout': ['static/chunks/a.js', 'static/chunks/b.js'],
    '/cities/[city]/page': ['static/chunks/b.js', 'static/chunks/c.js'],
  }
  assert.deepEqual(firstLoadFiles('/cities/[city]/page', pages, ['static/chunks/root.js']).sort(), ['static/chunks/b.js', 'static/chunks/c.js', 'static/chunks/root.js'])
  assert.deepEqual(firstLoadFiles('/cities/[city]/page', pages, ['static/chunks/root.js'], { withLayouts: true }).sort(), ['static/chunks/a.js', 'static/chunks/b.js', 'static/chunks/c.js', 'static/chunks/root.js'])
  assert.throws(() => firstLoadFiles('/missing/page', pages, []), /no client entry/)
  assert(gzipBytes(Buffer.from('a'.repeat(10_000))) < 100, 'gzip measures compressed bytes')
  process.stdout.write('PASS #4339 speed budget self-test\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--self-test')) selfTest()
  else builtCheck()
}
