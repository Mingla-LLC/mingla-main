// #4339 phase 2c — implementor regression test for the leftovers moved onto the
// new frame: the help video articles (/help/<slug>), the blog posts
// (/blog/<slug>) and the four free tools with their report pages
// (/tools/venues|events|trips|pricing[/report]).
//
// Source mode (default, no install) reads the source. Built mode
// (ISSUE_4339_BUILT=1 after `npm run build`) reads the prerendered help
// articles and tool pages.
//
// Pins:
//   - each route renders the site nav, ONE <main id="main"> and the canonical
//     footer, with the brand faces route-scoped (#3548), and none of the old
//     frame (CutoutNav / CutoutFooter / the tools' old top bar and audience menu);
//   - the help article keeps its content and behaviour: the player with
//     captions, the title, blurb and meta line, the server-rendered steps with
//     their outbound links (new tab, noopener), Up next, the video and
//     breadcrumb structured data, and the #3431 copy opt-in on <main>;
//   - the blog post is the same BlogPostView; only the staff preview keeps the
//     old frame;
//   - the tools keep their dark stage and their content, outside the brand
//     root's element resets.
//
// Run from mingla-marketing/ (Node 22.13+):
//   node --test lib/__tests__/issue-4339-leftovers.implementor.test.mjs

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const MARKETING = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => fs.readFileSync(path.join(MARKETING, rel), 'utf8')
const code = (source) => source.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const BUILT = process.env.ISSUE_4339_BUILT === '1'
const FACES = /className=\{`\$\{landingSerif\.variable\} \$\{landingSans\.variable\} \$\{landingMono\.variable\}`\}/

