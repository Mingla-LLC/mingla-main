#!/usr/bin/env node
// #4137 — implementor happy path for the /host redesign.
//
//   (default)      source contract + built HTML (needs `next build` first)
//   --source-only  source contract only (runs before `next build`)
//   --built-only   built HTML only, against .next/server/app/host.html
//
// Covers AC-H1, H2, H3, S1, S2, T2 (strings), B1, B5, I1, I2, I3 and the card
// accessibility/layout contract (C1, C5, C7 at source level).
//
// #4339 phase 2a SUPERSEDES THE PAGE-LEVEL HALF, deliberately: /host was
// replaced in place by the approved "Mingla, Edited" design (spec §1/§8;
// components/site/host-page.tsx). The #4137 hero lede/video, Start hosting
// card, bento, live-value figures and expanding cards are no longer on /host,
// so the assertions that read app/host/page.tsx or host.html for them are
// retired here. What still guards real code stays: the expanding cards, the
// builder demo and the HOST_IMAGERY provenance record (components that remain
// in the repo), plus, on the built page, no forbidden image source and no
// brand name. The new page is pinned by
// lib/__tests__/issue-4339-site-chrome.implementor.test.mjs.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_ONLY = process.argv.includes('--source-only')
const BUILT_ONLY = process.argv.includes('--built-only')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')

const NEW_LEDE =
  'Get found by the people planning their night out. Mingla builds your website, sells your tickets, tables and stays, and keeps your guests coming back. All from one app.'
const OLD_LEDE = 'One app builds your website, publishes your events, trips and stays'
const PROMPT =
  'Build a site for my 24/7 food house in Lekki — the menu with prices, online ordering, and a table booking form.'
const BUILDER_LABEL =
  'Example: Ari takes a brief for a 24/7 food house in Lekki, then builds a website with a hero photo, a menu with ordering and a table booking form, and publishes it.'
const STEPS = ['Reading your brief', 'Hero from your own photos', 'Menu with ordering', 'Table booking form', 'Published on your domain']
const REJECTED_VALUES = ['Paris', '4 payments', '9 Nov', '8:30pm', '4 guests', 'Thursday 5pm']
const BRAND_NAMES = ['William', 'Cilantro', 'Clarendon', 'Anchor', 'Palais', 'IYKYK', 'Bryant', 'Lake Johnson', 'Sopranos', 'Gogi']
const SLOTS = [
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  ...['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'].flatMap((c) => [`${c}-desktop`, `${c}-phone`]),
  'T1', 'T2', 'T3', 'T4', 'B1', 'B2', 'B3', 'B4', 'P1', 'P2', 'P3',
]

