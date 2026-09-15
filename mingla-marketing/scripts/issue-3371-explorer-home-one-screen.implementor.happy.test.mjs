#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// #3371 [explorer home one screen] — Seth's approved decisions, 2026-09-14,
// amended after screenshot review on 2026-09-15 (issue #3371, latest comment):
//   1. Side menu: Explorer -> `/` (lit on `/`), no Home item, and a supporting
//      "Going out" -> `/going-out` directly after Cities. Every menu row is
//      left-aligned: its icon starts at the row's left padding.
//   2. `/` is hero only, one screen, no scroll — no city guides section.
//   3. "Use Mingla" has measured breathing room above AND below it.
//   4. The long Explorer page lives at `/going-out` ("Going out"); `/explorer`
//      is a permanent redirect declared in the typed search registry.
//      `/for-explorers` never shipped, so it has no redirect.
//
// Modes: `--source-only` (before `next build`), `--built-only` (against the
// final production build, including local Chrome geometry), `--self-test`
// (proves the source and geometry guards reject the pre-#3371 state).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO = path.resolve(ROOT, '..')
const SELF = path.basename(fileURLToPath(import.meta.url))
const SOURCE_ONLY = process.argv.includes('--source-only')
const BUILT_ONLY = process.argv.includes('--built-only')
const SELF_TEST = process.argv.includes('--self-test')
const VIEWPORTS = [[1440, 900], [1280, 800], [1920, 1080], [390, 844], [375, 667]]
// Side-menu alignment viewports (Seth asked for phone proof, incl. 402x874).
const MENU_VIEWPORTS = [[1440, 900], [390, 844], [402, 874], [375, 667], [360, 780]]
const ICON_TOLERANCE_PX = 1
const CTA_CENTRE_TOLERANCE_PX = 1.5
const MIN_GAP = 28
const MAX_IMBALANCE = 16
const MIN_PILL_CLEARANCE = 24
const SAMPLES = 6
const CDP_REQUEST_TIMEOUT_MS = 25_000
const CHILD_STOP_TIMEOUT_MS = 2_000
// Cold `next start` and a fresh Chrome profile each took ~25s on a loaded dev
// machine; a 30s wait flaked once, so owned-process startup gets real headroom.
const STARTUP_TIMEOUT_MS = 90_000
const CHROME = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean).find((candidate) => fs.existsSync(candidate))

const readRepo = (relative) => fs.readFileSync(path.join(REPO, relative), 'utf8')
const M = (relative) => `mingla-marketing/${relative}`
// Comment-stripped source, so an explanatory comment naming the old component
// can never satisfy or trip a code assertion.
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

