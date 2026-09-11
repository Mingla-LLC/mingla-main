#!/usr/bin/env node

// Regression guard for the help centre (/help).
//
// Every assertion here corresponds to a failure that is SILENT — the page still
// renders, the build still passes, and only a real viewer finds out. That is
// the whole reason this file exists.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

const registry = read('content/help/registry.ts')
const player = read('components/help/help-player.tsx')
const browser = read('components/help/help-browser.tsx')
const detail = read('app/help/[slug]/page.tsx')
const routeRegistry = read('lib/search/route-registry.ts')
const sitemap = read('app/sitemap.ts')
const packageJson = JSON.parse(read('package.json'))

const pass = (m) => console.log(`PASS help-centre ${m}`)

// ── 1. the zero-byte manifest trap ───────────────────────────────────────────
// `cdnapi.bamboo-cloud.com/api/entry/<id>/flavors/playlist.m3u8` answers HTTP
// 200 with content-type application/vnd.apple.mpegurl and a body of ZERO bytes.
// A player built on it shows a poster and a spinner forever, and any curl-based
// health check calls it green. Only Kaltura's playManifest returns a real
// ladder.
assert.doesNotMatch(
  registry,
  /\/api\/entry\/\$\{entryId\}\/flavors\/playlist\.m3u8/,
  'bambooHlsUrl must not use /api/entry/<id>/flavors/playlist.m3u8 — it returns 200 with an empty body',
)
assert.match(
  registry,
  /playManifest\/entryId\/\$\{entryId\}\/format\/applehttp/,
  'bambooHlsUrl must use Kaltura playManifest, which is the form that returns a real ladder',
)
pass('HLS url uses playManifest, not the zero-byte flavors endpoint')

// ── 2. hls.js stays lazy ─────────────────────────────────────────────────────
// A static import puts ~569KB on the initial load of every help page, for every
// visitor, including the Safari users who never need it.
assert.doesNotMatch(
  player,
  /^import\s+.*\bfrom\s+['"]hls\.js['"]/m,
  'hls.js must never be statically imported — it is ~569KB and belongs in a dynamic chunk',
)
assert.match(player, /import\(['"]hls\.js['"]\)/, 'hls.js must be loaded with a dynamic import')
assert.match(
  player,
  /canPlayType\(['"]application\/vnd\.apple\.mpegurl['"]\)/,
  'native-HLS browsers must short-circuit before the hls.js import so Safari never downloads it',
)
pass('hls.js is dynamically imported and skipped entirely on native-HLS browsers')

// ── 3. no dead /help/ row in the sitemap ─────────────────────────────────────
// app/sitemap.ts emits `match.pathname` verbatim for every search_ready
// contract. A `prefix` contract for '/help/' would therefore submit the literal
// URL '/help/' to search engines — a path that renders nothing.
assert.doesNotMatch(
  routeRegistry,
  /type:\s*'prefix',\s*pathname:\s*'\/help\//,
  "'/help/' must not be a prefix contract — the sitemap would submit '/help/' itself, which 404s",
)
assert.match(
  routeRegistry,
  /HELP_ROUTE_CONTRACTS[\s\S]*type:\s*'exact'/,
  'help videos must project one exact route contract each, the way cities do',
)
assert.match(
  routeRegistry,
  /\.\.\.HELP_ROUTE_CONTRACTS,/,
  'HELP_ROUTE_CONTRACTS must be spread into ROUTE_REGISTRY or the pages have no contract',
)
assert.match(sitemap, /searchReadyRoutes\(\)/, 'sitemap must still be registry-driven')
pass('each video owns an exact route contract; no dead /help/ row')

// ── 4. contrast ──────────────────────────────────────────────────────────────
// White on --cut-accent (#eb7825) is 2.90:1. That fails AA for text (4.5:1) and
// also fails the 3:1 floor for UI components. --cut-accent-ink (#a8450e) is the
// kit's accessible accent at 5.96:1 on white.
for (const [name, source] of [['help-player', player], ['help-browser', browser], ['help detail', detail]]) {
  assert.doesNotMatch(
    source,
    /background:\s*'var\(--cut-accent\)'/,
    `${name} must not fill a surface with --cut-accent and put white on it — 2.90:1 fails AA; use --cut-accent-ink`,
  )
}
pass('no white-on-raw-accent surfaces (AA)')

// ── 5. the written steps are server-rendered ─────────────────────────────────
// The steps are the page's answer for anyone who does not press play, including
// answer engines that do not execute JS. They must not move into the player.
assert.match(detail, /video\.steps\.map/, 'the written steps must render on the detail page itself')
assert.doesNotMatch(detail, /^'use client'/m, 'the help detail page must stay a server component')
pass('written steps ship in the HTML')

// ── 6. the cutout stylesheet is actually loaded ──────────────────────────────
// The --cut-* tokens are scoped to [data-cutout], and each route family imports
// cutout.css from its own layout. Without that import the page still builds and
// still renders: the shell falls back to its inline background while the text
// inherits the site's dark-surface white, i.e. white on cream. Nothing in the
// build can see it.
const layout = read('app/help/layout.tsx')
assert.match(
  layout,
  /import '@\/components\/cutout\/cutout\.css'/,
  'app/help/layout.tsx must import cutout.css or every --cut-* token resolves empty',
)
pass('cutout.css is imported for the /help route family')

// ── 7. the guard runs in CI ──────────────────────────────────────────────────
const guardCommand = 'node scripts/help-video-centre.implementor.happy.test.mjs'
assert(
  packageJson.scripts.build.includes(guardCommand),
  'production build must run the help-centre guard',
)
pass('guard is wired into the production build')

console.log('PASS help-centre all invariants')
