// #4339 phase 1 — implementor regression test for the seven Host landing pages
// (/host/events, trips, experiences, restaurants, hotels, art, play).
//
// Source mode (default, no install): node strips the TypeScript types from the
// real modules (content/host-landing/icps.ts, lib/app-handoff.ts and the #4137
// seam it calls) and runs them; expected URLs are read from lib/store-links.ts,
// never written here. Built mode (`npm run test:issue-4339:built` after
// `npm run build`, i.e. ISSUE_4339_BUILT=1) also reads the prerendered HTML of
// all seven pages. It is not chained into `build`: the #3176/#2990 gates pin
// that chain and postbuild byte for byte.
//
// Pins:
//   - exactly the seven ICP slugs render from one template + one data file, and
//     none can shadow /host/download or /host/get;
//   - the hero headline is two lines and the second is italic;
//   - no "Privacy choices" text or link, and no extra fixed-bottom element;
//   - "Use Mingla Web" resolves through lib/cta-destination.ts: phones get the
//     Host OneLink ("Get Mingla Host"), computers the Host sheet;
//   - no store, OneLink or host URL is hard-coded in the new files;
//   - videos never carry a source in the server HTML (poster first; reduced
//     motion and Save-Data never load a clip).
//
// Run from mingla-marketing/ (Node 22.13+):
//   node --test lib/__tests__/issue-4339-host-landing.implementor.test.mjs

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { stripTypeScriptTypes } from 'node:module'
import { after, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const MARKETING = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => fs.readFileSync(path.join(MARKETING, rel), 'utf8')
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
const BUILT = process.env.ISSUE_4339_BUILT === '1'

const SLUGS = ['events', 'trips', 'experiences', 'restaurants', 'hotels', 'art', 'play']

const NEW_FILES = [
  'app/host/[icp]/page.tsx',
  'app/site-fonts.ts', // phase 2a moved the brand faces here from app/host/[icp]/fonts.ts
  'components/landing/handoff-sheet.tsx',
  'content/host-landing/icps.ts',
  'lib/app-handoff.ts',
  'components/landing/icp-landing.tsx',
  'components/landing/host-handoff.tsx',
  'components/landing/landing-media.tsx',
  'components/landing/landing-root.tsx',
  'components/landing/landing.css',
]

// ---- strip-types loader: one module and its relative lib imports ----------
const IMPORT = /from\s+'(@\/lib\/|\.\/)([\w-]+)'/g
function emit(sourcePath, outName, out, seen) {
  if (seen.has(outName)) return
  seen.add(outName)
  const deps = []
  const js = stripTypeScriptTypes(fs.readFileSync(sourcePath, 'utf8')).replace(IMPORT, (_m, _p, name) => {
    deps.push(name)
    return `from './${name}.mjs'`
  })
  fs.writeFileSync(path.join(out, `${outName}.mjs`), js)
  for (const name of deps) emit(path.join(MARKETING, 'lib', `${name}.ts`), name, out, seen)
}
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-4339-'))
after(() => fs.rmSync(out, { recursive: true, force: true }))
const seen = new Set()
emit(path.join(MARKETING, 'content/host-landing/icps.ts'), 'icps', out, seen)
emit(path.join(MARKETING, 'lib/app-handoff.ts'), 'app-handoff', out, seen)
const load = (name) => import(pathToFileURL(path.join(out, `${name}.mjs`)).href)
const icps = await load('icps')
const handoff = await load('app-handoff')
const stores = await load('store-links')
const links = await load('links-src')

// ---------------------------------------------------------------------------
test('exactly the seven ICP pages, from one data file, and none shadows a /host sibling', () => {
  assert.deepEqual(icps.ICP_SLUGS, SLUGS)
  const page = code(read('app/host/[icp]/page.tsx'))
  assert.match(page, /export const dynamicParams = false/)
  assert.match(page, /return ICP_SLUGS\.map\(\(icp\) => \(\{ icp \}\)\)/)
  assert.match(page, /<IcpLandingPage slug=\{icp\} \/>/)
  const siblings = fs.readdirSync(path.join(MARKETING, 'app/host')).filter((name) => !name.startsWith('['))
  for (const slug of SLUGS) assert.ok(!siblings.includes(slug), `/host/${slug} would collide with app/host/${slug}`)
  assert.ok(siblings.includes('download') && siblings.includes('get'))
  // One template: the page renders nothing ICP-specific itself.
  const template = code(read('components/landing/icp-landing.tsx'))
  for (const slug of SLUGS) assert.doesNotMatch(template, new RegExp(`['"]${slug}['"]`), `the template must not branch on ${slug}`)
  // Registered as INDEXED search routes, one per slug (Seth, 8 Nov): the same
  // search_ready class as /host, so each has a canonical URL, robots
  // index/follow and a sitemap entry (app/sitemap.ts lists searchReadyRoutes()).
  const registry = code(read('lib/search/route-registry.ts'))
  const block = registry.match(/HOST_LANDING_ROUTE_CONTRACTS[^=]*= ICP_SLUGS\.map[\s\S]*?\}\)\)/)?.[0] ?? ''
  assert.match(block, /lifecycle: 'search_ready' as const/, 'the landing pages are search_ready (indexed)')
  assert.doesNotMatch(block, /public_noindex/, 'no landing page is noindex')
  assert.match(block, /\.\.\.icpLandingMeta\(slug\)/, 'title and description come from the ICP copy')
  assert.match(block, /lastModified: HOST_LANDING_LAST_MODIFIED/)
  assert.match(registry, /\.\.\.HOST_LANDING_ROUTE_CONTRACTS,/)
  assert.match(registry, /export function searchReadyRoutes\(\)[\s\S]*?contract\.lifecycle === 'search_ready'/)
  assert.match(code(read('app/sitemap.ts')), /searchReadyRoutes\(\)\.map/, 'the sitemap lists every search_ready route')
  assert.match(page, /return searchRouteMetadata\(icpLandingPath\(icp\)\)/, 'the page uses the indexed metadata (canonical + index)')
  assert.doesNotMatch(page, /publicNoindexMetadata/)
  for (const slug of SLUGS) {
    const meta = icps.icpLandingMeta(slug)
    assert.ok(meta.title.trim() !== '' && meta.description.trim() !== '', `${slug}: search title and description`)
  }
})

