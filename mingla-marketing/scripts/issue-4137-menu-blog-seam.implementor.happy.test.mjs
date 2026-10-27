#!/usr/bin/env node
// #4137 wave 2 — implementor happy path (source, server render): the menu's
// blog seam. AudienceMenuContent is rendered through react-dom/server with the
// seam value swapped in this test only, so no test hook ships.
//
//   AC-M3  shipped value: no Blog row, no story card, no /blog href.
//          blog on: Blog sits directly after Going out with "New", and the
//          Latest story card links to the newest post. Never one without the
//          other: a story with the blog hidden renders nothing.
//   AC-M8  the "New" badge reaches 4.5:1 on both inactive and active rows.
//
// {"invariant":"I-4137-MENU-BLOG-GATED","enforced_by":["this test"]}
// Fails on revert: the pre-wave-2 menu has no seam, no Blog row and no card.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import ts from 'typescript'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const requireReal = createRequire(path.join(ROOT, 'package.json'))
const React = requireReal('react')
const { renderToStaticMarkup } = requireReal('react-dom/server')

const MENU = 'components/cutout/audience-menu-content.tsx'
const seamSource = read('lib/blog/menu-entry.ts')
// #4137 wave 3: the value is produced at build time (scripts/generate-blog-menu-entry.mjs)
// into menu-entry.generated.json, committed as the hidden value.
assert.match(seamSource, /export const BLOG_MENU_ENTRY: BlogMenuEntry = parseBlogMenuEntry\(generated\)/, '#4137: the seam reads the build-time value')
assert.deepEqual(JSON.parse(read('lib/blog/menu-entry.generated.json')), { blogVisible: false, showNewBadge: false, latest: null }, '#4137: the committed seam value is hidden')
assert.doesNotMatch(seamSource.replace(/\/\/.*$/gm, ''), /coreReady|allCityHubsSearchReady|allCoreTrustPagesSearchReady|server-only/, '#4137: the seam is not a readiness gate and bundles into the client')
assert.match(read(MENU), /import \{ BLOG_MENU_ENTRY \} from '@\/lib\/blog\/menu-entry'/, '#4137: the menu reads the one seam')