function destinations(menu, name) {
  const start = menu.indexOf(`const ${name} = [`)
  assert(start >= 0, `${name} must remain one literal destination list`)
  const block = menu.slice(start, menu.indexOf('\n  ]', start))
  return [...block.matchAll(/\{ href: '([^']+)', label: '([^']+)'/g)].map((match) => [match[1], match[2]])
}

function sourceContract(overrides = {}) {
  const source = (relative) => overrides[relative] ?? readRepo(relative)

  const menu = code(source(M('components/cutout/audience-menu-content.tsx')))
  assert.deepEqual(destinations(menu, 'audienceDestinations'), [['/', 'Explorer'], ['/host', 'Host']], 'Explorer must open the home page, followed by Host')
  assert.deepEqual(
    destinations(menu, 'supportingDestinations'),
    [['/cities', 'Cities'], ['/going-out', 'Going out'], ['/about', 'About'], ['/tools', 'Free tools']],
    'supporting items must be exactly Cities, Going out, About, Free tools',
  )
  assert.doesNotMatch(menu, /label: 'Home'|\bHouse\b/, 'the menu must not carry a separate Home item or its icon')
  assert.doesNotMatch(menu, /label: '[^']*[Ee]xplorers?[^']*', Icon: (?!Compass)/, 'no supporting menu label may say explorer')
  assert.match(menu, /\{ href: '\/going-out', label: 'Going out', Icon: Footprints \}/, 'Going out must use the Footprints icon')
  assert.match(menu, /const menuButtonClass = '[^']*\bcut-btn\b[^']*\bcut-menu-item\b[^']*'/, 'every menu row must opt into the left-aligned cut-menu-item treatment')
  assert.match(menu, /label="Explore Your City"[\s\S]*label="Host Your City"/, 'bottom device CTAs must stay')
  assert.doesNotMatch(menu.slice(menu.indexOf('<div className="mt-auto')), /cut-menu-item|menuButtonClass/, 'bottom CTAs must not receive the left-aligned row treatment')
  const cutoutCss = source(M('components/cutout/cutout.css')).replace(/\/\*[\s\S]*?\*\//g, '')
  assert.match(cutoutCss, /\.cut-btn\s*\{[^}]*justify-content:\s*center;/, 'every other cut-btn must stay centred')
  assert.match(cutoutCss, /\.cut-btn\.cut-menu-item\s*\{\s*justify-content:\s*flex-start;\s*\}/, 'the menu rows must override the centred cut-btn justify with a scoped two-class rule')
  assert.doesNotMatch(menu, /'\/explorer'/, 'the menu must not reference the retired /explorer path')
  assert.match(menu, /if \(pathname === '\/' \|\| pathname === '\/going-out'/, 'surfaceForPath must map the home and the renamed page to Explorer')
  assert.match(menu, /const activeSurface = supportingDestinationIsCurrent \? null : surfaceForPath\(pathname\) \?\? surface/, 'a current supporting item must win the highlight so Explorer is not lit on /going-out')
  assert.match(menu, /label="Explore Your City"[\s\S]*label="Host Your City"/, 'bottom device CTAs must be unchanged')

  const home = code(source(M('app/(explorer)/page.tsx')))
  assert.doesNotMatch(home, /RootCityGrid/, 'the home page must not mount the city guides grid')
  assert.doesNotMatch(home, /showCityLaunch|allCityHubsSearchReady/, 'the home page must not branch on the city launch')
  assert.match(home, /<CutoutShell dark noScroll>/, 'the home page must always be the one-screen shell')
  assert.match(home, /<div data-cut-deck className="relative h-full">/, 'the deck wrapper must fill the one-screen shell')
  assert.doesNotMatch(home, /h-\[100svh\]/, 'the scrolling deck wrapper height must not return')
  assert.match(home, /location="hero_above_deck"/, 'the Use Mingla action must stay between headline and deck')
  assert.doesNotMatch(code(source(M('app/(explorer)/layout.tsx'))), /city-hubs\.css/, 'the one-screen home has no city module to style')
  assert.match(code(source(M('app/host/page.tsx'))), /<RootCityGrid surface="host"/, 'the Host page keeps its city list')

  assert(fs.existsSync(path.join(REPO, M('app/(core)/going-out/page.tsx'))), '/going-out page must exist')
  assert(!fs.existsSync(path.join(REPO, M('app/(core)/explorer'))), 'the old /explorer page directory must be gone')
  assert(!fs.existsSync(path.join(REPO, M('app/(core)/for-explorers'))), 'the unshipped /for-explorers name must not exist')
  const goingOut = code(source(M('app/(core)/going-out/page.tsx')))
  assert.match(goingOut, /const record = CORE_PAGES\['going-out'\]/)
  assert.match(goingOut, /crumbs=\{\[\{name:'Home',path:'\/'\},\{name:'Going out',path:'\/going-out'\}\]\}/, 'breadcrumb must read Home -> Going out')
  const corePages = code(source(M('content/core-pages.ts')))
  assert.match(corePages, /slug: 'going-out', pathname: '\/going-out', lifecycle: CORE_PAGE_RELEASE_LIFECYCLE/)
  assert.match(corePages, /title: 'Going out: Date Plans, Events & City Gems \| Mingla'/)
  assert.match(corePages, /eyebrow: 'Going out'/)
  assert.match(corePages, /h1: 'Find a plan that fits the moment\.'/, 'the H1 must be unchanged')
  assert.doesNotMatch(corePages, /pathname: '\/explorer'/)

  const registry = code(source(M('lib/search/route-registry.ts')))
  const redirectBlock = /const REDIRECTED_ROUTES = \[([\s\S]*?)\] as const satisfies readonly RedirectedRouteContract\[\]/.exec(registry)
  assert(redirectBlock, 'REDIRECTED_ROUTES must stay the typed redirect owner')
  const redirects = [...redirectBlock[1].matchAll(/\{\s*id: '([^']+)',\s*match: \{ type: '(exact|prefix)', pathname: '([^']+)' \},\s*lifecycle: 'redirected',\s*source: '([^']+)',\s*destination: '([^']+)',\s*\}/g)]
    .map(([, id, type, pathname, from, to]) => ({ id, type, pathname, from, to }))
  const explorerRedirect = redirects.find((entry) => entry.from === '/explorer')
  assert(explorerRedirect, '/explorer must be a registered lifecycle redirect')
  assert.deepEqual([explorerRedirect.type, explorerRedirect.pathname, explorerRedirect.to], ['exact', '/explorer', '/going-out'])
  assert.equal(redirects.some((entry) => /for-explorers/.test(`${entry.from} ${entry.to}`)), false, '/for-explorers never shipped, so it must not be redirected')
  assert.match(registry, /\.map\(\(\{ source, destination \}\) => \(\{ source, destination, permanent: true as const \}\)\)/, 'registry redirects must stay permanent')
  assert.match(code(source(M('next.config.ts'))), /return \[\.\.\.nextRedirectsFromRegistry\(\)\]/, 'Next must consume the registry redirects rather than a hand-written entry')

  const verifier = source(M('scripts/verify-search-foundation.mjs'))
  assert.match(verifier, /\['\/explorer', '\/going-out'\],/, 'search verification must request the permanent redirect')
  assert.match(verifier, /'\/terms-of-service',[\s\S]*'\/going-out',\s*'\/help\/getting-the-apps'/, 'search verification must run the full contract on /going-out in registry order')
  const scope = JSON.parse(source('scripts/search/fixtures/release-route-scope.json'))
  assert.equal(scope.marketing.find((record) => record.path === '/going-out')?.lifecycle, 'search_ready', 'release route scope must plan /going-out as search_ready')
  assert.equal(scope.marketing.some((record) => record.path === '/explorer'), false, 'release route scope must not plan the redirected path')
  assert.match(source('scripts/search/workbook-contract.mjs'), /const isExplorer = record\.path === '\/going-out'/)
  const rights = JSON.parse(source('tools/product-proof-capture/rights-manifest.json'))
  assert(rights.outputs.find((row) => row.scene === 'explorer_saved_details').allowedSurfaces.includes('usemingla.com/going-out'))
  assert.doesNotMatch(JSON.stringify(rights), /usemingla\.com\/explorer"/, 'product-proof rights must follow the page to its new path')

  for (const footer of [M('components/cutout/footer.tsx'), M('components/marketing/footer.tsx')]) {
    const footerCode = code(source(footer))
    assert.match(footerCode, /\{ href: '\/going-out', label: 'Going out' \}/, `${footer} must link Going out to its new path`)
    assert.match(footerCode, /\{ href: '\/', label: 'Home' \}/, `${footer} keeps its Home link`)
    assert.doesNotMatch(footerCode, /'\/explorer'/, `${footer} must not link the redirected path`)
  }
  const posthog = code(source(M('components/marketing/posthog-provider.tsx')))
  assert.match(posthog, /pathname === '\/going-out' \|\| pathname\.startsWith\('\/cities\/'\) \? 'explorer' : 'neutral'/, 'audience continuity')
  assert.match(posthog, /pathname === '\/going-out' \? 'explorer_pillar'/, 'page-family continuity')
  assert.doesNotMatch(posthog, /'\/explorer'/)

  const scripts = JSON.parse(source(M('package.json'))).scripts
  const sourceCommand = `node scripts/${SELF} --source-only`
  const builtCommand = `node --experimental-websocket scripts/${SELF} --built-only`
  assert(scripts.build.includes(sourceCommand) && scripts.build.indexOf(sourceCommand) < scripts.build.indexOf('next build'), 'source guard must run before the first production build')
  assert(scripts.build.endsWith(` && ${builtCommand}`) && scripts.build.lastIndexOf(builtCommand) > scripts.build.lastIndexOf('next build'), 'geometry guard must run against the final production build')
  assert.equal(scripts['test:issue-3371'], `node --experimental-websocket scripts/${SELF}`, 'focused command must remain available')
  process.stdout.write('PASS #3371 source: menu order/hrefs without Home, one-screen home without city grid, /going-out rename, registry redirect, footers, analytics and build wiring\n')
}

function assertHomeGeometry(sample, label) {
  assert(sample.above >= MIN_GAP, `${label}: gap above Use Mingla is ${sample.above.toFixed(1)}px (< ${MIN_GAP}px)`)
  assert(sample.below >= MIN_GAP, `${label}: gap below Use Mingla is ${sample.below.toFixed(1)}px (< ${MIN_GAP}px)`)
  assert(Math.abs(sample.above - sample.below) <= MAX_IMBALANCE, `${label}: Use Mingla is off-centre by ${Math.abs(sample.above - sample.below).toFixed(1)}px (> ${MAX_IMBALANCE}px)`)
  assert(sample.pillClearance >= MIN_PILL_CLEARANCE, `${label}: deck is ${sample.pillClearance.toFixed(1)}px from the hero pill row (< ${MIN_PILL_CLEARANCE}px)`)
  assert.equal(sample.scrollHeight, sample.innerHeight, `${label}: home scrolls (document ${sample.scrollHeight}px, viewport ${sample.innerHeight}px)`)
  assert.equal(sample.cityGrid, false, `${label}: home renders the city guides module`)
}

// Visible geometry of the open side menu. Icon/text edges come from the SVG box
// and a Range over the label's text nodes; the bottom CTAs' content is the union
// of their text ranges and SVG boxes, compared with the button's centre.
const MENU_GEOMETRY = `(()=>{
  const dialog=document.querySelector('[role="dialog"]')
  const card=dialog.firstElementChild
  const box=(el)=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}}
  const textRects=(el)=>{const out=[];const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);for(let node=walker.nextNode();node;node=walker.nextNode()){if(!node.textContent.trim())continue;const range=document.createRange();range.selectNodeContents(node);for(const rect of range.getClientRects()){if(rect.width>0&&rect.height>0)out.push(rect)}}return out}
  const items=[...dialog.querySelectorAll('nav[aria-label="Primary"] a')].map((a)=>{
    const style=getComputedStyle(a),icon=a.querySelector('svg').getBoundingClientRect(),texts=textRects(a)
    return {label:a.textContent.trim(),current:a.getAttribute('aria-current'),box:box(a),paddingLeft:parseFloat(style.paddingLeft),paddingRight:parseFloat(style.paddingRight),
      iconLeft:icon.left,iconRight:icon.right,textLeft:Math.min(...texts.map((r)=>r.left)),textRight:Math.max(...texts.map((r)=>r.right)),
      lines:new Set(texts.map((r)=>Math.round(r.top))).size,scrollWidth:a.scrollWidth,clientWidth:a.clientWidth}
  })
  const ctas=[...new Set(card.querySelectorAll('.mt-auto .cut-btn'))].map((button)=>{
    const parts=[...textRects(button),...[...button.querySelectorAll('svg')].map((svg)=>svg.getBoundingClientRect())]
    const b=box(button),left=Math.min(...parts.map((r)=>r.left)),right=Math.max(...parts.map((r)=>r.right))
    return {label:button.textContent.trim(),centreOffset:(left+right)/2-(b.left+b.right)/2}
  })
  const panel=box(dialog)
  return {items,ctas,panel,innerWidth,scrollWidth:document.documentElement.scrollWidth,cardScrollHeight:card.scrollHeight,cardClientHeight:card.clientHeight,cardOverflowY:getComputedStyle(card).overflowY}
})()`

function spread(values) {
  return Math.max(...values) - Math.min(...values)
}

function assertMenuAlignment(sample, label) {
  assert.equal(sample.items.length, 6, `${label}: the menu must render six destinations`)
  for (const item of sample.items) {
    const offset = item.iconLeft - (item.box.left + item.paddingLeft)
    assert(Math.abs(offset) <= ICON_TOLERANCE_PX, `${label}: "${item.label}" icon starts ${offset.toFixed(1)}px from its row's left padding (expected <=${ICON_TOLERANCE_PX}px; a centred row puts it far to the right)`)
    assert(item.textLeft > item.iconRight, `${label}: "${item.label}" text must start after its icon`)
    assert.equal(item.lines, 1, `${label}: "${item.label}" label wraps`)
    assert(item.scrollWidth <= item.clientWidth && item.textRight <= item.box.right - item.paddingRight + ICON_TOLERANCE_PX, `${label}: "${item.label}" label is truncated`)
  }
  assert(spread(sample.items.map((item) => item.iconLeft)) <= ICON_TOLERANCE_PX, `${label}: the six icons do not share one left edge (${sample.items.map((item) => item.iconLeft.toFixed(1)).join(', ')})`)
  for (const [key, read] of [['width', (item) => item.box.width], ['height', (item) => item.box.height], ['icon-to-text gap', (item) => item.textLeft - item.iconRight]]) {
    assert(spread(sample.items.map(read)) <= ICON_TOLERANCE_PX, `${label}: active and inactive rows differ in ${key}`)
  }
  assert.equal(sample.ctas.length, 2, `${label}: the menu must keep its two bottom CTAs`)
  for (const cta of sample.ctas) {
    assert(Math.abs(cta.centreOffset) <= CTA_CENTRE_TOLERANCE_PX, `${label}: bottom CTA "${cta.label}" is no longer centred (${cta.centreOffset.toFixed(1)}px off)`)
  }
  assert.equal(sample.scrollWidth, sample.innerWidth, `${label}: the open menu overflows horizontally`)
  assert(sample.panel.left >= -0.5 && sample.panel.right <= sample.innerWidth + 0.5, `${label}: the drawer does not fit the viewport`)
  // Short phones (e.g. 375x667) are taller-than-drawer by design, as on main: the
  // drawer card scrolls vertically, so every row and CTA must stay reachable.
  if (sample.cardScrollHeight > sample.cardClientHeight) {
    assert(['auto', 'scroll'].includes(sample.cardOverflowY), `${label}: drawer content is ${sample.cardScrollHeight - sample.cardClientHeight}px taller than the drawer and cannot scroll`)
  }
}

async function openMenuGeometry(page, url, width, height) {
  const label = `${new URL(url).pathname} ${width}x${height}`
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 768 })
  await page.send('Page.navigate', { url })
  await waitFor(() => page.evaluate(`location.pathname===${JSON.stringify(new URL(url).pathname)}&&document.readyState==='complete'&&!!document.querySelector('button[aria-label="Open menu"]')`), `${label}: page did not load`)
  await page.evaluate(`(async()=>{await document.fonts.ready;document.querySelector('button[aria-label="Open menu"]').click();return true})()`)
  await waitFor(() => page.evaluate(`document.querySelectorAll('[role="dialog"] nav[aria-label="Primary"] a').length===6`), `${label}: side menu did not open`)
  let previous = null
  await waitFor(async () => {
    const left = await page.evaluate(`document.querySelector('[role="dialog"]').getBoundingClientRect().left`)
    const stable = previous !== null && Math.abs(left - previous) < 0.1
    previous = left
    if (!stable) await sleep(150)
    return stable
  }, `${label}: side menu did not settle`)
  return { label, sample: await page.evaluate(MENU_GEOMETRY) }
}

function artifactContract() {
  assert(fs.existsSync(path.join(ROOT, '.next/BUILD_ID')), 'run a production build before the #3371 built guard')
  const routes = JSON.parse(fs.readFileSync(path.join(ROOT, '.next/routes-manifest.json'), 'utf8'))
  const redirect = routes.redirects.find((entry) => entry.source === '/explorer')
  assert(redirect, 'built routes manifest lacks the /explorer redirect')
  assert.deepEqual([redirect.destination, redirect.statusCode], ['/going-out', 308], '/explorer must be a permanent redirect in the build')
  const appPaths = fs.readFileSync(path.join(ROOT, '.next/server/app-paths-manifest.json'), 'utf8')
  assert.match(appPaths, /"\/\(core\)\/going-out\/page"/, 'built artifact lacks /going-out')
  assert.doesNotMatch(appPaths, /"\/\(core\)\/explorer\/page"/, 'built artifact still contains the old /explorer page')
  process.stdout.write('PASS #3371 artifact: 308 /explorer -> /going-out and only the renamed page is built\n')
}

async function freePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const { port } = server.address()
  await new Promise((resolve) => server.close(resolve))
  return port
}

