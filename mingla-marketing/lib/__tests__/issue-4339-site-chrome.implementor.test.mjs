// #4339 phase 2a — implementor regression test for the site chrome (nav,
// canonical footer, Explorer hand-off) and the redesigned Home (/) and
// Mingla Host (/host).
//
// Source mode (default, no install): node strips the TypeScript types from the
// real hand-off modules (lib/app-handoff.ts and the #4137 seam it calls) and
// runs them; expected URLs are read from lib/store-links.ts, never written
// here. Built mode (`npm run test:issue-4339:built` after `npm run build`,
// i.e. ISSUE_4339_BUILT=1) also reads the prerendered HTML of / and /host.
//
// Pins:
//   - the home headline is three lines at every width: "Find" / the rotating
//     italic phrase / "that fit the vibe." (each line its own nowrap block);
//   - one hand-drawn arrow to the one CTA, no badge, notes or icon strip;
//   - the canonical footer: its columns, "© <year> Mingla. Making real life
//     easier to find.", the cross-link, and NO "Privacy choices";
//   - Explorer and Host hand-offs resolve through lib/cta-destination.ts:
//     phones → the app's OneLink, computers → its sheet (Explorer: no web);
//   - no store, OneLink or host URL is hard-coded in the new files;
//   - the nav: wordmark, five links, surface CTA, the 300ms menu with all
//     seven landing pages; the landing pages use it instead of the old nav;
//   - the Reelmark carousel geometry, and clips that load only near centre,
//     never under reduced motion or Save-Data;
//   - the redesign brand faces load only on /, /host and /host/<icp>.
//
// Run from mingla-marketing/ (Node 22.13+):
//   node --test lib/__tests__/issue-4339-site-chrome.implementor.test.mjs

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { stripTypeScriptTypes } from 'node:module'
import { after, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const MARKETING = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => fs.readFileSync(path.join(MARKETING, rel), 'utf8')
const code = (source) => source.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const BUILT = process.env.ISSUE_4339_BUILT === '1'
const SLUGS = ['events', 'trips', 'experiences', 'restaurants', 'hotels', 'art', 'play']

const NEW_FILES = [
  'app/(explorer)/page.tsx',
  'app/host/page.tsx',
  'app/site-fonts.ts',
  'components/site/home-page.tsx',
  'components/site/host-page.tsx',
  'components/site/site-nav.tsx',
  'components/site/reel-hero.tsx',
  'components/site/reel-stage.tsx',
  'components/site/rotating-phrase.tsx',
  'components/site/site-prompt-demo.tsx',
  'components/site/wordmark.tsx',
  'components/site/site.css',
  'components/landing/explorer-handoff.tsx',
  'components/landing/handoff-sheet.tsx',
  'components/landing/host-handoff.tsx',
  'components/marketing/footer.tsx',
  'components/marketing/site-footer.css',
  'components/cutout/footer.tsx',
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
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-4339-chrome-'))
after(() => fs.rmSync(out, { recursive: true, force: true }))
const seen = new Set()
emit(path.join(MARKETING, 'lib/app-handoff.ts'), 'app-handoff', out, seen)
emit(path.join(MARKETING, 'lib/app-link-landing.ts'), 'app-link-landing', out, seen)
const load = (name) => import(pathToFileURL(path.join(out, `${name}.mjs`)).href)
const handoff = await load('app-handoff')
const stores = await load('store-links')
const links = await load('links-src')
const landing = await load('app-link-landing')

// ---------------------------------------------------------------------------
test('home headline is three lines: "Find" / the rotating italic phrase / "that fit the vibe."', () => {
  const home = code(read('components/site/home-page.tsx'))
  assert.match(
    home,
    /title=\{\s*<>\s*<span>Find<\/span>\s*<span className="rot">\s*<RotatingPhrase phrases=\{HOME_PHRASES\} \/>\s*<\/span>\s*<span>that fit the vibe\.<\/span>\s*<\/>\s*\}/,
    'three spans, the middle one the rotating phrase',
  )
  assert.match(home, /HOME_PHRASES = \['romantic plans', 'weekend plans', 'side quests', 'group plans', 'solo plans'\] as const/)
  assert.match(code(read('components/site/rotating-phrase.tsx')), /return <em className=\{out \? 'swap out' : 'swap'\}>\{phrases\[index\]\}<\/em>/, 'the phrase is italic')
  const css = code(read('components/site/site.css'))
  assert.match(css, /\.rm h1 \.rm-lines > span \{\s*display: block;\s*white-space: nowrap;/, 'each line is its own block that never wraps')
  // One arrow, one CTA, nothing else around the hero.
  const hero = code(read('components/site/reel-hero.tsx'))
  assert.equal((hero.match(/<svg className="arr"/g) ?? []).length, 1)
  assert.equal((hero.match(/\{cta\}/g) ?? []).length, 1)
  assert.doesNotMatch(hero + home, /className="(?:note|badge|rm-notes)"|eyebrow/, 'no notes, badge or label pill')
  assert.match(css, /animation: none;\s*stroke-dashoffset: 0;/, 'reduced motion: the arrow is simply drawn')
})

test('canonical footer: columns, tagline, cross-link, and no "Privacy choices"', () => {
  const footer = code(read('components/marketing/footer.tsx'))
  assert.match(footer, /SITE_FOOTER_TAGLINE = 'Making real life easier to find\.'/)
  assert.match(footer, /© \{new Date\(\)\.getFullYear\(\)\} Mingla\. \{SITE_FOOTER_TAGLINE\}/)
  const columns = [...footer.matchAll(/title: '(\w+)',\s*links: \[([\s\S]*?)\]/g)].map((m) => [m[1], [...m[2].matchAll(/label: '([^']+)'/g)].map((l) => l[1])])
  assert.deepEqual(columns, [
    ['Explore', ['Home', 'Going out', 'Cities', 'Blog']],
    ['Host', ['For Hosts', 'Free tools', 'Help centre']],
    ['Company', ['About', 'Careers']],
    ['Legal', ['Privacy', 'Terms', 'Organiser Terms', 'Support']],
  ])
  assert.match(footer, /explorer: \{ href: '\/host', label: 'Run a venue, event or experience\? → Mingla Host' \}/)
  assert.match(footer, /host: \{ href: '\/', label: 'Looking for the app\? → Mingla for Explorers' \}/)
  assert.match(footer, /<Wordmark height=\{26\} title=\{null\} \/>/, 'small 26px wordmark')
  for (const rel of ['components/marketing/footer.tsx', 'components/cutout/footer.tsx', 'components/marketing/site-footer.css']) {
    assert.doesNotMatch(code(read(rel)), /privacy choices|privacy-choices|PrivacyChoices/i, `${rel}: no privacy control of its own`)
  }
  // Every page gets the same one.
  assert.match(code(read('components/cutout/footer.tsx')), /return <SiteFooter surface=\{surface\} \/>/)
  assert.match(footer, /export function Footer\(\{ surface \}: \{ surface: Surface \}\) \{\s*return <SiteFooter surface=\{surface === 'organiser' \? 'host' : 'explorer'\} \/>/)
  assert.match(code(read('components/site/home-page.tsx')), /<SiteFooter surface="explorer" \/>/)
  assert.match(code(read('components/site/host-page.tsx')), /<SiteFooter surface="host" \/>/)
  assert.match(code(read('components/landing/icp-landing.tsx')), /<SiteFooter surface="host" \/>/)
  const css = code(read('components/marketing/site-footer.css'))
  assert.match(css, /padding: 72px 0 calc\(48px \+ var\(--mingla-privacy-inset, 0px\)\)/, 'clears the #4318 strip')
  assert.doesNotMatch(css, /position:\s*fixed/)
})

test('Explorer hand-off: phone → Explorer OneLink, computer → "Mingla lives on your phone" with no web option', () => {
  const attribution = links.siteAttribution('explorer_nav')
  for (const platform of ['ios', 'android']) {
    const h = handoff.resolveAppHandoff('explorer', platform, attribution)
    assert.equal(h.action, 'navigate')
    assert.ok(h.href.startsWith(`${stores.EXPLORER_ONELINK_URL}?`), `${platform} goes to the Explorer OneLink: ${h.href}`)
    assert.match(h.href, /c=explorer_nav/)
  }
  assert.deepEqual(handoff.resolveAppHandoff('explorer', 'other', attribution), { action: 'sheet', sheet: 'explore' })
  const hrefs = handoff.appHandoffHrefs('explorer', attribution)
  assert.equal(hrefs.computerHref, landing.DOWNLOAD_PATH, 'no-JS computers reach the QR page')
  assert.deepEqual(hrefs.stores, { appStore: stores.APP_STORE_URL, googlePlay: stores.PLAY_STORE_URL })

  const button = code(read('components/landing/explorer-handoff.tsx'))
  assert.match(button, /from '@\/lib\/app-handoff'/)
  assert.match(button, /<DeviceLink\s+surface="explorer"/)
  assert.match(button, /resolveAppHandoff\('explorer', platform, ATTRIBUTION\)/)
  assert.match(button, /<HandoffSheet sheet="explore" attribution=\{ATTRIBUTION\}/)
  const sheet = code(read('components/landing/handoff-sheet.tsx'))
  assert.match(sheet, /Mingla lives on <em>your phone\.<\/em>/)
  assert.match(sheet, /\{sheet === 'host' \? \(\s*<div className="gs-web">/, 'only the Host sheet offers the web')
  assert.match(sheet, /appHandoffHrefs\(sheet === 'host' \? 'host' : 'explorer', attribution\)/)
  assert.match(sheet, /<QRCode value=\{hrefs\.phoneHref\}/)
  // Every Explorer CTA on the redesigned pages is this button.
  const home = code(read('components/site/home-page.tsx'))
  assert.match(home, /<ExplorerHandoffButton location="hero" className="btn cta" withArrow>\s*Use Mingla\s*<\/ExplorerHandoffButton>/)
  assert.doesNotMatch(home, /DeviceCta|href="\/download"/)
})

test('Host hand-off keeps phase 1: phone → Host OneLink, computer → Host sheet with host web', () => {
  const attribution = links.siteAttribution('business_nav')
  const phone = handoff.resolveAppHandoff('host', 'ios', attribution)
  assert.ok(phone.action === 'navigate' && phone.href.startsWith(`${stores.BUSINESS_ONELINK_URL}?`) && /c=business_nav/.test(phone.href))
  assert.deepEqual(handoff.resolveAppHandoff('host', 'other', attribution), { action: 'sheet', sheet: 'host' })
  assert.equal(handoff.appHandoffHrefs('host', attribution).computerHref, stores.BUSINESS_WEB_URL)
  const host = code(read('components/site/host-page.tsx'))
  assert.match(host, /cta=\{<HostHandoffButton location="hero" className="btn cta" withArrow \/>\}/)
  assert.match(code(read('components/landing/host-handoff.tsx')), /<HandoffSheet sheet="host" attribution=\{attribution\}/)
  // The website demo continues to host web through the seam; the description never travels.
  const demo = code(read('components/site/site-prompt-demo.tsx'))
  assert.match(demo, /const hrefs = appHandoffHrefs\('host', ATTRIBUTION\)/)
  assert.match(demo, /href=\{hrefs\.computerHref\}/)
  assert.doesNotMatch(demo, /encodeURIComponent|searchParams|\?draft|location\.href|fetch\(/, 'the description is never put in a URL or sent')
  assert.match(read('components/site/site-prompt-demo.tsx'), /TODO\(#4339 §5\)/)
  // Book a call and the host-type tiles.
  assert.match(host, /<Link className="btn white" href="\/schedule">\s*Book a call\s*<\/Link>/)
  assert.match(host, /ICP_SLUGS\.map\(\(slug\) => \{[\s\S]*?href=\{icpLandingPath\(slug\)\}/)
  assert.match(host, /<Link className="tile tools reveal" href="\/tools">/)
})

test('no store, OneLink or host URL is hard-coded in the new files', () => {
  const banned = [/apps\.apple\.com/i, /play\.google\.com/i, /onelink\.me/i, /go\.usemingla\.com/i, /biz\.usemingla\.com/i, /host\.usemingla\.com/i, /market:\/\//i]
  for (const rel of NEW_FILES) {
    const source = code(read(rel))
    for (const pattern of banned) assert.doesNotMatch(source, pattern, `${rel} must not hold ${pattern}`)
    // The only absolute URL allowed is the careers subdomain (ORCH-1225).
    const urls = [...source.matchAll(/https?:\/\/[^\s'"`)]+/g)].map((m) => m[0])
    for (const url of urls) assert.equal(url, 'https://career.usemingla.com', `${rel}: unexpected absolute URL ${url}`)
  }
})

test('site nav: wordmark, five links, surface CTA, the 300ms ink menu with every landing page', () => {
  const nav = code(read('components/site/site-nav.tsx'))
  assert.deepEqual(
    [...nav.matchAll(/\{ key: '[\w-]+', href: '([^']+)', label: '([^']+)' \}/g)].map((m) => [m[1], m[2]]),
    [
      ['/going-out', 'Going out'],
      ['/cities', 'Cities'],
      ['/host', 'For hosts'],
      ['/tools', 'Free tools'],
      ['/help', 'Help'],
    ],
  )
  assert.match(nav, /surface === 'host' \? \(\s*<HostHandoffButton location="nav"[\s\S]*?: \(\s*<ExplorerHandoffButton location="nav"/)
  assert.match(nav, /\.\.\.ICP_SLUGS\.map\(\(slug\) => \(\{ href: icpLandingPath\(slug\), label: ICP_LANDINGS\[slug\]\.name \}\)\)/, 'all seven landing pages')
  assert.match(nav, /title: 'Explore'[\s\S]*title: 'Host'[\s\S]*title: 'Company'/)
  assert.match(nav, /aria-expanded=\{open\}/)
  assert.match(nav, /event\.key === 'Escape'/)
  const css = code(read('components/site/site.css'))
  assert.match(css, /\.burger \{[^}]*background: var\(--ink\)/, 'ink menu button')
  assert.match(css, /\.burger i \{[^}]*transition: transform 0\.3s cubic-bezier\(0\.77, 0, 0\.175, 1\)/)
  assert.match(css, /\.site-nav\.open \.burger i:nth-child\(1\) \{\s*transform: rotate\(45deg\)/)
  assert.match(css, /\.nav-in \{[^}]*background: #fff;/, 'opaque white pill, readable over any section')
  // The landing pages and both redesigned pages use it; the old nav is gone from them.
  for (const rel of ['components/landing/icp-landing.tsx', 'components/site/home-page.tsx', 'components/site/host-page.tsx']) {
    assert.match(code(read(rel)), /<SiteNav surface="(?:host|explorer)"/, `${rel} uses the site nav`)
    assert.doesNotMatch(code(read(rel)), /CutoutNav|CutoutFooter/, `${rel} drops the old chrome`)
  }
})

test('Reelmark carousel: the design geometry, drift, drag momentum, near-centre clips only', () => {
  const stage = code(read('components/site/reel-stage.tsx'))
  for (const formula of [
    /u = Math\.max\(0\.52, Math\.min\(1\.12, vw \/ 1440\)\)/,
    /const SPACING = 236/,
    /const DRIFT = 50/,
    /const w = \(170 \+ 48 \* ad \* ad\) \* u/,
    /const h = \(280 \+ 92 \* Math\.pow\(ad, 2\.6\)\) \* u/,
    /const x = p \* \(1 \+ 0\.083 \* ad \* ad\)/,
    /const ry = Math\.max\(-26, Math\.min\(26, -d \* 16\)\)/,
    /const auto = reduced \? 0 : DRIFT/,
    /vel = Math\.max\(-4000, Math\.min\(4000, vel\)\)/,
  ]) {
    assert.match(stage, formula)
  }
  const video = stage.match(/<video[\s\S]*?\/>/)?.[0] ?? ''
  assert.doesNotMatch(video, /\ssrc=/, 'no clip source in the server HTML')
  for (const attr of ['muted', 'loop', 'playsInline', 'preload="none"', 'poster={media.poster}']) assert.ok(video.includes(attr), attr)
  assert.match(stage, /const still = prefersStillMedia\(\)/)
  assert.match(stage, /if \(!video \|\| still\) return/, 'reduced motion or Save-Data: posters only')
  assert.match(stage, /const near = Math\.abs\(p\) < Math\.max\(1\.5 \* spacing, half \* 0\.5\)/)
  assert.match(stage, /\} else if \(!video\.paused\) \{\s*video\.pause\(\)/)
  assert.match(code(read('components/landing/landing-media.tsx')), /prefers-reduced-motion: reduce[\s\S]*saveData === true/)
  // Ten cards each, every clip on disk.
  for (const [rel, name] of [['components/site/home-page.tsx', 'HOME_REEL'], ['components/site/host-page.tsx', 'HOST_REEL']]) {
    const block = code(read(rel)).match(new RegExp(`${name}: readonly ReelCard\\[\\] = \\[([\\s\\S]*?)\\n\\]`))?.[1] ?? ''
    const refs = [...block.matchAll(/media: '([vp]):([a-z0-9-]+)'/g)]
    assert.equal(refs.length, 10, `${name} has ten cards`)
    for (const [, kind, file] of refs) {
      const base = path.join(MARKETING, 'public/marketing/site', kind === 'v' ? 'm' : 'p', file)
      assert.ok(fs.existsSync(`${base}.jpg`), `${file}.jpg exists`)
      if (kind === 'v') assert.ok(fs.existsSync(`${base}.mp4`), `${file}.mp4 exists`)
    }
  }
})

test('the redesign brand faces load on /, /host and /host/<icp> only', () => {
  for (const rel of ['app/(explorer)/page.tsx', 'app/host/page.tsx', 'app/host/[icp]/page.tsx']) {
    const page = code(read(rel))
    assert.match(page, /import \{ landingMono, landingSans, landingSerif \} from '@\/app\/site-fonts'/)
    assert.match(page, /className=\{`\$\{landingSerif\.variable\} \$\{landingSans\.variable\} \$\{landingMono\.variable\}`\}/)
  }
  assert.ok(!fs.existsSync(path.join(MARKETING, 'app/host/[icp]/fonts.ts')), 'the module moved to app/site-fonts.ts')
  // The SEO contracts of / and /host are unchanged.
  assert.match(code(read('app/(explorer)/page.tsx')), /export const metadata = searchRouteMetadata\('\/'\)/)
  assert.match(code(read('app/(explorer)/page.tsx')), /<MinglaEntityGraph \/>/)
  assert.match(code(read('app/host/page.tsx')), /export const metadata = searchRouteMetadata\('\/host'\)/)
})

// ---- built HTML (after `next build`) ---------------------------------------
const builtHtml = (route) => fs.readFileSync(path.join(MARKETING, '.next/server/app', `${route}.html`), 'utf8')

test('built: / and /host render the hero, the hand-offs and the canonical footer', { skip: !BUILT && 'set ISSUE_4339_BUILT=1 after next build' }, () => {
  const home = builtHtml('index')
  assert.ok(
    home.includes('<span aria-hidden="true" class="rm-lines"><span>Find</span><span class="rot"><em class="swap">romantic plans</em></span><span>that fit the vibe.</span></span>'),
    'three-line headline',
  )
  assert.ok(home.includes('<span class="sr-only">Find plans that fit the vibe.</span>'))
  const host = builtHtml('host')
  assert.ok(host.includes('<span class="rm-lines"><span>Everything</span><span><em>a host needs.</em></span></span>'))
  for (const [name, html, surface] of [['/', home, 'explorer'], ['/host', host, 'host']]) {
    assert.match(html, /data-site-footer=""/, `${name}: canonical footer`)
    assert.match(html, /© <!-- -->\d{4}<!-- --> Mingla\. <!-- -->Making real life easier to find\./, `${name}: tagline`)
    assert.doesNotMatch(html, /privacy choices/i, `${name}: no privacy choices text`)
    assert.match(html, /<meta name="robots" content="index, follow"/, `${name}: still indexed`)
    assert.doesNotMatch(html, /<video[^>]*\ssrc=/, `${name}: no clip source before the script decides`)
    const ctas = [...html.matchAll(new RegExp(`<a [^>]*data-cta-surface="${surface}"[^>]*>`, 'g'))].map((m) => m[0])
    assert.ok(ctas.length >= 2, `${name}: nav and hero hand-offs render`)
    const onelink = surface === 'host' ? stores.BUSINESS_ONELINK_URL : stores.EXPLORER_ONELINK_URL
    for (const a of ctas) assert.ok(a.includes(`data-cta-phone-href="${onelink}?`), `${name}: phone href is the ${surface} OneLink`)
  }
  for (const slug of SLUGS) assert.ok(home.includes(`href="/host/${slug}"`), `the menu links /host/${slug}`)
})
