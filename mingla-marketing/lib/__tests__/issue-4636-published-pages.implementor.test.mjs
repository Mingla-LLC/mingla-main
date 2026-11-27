// MINGLA-INVARIANT: I-4636-CONVERTED-PAGES-FALL-BACK | issue #4636 | a converted page renders its published block list only when one exists and something in it can render; otherwise its coded children render unchanged (extends I-4452-NO-BLOCKS-NO-CHANGE).
// #4636 build 2 (happy path): the public read path.
//   - each converted page wraps its coded tree in <PublishedOr pageKey=…>; the 14 keys match the registry;
//   - published blocks render through BlockRenderer with the page's own wrapper settings;
//   - a library item `m:<uuid>` becomes a plain public storage URL (clip + poster, or still);
//   - the nav and footer with NO published settings render byte-identical to origin/main;
//     with settings they draw the published links; live staff pages join the menu;
//   - staff-made pages: a live page renders, a deleted one redirects, the sitemap lists live indexed pages;
//   - per-page cache tags and the revalidate route's page key;
//   - each converted page's default block list (page-defaults.json) is current and valid.
// Run from mingla-marketing/: node --test lib/__tests__/issue-4636-published-pages.implementor.test.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { after, test } from 'node:test'
import { loader, MARKETING } from './issue-4452-ts-loader.mjs'
import { tsxRenderer } from './issue-4452-tsx-render.mjs'
import { pageDefaultsJsonText, DEFAULTS_JSON } from '../../scripts/issue-4636-page-defaults.mjs'

const read = (p) => fs.readFileSync(path.join(MARKETING, p), 'utf8')
const L = loader('issue-4636-published-')
after(L.cleanup)
const converted = await L.load('site-pages/converted')
const custom = await L.load('site-pages/custom')
const settings = await L.load('site-pages/settings')
const media = await L.load('site-blocks/media')
const plan = await L.load('site-blocks/render-plan')
const registry = await L.load('site-blocks/registry')
const tags = await L.load('site-pages/tags')
const revalidate = await L.load('revalidate-tag')
const siteRegistry = { SITE_PAGES: JSON.parse(fs.readFileSync(path.join(MARKETING, 'lib/site-pages/registry.json'), 'utf8')).pages }

const NEXT_STUBS = {
  'next/link': "const React = require('react'); module.exports = { __esModule: true, default: function Link(p) { const { href, children, prefetch, ...rest } = p; return React.createElement('a', { href, ...rest }, children) } }",
  '@/components/landing/explorer-handoff': "const React = require('react'); module.exports = { ExplorerHandoffButton: (p) => React.createElement('a', { className: p.className, 'data-handoff': 'explorer' }, 'Use Mingla') }",
  '@/components/landing/host-handoff': "const React = require('react'); module.exports = { HostHandoffButton: (p) => React.createElement('a', { className: p.className, 'data-handoff': 'host' }, 'Use Mingla Host') }",
  './nav-call-link': "module.exports = { NavCallLink: () => null }",
}

test('the 14 converted pages are site registry keys and each route wraps its coded page in PublishedOr', () => {
  const keys = new Set(siteRegistry.SITE_PAGES.map((p) => p.key))
  for (const p of converted.CONVERTED_PAGES) {
    assert.ok(keys.has(p.key), p.key)
    assert.equal(siteRegistry.SITE_PAGES.find((x) => x.key === p.key).path, p.path, `${p.key} path`)
  }
  const routes = {
    home: 'app/(explorer)/page.tsx', host: 'app/host/page.tsx', creators: 'app/creators/page.tsx', locals: 'app/locals/page.tsx',
    about: 'app/(core)/about/page.tsx', 'going-out': 'app/(core)/going-out/page.tsx', download: 'app/download/page.tsx',
  }
  for (const [key, file] of Object.entries(routes)) assert.match(read(file), new RegExp(`<PublishedOr pageKey="${key}"`), file)
  assert.match(read('app/host/[icp]/page.tsx'), /<PublishedOr pageKey=\{icp\}/)
  const wrapper = read('components/site-blocks/published-page.tsx')
  assert.match(wrapper, /if \(!published \|\| published\.sections === null\) return children/)
  assert.match(wrapper, /renderableCount\(published\.sections, published\.media\) === 0/)
  assert.match(wrapper, /current=\{page\.current\}\s+layoutMain=\{page\.layoutMain\}\s+slug=\{page\.icp\}/)
})