test('help articles: the new frame, the same content and behaviour', () => {
  const page = code(read('app/help/[slug]/page.tsx'))
  assert.match(page, /from '@\/app\/site-fonts'/)
  assert.match(page, FACES)
  assert.match(page, /<SitePage surface="host" current="help" layoutMain>/, 'the site nav and footer; the layout keeps <main>')
  assert.doesNotMatch(page, /CutoutNav|CutoutFooter|CutoutShell|CutoutSection/, 'no old frame')
  assert.match(code(read('app/help/layout.tsx')), /<main id="main" data-allow-copy="">/, '#3431 copy opt-in stays on the one <main>')
  // Content and behaviour.
  assert.match(page, /export const dynamicParams = false/)
  assert.match(page, /generateStaticParams\(\)[\s\S]*HELP_VIDEOS\.map/)
  assert.match(page, /<HelpVideoSchema video=\{video\} \/>/)
  assert.match(page, /<BreadcrumbSchema\s+crumbs=\{\[\s*\{ name: 'Mingla', path: '\/' \},\s*\{ name: 'Help centre', path: '\/help' \},\s*\{ name: video\.title, path: helpVideoPath\(video\.slug\) \},/)
  assert.match(page, /<HelpPlayer\s+hlsUrl=\{bambooHlsUrl\(video\.bambooEntryId\)\}\s+poster=\{bambooPosterUrl\(video\.bambooEntryId, 1280\)\}\s+title=\{video\.title\}\s+captionsUrl=\{captions \?\? undefined\}/)
  assert.match(page, /This one is being recorded\. The steps below are complete\./)
  assert.match(page, /<h1 className="art-title">\{video\.title\}<\/h1>/)
  assert.match(page, /\{video\.blurb\}/)
  assert.match(page, /Shown on \{video\.surfaces\.join\(', '\)\}/)
  assert.match(page, /What happens in this video/)
  assert.match(page, /video\.steps\.map/)
  assert.match(page, /target="_blank"\s+rel="noopener noreferrer"/, 'outbound step links open a new tab with noopener')
  assert.match(page, /Up next[\s\S]*helpVideoPath\(next\.slug\)/)
  assert.doesNotMatch(read('app/help/[slug]/page.tsx'), /^'use client'/m, 'still a server component')
})

test('blog posts: the new frame around the same story; only the staff preview keeps the old frame', () => {
  const page = code(read('app/blog/[slug]/page.tsx'))
  assert.match(page, FACES)
  assert.match(page, /<SitePage surface="explorer">\s*<div className="blog-post">\s*<BlogPostView post=\{post\} embeds=\{embeds\} \/>/)
  assert.match(page, /export const dynamic = 'force-dynamic'/)
  const layout = code(read('app/blog/layout.tsx'))
  assert.match(layout, /bare=\{\['\/blog'\]\}\s+barePrefixes=\{\['\/blog\/'\]\}\s+framedPrefixes=\{\['\/blog\/preview\/'\]\}/)
  const frame = code(read('components/site/route-frame.tsx'))
  assert.match(frame, /if \(framedPrefixes\.some\(\(prefix\) => path\.startsWith\(prefix\)\)\) return false/, 'the preview is framed even under the bare /blog/ prefix')
  assert.match(code(read('app/blog/[slug]/not-found.tsx')), /<SitePage surface="explorer">/, 'a missing post keeps the nav and footer')
  assert.match(code(read('app/blog/error.tsx')), /if \(pathname\?\.startsWith\('\/blog\/preview\/'\)\) return section/)
  const css = code(read('components/site/pages.css'))
  assert.match(css, /\[data-landing\] \.blog-post \.blog-display,[\s\S]*?font-family: var\(--serif\);/, 'brand serif headings')
})

test('the four tools and their reports: the new frame, the dark stage and their content untouched', () => {
  const layout = code(read('app/tools/layout.tsx'))
  assert.match(layout, FACES)
  assert.match(layout, /<RouteFrame bare=\{\['\/tools'\]\} variant="site-tools" header=\{<ToolsBreadcrumb \/>\} footer=\{null\}>/)
  assert.doesNotMatch(layout, /ToolsAudienceMenu|mingla-wordmark\.svg|<Footer\b|<header/, 'no old top bar, audience menu or footer')
  assert.equal(fs.existsSync(path.join(MARKETING, 'components/marketing/tools-audience-menu.tsx')), false, 'the old audience menu is gone (no other user)')
  const frame = code(read('components/site/route-frame.tsx'))
  const block = frame.slice(frame.indexOf("if (variant === 'site-tools')"), frame.indexOf("if (variant === 'tools')"))
  assert.match(block, /<LandingRoot>\s*<SiteNav surface="host" current="tools" \/>\s*<\/LandingRoot>/)
  assert.match(block, /<main id="main" className="tools-stage bg-smoke text-text-primary" data-tools-stage="">\s*\{header\}\s*\{children\}\s*<\/main>/)
  assert.match(block, /<LandingRoot>\s*<SiteFooter surface="host" \/>\s*<\/LandingRoot>/)
  assert.ok(block.indexOf('</LandingRoot>') < block.indexOf('<main'), 'the stage sits outside the brand root (its element resets would override the tools’ Tailwind)')
  const css = code(read('components/site/pages.css'))
  assert.match(css, /\.tools-stage\[data-tools-stage\] \{[^}]*--font-display: var\(--font-landing-serif\)[^}]*--font-sans: var\(--font-landing-sans\)/)
  // The tool pages render inside the layout and bring no frame of their own.
  for (const tool of ['venues', 'events', 'trips', 'pricing']) {
    for (const rel of [`app/tools/${tool}/page.tsx`, `app/tools/${tool}/report/page.tsx`]) {
      assert.doesNotMatch(code(read(rel)), /CutoutNav|SiteNav|SitePage|<Footer\b|SiteFooter/, `${rel}: framed by the layout only`)
    }
  }
})

test('no other public marketing route is left on the old side menu', () => {
  const walk = (dir) =>
    fs.readdirSync(path.join(MARKETING, dir), { withFileTypes: true }).flatMap((e) => {
      const rel = path.join(dir, e.name)
      return e.isDirectory() ? walk(rel) : /\.tsx$/.test(e.name) ? [rel] : []
    })
  const old = walk('app').filter((rel) => /CutoutNav|ToolsAudienceMenu|GlassNav/.test(code(read(rel))))
  // The blog layout keeps CutoutNav for the staff preview only; /internal is not public.
  assert.deepEqual(old.sort(), ['app/blog/layout.tsx', 'app/internal/charts/page.tsx'])
})

// ---- built mode ---------------------------------------------------------------
const built = (rel) => fs.readFileSync(path.join(MARKETING, '.next/server/app', rel), 'utf8')

test('built: a help article and every tool page carry the site nav, one <main> and the canonical footer', { skip: !BUILT }, () => {
  const pages = ['help/getting-the-apps.html', 'tools/venues.html', 'tools/events.html', 'tools/trips.html', 'tools/pricing.html']
  for (const rel of pages) {
    const html = built(rel)
    assert.match(html, /data-site-nav=""/, `${rel}: site nav`)
    assert.match(html, /data-site-footer=""/, `${rel}: canonical footer`)
    assert.equal((html.match(/<main\b/g) ?? []).length, 1, `${rel}: one <main>`)
    assert.doesNotMatch(html, /aria-label="Mingla Host home"/, `${rel}: no old top bar`)
    assert.doesNotMatch(html.replace(/<script\b[\s\S]*?<\/script>/g, ''), /Privacy choices/i)
  }
  const help = built('help/getting-the-apps.html')
  assert.match(help, /<main id="main" data-allow-copy="">/)
  assert.match(help, /What happens in this video/)
  for (const tool of ['venues', 'events', 'trips', 'pricing']) assert.match(built(`tools/${tool}.html`), /data-tools-stage=""/)
})

// ---- review fixes (coordinator, 8 Nov) ------------------------------------------
test('no empty gap: a section the reader jumped past is still revealed', () => {
  const root = code(read('components/landing/landing-root.tsx'))
  assert.match(root, /root\.querySelectorAll<HTMLElement>\('\.reveal:not\(\.in\)'\)\.forEach\(\(el\) => \{\s*if \(el\.getBoundingClientRect\(\)\.top < window\.innerHeight\) \{\s*el\.classList\.add\('in'\)/)
  assert.match(root, /window\.addEventListener\('scroll', onCatchUp, \{ passive: true \}\)/)
  // The city guide band keeps its serif heading in every city, plans or not.
  assert.match(code(read('components/cities/city-page.tsx')), /<h2 className="h2" id="city-guide-title">\s*More than <em>one mode\.<\/em>\s*<\/h2>/)
})

test('Cary uses the licensed fountain photo, never the cover with drinks in shot (no alcohol, §11)', () => {
  assert.equal(fs.existsSync(path.join(MARKETING, 'public/marketing/site/p/weekend-cary-cover.jpg')), false)
  for (const rel of ['components/site/city-media.tsx', 'components/site/home-page.tsx', 'app/(core)/going-out/page.tsx']) {
    const source = code(read(rel))
    assert.doesNotMatch(source, /weekend-cary-cover/, rel)
    assert.match(source, /'p:cary-fountain'/, rel)
  }
  const same = (a, b) => fs.readFileSync(path.join(MARKETING, a)).equals(fs.readFileSync(path.join(MARKETING, b)))
  assert.ok(same('public/marketing/site/p/cary-fountain.jpg', 'public/marketing/cities/cards/cary-nc.jpg'), 'the same licensed bytes as the Cary city card')
  const manifest = JSON.parse(read('public/marketing/cities/asset-manifest.json'))
  const card = manifest.assets.find((a) => a.path === '/marketing/cities/cards/cary-nc.jpg')
  assert.ok(card && card.license && card.aiGenerated === false, 'licensed, not generated')
})

test('built: the Cary page and tile use the fountain', { skip: !BUILT }, () => {
  for (const rel of ['cities/cary-nc.html', 'cities.html', 'index.html', 'going-out.html']) {
    const html = built(rel)
    assert.doesNotMatch(html, /weekend-cary-cover/, rel)
  }
  assert.match(built('cities/cary-nc.html'), /\/marketing\/site\/p\/cary-fountain\.jpg/)
})
