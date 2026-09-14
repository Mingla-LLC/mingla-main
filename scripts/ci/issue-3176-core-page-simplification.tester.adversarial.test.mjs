#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Independent angle: verify the rendered geometry and crawler-visible output
// instead of accepting the implementation's source-shape declarations.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const MARKETING = path.join(ROOT, 'mingla-marketing')
const SELF = path.basename(fileURLToPath(import.meta.url))
const SOURCE_ONLY = process.argv.includes('--source-only')
const BUILT_ONLY = process.argv.includes('--built-only')
const SELF_TEST = process.argv.includes('--self-test')
const SCREENSHOT_DIR = process.env.MINGLA_QA_SCREENSHOT_DIR
const WIDTHS = [320, 390, 640, 768, 1024, 1440]
const SLUGS = ['lagos', 'durham-nc', 'cary-nc', 'raleigh-nc', 'new-york-city', 'brussels', 'paris', 'london', 'fort-lauderdale', 'washington-dc']
const CITY_NAMES = ['Lagos', 'Durham', 'Cary', 'Raleigh', 'New York City', 'Brussels', 'Paris', 'London', 'Fort Lauderdale', 'Washington, DC']
const REMOVED_COPY = [
  'Reviewed by the Mingla team',
  'How Mingla publishes information',
  'Contact and corrections',
  'What Mingla can and cannot verify',
  'Product record',
  'Why a city may not be linked yet',
  'Corrections and local knowledge',
  'Policy record',
  'City guide in review',
  'Sources checked',
  'Evidence before promotion',
]
const HUB_ANNOTATIONS = ['Sources:', 'How this list was checked', 'Last reviewed', 'Next evergreen review', 'Directory ID', 'Review status']
const CHROME = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
].filter(Boolean).find((candidate) => fs.existsSync(candidate))
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')

function sourceContract(overrides = {}) {
  const source = (relative) => overrides[relative] ?? read(relative)
  const css = source('mingla-marketing/components/core-pages/core-pages.css')
  const packageJson = JSON.parse(source('mingla-marketing/package.json'))
  const forcedPillStack = /\.core-city-pills\s+(?:li|a)(?:\s*,\s*\.core-city-pills\s+(?:li|a))*\s*\{[^{}]*\bwidth\s*:\s*100%/i

  assert.doesNotMatch(css, forcedPillStack, 'REGRESSION: 320px hero pills were forced into a ten-row stack')
  assert.match(css, /\.core-city-pills\s+ul\s*\{[^}]*flex-wrap\s*:\s*wrap/i, 'city pills must keep natural wrapping')
  assert.match(css, /\.core-city-pills\s+a\s*\{[^}]*min-height\s*:\s*44px/i, 'city pills must keep 44px targets')
  assert.match(css, /@media\s*\(prefers-reduced-motion\s*:\s*reduce\)/i, 'reduced-motion handling must remain explicit')
  assert.match(packageJson.scripts['test:issue-3176'], new RegExp(`${SELF.replaceAll('.', '\\.') } --source-only`), 'focused #3176 suite must run the tester source guard')
  assert.match(packageJson.scripts.build, new RegExp(`${SELF.replaceAll('.', '\\.') } --source-only`), 'build must run the tester source guard')
  assert.equal(packageJson.scripts['test:issue-3176:tester'], `node --experimental-websocket ../scripts/ci/${SELF}`, 'focused tester runtime command must remain available')
}

async function freePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}

function waitForChildExit(child, timeoutMs, label) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const onExit = () => { clearTimeout(timer); resolve() }
    const timer = setTimeout(() => { child.removeListener('exit', onExit); reject(new Error(`${label} did not stop`)) }, timeoutMs)
    child.once('exit', onExit)
  })
}

async function stopOwned(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const term = waitForChildExit(child, 2_000, 'owned child')
  child.kill('SIGTERM')
  try { await term } catch {
    if (child.exitCode !== null || child.signalCode !== null) return
    const kill = waitForChildExit(child, 2_000, 'owned child after SIGKILL')
    child.kill('SIGKILL')
    await kill
  }
}

async function waitFor(check, label, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    try { if (await check()) return } catch (error) { last = error }
    await new Promise((resolve) => setTimeout(resolve, 80))
  }
  throw new Error(`${label}${last ? `: ${last.message}` : ''}`)
}

class CdpPage {
  constructor(webSocketUrl) {
    this.id = 0
    this.pending = new Map()
    this.socket = new WebSocket(webSocketUrl)
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true })
      this.socket.addEventListener('error', reject, { once: true })
    })
    this.socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(String(data))
      const pending = this.pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(message.id)
      message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result)
    })
  }
  async send(method, params = {}) {
    await this.ready
    const id = ++this.id
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 25_000)
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

