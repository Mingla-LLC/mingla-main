// #4339 round B (F) — implementor regression test for the speed pass:
//   - the carousel writes only transform and clip-path per frame (no width or
//     height), one fixed box per card set on resize;
//   - clips: WebP posters (the hero's preloaded), the hero clip after first
//     paint, every other clip after load and idle, phone-size and AV1 copies
//     chosen at run time, every master under 700 KB;
//   - fonts: the serif's metric-matched fallbacks, and the legacy site faces
//     (Mochiy, Nunito Sans, Inter) never preloaded on every page;
//   - the nav menu image is lazy, the QR library loads with its sheet, the
//     cutout barrel is not imported by the help and city routes, and the
//     /schedule loading panel holds its room (CLS).
// Built mode also checks first-load JS and the preload links in the HTML.
//
// Run from mingla-marketing/ (Node 22.13+):
//   node --test lib/__tests__/issue-4339-round-b-speed.implementor.test.mjs

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { after, test } from 'node:test'
import { MARKETING, makeLoader } from './issue-4339-round-b-load.mjs'

const read = (rel) => fs.readFileSync(path.join(MARKETING, rel), 'utf8')
const code = (source) => source.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const BUILT = process.env.ISSUE_4339_BUILT === '1'
const CLIPS = path.join(MARKETING, 'public/marketing/site/m')
const loader = makeLoader()
after(() => loader.cleanup())

test('carousel: transform and clip-path per frame, never width or height', () => {
  const stage = code(read('components/site/reel-stage.tsx'))
  const layout = stage.slice(stage.indexOf('const layout = () => {'), stage.indexOf('const frame = (t: number) => {'))
  assert.ok(layout.length > 100, 'found the per-frame layout')
  assert.doesNotMatch(layout, /style\.(width|height)\s*=/, 'no width/height write per frame')
  assert.match(layout, /el\.style\.transform = `translate\([^`]*\) perspective\(1200px\) rotateY\(\$\{ry\}deg\) scale\(\$\{scale\}\)`/)
  assert.match(layout, /el\.style\.clipPath = `inset\(0 \$\{side\}px round/)
  const size = stage.slice(stage.indexOf('const size = () => {'), stage.indexOf('const layout = () => {'))
  assert.match(size, /el\.style\.width = `\$\{BOX_W \* u\}px`/)
  assert.match(size, /el\.style\.height = `\$\{BOX_H \* u\}px`/)
  const css = read('components/site/site.css')
  assert.match(css, /\[data-landing\] \.rm-card \{[^}]*will-change: transform;/)
  assert.doesNotMatch(css, /will-change: transform, width, height/)
})