function loadImagery() {
  const compiled = ts.transpileModule(read('lib/design-preview/host-imagery.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} }
  Function('module', 'exports', compiled)(module, module.exports)
  return module.exports.HOST_IMAGERY
}

function sourceContract() {
  // #4339: /host is the redesigned page; the #4137 page-level pins are retired.
  const page = read('app/host/page.tsx')
  assert.match(page, /<HostPage \/>/, '#4339: /host renders the redesigned page')
  assert.match(page, /export const metadata = searchRouteMetadata\('\/host'\)/, '#4137: /host keeps its search_ready metadata')
  assert.doesNotMatch(page + read('components/site/host-page.tsx'), /RootCityGrid|allCityHubsSearchReady|AriCreativeCard|gogi-site/, '#4137 AC-S1/B5: still no city grid or real-site screenshot')

  const hero = read('components/cutout/hero.tsx')
  assert.doesNotMatch(hero, /<CutReveal variant="headline"/, '#4137 AC-H3: the h1 is not wrapped in a reveal')

  const cards = read('components/ui/expanding-cards.tsx')
  assert.match(cards, /<button[\s\S]*?aria-expanded=\{active\}[\s\S]*?aria-controls=\{bodyId\}/, '#4137 AC-C1: each card has a real aria-expanded button')
  assert.match(cards, /onFocus=\{\(\) => setActiveIndex\(index\)\}/, '#4137 AC-C1: focus opens a card')
  assert.match(cards, /onClick=\{\(\) => setActiveIndex\(index\)\}/, '#4137 AC-C3: a tap opens a card')
  assert.match(cards, /event\.pointerType === 'mouse'/, '#4137 AC-C2: hover opens a card')
  const cardCode = cards.replace(/\/\/.*$/gm, '')
  assert.doesNotMatch(cardCode, /isDesktop|addEventListener\('resize'|onPointerLeave|onMouseLeave|onBlur|grayscale/,
    '#4137 AC-C2/C5/C7: no JS layout state, nothing closes on leave, no greyscale')
  const css = read('components/cutout/cutout.css')
  assert.match(css, /\.cut-xbody \{ width: 300px; \}/, '#4137 AC-C4: fixed-width body on desktop')
  assert.match(css, /writing-mode: vertical-rl/, '#4137 AC-C6: vertical chip on the collapsed desktop strip')
  assert.match(css, /\[data-paused\] img \{ animation-play-state: paused; \}/, '#4137 AC-H5: the wall pauses off screen')

  // AC-I1 / AC-I2: provenance record and files.
  const imagery = loadImagery()
  assert.deepEqual(imagery.map((i) => i.slot).sort(), [...SLOTS].sort(), '#4137 AC-I1: every §5.2 slot exactly once')
  for (const image of imagery) {
    assert.match(image.file, /^\/marketing\/host\/[a-z0-9-]+\.jpg$/, `#4137: ${image.slot} lives in /marketing/host/`)
    assert(['envato', 'mingla_owned', 'seth_supplied'].includes(image.source), `#4137 AC-I1: ${image.slot} source`)
    assert(image.sourceRef.length > 0, `#4137 AC-I1: ${image.slot} sourceRef`)
    const file = path.join(ROOT, 'public', image.file)
    assert(fs.existsSync(file), `#4137: ${image.file} must exist`)
    const kb = fs.statSync(file).size / 1024
    const cap = image.slot.startsWith('H') ? 250 : 350
    assert(kb <= cap, `#4137 AC-I2: ${image.file} is ${kb.toFixed(0)} KB (cap ${cap})`)
  }
  const files = fs.readdirSync(path.join(ROOT, 'public/marketing/host'))
  assert.equal(files.length, SLOTS.length, '#4137 AC-I1: no unrecorded file in public/marketing/host')
  const imageryCode = read('lib/design-preview/host-imagery.ts').replace(/\/\/.*$/gm, '')
  assert.doesNotMatch(imageryCode, /place-photos|supabase|googleusercontent|maps\.googleapis|host-icp\/|host-hero\//)

  const builder = read('components/ui/ari-site-builder-demo.tsx')
  assert(builder.includes(PROMPT), '#4137: the live prompt string is kept verbatim')
  for (const value of REJECTED_VALUES) assert(!builder.includes(value), `#4137 rule 9: builder must not carry "${value}"`)
  process.stdout.write('PASS #4137 /host source contract (cards, imagery, builder; the page itself is #4339)\n')
}

const decode = (s) => s
  .replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&rsquo;/g, '’').replace(/&nbsp;/g, ' ')
const visible = (html) => decode(html
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ')

/** The balanced element that starts at `start` (a `<tag` index). */
function elementAt(html, start) {
  const tag = /^<([a-z0-9]+)/i.exec(html.slice(start))[1]
  const re = new RegExp(`<${tag}\\b|</${tag}>`, 'gi')
  re.lastIndex = start
  let depth = 0
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[0].startsWith('</') ? -1 : 1
    if (depth === 0) return html.slice(start, m.index + m[0].length)
  }
  throw new Error(`unbalanced <${tag}>`)
}
const byClass = (html, cls) => {
  const i = html.search(new RegExp(`<[a-z]+[^>]*class="(?:[^"]* )?${cls}(?: [^"]*)?"`))
  assert(i >= 0, `#4137: .${cls} missing from the built HTML`)
  return elementAt(html, i)
}

function builtContract() {
  const file = path.join(ROOT, '.next/server/app/host.html')
  assert(fs.existsSync(file), '#4137: run `next build` before --built-only')
  const html = fs.readFileSync(file, 'utf8')
  const text = visible(html)

  // #4339: the #4137 page-level pins (lede, hero video, Start hosting, live
  // values, builder at rest, expanding cards) are retired with the page.
  assert.match(html, /<span class="rm-lines"><span>Everything<\/span>/, '#4339: host.html is the redesigned page')

  // AC-I1 / AC-I3: every image under /marketing/host/ is recorded; no forbidden source or brand.
  const imagery = new Set(loadImagery().map((i) => i.file))
  const used = new Set([...html.matchAll(/(?:src|srcSet|srcset)="([^"]+)"/g)]
    .flatMap((m) => m[1].split(','))
    .map((part) => decodeURIComponent(part.trim().split(' ')[0]))
    .map((src) => (src.startsWith('/_next/image?') ? new URLSearchParams(src.split('?')[1]).get('url') : src))
    .filter((src) => src && src.startsWith('/marketing/host/')))
  for (const src of used) assert(imagery.has(src), `#4137 AC-I1: ${src} is not in HOST_IMAGERY`)
  assert.doesNotMatch(html, /place-photos|googleusercontent|maps\.googleapis|\/marketing\/host-icp\//, '#4137 AC-I1: forbidden image source')
  for (const name of BRAND_NAMES) assert(!new RegExp(`\\b${name}\\b`, 'i').test(text), `#4137 AC-I3: "${name}" on /host`)

  process.stdout.write('PASS #4137 /host built HTML (imagery provenance and no brand names on the #4339 page)\n')
}

if (!BUILT_ONLY) sourceContract()
if (!SOURCE_ONLY) builtContract()