test('every ICP carries the full approved format, with internal tools and real media', () => {
  const toolPaths = new Set(['/tools/venues', '/tools/events', '/tools/trips', '/tools/pricing'])
  for (const slug of SLUGS) {
    const d = icps.ICP_LANDINGS[slug]
    for (const key of ['bring', 'name', 'short', 'l1', 'l2', 'sub', 'intro', 'big', 'fh', 'fp', 'end']) {
      assert.ok(typeof d[key] === 'string' && d[key].trim() !== '', `${slug}.${key}`)
    }
    assert.doesNotMatch(d.l1 + d.l2, /\*/, `${slug}: the headline lines carry no emphasis markup`)
    assert.equal(d.feats.length, 3, `${slug}: three feature cards`)
    assert.ok(d.who.length > 0 && d.faq.length > 0, `${slug}: who-it's-for and FAQ`)
    assert.ok(toolPaths.has(icps.TOOL_PATH[d.tool.n]), `${slug}: ${d.tool.n} links to its internal tool page`)
    for (const ref of [d.hero, d.endm, ...d.feats.map((f) => f.m)]) {
      const media = icps.resolveLandingMedia(ref)
      assert.ok(fs.existsSync(path.join(MARKETING, 'public', media.poster)), `${slug}: ${media.poster} exists`)
      if (media.src) assert.ok(fs.existsSync(path.join(MARKETING, 'public', media.src)), `${slug}: ${media.src} exists`)
    }
    assert.ok(fs.existsSync(path.join(MARKETING, 'public', icps.landingBackground(d.bg))), `${slug}: features background exists`)
    const all = JSON.stringify(d)
    assert.doesNotMatch(all, /free to start|free to use|no fees|per month|\/mo\b|commission/i, `${slug}: no pricing language`)
  }
  // The approved hero swaps (design v7): art and hotels open on their own clips.
  assert.equal(icps.ICP_LANDINGS.art.hero, 'v:lp-art')
  assert.equal(icps.ICP_LANDINGS.hotels.hero, 'v:lp-hotel')
})

test('the hero headline is two lines, the second italic, and the scroll paragraph keeps its emphasis', () => {
  const template = code(read('components/landing/icp-landing.tsx'))
  assert.match(
    template,
    /<h1 id="lp-title">\s*<span>\{d\.l1\}<\/span>\s*<span>\s*<em>\{d\.l2\}<\/em>\s*<\/span>\s*<\/h1>/,
    'h1 = line one, then line two in <em>',
  )
  assert.deepEqual(icps.litWords('Put the *date, the place* now').map((w) => [w.word, w.em]), [
    ['Put', false],
    ['the', false],
    ['date,', true],
    ['the', true],
    ['place', true],
    ['now', false],
  ])
})