function request(port, pathname, userAgent = 'Mozilla/5.0 MinglaTester/1.0') {
  return fetch(`http://127.0.0.1:${port}${pathname}`, { headers: { 'user-agent': userAgent } })
}

function visibleText(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

async function runtimeContract() {
  assert(CHROME, 'Chrome/Chromium is required for the #3176 tester runtime guard')
  assert(fs.existsSync(path.join(MARKETING, '.next/BUILD_ID')), 'run the current production build before the #3176 tester runtime guard')
  const appPort = await freePort()
  const debugPort = await freePort()
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mingla-3176-tester-'))
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(appPort)], {
    cwd: MARKETING,
    env: { ...process.env, MINGLA_HISTORICAL_2983_BUILD: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  let page
  try {
    await waitFor(async () => (await request(appPort, '/robots.txt')).status === 200, 'Next server did not start')
    let target
    await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json`)
      const targets = await response.json()
      target = targets.find((candidate) => candidate.type === 'page')
      return Boolean(target?.webSocketDebuggerUrl)
    }, 'Chrome debugger did not start')
    page = new CdpPage(target.webSocketDebuggerUrl)
    await page.send('Page.enable')
    await page.send('Runtime.enable')
    await page.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `localStorage.setItem('mingla_consent_v1', JSON.stringify({value:'denied',ts:Date.now()}))`,
    })

    let citiesLoaded = false
    for (const width of WIDTHS) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: false })
      await page.send('Emulation.setEmulatedMedia', { media: '', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
      if (!citiesLoaded) {
        await page.send('Page.navigate', { url: `http://127.0.0.1:${appPort}/cities` })
        citiesLoaded = true
      }
      await waitFor(() => page.evaluate("document.readyState==='complete'&&document.querySelectorAll('[data-city-pill]').length===10"), `${width}px /cities did not settle`)
      await page.evaluate('(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))})()')
      const geometry = await page.evaluate(`(()=>{
        const box=e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height}}
        const hero=document.querySelector('.core-cities-hero'),scroll=document.querySelector('.core-cities-scroll'),cards=[...document.querySelectorAll('[data-city-card]')],pills=[...document.querySelectorAll('[data-city-pill]')]
        const textBoxes=[hero.querySelector('h1'),hero.querySelector('p')].map(e=>{const range=document.createRange();range.selectNodeContents(e);return {...box(e),clientWidth:e.clientWidth,scrollWidth:e.scrollWidth,clientHeight:e.clientHeight,scrollHeight:e.scrollHeight,rangeRects:[...range.getClientRects()].map(r=>({top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height}))}})
        const grid=getComputedStyle(document.querySelector('.core-city-directory')).gridTemplateColumns.split(' ').filter(Boolean).length
        const image=getComputedStyle(document.querySelector('.core-city-directory img'))
        return {hero:box(hero),scroll:box(scroll),cards:cards.map(box),cardText:cards.map(card=>card.innerText.trim()),pills:pills.map(box),textBoxes,grid,viewport:innerHeight,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,imageTransition:image.transitionDuration,imageAnimation:image.animationName}
      })()`)
      assert.equal(geometry.overflow, 0, `${width}px /cities has horizontal overflow`)
      assert.equal(geometry.pills.length, 10, `${width}px /cities needs ten pills`)
      assert.equal(geometry.cards.length, 10, `${width}px /cities needs ten cards`)
      assert.deepEqual(geometry.cardText, CITY_NAMES, `${width}px cards must expose only the canonical city names in order`)
      assert(geometry.textBoxes.every((box) => box.scrollWidth <= box.clientWidth + 1 && box.rangeRects.every((line) => line.left >= geometry.hero.left && line.right <= geometry.hero.width + geometry.hero.left)), `${width}px hero text is internally clipped: ${JSON.stringify(geometry.textBoxes)}`)
      assert(Math.abs(geometry.hero.height - geometry.viewport) <= 1, `${width}px hero must remain one 100svh viewport; got ${geometry.hero.height}px`)
      assert(geometry.pills.every((pill) => pill.height >= 43.5), `${width}px city pill lost its 44px target`)
      assert(geometry.pills.every((pill) => pill.top >= geometry.hero.top && pill.bottom <= geometry.scroll.top - 4), `${width}px hero pills must all fit above the visible scroll cue`)
      assert(geometry.scroll.top >= geometry.hero.top && geometry.scroll.bottom <= geometry.hero.bottom + 1, `${width}px scroll cue must remain inside the hero`)
      const expectedColumns = width >= 1024 ? 5 : width >= 520 ? 2 : 1
      const expectedRatio = width >= 1024 ? 4 / 5 : width >= 520 ? 4 / 3 : 16 / 10
      assert.equal(geometry.grid, expectedColumns, `${width}px city grid column count`)
      assert(Math.abs(geometry.cards[0].width / geometry.cards[0].height - expectedRatio) < 0.015, `${width}px city card aspect ratio`)
      assert.equal(geometry.imageAnimation, 'none', `${width}px reduced-motion image animation`)
      assert(['0s', '0.00001s', '1e-05s'].includes(geometry.imageTransition), `${width}px reduced-motion transition remained ${geometry.imageTransition}`)
      if (width === 320) process.stdout.write(`EVIDENCE #3176 tester 320px hero ${JSON.stringify({ hero: geometry.hero, scroll: geometry.scroll, textBoxes: geometry.textBoxes, pills: geometry.pills })}\n`)
      if (SCREENSHOT_DIR && [320, 1440].includes(width)) {
        fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
        const capture = await page.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
        fs.writeFileSync(path.join(SCREENSHOT_DIR, `cities-${width}.png`), Buffer.from(capture.data, 'base64'))
      }
    }

    const browserAgent = 'Mozilla/5.0 MinglaTester/1.0'
    const crawlers = [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
      'OAI-SearchBot/1.0; +https://openai.com/searchbot',
      'Claude-SearchBot/1.0; +https://anthropic.com/claude-search-bot',
      'PerplexityBot/1.0; +https://perplexity.ai/perplexitybot',
    ]
    for (const pathname of ['/about', '/explorer', '/cities', ...SLUGS.map((slug) => `/cities/${slug}`)]) {
      const baselineResponse = await request(appPort, pathname, browserAgent)
      assert.equal(baselineResponse.status, 200, `${pathname} direct request`)
      const baselineHtml = await baselineResponse.text()
      const baseline = visibleText(baselineHtml)
      assert.match(baselineHtml, /name="robots" content="index, follow"|content="index, follow" name="robots"/i, `${pathname} approved index gate`)
      assert.match(baselineHtml, new RegExp(`<link[^>]+rel="canonical"[^>]+href="https://usemingla\\.com${pathname}"|<link[^>]+href="https://usemingla\\.com${pathname}"[^>]+rel="canonical"`, 'i'), `${pathname} self-canonical`)
      assert.match(baselineHtml, /application\/ld\+json/i, `${pathname} structured data`)
      for (const phrase of REMOVED_COPY) assert(!baseline.includes(phrase), `${pathname} renders removed annotation: ${phrase}`)
      if (pathname.startsWith('/cities/')) {
        for (const phrase of HUB_ANNOTATIONS) assert(!baseline.includes(phrase), `${pathname} renders removed hub annotation: ${phrase}`)
      }
      for (const crawler of crawlers) {
        const crawlerResponse = await request(appPort, pathname, crawler)
        assert.equal(crawlerResponse.status, 200, `${pathname} crawler status`)
        assert.equal(visibleText(await crawlerResponse.text()), baseline, `${pathname} crawler/direct material-text parity`)
      }
      if (pathname.startsWith('/cities/')) assert.equal((baselineHtml.match(/class="ps-catalogue-card"/g) ?? []).length, 50, `${pathname} must retain 50 cards`)
    }
    const directoryHtml = await (await request(appPort, '/cities')).text()
    const links = [...directoryHtml.matchAll(/<a\b[^>]*href="(\/cities\/[^"]+)"[^>]*>/g)].map((match) => match[1])
    assert.equal(links.length, 20, '/cities must expose exactly ten pills plus ten cards')
    for (const slug of SLUGS) assert.equal(links.filter((href) => href === `/cities/${slug}`).length, 2, `/cities/${slug} must appear once in each directory control`)
  } finally {
    page?.close()
    await stopOwned(chrome)
    await stopOwned(server)
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

if (!BUILT_ONLY) sourceContract()
if (!SOURCE_ONLY) await runtimeContract()
if (SELF_TEST) {
  const relative = 'mingla-marketing/components/core-pages/core-pages.css'
  const reverted = `${read(relative)}\n@media (max-width:359px){.core-city-pills li,.core-city-pills a{width:100%}}\n`
  assert.throws(() => sourceContract({ [relative]: reverted }), /forced into a ten-row stack/, 'reintroducing the 320px stack must prove RED')
  process.stdout.write('RED proof: reintroducing the 320px ten-row pill stack was rejected\n')
}
process.stdout.write('PASS #3176 tester adversarial responsive, crawler and catalogue contract\n')
