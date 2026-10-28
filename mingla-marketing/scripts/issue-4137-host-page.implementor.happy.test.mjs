#!/usr/bin/env node
// #4137 — implementor happy path for the /host redesign.
//
//   (default)      source contract + built HTML (needs `next build` first)
//   --source-only  source contract only (runs before `next build`)
//   --built-only   built HTML only, against .next/server/app/host.html
//
// Covers AC-H1, H2, H3, S1, S2, T2 (strings), B1, B5, I1, I2, I3 and the card
// accessibility/layout contract (C1, C5, C7 at source level).

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
  const page = read('app/host/page.tsx')
  assert(page.includes(`lede="${NEW_LEDE}"`), '#4137 AC-H1: /host carries the new lede')
  assert.match(page, /backdrop=\{<HostHeroWall \/>\}/, '#4137: the hero uses the photo wall')
  assert.doesNotMatch(page, /world-hosts-create-(preview|poster)|video=|image="/, '#4137 AC-H1: the video plate is gone')
  assert.match(page, /<HostStartCta \/>/, '#4137 AC-S1: Start hosting card mounted')
  assert.doesNotMatch(page, /RootCityGrid|allCityHubsSearchReady/, '#4137 AC-S1: no city grid on /host')
  assert.doesNotMatch(page, /AriCreativeCard|gogi-site/, '#4137 AC-B5: the real-site screenshot is gone from /host')
  assert.match(page, /<AriSiteBuilderDemo \/>/, '#4137: builder demo mounted')
  assert.match(page, /<DeviceCta surface="host" location="tools"/, '#4137 OQ-8: the tools button stays')

  const hero = read('components/cutout/hero.tsx')
  assert.doesNotMatch(hero, /<CutReveal variant="headline"/, '#4137 AC-H3: the h1 is not wrapped in a reveal')
  const wall = read('components/cutout/host-hero-wall.tsx')
  assert.match(wall, /priority=\{index === 0\}/, '#4137 AC-H2: only tile 1 is priority')

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
  process.stdout.write('PASS #4137 /host source contract (hero, cards, imagery, builder, Start hosting)\n')
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

  // AC-H1
  assert(text.includes(NEW_LEDE), '#4137 AC-H1: new lede in the server HTML')
  assert(!html.includes('world-hosts-create-preview.mp4') && !html.includes('world-hosts-create-poster.jpg'), '#4137 AC-H1: no hero video')
  assert(!text.includes(OLD_LEDE), '#4137 AC-H1: old lede gone')

  // AC-H2
  const wall = byClass(html, 'cut-hero-wall')
  assert.match(wall, /^<div[^>]*aria-hidden="true"/, '#4137 AC-H2: the wall is aria-hidden')
  const wallImgs = wall.match(/<img\b[^>]*>/g) ?? []
  assert.equal(wallImgs.length, 6, '#4137 AC-H2: six wall images')
  for (const img of wallImgs) assert.match(img, /alt=""/, '#4137 AC-H2: decorative alt')
  assert.equal(wallImgs.filter((img) => /fetchpriority="high"/i.test(img)).length, 1, '#4137 AC-H2: exactly one high-priority tile')
  assert.doesNotMatch(wall, /<figcaption|credit|Photo/i, '#4137 AC-H2: no captions or credits')

  // AC-H3: neither the h1 nor the lede sits inside an inline opacity:0 wrapper.
  const h1At = html.search(/<h1\b/)
  const before = html.slice(Math.max(0, h1At - 600), h1At)
  assert.doesNotMatch(before.slice(before.lastIndexOf('<div')), /opacity:0/, '#4137 AC-H3: h1 visible in server HTML')
  const ledeAt = html.indexOf(NEW_LEDE.slice(0, 40))
  const ledeTag = html.lastIndexOf('<p', ledeAt)
  assert.doesNotMatch(html.slice(html.lastIndexOf('<div', ledeTag), ledeTag), /opacity:0/, '#4137 AC-H3: lede visible in server HTML')

  // AC-S1 / AC-S2
  assert(!text.includes('Mingla city guides') && !html.includes('city-grid'), '#4137 AC-S1: no city grid')
  const start = byClass(html, 'cut-start')
  const startText = visible(start)
  assert.match(startText, /Start hosting/i)
  assert(startText.includes('Open your doors to the whole city.'), '#4137 AC-S2: h2')
  assert(startText.includes('Put your place, event or trip in front of the people planning their weekend, and start selling the same day.'))
  assert.equal((byClass(start, 'cut-start-photos').match(/<img\b/g) ?? []).length, 3, '#4137 AC-S2: three photos')
  assert.equal((start.match(/data-cta-surface="host"/g) ?? []).length, 1, '#4137 AC-S2: exactly one host CTA')
  assert.doesNotMatch(startText, /On iPhone|this button opens|Photo/, '#4137 AC-S2: no device note or credit')

  // AC-T2: live values only.
  for (const value of ['Rain likely 7–9pm', 'peaks 10pm–1am', '12 Sep', '14 Sep', '18 of 24 tables', 'Came before', 'Never heard of you']) {
    assert(text.includes(value), `#4137 AC-T2: "${value}" on /host`)
  }
  for (const value of REJECTED_VALUES) assert(!text.includes(value), `#4137 AC-T2: "${value}" must not appear`)
  for (const pct of ['width:34%', 'width:61%', 'width:100%']) assert(html.includes(pct), `#4137 AC-T2: bar ${pct}`)

  // AC-T3: the four tool photos carry their alt text.
  for (const alt of ['A bar ready for a busy night', 'Friends arriving on a group trip', 'A restaurant floor laid for the evening', 'Drinks on a table, shown in an email preview']) {
    assert(html.includes(`alt="${alt}"`), `#4137 AC-T3: tool photo "${alt}"`)
  }

  // AC-B1 / AC-B5: finished state at rest, one role=img, nothing focusable.
  const bld = byClass(html, 'cut-bld')
  assert.match(bld, /^<div[^>]*role="img"/)
  assert(decode(bld).includes(`aria-label="${BUILDER_LABEL}"`), '#4137 AC-B5: builder label')
  assert(visible(bld).includes(PROMPT), '#4137 AC-B1: full prompt at rest')
  const stepItems = byClass(bld, 'cut-steps').match(/<li\b[^>]*>/g) ?? []
  assert.equal(stepItems.length, 5)
  for (const li of stepItems) assert.match(li, /class="[^"]*\bdone\b/, '#4137 AC-B1: every step done at rest')
  for (const step of STEPS) assert(visible(bld).includes(step))
  assert.equal((bld.match(/class="cut-bs [^"]*\bshow\b/g) ?? []).length, 3, '#4137 AC-B1: three sections shown')
  assert.match(bld, /class="cut-live show"/, '#4137 AC-B1: live badge shown')
  assert.doesNotMatch(bld, /<(a|button|input|select|textarea)\b|tabindex="0"/, '#4137 AC-B5: nothing focusable inside the demo')
  assert(!html.includes('gogi-site'), '#4137 AC-B5: no real-site screenshot')

  // AC-C1 (static half): seven card buttons with aria-expanded, one open.
  const cards = byClass(html, 'cut-xc')
  const triggers = cards.match(/<button[^>]*class="cut-xcard-trigger"[^>]*>/g) ?? []
  assert.equal(triggers.length, 7, '#4137 AC-C1: seven card buttons')
  assert.equal(triggers.filter((b) => /aria-expanded="true"/.test(b)).length, 1, '#4137: one card open at rest')
  assert.doesNotMatch(cards, /grayscale/, '#4137 AC-C5')

  // AC-I1 / AC-I3: every image under /marketing/host/ is recorded; no forbidden source or brand.
  const imagery = new Set(loadImagery().map((i) => i.file))
  const used = new Set([...html.matchAll(/(?:src|srcSet|srcset)="([^"]+)"/g)]
    .flatMap((m) => m[1].split(','))
    .map((part) => decodeURIComponent(part.trim().split(' ')[0]))
    .map((src) => (src.startsWith('/_next/image?') ? new URLSearchParams(src.split('?')[1]).get('url') : src))
    .filter((src) => src && src.startsWith('/marketing/host/')))
  assert(used.size >= 25, `#4137 AC-I1: expected the /host photos in the HTML, found ${used.size}`)
  for (const src of used) assert(imagery.has(src), `#4137 AC-I1: ${src} is not in HOST_IMAGERY`)
  assert.doesNotMatch(html, /place-photos|googleusercontent|maps\.googleapis|\/marketing\/host-icp\/|\/marketing\/host-hero\//, '#4137 AC-I1: forbidden image source')
  for (const name of BRAND_NAMES) assert(!new RegExp(`\\b${name}\\b`, 'i').test(text), `#4137 AC-I3: "${name}" on /host`)

  process.stdout.write('PASS #4137 /host built HTML (hero, Start hosting, live values, builder at rest, cards, imagery provenance)\n')
}

if (!BUILT_ONLY) sourceContract()
if (!SOURCE_ONLY) builtContract()