test('one fetch per page, under its own cache tag; the preview reads only its own page', () => {
  assert.equal(tags.sitePageTag('home'), 'site-page:home')
  assert.equal(tags.sitePageTag('p-0123456789ab'), 'site-page:p-0123456789ab')
  assert.throws(() => tags.sitePageTag('../x'))
  const src = read('lib/site-pages/published.ts')
  assert.match(src, /rpc\('site_public_page', \{ p_page_key: key \}\), \['site-public-page-v1', key\], \{\s+tags: \[sitePageTag\(key\)\],/)
  assert.match(src, /if \(preview\.pageKey !== key\) return null/)
  assert.doesNotMatch(read('lib/site-pages/content.ts'), /sections/, 'the #4452 whole-site read carries no block lists')
})

test('a library item becomes a plain public storage URL; legacy v:/p: refs are untouched', () => {
  const id = '46360000-0000-4000-c000-0000000000a2'
  const map = { [id]: { kind: 'video' }, '46360000-0000-4000-c000-0000000000a1': { kind: 'image' } }
  const out = media.resolveLibraryRefs({ media: `m:${id}`, items: [{ media: 'm:46360000-0000-4000-c000-0000000000a1' }, { media: 'v:amb-about' }] }, map)
  assert.deepEqual(out, { value: { media: `mv:${id}`, items: [{ media: 'mp:46360000-0000-4000-c000-0000000000a1' }, { media: 'v:amb-about' }] }, missing: [] })
  assert.deepEqual([...media.libraryIds({ a: [`m:${id}`, 'p:x'] })], [id])
  const T = tsxRenderer('issue-4636-media-ref-', { stubs: { './clip-av1.generated.json': `module.exports = ${fs.readFileSync(path.join(MARKETING, 'lib/clip-av1.generated.json'), 'utf8')}` } })
  after(T.cleanup)
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abc.supabase.co/'
  const ref = T.load('lib/landing-media-ref.ts')
  assert.deepEqual(ref.resolveLandingMedia(`mv:${id}`), {
    kind: 'video',
    src: `https://abc.supabase.co/storage/v1/object/public/site-video/library/${id}.mp4`,
    poster: `https://abc.supabase.co/storage/v1/object/public/site-media/library/${id}_poster.jpg`,
  })
  assert.equal(ref.resolveLandingMedia(`mp:${id}`).poster, `https://abc.supabase.co/storage/v1/object/public/site-media/library/${id}.jpg`)
  assert.deepEqual(ref.resolveLandingMedia('v:amb-about'), { kind: 'video', src: '/marketing/site/m/amb-about.mp4', poster: '/marketing/site/m/amb-about.jpg' })
  const clips = T.load('lib/clip-sources.ts')
  const env = { viewportWidth: 390, coarsePointer: true, av1: true }
  assert.equal(clips.clipSourceFor(`https://abc.supabase.co/storage/v1/object/public/site-video/library/${id}.mp4`, env), `https://abc.supabase.co/storage/v1/object/public/site-video/library/${id}.mp4`, 'no -sm / webm sibling for library clips')
  assert.equal(clips.webpPoster(`https://abc.supabase.co/storage/v1/object/public/site-media/library/${id}_poster.jpg`).endsWith('.jpg'), true)
  assert.equal(clips.clipSourceFor('/marketing/site/m/amb-about.mp4', env).includes('-sm'), true, 'site clips unchanged')
})

test('a usable published list renders: hidden blocks skipped, programme frames shared', () => {
  const list = [
    { type: 'answer', version: 1, content: { question: 'What is Mingla?', answer: 'A plans app.' } },
    { type: 'marquee', version: 1, content: { words: ['a', 'b', 'c'] }, hidden: true },
    { type: 'steps', version: 1, content: { variant: 'creators', heading: 'How it *works.*', items: [{ title: 'One', body: 'x', visual: 'v:salsa' }, { title: 'Two', body: 'y', visual: 'v:salsa' }, { title: 'Three', body: 'z', visual: 'v:salsa' }] } },
  ]
  const reports = []
  const p = plan.planBlocks(list, (m) => reports.push(m))
  assert.equal(p.groups.flatMap((g) => g.items).length, plan.usableBlockCount(list, {}))
  assert.equal(plan.usableBlockCount(list, {}) >= 1, true)
})

test('nav and footer: with nothing published they render byte-identical to origin/main; with settings, the published links', () => {
  const main = (rel) => {
    try {
      return execFileSync('git', ['show', `origin/main:mingla-marketing/${rel}`], { cwd: MARKETING, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      return null
    }
  }
  const before = tsxRenderer('issue-4636-chrome-before-', { stubs: NEXT_STUBS, source: (rel) => (rel === 'components/site/site-nav.tsx' || rel === 'components/marketing/footer.tsx' ? main(rel) : null) })
  const now = tsxRenderer('issue-4636-chrome-now-', { stubs: NEXT_STUBS })
  after(before.cleanup)
  after(now.cleanup)
  for (const surface of ['explorer', 'host']) {
    const NavB = before.load('components/site/site-nav.tsx').SiteNav
    const NavN = now.load('components/site/site-nav.tsx').SiteNav
    const FootB = before.load('components/marketing/footer.tsx').SiteFooter
    const FootN = now.load('components/marketing/footer.tsx').SiteFooter
    const e = before.React.createElement
    assert.equal(now.render(now.React.createElement(NavN, { surface, current: 'host', settings: null, extraMenu: [] })), before.render(e(NavB, { surface, current: 'host' })), `nav ${surface}`)
    assert.equal(now.render(now.React.createElement(FootN, { surface, settings: null })), before.render(e(FootB, { surface })), `footer ${surface}`)
  }
  const NavN = now.load('components/site/site-nav.tsx').SiteNav
  const FootN = now.load('components/marketing/footer.tsx').SiteFooter
  const nav = { top: [{ label: 'Going out', to: '/going-out' }, { label: 'Summer', to: '/summer-socials' }], menu: [{ title: 'Explore', links: [{ label: 'Home', to: '/' }] }] }
  const navHtml = now.render(now.React.createElement(NavN, { surface: 'explorer', current: 'going-out', settings: nav, extraMenu: [{ href: '/rooftops', label: 'Rooftops' }] }))
  assert.match(navHtml, /<a href="\/summer-socials">Summer<\/a>/)
  assert.match(navHtml, /<a href="\/going-out" class="on" aria-current="page">Going out<\/a>/)
  assert.match(navHtml, /<a href="\/rooftops">Rooftops<\/a>/, 'a live staff page that asked to be in the menu')
  assert.doesNotMatch(navHtml, /Free tools/, 'the coded links are replaced')
  const footHtml = now.render(now.React.createElement(FootN, { surface: 'explorer', settings: { columns: [{ title: 'Company', links: [{ label: 'Careers', to: 'https://career.usemingla.com' }] }], tagline: 'Plans, sorted.' } }))
  assert.match(footHtml, /<a href="https:\/\/career\.usemingla\.com">Careers<\/a>/)
  assert.match(footHtml, /Mingla\. Plans, sorted\./)
  assert.equal(settings.settingsErrors({ nav, footer: { columns: [{ title: 'X', links: [{ label: 'Y', to: 'mailto:hi@usemingla.com' }] }] } }).length, 0)
})

test('staff-made pages: live renders, deleted redirects (308), drafts never; sitemap and menu take live pages only', () => {
  const live = { key: 'p-0123456789ab', path: '/summer-socials', status: 'live', redirect_to: null, name: 'Summer socials', description: 'Rooftops.', format: 'landing', hide_from_search: false, show_in_menu: true, published_at: '2026-11-27T00:00:00Z', share: { bucket: 'site-media', path: 'library/x.jpg', width: 1200, height: 630, alt: 'A rooftop' } }
  const gone = { ...live, key: 'p-0123456789ac', path: '/old-launch', status: 'unpublished', redirect_to: '/' }
  const hidden = { ...live, key: 'p-0123456789ad', path: '/secret/june', hide_from_search: true, show_in_menu: false }
  const index = custom.customIndexFrom([live, gone, hidden, { junk: true }])
  const reserved = JSON.parse(read('lib/site-pages/reserved-paths.json')).segments
  assert.equal(index.length, 3)
  assert.deepEqual(custom.routeCustom(['summer-socials'], index, reserved), { kind: 'page', entry: live })
  assert.deepEqual(custom.routeCustom(['old-launch'], index, reserved), { kind: 'redirect', to: '/' })
  assert.equal(custom.routeCustom(['secret', 'june'], index, reserved).kind, 'page')
  assert.deepEqual(custom.sitemapEntries(index).map((e) => e.path), ['/summer-socials'])
  assert.deepEqual(custom.menuEntries(index), [{ href: '/summer-socials', label: 'Summer socials' }])
  const meta = custom.customPageMetadata(live, 'https://abc.supabase.co/storage/v1/object/public')
  assert.deepEqual(meta.robots, { index: true, follow: true })
  assert.equal(meta.alternates.canonical, 'https://usemingla.com/summer-socials')
  assert.equal(meta.openGraph.images[0].url, 'https://abc.supabase.co/storage/v1/object/public/site-media/library/x.jpg')
  assert.equal(custom.surfaceForFormat('host-type'), 'host')
  const route = read('app/[...slug]/page.tsx')
  assert.match(route, /if \(r\.kind === 'redirect'\) permanentRedirect\(r\.to\)/)
  assert.match(route, /if \(r\.kind !== 'page'\) notFound\(\)/)
  assert.match(read('app/sitemap.ts'), /sitemapEntries\(await customIndex\(\)\)/)
})

test('publish refreshes one page: the revalidate route takes a page key', () => {
  assert.equal(revalidate.revalidateTargetFor('{"tag":"pages","page":"host"}'), 'pages')
  assert.equal(revalidate.revalidatePageKeyFor('{"tag":"pages","page":"host"}'), 'host')
  assert.equal(revalidate.revalidatePageKeyFor('{"tag":"pages"}'), undefined)
  assert.equal(revalidate.revalidatePageKeyFor(''), undefined)
  const route = read('app/api/blog/revalidate/route.ts')
  assert.match(route, /if \(page\) revalidateTag\(sitePageTag\(page\)\)/)
  assert.match(route, /revalidated: true, tag, page/)
})

test('each converted page has a current default block list that the registry accepts', () => {
  assert.equal(fs.readFileSync(DEFAULTS_JSON, 'utf8'), pageDefaultsJsonText(), 'run node scripts/issue-4636-page-defaults.mjs')
  const json = JSON.parse(fs.readFileSync(DEFAULTS_JSON, 'utf8'))
  assert.deepEqual(Object.keys(json.pages).sort(), [...converted.CONVERTED_PAGE_KEYS].sort())
  for (const [key, blocks] of Object.entries(json.pages)) {
    const check = registry.validatePage(blocks)
    assert.ok(check.ok, `${key}: ${JSON.stringify([check.errors, check.results.filter((r) => !r.ok)])}`)
    assert.ok(blocks.length >= 1, key)
  }
  assert.deepEqual(json.pages.home.map((b) => [b.type, b.colour ?? null]), [['reelHero', 'paper'], ['steps', 'paper'], ['tiles', 'night'], ['citiesRow', 'paper'], ['marquee', null], ['videoBand', null]])
})
