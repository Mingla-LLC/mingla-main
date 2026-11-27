// #4636 build 2 (adversarial, a distinct angle from the happy file): what a broken,
// hostile or half-finished state does to the public site.
//   A-1 a draft never reaches a public read: the page read uses the preview only inside a
//       preview, for its own page; the staff page index has no drafts; the catch-all 404s them.
//   A-2 invalid published content falls back safely and reports: a non-list, all-invalid
//       blocks, a missing library item or an unknown type leave the coded page; partial
//       invalid lists skip only the bad blocks.
//   A-3 addresses: reserved (/host, /blog/x, /api), malformed (uppercase, three segments, dots,
//       encoded), and a redirect that tries to leave the site.
//   A-4 noindex for hidden pages; no share image without a storage root.
//   A-5 a hostile nav / footer payload stays coded; the revalidate route refuses a bad page key.
// FAILS-ON-REVERT: removing the reserved check in routeCustom fails A-3; returning the first
// missing-media block from usableBlockCount fails A-2; dropping safeRedirect fails A-3.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, test } from 'node:test'
import { loader, MARKETING } from './issue-4452-ts-loader.mjs'

const read = (p) => fs.readFileSync(path.join(MARKETING, p), 'utf8')
const L = loader('issue-4636-published-adv-')
after(L.cleanup)
const custom = await L.load('site-pages/custom')
const settings = await L.load('site-pages/settings')
const plan = await L.load('site-blocks/render-plan')
const revalidate = await L.load('revalidate-tag')
const reserved = JSON.parse(read('lib/site-pages/reserved-paths.json')).segments

const ok = { type: 'answer', version: 1, content: { question: 'Q?', answer: 'A.' } }
const libId = '46360000-0000-4000-a000-0000000000c1'