async function waitFor(check, message, timeout = 30_000) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    try { if (await check()) return } catch (error) { last = error }
    await new Promise((resolve) => setTimeout(resolve, 80))
  }
  throw new Error(`${message}${last ? `: ${last.message}` : ''}`)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function request(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, method: 'GET', headers: { Host: 'usemingla.com', 'User-Agent': 'Mozilla/5.0 Mingla3371/1.0' } }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.once('error', reject)
    req.end()
  })
}

class Page {
  constructor(url) {
    this.next = 0
    this.pending = new Map()
    this.socket = new WebSocket(url)
    this.ready = new Promise((resolve, reject) => { this.socket.addEventListener('open', resolve, { once: true }); this.socket.addEventListener('error', reject, { once: true }) })
    this.socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(String(data))
      const pending = this.pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(message.id)
      message.error ? pending.reject(Error(message.error.message)) : pending.resolve(message.result)
    })
  }
  async send(method, params = {}, timeoutMs = CDP_REQUEST_TIMEOUT_MS) {
    await this.ready
    const id = ++this.next
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error(`CDP timeout: ${method}`)) }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    assert(!result.exceptionDetails, result.exceptionDetails?.exception?.description ?? result.exceptionDetails?.text)
    return result.result.value
  }
  close() { this.socket.close() }
}

