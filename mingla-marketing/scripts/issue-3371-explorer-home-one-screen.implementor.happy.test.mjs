#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// #3371 [explorer home one screen] — Seth's approved decisions, 2026-09-14:
//   1. Side menu: Explorer -> `/` (lit on `/`), no Home item, and a supporting
//      "For Explorers" -> `/for-explorers` directly after Cities.
//   2. `/` is hero only, one screen, no scroll — no city guides section.
//   3. "Use Mingla" has measured breathing room above AND below it.
//   4. The long Explorer page lives at `/for-explorers`; `/explorer` is a
//      permanent redirect declared in the typed search registry.
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
    [['/cities', 'Cities'], ['/for-explorers', 'For Explorers'], ['/about', 'About'], ['/tools', 'Free tools']],
    'supporting items must be exactly Cities, For Explorers, About, Free tools',
  )
  assert.doesNotMatch(menu, /label: 'Home'|\bHouse\b/, 'the menu must not carry a separate Home item or its icon')
  assert.doesNotMatch(menu, /'\/explorer'/, 'the menu must not reference the retired /explorer path')
  assert.match(menu, /if \(pathname === '\/' \|\| pathname === '\/for-explorers'/, 'surfaceForPath must map the home and the renamed page to Explorer')
  assert.match(menu, /const activeSurface = supportingDestinationIsCurrent \? null : surfaceForPath\(pathname\) \?\? surface/, 'a current supporting item must win the highlight so Explorer is not lit on /for-explorers')
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

  assert(fs.existsSync(path.join(REPO, M('app/(core)/for-explorers/page.tsx'))), '/for-explorers page must exist')
  assert(!fs.existsSync(path.join(REPO, M('app/(core)/explorer'))), 'the old /explorer page directory must be gone')
  const forExplorers = code(source(M('app/(core)/for-explorers/page.tsx')))
  assert.match(forExplorers, /const record = CORE_PAGES\['for-explorers'\]/)
  assert.match(forExplorers, /crumbs=\{\[\{name:'Home',path:'\/'\},\{name:'For Explorers',path:'\/for-explorers'\}\]\}/, 'breadcrumb must read Home -> For Explorers')
  const corePages = code(source(M('content/core-pages.ts')))
  assert.match(corePages, /slug: 'for-explorers', pathname: '\/for-explorers', lifecycle: CORE_PAGE_RELEASE_LIFECYCLE/)
  assert.match(corePages, /title: 'For Explorers: Date Plans, Events & City Gems \| Mingla'/)
  assert.match(corePages, /eyebrow: 'For Explorers'/)
  assert.match(corePages, /h1: 'Find a plan that fits the moment\.'/, 'the H1 must be unchanged')
  assert.doesNotMatch(corePages, /pathname: '\/explorer'/)

  const registry = code(source(M('lib/search/route-registry.ts')))
  const redirectBlock = /const REDIRECTED_ROUTES = \[([\s\S]*?)\] as const satisfies readonly RedirectedRouteContract\[\]/.exec(registry)
  assert(redirectBlock, 'REDIRECTED_ROUTES must stay the typed redirect owner')
  const redirects = [...redirectBlock[1].matchAll(/\{\s*id: '([^']+)',\s*match: \{ type: '(exact|prefix)', pathname: '([^']+)' \},\s*lifecycle: 'redirected',\s*source: '([^']+)',\s*destination: '([^']+)',\s*\}/g)]
    .map(([, id, type, pathname, from, to]) => ({ id, type, pathname, from, to }))
  const explorerRedirect = redirects.find((entry) => entry.from === '/explorer')
  assert(explorerRedirect, '/explorer must be a registered lifecycle redirect')
  assert.deepEqual([explorerRedirect.type, explorerRedirect.pathname, explorerRedirect.to], ['exact', '/explorer', '/for-explorers'])
  assert.match(registry, /\.map\(\(\{ source, destination \}\) => \(\{ source, destination, permanent: true as const \}\)\)/, 'registry redirects must stay permanent')
  assert.match(code(source(M('next.config.ts'))), /return \[\.\.\.nextRedirectsFromRegistry\(\)\]/, 'Next must consume the registry redirects rather than a hand-written entry')

  const verifier = source(M('scripts/verify-search-foundation.mjs'))
  assert.match(verifier, /\['\/explorer', '\/for-explorers'\],/, 'search verification must request the permanent redirect')
  assert.match(verifier, /'\/terms-of-service',[\s\S]*'\/for-explorers',\s*'\/help\/getting-the-apps'/, 'search verification must run the full contract on /for-explorers in registry order')
  const scope = JSON.parse(source('scripts/search/fixtures/release-route-scope.json'))
  assert.equal(scope.marketing.find((record) => record.path === '/for-explorers')?.lifecycle, 'search_ready', 'release route scope must plan /for-explorers as search_ready')
  assert.equal(scope.marketing.some((record) => record.path === '/explorer'), false, 'release route scope must not plan the redirected path')
  assert.match(source('scripts/search/workbook-contract.mjs'), /const isExplorer = record\.path === '\/for-explorers'/)
  const rights = JSON.parse(source('tools/product-proof-capture/rights-manifest.json'))
  assert(rights.outputs.find((row) => row.scene === 'explorer_saved_details').allowedSurfaces.includes('usemingla.com/for-explorers'))
  assert.doesNotMatch(JSON.stringify(rights), /usemingla\.com\/explorer"/, 'product-proof rights must follow the page to its new path')

  for (const footer of [M('components/cutout/footer.tsx'), M('components/marketing/footer.tsx')]) {
    const footerCode = code(source(footer))
    assert.match(footerCode, /\{ href: '\/for-explorers', label: 'For Explorers' \}/, `${footer} must link For Explorers to its new path`)
    assert.match(footerCode, /\{ href: '\/', label: 'Home' \}/, `${footer} keeps its Home link`)
    assert.doesNotMatch(footerCode, /'\/explorer'/, `${footer} must not link the redirected path`)
  }
  const posthog = code(source(M('components/marketing/posthog-provider.tsx')))
  assert.match(posthog, /pathname === '\/for-explorers' \|\| pathname\.startsWith\('\/cities\/'\) \? 'explorer' : 'neutral'/, 'audience continuity')
  assert.match(posthog, /pathname === '\/for-explorers' \? 'explorer_pillar'/, 'page-family continuity')
  assert.doesNotMatch(posthog, /'\/explorer'/)

  const scripts = JSON.parse(source(M('package.json'))).scripts
  const sourceCommand = `node scripts/${SELF} --source-only`
  const builtCommand = `node --experimental-websocket scripts/${SELF} --built-only`
  assert(scripts.build.includes(sourceCommand) && scripts.build.indexOf(sourceCommand) < scripts.build.indexOf('next build'), 'source guard must run before the first production build')
  assert(scripts.build.endsWith(` && ${builtCommand}`) && scripts.build.lastIndexOf(builtCommand) > scripts.build.lastIndexOf('next build'), 'geometry guard must run against the final production build')
  assert.equal(scripts['test:issue-3371'], `node --experimental-websocket scripts/${SELF}`, 'focused command must remain available')
  process.stdout.write('PASS #3371 source: menu order/hrefs without Home, one-screen home without city grid, /for-explorers rename, registry redirect, footers, analytics and build wiring\n')
}