function renderMenu(entry, pathname = '/') {
  const compiled = ts.transpileModule(read(MENU), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText
  const modules = {
    'react/jsx-runtime': requireReal('react/jsx-runtime'),
    'next/link': { __esModule: true, default: ({ href, children, onClick: _onClick, ...rest }) => React.createElement('a', { href, ...rest }, children) },
    'next/navigation': { usePathname: () => pathname },
    'lucide-react': requireReal('lucide-react'),
    '@/lib/blog/menu-entry': { BLOG_MENU_ENTRY: entry },
    './device-cta': { DeviceCta: ({ label, className }) => React.createElement('a', { className: `cut-btn ${className}`, 'data-test-cta': '' }, label) },
  }
  const module = { exports: {} }
  Function('module', 'exports', 'require', compiled)(module, module.exports, (id) => {
    if (!(id in modules)) throw new Error(`#4137 test: unexpected import ${id}`)
    return modules[id]
  })
  return renderToStaticMarkup(React.createElement(module.exports.AudienceMenuContent, { surface: 'explorer', onDismiss() {}, onChildDialogOpenChange() {} }))
}
const linkLabels = (html) => [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
  .map(([, href, inner]) => [inner.replace(/<span class="sr-only">[\s\S]*?<\/span>/g, '').replace(/<[^>]+>/g, '').trim(), href])

// Shipped value.
const shipped = renderMenu({ blogVisible: false, showNewBadge: false, latest: null })
assert.deepEqual(linkLabels(shipped), [
  ['Explorer', '/'], ['Cities', '/cities'], ['Going out', '/going-out'],
  ['Host', '/host'], ['Free tools', '/tools'],
  ['About', '/about'], ['Help', '/help'], ['Support', '/support'], ['Careers', 'https://career.usemingla.com'],
], '#4137 AC-M1: grouped links in DOM order')
assert.doesNotMatch(shipped, /cut-menu-story|href="\/blog/, '#4137 AC-M3: no Blog row and no story card while the blog is hidden')
assert.deepEqual([...shipped.matchAll(/class="cut-menu-group" id="([^"]+)">([^<]+)</g)].map((match) => match[2]), ['Explore', 'Host', 'Company'], '#4137: group labels in order')
assert.match(read('components/cutout/cutout.css'), /\.cut-menu-group \{[^}]*text-transform: uppercase;/, '#4137: group labels read EXPLORE, HOST, COMPANY')
assert.match(shipped, /<a href="https:\/\/career\.usemingla\.com" target="_blank" rel="noopener noreferrer"[^>]*>Careers<span class="sr-only">, opens in a new tab<\/span><\/a>/, '#4137: Careers opens in a new tab and says so')
assert.match(shipped, /class="cut-menu-ctas mt-auto[^"]*"><a class="cut-btn w-full justify-center !text-\[var\(--cut-ink\)\]" data-test-cta="">Explore Your City<\/a><a class="cut-btn w-full justify-center" data-test-cta="">Host Your City<\/a><\/div>/, '#4137: the two bottom CTAs are unchanged')

// Blog on, with a story.
const story = { href: '/blog/a-slow-saturday', title: 'A slow Saturday in Raleigh, in three stops', coverSrc: '/blog/cover.jpg', coverWidth: 120, coverHeight: 120 }
const on = renderMenu({ blogVisible: true, showNewBadge: true, latest: story })
const onLinks = linkLabels(on)
assert.deepEqual(onLinks.slice(0, 4), [['Explorer', '/'], ['Cities', '/cities'], ['Going out', '/going-out'], ['BlogNew', '/blog']], '#4137 AC-M3: Blog directly after Going out, with New')
assert.match(on, /<span class="cut-menu-new">New<\/span>/)
assert.match(on, /<a href="\/blog\/a-slow-saturday" class="cut-card cut-menu-story focus-ring"><img src="\/blog\/cover\.jpg" alt=""[^>]*\/><span><small>Latest story<\/small><strong>A slow Saturday in Raleigh, in three stops<\/strong><\/span><\/a>/, '#4137 AC-M3: story card')
assert.match(read('components/cutout/cutout.css'), /\.cut-menu-story small \{[^}]*text-transform: uppercase;/, '#4137: LATEST STORY')
const blogPage = renderMenu({ blogVisible: true, showNewBadge: false, latest: null }, '/blog/a-slow-saturday')
assert.deepEqual([...blogPage.matchAll(/<a\b[^>]*aria-current="page"[^>]*>([\s\S]*?)<\/a>/g)].map((match) => match[1].replace(/<[^>]+>/g, '')), ['Blog'], '#4137: /blog/* lights Blog only')
assert.doesNotMatch(blogPage, /cut-menu-new|cut-menu-story/, '#4137: no badge without showNewBadge and no card without a story')

// Never one without the other.
const hiddenWithStory = renderMenu({ blogVisible: false, showNewBadge: true, latest: story })
assert.doesNotMatch(hiddenWithStory, /cut-menu-story|href="\/blog|cut-menu-new/, '#4137: a story never shows while the blog is hidden')

// Active chips light alone.
for (const [pathname, label] of [['/help/create-an-event', 'Help'], ['/support', 'Support'], ['/about', 'About'], ['/cities/raleigh-nc', 'Cities'], ['/tools/events', 'Free tools'], ['/host', 'Host'], ['/going-out', 'Going out'], ['/', 'Explorer']]) {
  const html = renderMenu({ blogVisible: false, showNewBadge: false, latest: null }, pathname)
  const lit = [...html.matchAll(/<a\b[^>]*aria-current="page"[^>]*>([\s\S]*?)<\/a>/g)].map((match) => match[1].replace(/<[^>]+>/g, '').trim())
  assert.deepEqual(lit, [label], `#4137 AC-M2: ${pathname} lights ${label} only`)
}
// Off-menu pages keep the shell's surface fallback (unchanged #3371 rule): at most one lit item, never Careers.
const careers = renderMenu({ blogVisible: false, showNewBadge: false, latest: null }, '/careers')
assert((careers.match(/aria-current="page"/g) ?? []).length <= 1, '#4137: one lit item at most')
assert.doesNotMatch(careers, /href="https:\/\/career\.usemingla\.com"[^>]*aria-current/, '#4137: the external Careers chip never lights')

// AC-M8 — badge contrast from the shipped CSS.
const css = read('components/cutout/cutout.css')
const rule = (selector) => new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`).exec(css)?.[1] ?? assert.fail(`#4137: ${selector} missing`)
const colour = (body, prop) => new RegExp(`(?:^|;|\\s)${prop}: (#[0-9a-fA-F]{3,6})`).exec(body)?.[1] ?? assert.fail(`#4137: ${prop} missing`)
const luminance = (hex) => {
  const full = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex
  const [r, g, b] = [1, 3, 5].map((index) => parseInt(full.slice(index, index + 2), 16) / 255).map((c) => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }
for (const selector of ['.cut-menu-new', '.cut-btn-brand .cut-menu-new']) {
  const body = rule(selector)
  const ratio = contrast(colour(body, 'background'), colour(body, 'color'))
  assert(ratio >= 4.5, `#4137 AC-M8: ${selector} contrast ${ratio.toFixed(2)} < 4.5`)
  process.stdout.write(`EVIDENCE #4137 ${selector} contrast ${ratio.toFixed(2)}:1\n`)
}

// #4137 wave 3 — the derivation the build runs: Blog only with a public post,
// "New" for 14 days, Latest story = the newest post with a licensed cover, and
// anything malformed falls back to hidden.
{
  const derive = (() => {
    const js = ts.transpileModule(read('lib/blog/menu-entry-derive.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    const module = { exports: {} }
    Function('module', 'exports', js)(module, module.exports)
    return module.exports
  })()
  const now = new Date('2026-11-01T12:00:00Z')
  const media = (objectPath) => `https://example.supabase.co/storage/v1/object/public/blog-media/${objectPath}`
  const card = (slug, publishAt, cover = { path: 'u/c.jpg' }) => ({ slug, title: `Title ${slug}`, publish_at: publishAt, cover })
  assert.deepEqual(derive.blogMenuEntryFromIndex({ featured: null, posts: [] }, media, now), { blogVisible: false, showNewBadge: false, latest: null }, '#4137: no post, no Blog row')
  assert.deepEqual(derive.blogMenuEntryFromIndex(null, media, now), { blogVisible: false, showNewBadge: false, latest: null })
  const live = derive.blogMenuEntryFromIndex({ featured: card('pinned-old', '2026-09-01T00:00:00Z'), posts: [card('newest-one', '2026-10-30T00:00:00Z')] }, media, now)
  assert.equal(live.blogVisible, true)
  assert.equal(live.showNewBadge, true, '#4137: New while the newest story is under 14 days old')
  assert.equal(live.latest.href, '/blog/newest-one', '#4137: the newest post, even when another is featured')
  assert.equal(live.latest.coverSrc, `/_next/image?url=${encodeURIComponent(media('u/c.jpg'))}&w=128&q=75`, '#4137: licensed blog cover through the site optimiser')
  assert.equal(derive.blogMenuEntryFromIndex({ featured: null, posts: [card('old-one', '2026-09-01T00:00:00Z')] }, media, now).showNewBadge, false, '#4137: no New after 14 days')
  assert.equal(derive.blogMenuEntryFromIndex({ featured: null, posts: [card('no-cover', '2026-10-30T00:00:00Z', null)] }, media, now).latest, null, '#4137: no cover, no story card')
  assert.deepEqual(derive.parseBlogMenuEntry({ blogVisible: true, showNewBadge: true, latest: { href: 'https://evil.example', title: 'x', coverSrc: '/_next/image?url=x', coverWidth: 60, coverHeight: 60 } }), { blogVisible: true, showNewBadge: true, latest: null }, '#4137: a bad story href is dropped')
  assert.deepEqual(derive.parseBlogMenuEntry('nonsense'), { blogVisible: false, showNewBadge: false, latest: null })
}

process.stdout.write('PASS #4137 menu blog seam: hidden by default, Blog + New + Latest story only together, one lit item per route, AA badge\n')