function waitForExit(child, timeoutMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = setTimeout(() => { child.removeListener('exit', onExit); resolve(false) }, timeoutMs)
    const onExit = () => { clearTimeout(timer); resolve(true) }
    child.once('exit', onExit)
  })
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return true
  const exited = waitForExit(child, CHILD_STOP_TIMEOUT_MS)
  child.kill('SIGTERM')
  if (await exited) return true
  const killed = waitForExit(child, CHILD_STOP_TIMEOUT_MS)
  child.kill('SIGKILL')
  return killed
}

// Visible geometry, not box edges: the headline's bottom is the lowest rect of
// its TEXT nodes (a Range per node), and the deck's top is the highest visible
// card (the peeked back card), clipped by the deck's own overflow box.
const GEOMETRY = `(()=>{
  const deck=document.querySelector('[data-cut-deck]')
  const h1=deck.querySelector('h1')
  const walker=document.createTreeWalker(h1,NodeFilter.SHOW_TEXT)
  let textBottom=-Infinity
  for(let node=walker.nextNode();node;node=walker.nextNode()){
    if(!node.textContent.trim())continue
    const range=document.createRange();range.selectNodeContents(node)
    for(const rect of range.getClientRects()){if(rect.width>0&&rect.height>0)textBottom=Math.max(textBottom,rect.bottom)}
  }
  const opacity=(el)=>{let value=1;for(let node=el;node&&node!==document.documentElement;node=node.parentElement){const style=getComputedStyle(node);if(style.display==='none'||style.visibility==='hidden')return 0;value*=parseFloat(style.opacity)}return value}
  const cells=[...deck.querySelectorAll('.group.absolute')]
  const clip=cells[0].parentElement.getBoundingClientRect()
  const cards=cells.map((cell)=>cell.firstElementChild).filter((card)=>card&&opacity(card)>0.05).map((card)=>card.getBoundingClientRect())
  const cardTop=Math.max(Math.min(...cards.map((rect)=>rect.top)),clip.top)
  const cardBottom=Math.min(Math.max(...cards.map((rect)=>rect.bottom)),clip.bottom)
  const action=deck.querySelector('[data-cut-deck] > .z-30 .cut-btn').getBoundingClientRect()
  const pills=[...deck.querySelectorAll('nav[aria-label="Site"] > *')].filter((pill)=>getComputedStyle(pill).display!=='none').map((pill)=>pill.getBoundingClientRect())
  return {
    textBottom, actionTop:action.top, actionBottom:action.bottom, cardTop, cardBottom,
    above:action.top-textBottom, below:cardTop-action.bottom, pillClearance:Math.min(...pills.map((rect)=>rect.top))-cardBottom,
    scrollHeight:Math.max(document.documentElement.scrollHeight,document.body.scrollHeight), innerHeight,
    cityGrid:!!document.querySelector('.city-root-module'),
  }
})()`