test('clips: copy choice, WebP posters, deferred start, light masters', async () => {
  const cs = await loader.load('lib/clip-sources.ts')
  const phone = { viewportWidth: 375, coarsePointer: true, av1: false }
  const phoneAv1 = { viewportWidth: 375, coarsePointer: true, av1: true }
  const desk = { viewportWidth: 1440, coarsePointer: false, av1: false }
  const deskAv1 = { viewportWidth: 1440, coarsePointer: false, av1: true }
  const av1 = JSON.parse(read('lib/clip-av1.generated.json'))
  for (const name of ['crowd', 'cozy', 'c-lagos', 'f-trip', 'salsa']) {
    const src = `/marketing/site/m/${name}.mp4`
    assert.equal(cs.clipSourceFor(src, phone), `/marketing/site/m/${name}-sm.mp4`)
    assert.equal(cs.clipSourceFor(src, desk), src)
    assert.equal(cs.clipSourceFor(src, phoneAv1), `/marketing/site/m/${name}-sm.${av1.small.includes(name) ? 'webm' : 'mp4'}`)
    assert.equal(cs.clipSourceFor(src, deskAv1), `/marketing/site/m/${name}.${av1.full.includes(name) ? 'webm' : 'mp4'}`)
  }
  assert.ok(av1.full.length + av1.small.length > 0, 'some AV1 copies are lighter and kept')
  assert.equal(cs.webpPoster('/marketing/site/m/crowd.jpg'), '/marketing/site/m/crowd.webp')
  const masters = fs.readdirSync(CLIPS).filter((f) => f.endsWith('.mp4') && !f.endsWith('-sm.mp4'))
  assert.ok(masters.length >= 50)
  for (const file of masters) {
    const name = file.slice(0, -4)
    const size = (f) => fs.statSync(path.join(CLIPS, f)).size
    assert.ok(size(file) < 700 * 1024, `${file} is ${Math.round(size(file) / 1024)} KB`)
    for (const copy of [`${name}-sm.mp4`, `${name}.webp`]) assert.ok(fs.existsSync(path.join(CLIPS, copy)), `${copy} exists`)
    // An AV1 copy ships only where it is under 90% of its H.264 twin.
    assert.equal(fs.existsSync(path.join(CLIPS, `${name}.webm`)), av1.full.includes(name), `${name}.webm matches the manifest`)
    assert.equal(fs.existsSync(path.join(CLIPS, `${name}-sm.webm`)), av1.small.includes(name), `${name}-sm.webm matches the manifest`)
    if (av1.full.includes(name)) assert.ok(size(`${name}.webm`) < size(file) * 0.9, `${name}.webm is lighter`)
    if (av1.small.includes(name)) assert.ok(size(`${name}-sm.webm`) < size(`${name}-sm.mp4`) * 0.9, `${name}-sm.webm is lighter`)
    assert.ok(size(`${name}-sm.mp4`) < size(file), `${name}-sm.mp4 is lighter than the mp4`)
    assert.ok(size(`${name}.webp`) < 60 * 1024, `${name}.webp poster is small (${Math.round(size(`${name}.webp`) / 1024)} KB)`)
  }
  for (const f of ['f-trip.mp4', 'salsa.mp4']) assert.ok(fs.statSync(path.join(CLIPS, f)).size < 700 * 1024, f)
  const media = code(read('components/landing/landing-media.tsx'))
  assert.match(media, /return <LandingClip src=\{resolved\.src \?\? ''\} poster=\{poster\} hero=\{hero\} lazyPoster=\{lazyPoster && !hero && !priority\} \/>/)
  assert.match(media, /void \(hero \? afterFirstPaint\(\) : afterLoadAndIdle\(\)\)\.then\(watch\)/)
  assert.match(media, /video\.src = clipSourceFor\(src, clipEnvironment\(\)\)/)
  const stage = code(read('components/site/reel-stage.tsx'))
  assert.match(stage, /void afterLoadAndIdle\(\)\.then\(\(\) => \{\s*if \(!alive\) return\s*clipsAllowed = true/)
  assert.match(stage, /video\.src = clipSourceFor\(video\.dataset\.src \?\? '', env\)/)
})

test('LCP: priority and lazy posters, lazy city place photos, sized help thumbnails', () => {
  const media = code(read('components/landing/landing-media.tsx'))
  assert.match(media, /if \(hero \|\| priority\) preload\(poster, \{ as: 'image', fetchPriority: 'high' \}\)/)
  assert.match(media, /poster=\{lazyPoster \? undefined : poster\}\s*data-poster=\{lazyPoster \? poster : undefined\}/)
  assert.match(media, /video\.poster = poster/)
  const goingOut = code(read('app/(core)/going-out/page.tsx'))
  assert.match(goingOut, /<LandingMedia media=\{guide\.media\} lazyPoster \/>/)
  assert.match(goingOut, /<LandingMedia media="v:cozy" priority \/>/)
  assert.match(code(read('components/cities/city-weekend.tsx')), /eager=\{false\}/)
  // #4339 speed fix: the cards render on the server (help-video-grid.tsx);
  // thumbnails are srcsets over next/image's optimiser built on the server
  // (no client image component), the first one preloaded (the LCP), the rest
  // lazy.
  const grid = code(read('components/help/help-video-grid.tsx'))
  assert.match(grid, /const \{ src, srcSet \} = optimisedImageSources\(bambooPosterUrl\(entryId, 960\)\)/)
  assert.match(grid, /if \(lcp\) preload\(src, \{ as: 'image', fetchPriority: 'high', imageSrcSet: srcSet, imageSizes: CARD_SIZES \}\)/)
  assert.match(grid, /\.\.\.\(lcp \? \{ fetchPriority: 'high' as const \} : \{ loading: 'lazy' as const \}\)/)
  assert.doesNotMatch(grid, /from 'next\/image'/, 'no image component on the help page')
  assert.doesNotMatch(grid, /^'use client'/, 'the help cards render on the server')
})

test('fonts: serif fallback metrics; legacy faces not preloaded site-wide', () => {
  const css = read('components/landing/landing.css')
  for (const [name, size] of [['MinglaSerifFallbackGeorgia', '76.49%'], ['MinglaSerifFallbackNoto', '70.89%'], ['MinglaSerifFallbackTimes', '83.94%']]) {
    assert.match(css, new RegExp(`font-family: '${name}';[^}]*size-adjust: ${size.replace('.', '\\.')};[^}]*ascent-override:[^}]*descent-override:`), name)
  }
  assert.match(read('app/site-fonts.ts'), /fallback: \['MinglaSerifFallbackGeorgia', 'MinglaSerifFallbackNoto', 'MinglaSerifFallbackTimes', 'Georgia', 'serif'\]/)
  const fonts = read('app/fonts.ts')
  assert.equal((fonts.match(/preload: false,/g) ?? []).length, 4, 'the four root faces load on use')
  assert.doesNotMatch(fonts, /preload: true/)
  // On a redesigned page the legacy faces are never asked for at all.
  assert.match(css, /html:has\(\[data-landing\]\) \{\s*--font-mochiy: initial;\s*--font-nunito: initial;\s*--font-inter: initial;\s*\}/)
  assert.match(css, /html:has\(\[data-landing\]\) body \{\s*font-family: system-ui/)
})

test('lazy nav image, QR with its sheet, no cutout barrel on help and cities, /schedule holds its room', () => {
  assert.match(code(read('components/site/site-nav.tsx')), /<img src="\/marketing\/site\/p\/lagos-quests-gallery\.jpg" alt="" loading="lazy" decoding="async" width=\{900\} height=\{599\} \/>/)
  // #4339 speed fix: the weekend's item sheet (with its QR) moved to
  // city-item-sheet.tsx, which city-this-weekend.tsx itself loads on a tap.
  for (const file of ['components/landing/handoff-sheet.tsx', 'components/cities/city-item-sheet.tsx']) {
    const src = code(read(file))
    assert.match(src, /const QRCode = dynamic\(\(\) => import\('react-qr-code'\), \{ ssr: false \}\)/, file)
    assert.doesNotMatch(src, /import QRCode from 'react-qr-code'/, file)
  }
  for (const file of ['app/help/page.tsx', 'app/help/[slug]/page.tsx', 'components/cities/city-hub.tsx', 'components/page-system/catalogue-detail.tsx', 'app/blog/layout.tsx']) {
    assert.doesNotMatch(code(read(file)), /from '@\/components\/cutout'/, file)
  }
  assert.match(code(read('app/schedule/ScheduleClient.tsx')), /<div className="sched-state sched-loading" role="status">/)
  assert.match(read('components/site/pages.css'), /\.sched-state\.sched-loading \{\s*min-height: min\(760px, 85vh\);/)
})

test('built: no legacy font preload, hero poster preloaded, first-load JS', { skip: !BUILT && 'set ISSUE_4339_BUILT=1 after npm run build' }, () => {
  const html = (route) => fs.readFileSync(path.join(MARKETING, '.next/server/app', `${route}.html`), 'utf8')
  for (const route of ['index', 'host', 'host/events', 'cities/lagos', 'going-out', 'about']) {
    const page = html(route)
    const preloads = [...page.matchAll(/<link rel="preload" href="([^"]+\.woff2)"/g)].map((m) => m[1])
    assert.ok(preloads.length <= 4, `${route}: at most the four brand faces are preloaded (${preloads.length})`)
  }
  assert.match(html('host/events'), /<link rel="preload" as="image" href="\/marketing\/site\/m\/crowd\.webp" fetchPriority="high"\/>|<link rel="preload" href="\/marketing\/site\/m\/crowd\.webp" as="image" fetchPriority="high"\/>/)
})

test('speed fix: the first-load budget runs in the build, and city routes leave the historical layout behind', async () => {
  const pkg = JSON.parse(read('package.json'))
  assert.match(pkg.scripts.build, /issue-4339-built-output-anti-copy\.mjs --built && node scripts\/issue-4339-first-load-budget\.mjs --self-test && node scripts\/issue-4339-first-load-budget\.mjs$/, 'the budget closes the release build')
  const budget = await import(pathToFileURL(path.join(MARKETING, 'scripts/issue-4339-first-load-budget.mjs')).href)
  assert.equal(budget.FIRST_LOAD_BUDGET_BYTES, 130_000)
  for (const entry of ['/(explorer)/page', '/host/page', '/host/[icp]/page', '/cities/[city]/page', '/(core)/going-out/page', '/schedule/page', '/help/page']) {
    assert.ok(budget.BUDGET_ROUTES.some(([e]) => e === entry), `${entry} is budgeted`)
  }
  // The release city route renders the redesigned page only.
  const page = code(read('app/cities/[city]/page.tsx'))
  assert.match(page, /import \{ CityHub \} from '@\/components\/cities\/city-route'/)
  const route = code(read('components/cities/city-route.tsx'))
  assert.doesNotMatch(route, /city-hub'|framer-motion|city-catalogue|device-cta/)
  assert.match(code(read('next.config.ts')), /if \(process\.env\.MINGLA_HISTORICAL_2983_BUILD === '1'\) webpackConfig\.plugins\.push\(new HistoricalCityLayoutPlugin\(\)\)/)
  for (const rel of ['components/cities/city-page.tsx', 'components/cities/city-weekend.tsx', 'components/cities/city-this-weekend.tsx', 'components/cities/city-actions.tsx']) {
    // Type-only imports erase at build time; only value imports ship.
    const src = code(read(rel)).replace(/^import type .*$/gm, '')
    assert.doesNotMatch(src, /from '\.\/city-hub'|from 'framer-motion'|from '@\/components\/cutout\/device-cta'|from '@\/components\/page-system\/catalogue-detail'/, `${rel}: no historical layout, motion, device CTA or eager detail sheet`)
  }
})

test('speed fix (built): every redesigned route under the first-load budget, none with framer-motion', { skip: !process.env.ISSUE_4339_BUILT && 'set ISSUE_4339_BUILT=1 after npm run build' }, () => {
  const out = execFileSync(process.execPath, [path.join(MARKETING, 'scripts/issue-4339-first-load-budget.mjs')], { cwd: MARKETING, encoding: 'utf8' })
  assert.match(out, /PASS #4339 speed budget/)
})