test('no "Privacy choices" text or link, and no fixed-bottom element of its own', () => {
  for (const rel of NEW_FILES) {
    assert.doesNotMatch(read(rel), /privacy choices|PrivacyChoices|privacy-choices/i, `${rel} must not carry its own privacy control`)
  }
  const css = code(read('components/landing/landing.css'))
  const fixed = [...css.matchAll(/([^{}]+)\{[^}]*position:\s*fixed[^}]*\}/g)]
  assert.equal(fixed.length, 1, 'only the hand-off sheet overlay is fixed')
  assert.match(fixed[0][1].trim(), /^\[data-landing-sheet\]$/)
  assert.match(fixed[0][0], /inset:\s*0/, 'the sheet overlay covers the screen; it is not a bottom bar')
  // The hero clears the #4318 strip by its own inset.
  assert.match(css, /bottom: calc\(25px \+ clamp\(28px, 5vh, 56px\) \+ var\(--mingla-privacy-inset, 0px\)\)/)
})

test('"Use Mingla Web" resolves through the #4137 seam: phone → Host OneLink, computer → Host sheet', () => {
  const attribution = links.siteAttribution('business_hero')
  for (const platform of ['ios', 'android']) {
    const h = handoff.resolveAppHandoff('host', platform, attribution)
    assert.equal(h.action, 'navigate')
    assert.ok(h.href.startsWith(`${stores.BUSINESS_ONELINK_URL}?`), `${platform} goes to the Host OneLink: ${h.href}`)
    assert.match(h.href, /c=business_hero/)
  }
  assert.deepEqual(handoff.resolveAppHandoff('host', 'other', attribution), { action: 'sheet', sheet: 'host' })
  assert.deepEqual(handoff.resolveAppHandoff('explorer', 'other', attribution), { action: 'sheet', sheet: 'explore' })
  const hrefs = handoff.appHandoffHrefs('host', attribution)
  assert.equal(hrefs.computerHref, stores.BUSINESS_WEB_URL)
  assert.deepEqual(hrefs.stores, { appStore: stores.BUSINESS_APP_STORE_URL, googlePlay: stores.BUSINESS_PLAY_STORE_URL })
  assert.equal(handoff.hostWebLabel(hrefs.computerHref), new URL(stores.BUSINESS_WEB_URL).host)

  const button = code(read('components/landing/host-handoff.tsx'))
  assert.match(button, /from '@\/lib\/app-handoff'/)
  assert.match(button, /<DeviceLink\s+surface="host"/)
  assert.match(button, /<span data-cta-when="phone">Get Mingla Host<\/span>/)
  assert.match(button, /<span data-cta-when="computer">Use Mingla Web<\/span>/)
  assert.match(button, /resolveAppHandoff\('host', platform, ATTRIBUTION\)/)
  assert.match(code(read('lib/app-handoff.ts')), /from '\.\/cta-destination'/)
  // Talk to the team opens /schedule with the ICP chosen.
  const template = code(read('components/landing/icp-landing.tsx'))
  assert.match(template, /return `\/schedule\?icp=\$\{encodeURIComponent\(slug\)\}`/)
  assert.equal((template.match(/<HostHandoffButton /g) ?? []).length, 3, 'hero, features and closing band')
})

test('no store, OneLink or host URL is hard-coded in the new files', () => {
  const banned = [
    /apps\.apple\.com/i,
    /play\.google\.com/i,
    /onelink\.me/i,
    /go\.usemingla\.com/i,
    /biz\.usemingla\.com/i,
    /host\.usemingla\.com/i,
    /usemingla\.com\/(host\/)?download/i,
    /market:\/\//i,
    /https?:\/\//i,
  ]
  for (const rel of NEW_FILES) {
    const source = code(read(rel))
    for (const pattern of banned) assert.doesNotMatch(source, pattern, `${rel} must not hold ${pattern}`)
  }
})

test('clips: poster first, no source in the server HTML, never loaded under reduced motion or Save-Data', () => {
  const media = code(read('components/landing/landing-media.tsx'))
  const video = media.match(/<video[\s\S]*?\/>/)?.[0] ?? ''
  assert.ok(video !== '', 'the clip renders a <video>')
  assert.doesNotMatch(video, /\ssrc=/, 'no src in the server HTML')
  assert.doesNotMatch(media, /<source/)
  for (const attr of ['muted', 'loop', 'playsInline', 'preload="none"', 'poster={poster}']) assert.ok(video.includes(attr), attr)
  assert.match(media, /prefers-reduced-motion: reduce/)
  assert.match(media, /saveData === true/)
  assert.match(media, /if \(!video \|\| src === '' \|\| prefersStillMedia\(\)\) return/)
  assert.match(media, /video\.pause\(\)/, 'pauses off screen')
  assert.match(media, /video\.preload = hero \? 'auto' : 'metadata'/, 'only the hero preloads')
})