const SETTLED = `(()=>{
  const h1=document.querySelector('[data-cut-deck] h1')
  const deck=h1&&h1.nextElementSibling
  const action=document.querySelector('[data-cut-deck] > .z-30 .cut-btn')
  if(!h1||!deck||!action||document.readyState!=='complete')return false
  if(!document.querySelector('[data-cut-deck] .group.absolute'))return false
  const settled=(el)=>{const style=getComputedStyle(el);return style.opacity==='1'&&(style.transform==='none'||style.transform==='matrix(1, 0, 0, 1, 0, 0)')}
  return settled(h1)&&settled(deck)
})()`

async function openMenuItems(page) {
  await page.evaluate(`(()=>{document.querySelector('button[aria-label="Open menu"]').click();return true})()`)
  await waitFor(() => page.evaluate(`document.querySelectorAll('[role="dialog"] nav[aria-label="Primary"] a').length===6`), 'side menu did not open')
  return page.evaluate(`[...document.querySelectorAll('[role="dialog"] nav[aria-label="Primary"] a')].map((a)=>[a.textContent.trim(),a.getAttribute('href'),a.getAttribute('aria-current')])`)
}

async function runtimeContract() {
  const serverPort = await freePort()
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(serverPort)], { cwd: ROOT, env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', MINGLA_HISTORICAL_2983_BUILD: '' }, stdio: 'ignore' })
  let chrome
  let page
  let profile
  try {
    await waitFor(async () => (await request(serverPort, '/robots.txt')).status === 200, 'local Next server did not start', STARTUP_TIMEOUT_MS)

    const redirect = await request(serverPort, '/explorer?utm_source=3371')
    assert.equal(redirect.status, 308, '/explorer must be a permanent redirect')
    assert.equal(redirect.headers.location, '/going-out?utm_source=3371', '/explorer must land on /going-out with its query')
    const renamed = await request(serverPort, '/going-out')
    assert.equal(renamed.status, 200, '/going-out must render')
    assert.match(renamed.body, /<title>Going out: Date Plans, Events &amp; City Gems \| Mingla<\/title>/, '/going-out browser title')
    assert.match(renamed.body, /<h1\b[^>]*>Find a plan that fits the moment\.<\/h1>/, '/going-out keeps its H1')
    assert.doesNotMatch(renamed.body, /href="\/explorer"/, '/going-out links the redirected path')
    const home = await request(serverPort, '/')
    assert.equal(home.status, 200)
    assert.doesNotMatch(home.body, /city-root-module|Mingla city guides/, 'home must not server-render the city guides module')
    assert.doesNotMatch(home.body, /href="\/explorer"/, 'home links the redirected path')
    const sitemap = (await request(serverPort, '/sitemap.xml')).body
    assert.doesNotMatch(sitemap, /usemingla\.com\/explorer</, 'sitemap must not list the redirected path')
    assert.equal(sitemap.includes('usemingla.com/going-out<'), sitemap.includes('usemingla.com/about<'), '/going-out must share the core-page sitemap state')
    const host = (await request(serverPort, '/host')).body
    assert.equal(host.includes('city-root-module'), sitemap.includes('/cities/lagos<'), 'the Host page keeps its city list whenever the city launch is live')
    process.stdout.write('PASS #3371 runtime HTTP: 308 with query, /going-out title/H1, home without city guides, sitemap and Host list\n')

    if (process.env.VERCEL === '1') {
      process.stdout.write('SKIP #3371 browser geometry on Vercel only; source, artifact and HTTP gates executed\n')
      return
    }
    assert(CHROME, 'Chrome executable required for the #3371 measured-spacing proof')
    assert.equal(typeof WebSocket, 'function', 'run this guard with Node command-scoped --experimental-websocket')
    const chromePort = await freePort()
    profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mingla-3371-home-'))
    chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${chromePort}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions', 'about:blank'], { stdio: 'ignore' })
    await waitFor(async () => (await fetch(`http://127.0.0.1:${chromePort}/json/version`)).ok, 'owned Chrome did not start', STARTUP_TIMEOUT_MS)
    const target = await fetch(`http://127.0.0.1:${chromePort}/json/new?about:blank`, { method: 'PUT' }).then((response) => response.json())
    page = new Page(target.webSocketDebuggerUrl)
    await page.send('Page.enable')
    await page.send('Runtime.enable')
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('mingla_consent_v1',JSON.stringify({value:'denied',ts:Date.now()}))` })
    const base = `http://127.0.0.1:${serverPort}`

    for (const [width, height] of VIEWPORTS) {
      const label = `${width}x${height}`
      await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
      await page.send('Page.navigate', { url: `${base}/` })
      await waitFor(() => page.evaluate(`location.pathname==='/'`), `${label}: home did not load`)
      await waitFor(() => page.evaluate(SETTLED), `${label}: home hero did not settle`)
      await page.evaluate(`(async()=>{await document.fonts.ready;await new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(r)));return true})()`)
      const samples = []
      // Samples span a full 2s deck rotation, so every card swap is measured.
      for (let index = 0; index < SAMPLES; index += 1) {
        samples.push(await page.evaluate(GEOMETRY))
        await sleep(400)
      }
      for (const sample of samples) assertHomeGeometry(sample, label)
      const worst = (key) => Math.min(...samples.map((sample) => sample[key])).toFixed(1)
      process.stdout.write(`EVIDENCE #3371 ${label} above=${worst('above')}px below=${worst('below')}px pillClearance=${worst('pillClearance')}px scroll=${samples[0].scrollHeight}/${samples[0].innerHeight}\n`)
    }

    await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    await page.send('Page.navigate', { url: `${base}/` })
    await waitFor(() => page.evaluate(SETTLED), 'home hero did not settle before the menu check')
    assert.deepEqual(await openMenuItems(page), [
      ['Explorer', '/', 'page'], ['Host', '/host', null], ['Cities', '/cities', null],
      ['Going out', '/going-out', null], ['About', '/about', null], ['Free tools', '/tools', null],
    ], 'on / the menu must light Explorer only, with no Home item')
    await page.send('Page.navigate', { url: `${base}/explorer` })
    await waitFor(() => page.evaluate(`location.pathname==='/going-out'&&document.readyState==='complete'&&!!document.querySelector('button[aria-label="Open menu"]')`), 'browser did not follow /explorer to /going-out')
    assert.deepEqual(await openMenuItems(page), [
      ['Explorer', '/', null], ['Host', '/host', null], ['Cities', '/cities', null],
      ['Going out', '/going-out', 'page'], ['About', '/about', null], ['Free tools', '/tools', null],
    ], 'on /going-out the menu must light Going out, not Explorer')

    for (const [width, height] of MENU_VIEWPORTS) {
      const { label, sample } = await openMenuGeometry(page, `${base}/`, width, height)
      assertMenuAlignment(sample, label)
      assert.equal(sample.items.find((item) => item.current === 'page')?.label, 'Explorer', `${label}: Explorer must be the lit row`)
      process.stdout.write(`EVIDENCE #3371 menu ${label} iconOffset=${Math.max(...sample.items.map((item) => Math.abs(item.iconLeft - item.box.left - item.paddingLeft))).toFixed(2)}px iconLeftSpread=${spread(sample.items.map((item) => item.iconLeft)).toFixed(2)}px ctaCentreOffset=${sample.ctas.map((cta) => cta.centreOffset.toFixed(2)).join('/')}px scrollWidth=${sample.scrollWidth}/${sample.innerWidth} drawerOverflowY=${Math.max(0, sample.cardScrollHeight - sample.cardClientHeight)}px\n`)
    }
    const goingOutMenu = await openMenuGeometry(page, `${base}/going-out`, 402, 874)
    assertMenuAlignment(goingOutMenu.sample, goingOutMenu.label)
    assert.equal(goingOutMenu.sample.items.find((item) => item.current === 'page')?.label, 'Going out', `${goingOutMenu.label}: Going out must be the lit row`)
    for (const [width, height] of MENU_VIEWPORTS.filter(([width]) => width < 768)) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true })
      await page.send('Page.navigate', { url: `${base}/going-out` })
      await waitFor(() => page.evaluate(`location.pathname==='/going-out'&&document.readyState==='complete'`), `/going-out ${width}x${height}: page did not load`)
      await page.evaluate(`document.fonts.ready.then(()=>true)`)
      const overflow = await page.evaluate(`document.documentElement.scrollWidth-innerWidth`)
      assert.equal(overflow, 0, `/going-out ${width}x${height}: page overflows horizontally by ${overflow}px`)
    }
    process.stdout.write(`PASS #3371 menu: ${MENU_VIEWPORTS.map(([w, h]) => `${w}x${h}`).join(', ')} rows left-aligned (icon at padding <=${ICON_TOLERANCE_PX}px, one icon column, text after icon, no wrap/truncation, identical active/inactive rows), bottom CTAs centred, drawer inside the viewport (content scrolls where taller); lit Going out on /going-out; /going-out no horizontal overflow on phones\n`)
    process.stdout.write(`PASS #3371 browser: ${VIEWPORTS.map(([w, h]) => `${w}x${h}`).join(', ')} keep >=${MIN_GAP}px above and below Use Mingla (imbalance <=${MAX_IMBALANCE}px), >=${MIN_PILL_CLEARANCE}px deck-to-pills, no scroll; menu highlight on / and /going-out\n`)
  } finally {
    try { if (page) await page.send('Browser.close', {}, 2_000) } catch { /* the owned Chrome is force-stopped below */ }
    page?.close()
    const chromeStopped = await stopChild(chrome)
    const serverStopped = await stopChild(server)
    if (profile && chromeStopped) fs.rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
    if (!chromeStopped || !serverStopped) process.stderr.write('WARN #3371 an owned child process did not exit after SIGKILL\n')
  }
}

