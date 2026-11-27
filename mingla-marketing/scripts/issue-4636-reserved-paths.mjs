#!/usr/bin/env node
// #4636 — writes lib/site-pages/reserved-paths.json: every first address
// segment a staff-made page may NOT use, because the site already answers it.
//
// A custom page lives at /<a> or /<a>/<b> (lowercase, at most two segments) and
// is served by the catch-all route app/[...slug]. Next.js always prefers a
// coded route, so a custom address whose first segment is a coded route's
// first segment could be shadowed (or shadow nothing and confuse people). The
// list is built from the code, never typed by hand:
//
//   - every route folder under app/ (route groups like (core) are walked
//     through, dynamic and private folders are skipped);
//   - every top-level entry of public/ (files and folders);
//   - the middleware's matcher prefixes and the next.config rewrites;
//   - every path in the search route registry (redirects, retired routes);
//   - a few platform words (_next, admin, ...).
//
// The database refuses these through site_reserved_segments() (the #4636
// migration); a parity test keeps that list identical to this file
// (I-4636-NO-ADDRESS-COLLISION). `--check` fails when the JSON is stale.
//
//   node scripts/issue-4636-reserved-paths.mjs          # write
//   node scripts/issue-4636-reserved-paths.mjs --check  # verify, exit 1 when stale
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MARKETING = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const RESERVED_JSON = path.join(MARKETING, 'lib/site-pages/reserved-paths.json')

/** Platform words no page should take, whatever the code says today. */
const PLATFORM = ['_next', 'admin', 'api', 'assets', 'static', 'well-known', 'site-preview', 'preview', 'login', 'logout', 'auth', 'sitemap', 'robots', 'feed', 'rss', 'index', 'search', 'home', 'host', 'help', 'blog', 'page', 'pages', 'new', 'edit']

/** First segments of every route folder under app/ (route groups are transparent). */
export function appSegments(dir = path.join(MARKETING, 'app')) {
  const out = new Set()
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    if (e.name.startsWith('(') && e.name.endsWith(')')) {
      for (const s of appSegments(path.join(dir, e.name))) out.add(s)
      continue
    }
    if (e.name.startsWith('[') || e.name.startsWith('_') || e.name.startsWith('@')) continue
    out.add(e.name)
  }
  return out
}

/** Top-level files of app/ that answer a URL (robots.ts -> robots.txt is covered by the dot rule). */
function appFileSegments() {
  const out = new Set()
  for (const f of fs.readdirSync(path.join(MARKETING, 'app'))) {
    const m = f.match(/^(sitemap|robots|manifest|icon|apple-icon|favicon|opengraph-image|twitter-image)\b/)
    if (m) out.add(m[1])
  }
  return out
}

function publicSegments() {
  const out = new Set()
  for (const f of fs.readdirSync(path.join(MARKETING, 'public'))) {
    out.add(f)
    out.add(f.replace(/\..*$/, ''))
  }
  return out
}

function firstSegment(p) {
  const m = String(p).match(/^\/([^/:?(]+)/)
  return m ? m[1] : null
}

function sourceSegments() {
  const out = new Set()
  const mw = fs.readFileSync(path.join(MARKETING, 'middleware.ts'), 'utf8')
  const matcher = mw.slice(mw.indexOf('matcher:'))
  for (const m of matcher.matchAll(/'(\/[^']*)'/g)) {
    const s = firstSegment(m[1])
    if (s) out.add(s)
  }
  for (const m of mw.matchAll(/\\\/([a-z][a-z0-9-]*)\\\//g)) out.add(m[1])
  const cfg = fs.readFileSync(path.join(MARKETING, 'next.config.ts'), 'utf8')
  for (const m of cfg.matchAll(/source:\s*'(\/[^']*)'/g)) {
    const s = firstSegment(m[1])
    if (s) out.add(s)
  }
  const registry = fs.readFileSync(path.join(MARKETING, 'lib/search/route-registry.ts'), 'utf8')
  for (const m of registry.matchAll(/(?:source|pathname|destination|path):\s*'(\/[^']*)'/g)) {
    const s = firstSegment(m[1])
    if (s) out.add(s)
  }
  return out
}

export function reservedSegments() {
  const all = new Set([...PLATFORM, ...appSegments(), ...appFileSegments(), ...publicSegments(), ...sourceSegments()])
  // Only address-shaped words matter (a custom address is lowercase letters, digits and single hyphens).
  return [...all].filter((s) => /^[a-z0-9_][a-z0-9_.-]*$/.test(s)).sort()
}

export function reservedJsonText() {
  return `${JSON.stringify({ segments: reservedSegments() }, null, 2)}\n`
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const text = reservedJsonText()
  const current = fs.existsSync(RESERVED_JSON) ? fs.readFileSync(RESERVED_JSON, 'utf8') : ''
  if (process.argv.includes('--check')) {
    if (current !== text) {
      console.error('issue-4636: lib/site-pages/reserved-paths.json is out of date; run node scripts/issue-4636-reserved-paths.mjs (and add a migration that re-emits site_reserved_segments())')
      process.exitCode = 1
    } else console.log('issue-4636: reserved-paths.json matches the app routes')
  } else if (current !== text) {
    fs.writeFileSync(RESERVED_JSON, text)
    console.log('issue-4636: wrote lib/site-pages/reserved-paths.json')
  } else console.log('issue-4636: reserved-paths.json already current')
}