function assertHomeGeometry(sample, label) {
  assert(sample.above >= MIN_GAP, `${label}: gap above Use Mingla is ${sample.above.toFixed(1)}px (< ${MIN_GAP}px)`)
  assert(sample.below >= MIN_GAP, `${label}: gap below Use Mingla is ${sample.below.toFixed(1)}px (< ${MIN_GAP}px)`)
  assert(Math.abs(sample.above - sample.below) <= MAX_IMBALANCE, `${label}: Use Mingla is off-centre by ${Math.abs(sample.above - sample.below).toFixed(1)}px (> ${MAX_IMBALANCE}px)`)
  assert(sample.pillClearance >= MIN_PILL_CLEARANCE, `${label}: deck is ${sample.pillClearance.toFixed(1)}px from the hero pill row (< ${MIN_PILL_CLEARANCE}px)`)
  assert.equal(sample.scrollHeight, sample.innerHeight, `${label}: home scrolls (document ${sample.scrollHeight}px, viewport ${sample.innerHeight}px)`)
  assert.equal(sample.cityGrid, false, `${label}: home renders the city guides module`)
}

function artifactContract() {
  assert(fs.existsSync(path.join(ROOT, '.next/BUILD_ID')), 'run a production build before the #3371 built guard')
  const routes = JSON.parse(fs.readFileSync(path.join(ROOT, '.next/routes-manifest.json'), 'utf8'))
  const redirect = routes.redirects.find((entry) => entry.source === '/explorer')
  assert(redirect, 'built routes manifest lacks the /explorer redirect')
  assert.deepEqual([redirect.destination, redirect.statusCode], ['/for-explorers', 308], '/explorer must be a permanent redirect in the build')
  const appPaths = fs.readFileSync(path.join(ROOT, '.next/server/app-paths-manifest.json'), 'utf8')
  assert.match(appPaths, /"\/\(core\)\/for-explorers\/page"/, 'built artifact lacks /for-explorers')
  assert.doesNotMatch(appPaths, /"\/\(core\)\/explorer\/page"/, 'built artifact still contains the old /explorer page')
  process.stdout.write('PASS #3371 artifact: 308 /explorer -> /for-explorers and only the renamed page is built\n')
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
    assert.equal(redirect.headers.location, '/for-explorers?utm_source=3371', '/explorer must land on /for-explorers with its query')
    const renamed = await request(serverPort, '/for-explorers')
    assert.equal(renamed.status, 200, '/for-explorers must render')
    assert.match(renamed.body, /<title>For Explorers: Date Plans, Events &amp; City Gems \| Mingla<\/title>/, '/for-explorers browser title')
    assert.match(renamed.body, /<h1\b[^>]*>Find a plan that fits the moment\.<\/h1>/, '/for-explorers keeps its H1')
    assert.doesNotMatch(renamed.body, /href="\/explorer"/, '/for-explorers links the redirected path')
    const home = await request(serverPort, '/')
    assert.equal(home.status, 200)
    assert.doesNotMatch(home.body, /city-root-module|Mingla city guides/, 'home must not server-render the city guides module')
    assert.doesNotMatch(home.body, /href="\/explorer"/, 'home links the redirected path')
    const sitemap = (await request(serverPort, '/sitemap.xml')).body
    assert.doesNotMatch(sitemap, /usemingla\.com\/explorer</, 'sitemap must not list the redirected path')
    assert.equal(sitemap.includes('usemingla.com/for-explorers<'), sitemap.includes('usemingla.com/about<'), '/for-explorers must share the core-page sitemap state')
    const host = (await request(serverPort, '/host')).body
    assert.equal(host.includes('city-root-module'), sitemap.includes('/cities/lagos<'), 'the Host page keeps its city list whenever the city launch is live')
    process.stdout.write('PASS #3371 runtime HTTP: 308 with query, /for-explorers title/H1, home without city guides, sitemap and Host list\n')

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
      ['For Explorers', '/for-explorers', null], ['About', '/about', null], ['Free tools', '/tools', null],
    ], 'on / the menu must light Explorer only, with no Home item')
    await page.send('Page.navigate', { url: `${base}/explorer` })
    await waitFor(() => page.evaluate(`location.pathname==='/for-explorers'&&document.readyState==='complete'&&!!document.querySelector('button[aria-label="Open menu"]')`), 'browser did not follow /explorer to /for-explorers')
    assert.deepEqual(await openMenuItems(page), [
      ['Explorer', '/', null], ['Host', '/host', null], ['Cities', '/cities', null],
      ['For Explorers', '/for-explorers', 'page'], ['About', '/about', null], ['Free tools', '/tools', null],
    ], 'on /for-explorers the menu must light For Explorers, not Explorer')
    process.stdout.write(`PASS #3371 browser: ${VIEWPORTS.map(([w, h]) => `${w}x${h}`).join(', ')} keep >=${MIN_GAP}px above and below Use Mingla (imbalance <=${MAX_IMBALANCE}px), >=${MIN_PILL_CLEARANCE}px deck-to-pills, no scroll; menu highlight on / and /for-explorers\n`)
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
    .replace("    { href: '/cities', label: 'Cities', Icon: MapPinned },\n    { href: '/for-explorers', label: 'For Explorers', Icon: BookOpen },", "    { href: '/', label: 'Home', Icon: House },\n    { href: '/cities', label: 'Cities', Icon: MapPinned },")
  assert.notEqual(oldMenu, menu, 'self-test must rebuild the pre-#3371 menu')
  assert.throws(() => sourceContract({ [menuPath]: oldMenu }), /Explorer must open the home page/, 'the pre-#3371 menu must prove RED')
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
  process.stdout.write('RED proof: pre-#3371 menu, scrolling home with city grid, missing redirect and the measured crowded gaps were rejected\n')
}

assert(!(SOURCE_ONLY && BUILT_ONLY), 'choose only one #3371 guard mode')
if (!BUILT_ONLY) sourceContract()
if (SELF_TEST) selfTest()
if (!SOURCE_ONLY && !SELF_TEST) { artifactContract(); await runtimeContract() }
process.stdout.write('PASS #3371 explorer home one screen implementor happy-path guard\n')