function selfTest() {
  const menuPath = M('components/cutout/audience-menu-content.tsx')
  const homePath = M('app/(explorer)/page.tsx')
  const registryPath = M('lib/search/route-registry.ts')
  const menu = readRepo(menuPath)
  const oldMenu = menu
    .replace("{ href: '/', label: 'Explorer', surface: 'explorer' as const, Icon: Compass },", "{ href: '/explorer', label: 'Explorer', surface: 'explorer' as const, Icon: Compass },")
    .replace("    { href: '/cities', label: 'Cities', Icon: MapPinned },\n    { href: '/going-out', label: 'Going out', Icon: Footprints },", "    { href: '/', label: 'Home', Icon: House },\n    { href: '/cities', label: 'Cities', Icon: MapPinned },")
  assert.notEqual(oldMenu, menu, 'self-test must rebuild the pre-#3371 menu')
  assert.throws(() => sourceContract({ [menuPath]: oldMenu }), /Explorer must open the home page/, 'the pre-#3371 menu must prove RED')
  const centredMenu = menu.replace(' cut-menu-item', '')
  assert.notEqual(centredMenu, menu, 'self-test must remove the left-aligned row class')
  assert.throws(() => sourceContract({ [menuPath]: centredMenu }), /left-aligned cut-menu-item/, 'centred menu rows must prove RED')
  const cssPath = M('components/cutout/cutout.css')
  const css = readRepo(cssPath)
  const noOverride = css.replace('.cut-btn.cut-menu-item { justify-content: flex-start; }', '')
  assert.notEqual(noOverride, css, 'self-test must remove the scoped justify override')
  assert.throws(() => sourceContract({ [cssPath]: noOverride }), /scoped two-class rule/, 'a missing justify override must prove RED')
  const centredRow = (index) => ({ label: `Row ${index}`, current: index === 0 ? 'page' : null, box: { left: 36, right: 259, width: 223, height: 56 }, paddingLeft: 20, paddingRight: 20, iconLeft: 36 + 20 + 50 - index * 4, iconRight: 36 + 20 + 70 - index * 4, textLeft: 36 + 20 + 84 - index * 4, textRight: 200, lines: 1, scrollWidth: 223, clientWidth: 223 })
  const centredSample = { items: [0, 1, 2, 3, 4, 5].map(centredRow), ctas: [{ label: 'Explore Your City', centreOffset: 0 }, { label: 'Host Your City', centreOffset: 0 }], panel: { left: 65, right: 390 }, innerWidth: 390, scrollWidth: 390, cardScrollHeight: 700, cardClientHeight: 820, cardOverflowY: 'auto' }
  assert.throws(() => assertMenuAlignment(centredSample, 'centred rows'), /icon starts 50\.0px from its row's left padding/, 'centred menu geometry must prove RED')
  const leftSample = { ...centredSample, items: centredSample.items.map((item) => ({ ...item, iconLeft: 56, iconRight: 76, textLeft: 90 })), ctas: [{ label: 'Explore Your City', centreOffset: -60 }, centredSample.ctas[1]] }
  assert.throws(() => assertMenuAlignment(leftSample, 'left CTA'), /bottom CTA "Explore Your City" is no longer centred/, 'a left-aligned bottom CTA must prove RED')
  const home = readRepo(homePath)
  const scrollingHome = home
    .replace('<CutoutShell dark noScroll>', "<CutoutShell dark noScroll={!showCityLaunch}>")
    .replace('      </div>\n    </CutoutShell>', '      </div>\n      {showCityLaunch ? <RootCityGrid surface="explorer" /> : null}\n    </CutoutShell>')
  assert.notEqual(scrollingHome, home, 'self-test must rebuild the scrolling home')
  assert.throws(() => sourceContract({ [homePath]: scrollingHome }), /must not mount the city guides grid/, 'the scrolling home must prove RED')
  const registry = readRepo(registryPath)
  const noRedirect = registry.replace("source: '/explorer',", "source: '/explorer-removed',")
  assert.notEqual(noRedirect, registry, 'self-test must remove the registry redirect')
  assert.throws(() => sourceContract({ [registryPath]: noRedirect }), /registered lifecycle redirect/, 'a missing redirect must prove RED')
  // The origin/main measurements before #3371 (production build, same method).
  const before = {
    '375x667': { above: 67.1, below: -3.4, pillClearance: 45.6, scrollHeight: 1740, innerHeight: 667, cityGrid: true },
    '1280x800': { above: 28.7, below: 27.2, pillClearance: 38.8, scrollHeight: 800, innerHeight: 800, cityGrid: false },
  }
  assert.throws(() => assertHomeGeometry(before['375x667'], '375x667'), /gap below Use Mingla/, 'the crowded small-phone action must prove RED')
  assert.throws(() => assertHomeGeometry(before['1280x800'], '1280x800'), /gap below Use Mingla is 27\.2px/, 'the 27px desktop gap must prove RED')
  process.stdout.write('RED proof: pre-#3371 menu, centred menu rows (source and geometry), a left-aligned bottom CTA, scrolling home with city grid, missing redirect and the measured crowded gaps were rejected\n')
}

assert(!(SOURCE_ONLY && BUILT_ONLY), 'choose only one #3371 guard mode')
if (!BUILT_ONLY) sourceContract()
if (SELF_TEST) selfTest()
if (!SOURCE_ONLY && !SELF_TEST) { artifactContract(); await runtimeContract() }
process.stdout.write('PASS #3371 explorer home one screen implementor happy-path guard\n')
