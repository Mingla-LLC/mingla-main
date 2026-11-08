// #4339 build round A — implementor regression test for Seth's 8 Nov requests:
//   1. the new clips are wired in (Home Friends tile, the six ICP features
//      backgrounds, four ICP feature cards, the six Going out tiles, every
//      city tile + Home city row + city page hero, About, Locals), and no file
//      in public/marketing/site is left unreferenced;
//   2. the /host Free tools tile runs a clip under the same ink wash as its
//      neighbours, with no "4 free tools" pill;
//   3. every standalone Mingla wordmark is a home link (cards that already link
//      elsewhere, the About and Ari cards, are the only exceptions);
//   4. no orphan tiles on phones: in a 2-column tile grid with an odd count,
//      the last tile spans both columns at 16:10;
//   5. the footer is four columns of four links, a symmetrical 2×2 on phones.
//
// Source mode (default, no install) reads the source and the public files.
// Built mode (ISSUE_4339_BUILT=1 after `npm run build`, Chrome installed) runs
// `next start` and checks the pages at 375 px: no orphan tile in any 2-column
// grid, the footer columns aligned, every wordmark a home link, and the clip
// rules (poster first, preload none, muted, inline).
//
// Run from mingla-marketing/ (Node 22.13+):
//   node --test lib/__tests__/issue-4339-round-a.implementor.test.mjs

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { stripTypeScriptTypes } from 'node:module'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { CHROME, withBrowser } from './issue-4339-browser-harness.mjs'

const MARKETING = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => fs.readFileSync(path.join(MARKETING, rel), 'utf8')
const code = (source) => source.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const BUILT = process.env.ISSUE_4339_BUILT === '1'
const SITE = path.join(MARKETING, 'public/marketing/site')