test('A-1 a draft never reaches a public read', () => {
  const src = read('lib/site-pages/published.ts')
  // The preview branch is the ONLY place a draft is read, and only for the previewed page.
  assert.match(src, /const preview = previewSlot\(\)\.value\n  if \(preview\) \{\n    if \(preview\.pageKey !== key\) return null/)
  assert.doesNotMatch(src, /admin_site_page|site_page_drafts/, 'the site never calls an admin read')
  // A draft-only staff page is not in the index the catch-all routes by.
  const index = custom.customIndexFrom([{ key: 'p-0123456789ab', path: '/launch', status: 'draft', redirect_to: null }])
  assert.equal(index.length, 0)
  assert.deepEqual(custom.routeCustom(['launch'], index, reserved), { kind: 'not-found' })
  // The preview route is never cached or indexed.
  const preview = read('app/site-preview/[token]/page.tsx')
  assert.match(preview, /export const dynamic = 'force-dynamic'/)
  assert.match(preview, /robots: \{ index: false, follow: false \}/)
})

test('A-2 invalid published content falls back safely and reports', () => {
  assert.equal(plan.usableBlockCount('not a list', {}), 0, 'a non-list keeps the coded page')
  assert.equal(plan.usableBlockCount([{ type: 'carousel3d', version: 1, content: {} }, { type: 'answer', version: 9, content: {} }], {}), 0, 'all invalid → coded')
  assert.equal(plan.usableBlockCount([{ type: 'wideClip', version: 1, content: { media: `m:${libId}` } }], {}), 0, 'a missing library item → not drawn')
  assert.equal(plan.usableBlockCount([{ type: 'wideClip', version: 1, content: { media: `m:${libId}` } }], { [libId]: { kind: 'video' } }), 1)
  assert.equal(plan.usableBlockCount([ok, { type: 'answer', version: 1, content: { question: '<script>', answer: 'x' } }], {}), 1, 'only the bad block is skipped')
  assert.equal(plan.usableBlockCount([{ ...ok, hidden: true }], {}), 0, 'a list of hidden blocks draws nothing → coded')
  assert.equal(plan.usableBlockCount([ok], {}, (t) => t !== 'answer'), 0, 'a type with no renderer → coded')
  const reports = []
  plan.planBlocks([ok, { type: 'answer', version: 1, content: { question: 'x'.repeat(121), answer: 'y' } }], (m) => reports.push(m))
  assert.ok(reports.some((m) => /block 1 skipped/.test(m)), 'the skipped block is reported')
  const wrapper = read('components/site-blocks/published-page.tsx')
  assert.match(wrapper, /report\(`\$\{pageKey\}: the published block list has nothing that can render; the coded page stays`\)\n    return children/)
  const renderer = read('components/site-blocks/block-renderer.tsx')
  assert.match(renderer, /report\(`block \$\{index\} skipped: media library item \$\{resolved\.missing\.join\(', '\)\} is not available`\)\n      return null/)
  // The read itself failing: the coded page, with a console.error and no payload.
  assert.match(read('lib/site-pages/published.ts'), /console\.error\('\[site-pages\] page content unavailable; the page renders as coded'\)\n    return null/)
})

test('A-3 addresses: reserved, malformed and off-site redirects', () => {
  const live = (path) => ({ key: 'p-0123456789ab', path, status: 'live', redirect_to: null, name: 'x', description: null, format: 'blank', hide_from_search: false, show_in_menu: false, published_at: null, share: null })
  // Even a row that somehow holds a reserved address is never served (the catch-all re-checks).
  for (const p of [['host'], ['blog', 'x'], ['api'], ['site-preview'], ['careers-not-found'], ['tools', 'venues']]) {
    const path = `/${p.join('/')}`
    assert.deepEqual(custom.routeCustom(p, [live(path)], reserved), { kind: 'not-found' }, path)
  }
  for (const p of [['Summer'], ['a', 'b', 'c'], ['..'], ['a..b'], ['%2e%2e'], ['a_b'], ['-a'], ['a--b'], [], undefined]) {
    assert.equal(custom.addressFor(p), null, JSON.stringify(p))
  }
  for (const bad of ['https://evil.example', '//evil.example', '/../admin', 'javascript:alert(1)', null, '']) assert.equal(custom.safeRedirect(bad), '/', String(bad))
  assert.equal(custom.safeRedirect('/going-out?from=old'), '/going-out?from=old')
  const gone = { ...live('/old'), status: 'unpublished', redirect_to: 'https://evil.example' }
  assert.deepEqual(custom.routeCustom(['old'], [gone], reserved), { kind: 'redirect', to: '/' }, 'a redirect never leaves the site')
  const loop = { ...live('/loop'), status: 'unpublished', redirect_to: '/loop' }
  assert.deepEqual(custom.routeCustom(['loop'], [loop], reserved), { kind: 'not-found' }, 'a redirect to itself is a 404, not a loop')
})

test('A-4 hidden pages are noindex; no share image without a storage root', () => {
  const entry = { key: 'p-0123456789ab', path: '/quiet', status: 'live', redirect_to: null, name: 'Quiet', description: null, format: 'story', hide_from_search: true, show_in_menu: false, published_at: null, share: { bucket: 'site-media', path: 'library/x.jpg', width: 1, height: 1, alt: 'x' } }
  const meta = custom.customPageMetadata(entry, '')
  assert.deepEqual(meta.robots, { index: false, follow: false })
  assert.equal(meta.openGraph.images, undefined)
  assert.equal(meta.description, undefined)
  assert.deepEqual(custom.sitemapEntries([entry]), [], 'a hidden page is not in the sitemap')
})

test('A-5 a hostile nav / footer stays coded; a bad revalidate page key is refused', () => {
  const reports = []
  const out = settings.usableSettings({
    nav: { top: [{ label: 'Hi', to: 'javascript:alert(1)' }], menu: [{ title: 'X', links: [{ label: 'Y', to: '/' }] }] },
    footer: { columns: [{ title: '<b>x</b>', links: [{ label: 'y', to: '/' }] }] },
  }, (m) => reports.push(m))
  assert.deepEqual(out, { nav: null, footer: null })
  assert.equal(reports.length, 2)
  for (const bad of [{ nav: { top: [], menu: [] } }, { nav: { top: [{ label: 'a', to: '/' }], menu: [{ title: 'b', links: [{ label: 'c', to: '//evil' }] }] } }, { footer: { columns: Array(5).fill({ title: 'a', links: [{ label: 'b', to: '/' }] }) } }, { other: 1 }]) {
    assert.ok(settings.settingsErrors(bad).length > 0, JSON.stringify(bad))
  }
  assert.deepEqual(settings.usableSettings('nope', () => undefined), { nav: null, footer: null })
  assert.equal(revalidate.revalidatePageKeyFor('{"tag":"pages","page":"../etc"}'), null)
  assert.equal(revalidate.revalidatePageKeyFor('{"tag":"pages","page":7}'), null)
  assert.match(read('app/api/blog/revalidate/route.ts'), /if \(page === null\) return Response\.json\(\{ revalidated: false, error: 'unknown_page' \}, \{ status: 400, headers: NO_STORE \}\)/)
})