test('/host/events: the features background is the approved bg-events clip under the clip rules; the others keep their stills', () => {
  // Seth approved bg-events (8 Nov): stage lights through haze, 1280 wide, 5 s,
  // no people, no text. It replaces the still durham-midweek-live.
  assert.equal(icps.ICP_LANDINGS.events.bg, 'v:bg-events')
  assert.equal(icps.landingBackgroundMedia('v:bg-events'), 'v:bg-events')
  const clip = icps.resolveLandingMedia('v:bg-events')
  assert.equal(clip.src, '/marketing/site/m/bg-events.mp4')
  assert.equal(clip.poster, '/marketing/site/m/bg-events.jpg')
  for (const file of [clip.src, clip.poster]) assert.ok(fs.existsSync(path.join(MARKETING, 'public', file)), `${file} exists`)
  assert.ok(fs.statSync(path.join(MARKETING, 'public', clip.src)).size < 600_000, 'the loop stays light')
  for (const slug of SLUGS.filter((s) => s !== 'events')) {
    const bg = icps.ICP_LANDINGS[slug].bg
    assert.doesNotMatch(bg, /^v:/, `${slug}: keeps its still until its clip arrives`)
    assert.equal(icps.landingBackgroundMedia(bg), `p:${bg}`)
  }
  // The sticky background renders through LandingMedia (muted, loop,
  // playsInline, preload none, poster only under reduced motion / Save-Data),
  // never a bare <img> or <video> of its own, and the clip gets the still's
  // brightness filter.
  const template = code(read('components/landing/icp-landing.tsx'))
  assert.match(template, /<div className="feat-bg" aria-hidden="true">\s*(?:\{\}\s*)?<LandingMedia media=\{landingBackgroundMedia\(d\.bg\)\} \/>\s*<\/div>/)
  assert.doesNotMatch(template, /landingBackground\(d\.bg\)/)
  const css = read('components/landing/landing.css')
  assert.match(css, /\[data-landing\] \.feat-bg img,\s*\[data-landing\] \.feat-bg video \{[^}]*object-fit: cover;[^}]*filter: brightness\(0\.5\) saturate\(0\.9\);/)
  if (BUILT) {
    const html = fs.readFileSync(path.join(MARKETING, '.next/server/app/host', 'events.html'), 'utf8')
    const bg = html.match(/<div class="feat-bg" aria-hidden="true">([\s\S]*?)<\/div>/)?.[1] ?? ''
    assert.match(bg, /<video[^>]*poster="\/marketing\/site\/m\/bg-events\.jpg"/, 'built: the clip with its poster')
    assert.match(bg, /preload="none"/, 'built: nothing preloads')
    assert.match(bg, /data-landing-clip="\/marketing\/site\/m\/bg-events\.mp4"/)
    assert.doesNotMatch(bg, /\ssrc=|<img/, 'built: no source until on screen, no still')
  }
})

// ---- built HTML (after `next build`) ---------------------------------------
test('built: all seven pages prerender indexed, with the two-line hero and no privacy link', { skip: !BUILT && 'set ISSUE_4339_BUILT=1 after next build' }, () => {
  for (const slug of SLUGS) {
    const file = path.join(MARKETING, '.next/server/app/host', `${slug}.html`)
    assert.ok(fs.existsSync(file), `${slug} must be prerendered`)
    const html = fs.readFileSync(file, 'utf8')
    const d = icps.ICP_LANDINGS[slug]
    const esc = (s) => s.replaceAll('&', '&amp;').replaceAll('’', '’')
    assert.ok(html.includes(`<h1 id="lp-title"><span>${esc(d.l1)}</span><span><em>${esc(d.l2)}</em></span></h1>`), `${slug}: two-line hero`)
    assert.doesNotMatch(html, /privacy choices/i, `${slug}: no privacy choices text`)
    assert.match(html, /<meta name="robots" content="index, follow"/, `${slug}: indexed`)
    assert.ok(html.includes(`<link rel="canonical" href="https://usemingla.com/host/${slug}"`), `${slug}: canonical URL`)
    assert.doesNotMatch(html, /<video[^>]*\ssrc=/, `${slug}: no clip source before the script decides`)
    assert.ok(html.includes(`href="/schedule?icp=${slug}"`), `${slug}: Talk to the team`)
    assert.ok(html.includes(`href="${icps.TOOL_PATH[d.tool.n]}"`), `${slug}: tool link`)
    const ctas = [...html.matchAll(/<a [^>]*data-cta-surface="host"[^>]*>/g)].map((m) => m[0])
    assert.ok(ctas.length >= 3, `${slug}: hand-off buttons render`)
    for (const a of ctas) {
      assert.ok(a.includes(`href="${stores.BUSINESS_WEB_URL}"`), `${slug}: computer href is host web`)
      assert.ok(a.includes(`data-cta-phone-href="${stores.BUSINESS_ONELINK_URL}?`), `${slug}: phone href is the Host OneLink`)
    }
  }
})