function walk(dir) {
  const out = []
  for (const entry of fs.readdirSync(path.join(MARKETING, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue
      out.push(...walk(rel))
    } else if (/\.(tsx?|mjs)$/.test(entry.name)) out.push(rel)
  }
  return out
}
const SOURCES = ['app', 'components', 'content', 'lib'].flatMap(walk)

// ---- 1. clips ----------------------------------------------------------------
const CLIPS = [
  ['components/site/home-page.tsx', /\{ media: 'v:a-friends', title: 'Friends'/, 'a-friends'],
  ['content/host-landing/icps.ts', /bg: "v:bg-trips"/, 'bg-trips'],
  ['content/host-landing/icps.ts', /bg: "v:bg-exp"/, 'bg-exp'],
  ['content/host-landing/icps.ts', /bg: "v:bg-rest"/, 'bg-rest'],
  ['content/host-landing/icps.ts', /bg: "v:bg-hotel"/, 'bg-hotel'],
  ['content/host-landing/icps.ts', /bg: "v:bg-art"/, 'bg-art'],
  ['content/host-landing/icps.ts', /bg: "v:bg-play"/, 'bg-play'],
  ['content/host-landing/icps.ts', /t: "Itineraries people trust", m: "v:f-trip"/, 'f-trip'],
  ['content/host-landing/icps.ts', /t: "Every opening, listed", m: "v:f-museum"/, 'f-museum'],
  ['content/host-landing/icps.ts', /t: "A list that comes back", m: "v:f-stage"/, 'f-stage'],
  ['content/host-landing/icps.ts', /t: "Theme nights & tournaments", m: "v:f-arcade"/, 'f-arcade'],
  ['app/(core)/going-out/page.tsx', /'v:g-solo', title: 'Solo Saturday'/, 'g-solo'],
  ['app/(core)/going-out/page.tsx', /'v:g-culture', title: 'Lagos, not parties'/, 'g-culture'],
  ['app/(core)/going-out/page.tsx', /'v:g-under', title: 'Underrated Durham'/, 'g-under'],
  ['app/(core)/going-out/page.tsx', /'v:g-date', title: 'Cary has range'/, 'g-date'],
  ['app/(core)/going-out/page.tsx', /'v:g-family', title: 'With the grandparents'/, 'g-family'],
  ['app/(core)/going-out/page.tsx', /'v:g-quests', title: 'Lagos side quests'/, 'g-quests'],
  ['app/(core)/about/page.tsx', /<section className="about-clip" aria-hidden="true">\s*<div className="wrap">\s*<div className="ph reveal">\s*<LandingMedia media="v:amb-about" \/>/, 'amb-about'],
  ['app/locals/page.tsx', /<div className="band reveal mt-24">\s*<LandingMedia media="v:amb-locals" \/>/, 'amb-locals'],
]
const CITY_CLIPS = {
  lagos: 'c-lagos',
  'raleigh-nc': 'c-raleigh',
  'durham-nc': 'c-durham',
  'cary-nc': 'c-cary',
  brussels: 'c-brussels',
  'washington-dc': 'c-dc',
  'new-york-city': 'c-nyc',
  london: 'c-london',
  paris: 'c-paris',
  'fort-lauderdale': 'c-ftl',
}

function assertClipFiles(name) {
  for (const ext of ['mp4', 'jpg']) {
    const file = path.join(SITE, 'm', `${name}.${ext}`)
    assert.ok(fs.existsSync(file), `${name}.${ext} is in public/marketing/site/m`)
  }
  assert.ok(fs.statSync(path.join(SITE, 'm', `${name}.mp4`)).size < 900_000, `${name}.mp4 stays a light web loop`)
}

test('1. every new clip is wired to its slot, with its poster beside it', () => {
  for (const [rel, pattern, name] of CLIPS) {
    assert.match(code(read(rel)), pattern, `${rel}: ${name}`)
    assertClipFiles(name)
  }
  // The cities: one map feeds the /cities tile, the city page hero and the Home
  // row, so the three always show the same clip (and Durham's old people photo
  // is gone from Home).
  const media = code(read('components/site/city-media.tsx'))
  assert.match(media, /CITY_MEDIA: Readonly<Record<CityHubSlug, LandingMediaRef>>/)
  for (const [slug, name] of Object.entries(CITY_CLIPS)) {
    assert.ok(media.includes(`${/-/.test(slug) ? `'${slug}'` : slug}: 'v:${name}'`), `${slug} → ${name}`)
    assertClipFiles(name)
  }
  assert.match(media, /return <LandingMedia media=\{CITY_MEDIA\[slug\]\} hero=\{hero\} \/>/)
  const home = code(read('components/site/home-page.tsx'))
  assert.match(home, /const CITY_TILES: readonly CityHubSlug\[\] = \['lagos', 'raleigh-nc', 'durham-nc', 'cary-nc', 'brussels'\]/)
  assert.match(home, /<LandingMedia media=\{CITY_MEDIA\[slug\]\} \/>/)
  assert.doesNotMatch(home, /weekend-durham-cover|weekend-lagos-boat/)
})

test('1. every media reference resolves to a file, and no file in public/marketing/site is orphaned', () => {
  const refs = new Set()
  for (const rel of SOURCES) {
    const source = code(read(rel))
    for (const m of source.matchAll(/["'`](v|p):([a-z0-9-]+)["'`]/g)) refs.add(m[1] === 'v' ? `m/${m[2]}.mp4` : `p/${m[2]}.jpg`)
    for (const m of source.matchAll(/\/marketing\/site\/([mp]\/[a-z0-9-]+\.(?:jpg|mp4))/g)) refs.add(m[1])
  }
  for (const ref of [...refs]) {
    if (ref.endsWith('.mp4')) refs.add(ref.replace(/\.mp4$/, '.jpg'))
  }
  for (const ref of refs) assert.ok(fs.existsSync(path.join(SITE, ref)), `referenced ${ref} exists`)
  for (const dir of ['m', 'p']) {
    if (!fs.existsSync(path.join(SITE, dir))) continue
    for (const file of fs.readdirSync(path.join(SITE, dir))) {
      assert.ok(refs.has(`${dir}/${file}`), `public/marketing/site/${dir}/${file} is referenced by no page (prune it)`)
    }
  }
})

// ---- 2. Free tools tile --------------------------------------------------------
test('2. /host Free tools tile: a clip under the ink wash of its neighbours, no "4 free tools" pill', () => {
  const host = code(read('components/site/host-page.tsx'))
  assert.match(
    host,
    /<Link className="tile tools reveal" href="\/tools">\s*<div className="ph scrim">\s*<LandingMedia media="v:bg-exp" \/>\s*<\/div>\s*<div className="ov">\s*<h3>Free tools<\/h3>\s*<p>No sign-up, no sales call\.<\/p>/,
  )
  assert.doesNotMatch(host, /\d+ free tools/i)
  // The neighbours (the host-type tiles) use the same wash.
  assert.match(host, /<Link className="tile reveal" href=\{icpLandingPath\(slug\)\} key=\{slug\}>\s*<div className="ph scrim">/)
})

// ---- 3. every wordmark goes Home ----------------------------------------------
const WORDMARK = /<Wordmark\b|src="\/brand\/(?:links\/)?mingla-wordmark[\w-]*\.svg"/g
const HOME_HREF = /^(?:"\/"|\{abs\('\/'\)\}|"https:\/\/usemingla\.com")$/
// Wordmarks inside a card that already links elsewhere: the About cards and
// the Ari cards (Seth, 8 Nov). Matched by the card's `vcard` class.
// The /links page bar is out of this round's reach (links-* is not edited
// here); it is named so a new exception cannot slip in silently.
const NAMED_EXCEPTIONS = new Set(['components/marketing/links-experience.tsx'])

/** For each wordmark in `source`: the enclosing link's href, or why it is exempt. */
export function wordmarkLinks(source) {
  const out = []
  for (const m of source.matchAll(WORDMARK)) {
    const before = source.slice(0, m.index)
    // The innermost card with the vcard class that is still open here.
    const card = [...before.matchAll(/<(\w+)\b[^>]*className="vcard[^"]*"[^>]*>/g)].at(-1)
    if (card && !before.slice(card.index).includes(`</${card[1]}>`)) {
      out.push({ index: m.index, exempt: 'card' })
      continue
    }
    const open = [...before.matchAll(/<(Link|a)\b([^>]*)>/g)].at(-1)
    if (!open || before.slice(open.index).includes(`</${open[1]}>`)) {
      out.push({ index: m.index, href: null })
      continue
    }
    const href = open[2].match(/\shref=("[^"]*"|\{[^}]*\})/)?.[1] ?? null
    out.push({ index: m.index, href, label: open[2].match(/aria-label="([^"]*)"/)?.[1] ?? null })
  }
  return out
}

test('3. every standalone Mingla wordmark is a home link (cards that link elsewhere excepted)', () => {
  let seen = 0
  for (const rel of SOURCES.filter((r) => r.endsWith('.tsx') && !r.endsWith('components/site/wordmark.tsx'))) {
    if (NAMED_EXCEPTIONS.has(rel)) continue
    for (const w of wordmarkLinks(code(read(rel)))) {
      seen += 1
      if (w.exempt) continue
      assert.ok(w.href !== null, `${rel}: a wordmark that is not inside a link (it must go Home)`)
      assert.match(w.href, HOME_HREF, `${rel}: wordmark links to ${w.href}, not Home`)
      assert.equal(w.label, 'Mingla home', `${rel}: the home link is named "Mingla home"`)
    }
  }
  assert.ok(seen >= 10, `found ${seen} wordmarks`)
  // The one Seth named: the paper section on every /host/<icp> page.
  assert.match(
    code(read('components/landing/icp-landing.tsx')),
    /<Link className="wm-link" href="\/" aria-label="Mingla home">\s*<img className="wm" src="\/brand\/mingla-wordmark\.svg" alt="" width=\{85\} height=\{30\} \/>\s*<\/Link>/,
  )
})

test('3. the scanner itself: a bare wordmark fails, a card wordmark is exempt', () => {
  assert.deepEqual(wordmarkLinks('<div><img src="/brand/mingla-wordmark.svg" alt="Mingla" /></div>').map((w) => w.href), [null])
  assert.equal(wordmarkLinks('<Link href="/host" className="x"><Wordmark /></Link>')[0].href, '"/host"')
  assert.equal(wordmarkLinks('<Link href="/a">x</Link><Wordmark />')[0].href, null)
  assert.equal(wordmarkLinks('<article className="vcard ari-card"><Wordmark /></article>')[0].exempt, 'card')
  assert.equal(wordmarkLinks('<Link className="vcard text-card" href="/host"><Wordmark /></Link>')[0].exempt, 'card')
  assert.equal(wordmarkLinks('<Link className="brand" href={abs(\'/\')} aria-label="Mingla home"><Wordmark /></Link>')[0].href, "{abs('/')}")
})

// ---- 4. no orphan tiles on phones ------------------------------------------------
test('4. phones: the last tile of an odd 2-column grid spans both columns at 16:10', async () => {
  const css = code(read('components/site/site.css'))
  const phone = css.slice(css.indexOf('@media (max-width: 640px)'))
  assert.match(phone, /\.cityrow > :last-child:nth-child\(odd\),\s*\[data-landing\] \.reel-grid > :last-child:nth-child\(odd\),\s*\[data-landing\] \.wk-grid > li\[data-orphan\] \{\s*grid-column: 1 \/ -1;/)
  assert.match(phone, /\.wk-grid > li\[data-orphan\] \.wk-card \.ph \{\s*aspect-ratio: 16 \/ 10;/)
  // Tablet and desktop are unchanged: the rule lives only in the phone query.
  assert.doesNotMatch(css.slice(0, css.indexOf('@media (max-width: 640px)')), /data-orphan|:last-child:nth-child\(odd\)/)
  const mod = await import(pathToFileURL(writeStripped('components/site/orphan-tile.ts')).href)
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => mod.orphanTile(i, 5)), [false, false, false, false, true])
  assert.deepEqual([0, 1, 2, 3].map((i) => mod.orphanTile(i, 4)), [false, false, false, false])
  assert.match(code(read('components/cities/city-this-weekend.tsx')), /data-orphan=\{orphanTile\(index, shownListings\.length\) \? '' : undefined\}/)
  assert.match(code(read('components/cities/city-weekend.tsx')), /const shownCount = collapsed \? Math\.min\(COLLAPSED_COUNT, visible\.length\) : visible\.length/)
  assert.match(code(read('components/cities/city-weekend.tsx')), /data-orphan=\{orphanTile\(index, shownCount\) \? '' : undefined\}/)
})

function writeStripped(rel) {
  const dir = fs.mkdtempSync(path.join(MARKETING, 'node_modules/.issue-4339-round-a-'))
  const out = path.join(dir, path.basename(rel).replace(/\.ts$/, '.mjs'))
  fs.writeFileSync(out, stripTypeScriptTypes(read(rel)))
  process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }))
  return out
}

// ---- 5. symmetrical footer ---------------------------------------------------------
test('5. footer: four columns of four links, every internal link a real route', () => {
  const footer = code(read('components/marketing/footer.tsx'))
  const columns = [...footer.matchAll(/title: '(\w+)',\s*links: \[([\s\S]*?)\]/g)].map((m) => [m[1], [...m[2].matchAll(/href: '([^']+)', label: '([^']+)'/g)].map((l) => [l[2], l[1]])])
  assert.deepEqual(columns, [
    ['Explore', [['Home', '/'], ['Going out', '/going-out'], ['Cities', '/cities'], ['Blog', '/blog']]],
    ['Host', [['For Hosts', '/host'], ['Free tools', '/tools'], ['Help centre', '/help'], ['Support', '/support']]],
    ['Company', [['About', '/about'], ['Careers', 'https://career.usemingla.com'], ['Locals', '/locals'], ['Creators', '/creators']]],
    ['Legal', [['Privacy', '/privacy-policy'], ['Terms', '/terms-of-service'], ['Organiser Terms', '/organiser-terms'], ['Delete account', '/delete-account']]],
  ])
  for (const route of ['locals', 'creators', 'delete-account', 'support']) {
    assert.ok(fs.existsSync(path.join(MARKETING, 'app', route, 'page.tsx')), `/${route} is a real page`)
  }
  assert.doesNotMatch(footer, /privacy choices|privacy-choices/i)
  const css = code(read('components/marketing/site-footer.css'))
  assert.match(css, /@media \(max-width: 1000px\) \{\s*\[data-site-footer\] \.sf-top \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/)
  assert.match(css, /\.sf-top \{\s*display: grid;\s*grid-template-columns: 1\.6fr repeat\(4, minmax\(0, 1fr\)\);/, 'desktop: one row of four')
})

// ---- built: the pages at 375 px ------------------------------------------------------
const PAGES = ['/', '/host', '/host/trips', '/host/play', '/going-out', '/cities', '/cities/durham-nc', '/about', '/locals']

// In the page: in every 2-column grid (two equal tracks), a last tile that sits
// alone on its row must span the grid's full width.
const ORPHANS = `(() => {
  const bad = []
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el)
    if (cs.display !== 'grid') continue
    const tracks = cs.gridTemplateColumns.split(' ').map(parseFloat)
    if (tracks.length !== 2 || Math.abs(tracks[0] - tracks[1]) > 1) continue
    const kids = [...el.children].filter((c) => getComputedStyle(c).display !== 'none' && c.getBoundingClientRect().width > 0)
    if (kids.length < 2) continue
    // An orphan: the last tile sits alone on its row without spanning it.
    const last = kids.at(-1).getBoundingClientRect()
    const prev = kids.at(-2).getBoundingClientRect()
    const width = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
    if (Math.abs(prev.top - last.top) > 1 && Math.abs(last.width - width) > 2) bad.push((el.className || el.tagName) + ' (' + kids.length + ')')
  }
  return bad
})()`

const FOOTER = `(() => {
  const cols = [...document.querySelectorAll('[data-site-footer] .sf-col')].map((c) => {
    const r = c.getBoundingClientRect()
    const h = c.querySelector('.sf-label').getBoundingClientRect()
    return { x: Math.round(r.left), w: Math.round(r.width), head: Math.round(h.bottom), links: c.querySelectorAll('li a').length, gaps: [...c.querySelectorAll('li a')].map((a, i, all) => i ? Math.round(a.getBoundingClientRect().top - all[i - 1].getBoundingClientRect().top) : 0).slice(1) }
  })
  const brand = document.querySelector('[data-site-footer] .sf-brand').getBoundingClientRect().left
  const bottom = document.querySelector('[data-site-footer] .sf-bot p').getBoundingClientRect().left
  return { cols, brand: Math.round(brand), bottom: Math.round(bottom) }
})()`

// Every wordmark on the page (the inline SVG brand or a wordmark image) sits
// in a link to Home, unless it is inside a card (.vcard).
const WORDMARKS = `(() => {
  const marks = [...document.querySelectorAll('img[src*="mingla-wordmark"], svg[viewBox="0 80 256 90"]')]
  return marks.filter((m) => !m.closest('.vcard')).map((m) => { const a = m.closest('a'); return a ? a.getAttribute('href') : null })
})()`

const CLIP_RULES = `(() => [...document.querySelectorAll('video[data-landing-clip]')].map((v) => ({
  poster: !!v.getAttribute('poster'), muted: v.muted, inline: v.hasAttribute('playsinline'), preloadNone: v.getAttribute('preload') === 'none' || v.getAttribute('src') !== null,
})))()`

test('built: at 375 px no orphan tiles, the footer is a symmetrical 2×2, every wordmark goes Home', { skip: !(BUILT && CHROME) && 'set ISSUE_4339_BUILT=1 after next build (Chrome needed)' }, async () => {
  await withBrowser(MARKETING, async (page) => {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true })
    for (const route of PAGES) {
      await page.send('Page.navigate', { url: `${page.origin}${route}` })
      await page.until(`document.readyState === 'complete' && !!document.querySelector('[data-site-footer]')`, `${route} loads`)
      assert.deepEqual(await page.evaluate(ORPHANS), [], `${route}: an orphan tile in a 2-column grid`)
      const footer = await page.evaluate(FOOTER)
      assert.equal(footer.cols.length, 4, `${route}: four footer columns`)
      for (const c of footer.cols) assert.equal(c.links, 4, `${route}: four links per column`)
      const [a, b, c, d] = footer.cols
      assert.equal(a.x, c.x, `${route}: column 1 and 3 share a left edge`)
      assert.equal(b.x, d.x, `${route}: column 2 and 4 share a left edge`)
      assert.ok(Math.abs(a.w - b.w) <= 1, `${route}: equal column widths`)
      assert.equal(a.head, b.head, `${route}: row 1 headings on one line`)
      assert.equal(c.head, d.head, `${route}: row 2 headings on one line`)
      const rhythm = new Set(footer.cols.flatMap((col) => col.gaps))
      assert.equal(rhythm.size, 1, `${route}: one link rhythm (${[...rhythm]})`)
      assert.equal(footer.brand, a.x, `${route}: wordmark on the column edge`)
      assert.equal(footer.bottom, a.x, `${route}: bottom line on the same edge`)
      for (const href of await page.evaluate(WORDMARKS)) assert.equal(href, '/', `${route}: a wordmark links to ${href}`)
      for (const clip of await page.evaluate(CLIP_RULES)) assert.deepEqual(clip, { poster: true, muted: true, inline: true, preloadNone: true }, `${route}: clip rules`)
    }
    // The Home cities row: Brussels (the 5th) spans the row at 16:10.
    await page.send('Page.navigate', { url: `${page.origin}/` })
    await page.until(`document.readyState === 'complete'`, '/ loads')
    const brussels = await page.evaluate(`(() => { const t = [...document.querySelectorAll('.cityrow > a')]; const r = t.at(-1).getBoundingClientRect(); return { name: t.at(-1).textContent.trim(), ratio: Math.round(r.width / r.height * 100) / 100, full: Math.abs(r.width - t.at(-1).parentElement.clientWidth) <= 2 } })()`)
    assert.deepEqual(brussels, { name: 'Brussels', ratio: 1.6, full: true })
    // Desktop is unchanged: five across, no spanning.
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    await page.send('Page.reload')
    await page.until(`document.readyState === 'complete'`, '/ reloads')
    const desktop = await page.evaluate(`(() => { const row = document.querySelector('.cityrow'); return { tracks: getComputedStyle(row).gridTemplateColumns.split(' ').length, lastSpan: getComputedStyle(row.lastElementChild).gridColumnStart } })()`)
    assert.deepEqual(desktop, { tracks: 5, lastSpan: 'auto' })
    const footer = await page.evaluate(FOOTER)
    assert.equal(new Set(footer.cols.map((c) => c.head)).size, 1, 'desktop: one row of four columns')
  })
})
