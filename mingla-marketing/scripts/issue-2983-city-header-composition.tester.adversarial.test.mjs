#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Independent angle: native scrolling and physical input ownership, rather
// than accepting a sticky offset or CSS declaration as proof of a usable UI.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SELF = path.basename(fileURLToPath(import.meta.url))
const SOURCE_ONLY = process.argv.includes('--source-only')
const BUILT_ONLY = process.argv.includes('--built-only')
const FIXED_REVERT = process.argv.includes('--fixed-revert')
const SLUGS = ['lagos', 'durham-nc', 'cary-nc', 'raleigh-nc', 'new-york-city', 'brussels', 'paris', 'london', 'fort-lauderdale', 'washington-dc']
const ROUTES = ['/cities/lagos', '/internal/page-system/city-lagos']
const CHROME = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean).find(candidate => fs.existsSync(candidate))
const OLD_POSITIONING = ".city-hub-root{position:static!important}.city-hub-root>[data-cutout]>.cut-shell{position:relative!important}.page-system-root.city-hub-root[data-host-acquisition='true'] .ps-nav{position:fixed!important;inset:auto 0 auto!important;top:calc(var(--city-host-bar-height) + 12px)!important;z-index:80!important;padding:0 20px!important}"
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const counters = { initialStates: 0, scrolledCities: 0, hitPoints: 0, pointerInputs: 0, touchInputs: 0, journeys: 0, menus: 0, noJsCities: 0, zoomCities: 0 }

function sourceContract() {
  const scripts = JSON.parse(read('package.json')).scripts
  for (const mode of ['--source-only', '--built-only']) {
    assert(scripts.build.includes(`node --experimental-websocket scripts/${SELF} ${mode}`), `independent ${mode} guard must remain CI-enforced`)
  }
  assert(scripts.build.includes('node scripts/issue-2990-audience-navigation.implementor.happy.test.mjs && next build'), 'the original source/build adjacency must remain')
  assert(!scripts.build.includes('NODE_OPTIONS'), 'no global runtime flag')
  assert(scripts.build.includes('node --experimental-websocket scripts/issue-2983-host-trip-bento-overlap.tester.adversarial.test.mjs --built-only'), 'Host geometry must also execute on Node20')
  const css = read('components/cities/city-hubs.css')
  assert.match(css, /\.city-hub-root\s*\{[^}]*position:\s*relative;/)
  assert.match(css, /\.city-hub-root > \[data-cutout\] > \.cut-shell\s*\{\s*position:\s*static;/)
  const nav = css.match(/\.page-system-root\.city-hub-root\[data-host-acquisition='true'\] \.ps-nav\s*\{([^}]+)\}/)?.[1] ?? ''
  assert.match(nav, /position:\s*absolute;/)
  assert.doesNotMatch(nav, /opacity|visibility|pointer-events|transform|margin/)
  assert.match(read('components/page-system/page-system.css'), /\.page-system-root\[data-host-acquisition='true'\] \.ps-catalogue-controls \{ top: var\(--page-host-bar-height\); \}/)
  console.log('PASS #2983 independent header source: no hiding/layer workaround; exact CI runtime commands preserved')
}

function artifactContract() {
  assert(fs.existsSync(path.join(ROOT, '.next/BUILD_ID')), 'a real production build is required')
  for (const slug of SLUGS) {
    const html = read(`.next/server/app/cities/${slug}.html`)
    assert.match(html, /name="robots" content="noindex, follow"/)
    assert.doesNotMatch(html, /rel="canonical"|application\/ld\+json/)
    assert.equal((html.match(/<h1\b/g) ?? []).length, 1)
    assert.match(html, /class="ps-logo-link"|class="ps-menu-button"/)
    assert.equal((html.match(/class="ps-catalogue-card"/g) ?? []).length, slug === 'lagos' ? 50 : 0)
  }
  const css = fs.readdirSync(path.join(ROOT, '.next/static/css')).filter(name => name.endsWith('.css')).map(name => read(`.next/static/css/${name}`)).join('\n')
  assert.match(css, /\.page-system-root\.city-hub-root\[data-host-acquisition=(?:true|"true"|'true')\] \.ps-nav\{[^}]*position:absolute/)
  console.log('PASS #2983 independent header artifact: 10 noindex SSR routes, only real Lagos catalogue, compiled scrolling nav')
}

async function freePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}

async function waitFor(check, message, timeout = 20_000) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    try { if (await check()) return } catch (error) { last = error }
    await new Promise(resolve => setTimeout(resolve, 60))
  }
  throw new Error(`${message}${last ? `: ${last.message}` : ''}`)
}

class Page {
  constructor(url) {
    this.next = 0
    this.pending = new Map()
    this.socket = new WebSocket(url)
    this.ready = new Promise((resolve, reject) => { this.socket.addEventListener('open', resolve, { once: true }); this.socket.addEventListener('error', reject, { once: true }) })
    this.socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(String(data)), pending = this.pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(message.id)
      message.error ? pending.reject(Error(message.error.message)) : pending.resolve(message.result)
    })
  }
  async send(method, params = {}) {
    await this.ready
    const id = ++this.next
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error(`CDP timeout: ${method}`)) }, 25_000)
      this.pending.set(id, { resolve, reject, timer })
    })
    this.socket.send(JSON.stringify({ id, method, params }))
    return result
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    assert(!result.exceptionDetails, result.exceptionDetails?.exception?.description ?? result.exceptionDetails?.text)
    return result.result.value
  }
  close() { this.socket.close() }
}

const settle = `(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));})()`
async function settled(page) {
  if (page.scriptingDisabled) {
    // CDP can inspect no-JS documents, but page rAF/timers cannot execute.
    await new Promise(resolve => setTimeout(resolve, 120))
    return
  }
  await page.evaluate(settle)
}

const framing = `(()=>{const result={};for(const [key,selector] of Object.entries({root:'.city-hub-root',wrapper:'.city-hub-root>[data-cutout]',shell:'.city-hub-root>[data-cutout]>.cut-shell',nav:'.ps-nav',logo:'.ps-logo-link',menu:'.ps-menu-button',notice:'.city-lifecycle-notice',hero:'.city-hero',main:'main',catalogue:'.ps-catalogue',footer:'footer'})){const node=document.querySelector(selector);if(!node){result[key]=null;continue}const r=node.getBoundingClientRect();result[key]=[r.x,r.y,r.width,r.height]}return result})()`

function assertFraming(actual, baseline, label) {
  for (const key of Object.keys(baseline)) {
    if (baseline[key] === null) { assert.equal(actual[key], null, `${label}: ${key}`); continue }
    assert(actual[key], `${label}: ${key} missing`)
    baseline[key].forEach((value, index) => assert(Math.abs(value - actual[key][index]) <= 1, `${label}: ${key}[${index}] moved from ${value} to ${actual[key][index]}`))
  }
}

async function oldRules(page, enabled) {
  await page.evaluate(enabled
    ? `(()=>{const s=document.createElement('style');s.id='tester-original-positioning';s.textContent=${JSON.stringify(OLD_POSITIONING)};document.head.append(s)})()`
    : `document.querySelector('#tester-original-positioning')?.remove()`)
  await settled(page)
}

async function viewport(page, width = 390, height = 844) {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  await page.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 })
}

async function navigate(page, base, route) {
  await page.send('Page.navigate', { url: base + route })
  const pathname = new URL(base + route).pathname
  await waitFor(() => page.evaluate(`location.pathname===${JSON.stringify(pathname)}&&document.readyState==='complete'&&!!document.querySelector('header.ps-nav')`), `${route}: document did not load`)
  await page.send('Page.bringToFront')
  await settled(page)
}

async function wheel(page, deltaY, deltaX = 0, point = { x: 200, y: 450 }) {
  await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaY, deltaX })
  await new Promise(resolve => setTimeout(resolve, 160))
  await settled(page)
}

async function sticky(page) {
  const target = await page.evaluate(`(()=>{const r=document.querySelector('.ps-catalogue-controls').getBoundingClientRect();return scrollY+r.top+40})()`)
  await wheel(page, target - await page.evaluate('scrollY'))
  await waitFor(() => page.evaluate(`(()=>{const b=document.querySelector('.ps-host-acquisition').getBoundingClientRect(),c=document.querySelector('.ps-catalogue-controls').getBoundingClientRect();return Math.abs(b.bottom-c.top)<=1})()`), 'filters did not meet the real Host-bar bottom')
}

async function controlProof(page, selector, edge = 'center') {
  const result = await page.evaluate(`(()=>{
    const e=document.querySelector(${JSON.stringify(selector)});if(!e)return {missing:true};const r=e.getBoundingClientRect();
    const x=${edge === 'left' ? 'r.left+8' : edge === 'right' ? 'r.right-8' : 'r.left+r.width/2'},y=r.top+r.height/2;
    const hit=document.elementFromPoint(x,y),nav=document.querySelector('.ps-nav').getBoundingClientRect();
    return {x,y,label:e.getAttribute('aria-label')||e.textContent.trim(),owned:!!hit&&(hit===e||e.contains(hit)),hit:hit?.outerHTML.slice(0,180),width:r.width,height:r.height,within:x>=0&&x<=innerWidth&&y>=0&&y<=innerHeight,navBottom:nav.bottom,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth};
  })()`)
  assert(!result.missing, `${selector}: control missing`)
  assert(result.within, `${selector}/${edge}: input point offscreen ${JSON.stringify(result)}`)
  assert(result.owned, `${selector}/${edge}: control does not own physical hit ${JSON.stringify(result)}`)
  assert.equal(result.overflow, 0, `${selector}: horizontal overflow`)
  counters.hitPoints++
  return result
}

async function nativeInput(page, point, kind) {
  if (kind === 'touch') {
    await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y, radiusX: 1, radiusY: 1, force: 1, id: 0 }] })
    await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    counters.touchInputs++
  } else {
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 })
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 })
    counters.pointerInputs++
  }
  await settled(page)
}

async function click(page, selector, kind = 'pointer', edge = 'center') {
  await nativeInput(page, await controlProof(page, selector, edge), kind)
}

async function key(page, keyValue, code, modifiers = 0) {
  await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: keyValue, code: keyValue, windowsVirtualKeyCode: code, modifiers })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyValue, code: keyValue, windowsVirtualKeyCode: code, modifiers })
  await settled(page)
}

async function expectCards(page, count, queryKey, expected) {
  await waitFor(() => page.evaluate(`document.querySelectorAll('.ps-catalogue-card').length===${count}&&new URLSearchParams(location.search).get(${JSON.stringify(queryKey)})===${JSON.stringify(expected)}`), `expected ${count} cards with ${queryKey}=${expected}`)
}

async function historyStep(page, offset) {
  const history = await page.send('Page.getNavigationHistory')
  await page.send('Page.navigateToHistoryEntry', { entryId: history.entries[history.currentIndex + offset].id })
  await settled(page)
}

async function journey(page, base, route, kind) {
  await viewport(page)
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: kind === 'touch', maxTouchPoints: 1 })
  await navigate(page, base, `${route}?type=places`)
  await sticky(page)
  for (const selector of ['.ps-type-toggle a:first-child', '.ps-type-toggle a:last-child']) {
    for (const edge of ['center', 'left', 'right']) await controlProof(page, selector, edge)
  }
  assert(await page.evaluate(`document.querySelector('.ps-nav').getBoundingClientRect().bottom<0`), `${route}: navigation still covers sticky range`)
  await click(page, '.ps-type-toggle a:last-child', kind, 'right')
  await expectCards(page, 6, 'type', 'plans')
  const intent = await page.evaluate(`new URL(document.querySelector('.ps-filter-rail a:nth-child(2)').href).searchParams.get('intents')`)
  await click(page, '.ps-filter-rail a:nth-child(2)', kind)
  await expectCards(page, 1, 'intents', intent)
  await click(page, '.ps-type-toggle a:first-child', kind, 'left')
  await expectCards(page, 50, 'type', 'places')
  const category = await page.evaluate(`new URL(document.querySelector('.ps-filter-rail a:nth-child(2)').href).searchParams.get('categories')`)
  await click(page, '.ps-filter-rail a:nth-child(2)', kind)
  await expectCards(page, 5, 'categories', category)
  await click(page, '.ps-filter-rail a:first-child', kind)
  await expectCards(page, 50, 'categories', null)
  const rail = await page.evaluate(`(()=>{const r=document.querySelector('.ps-filter-rail').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
  await wheel(page, 0, 2500, rail)
  await waitFor(() => page.evaluate(`document.querySelector('.ps-filter-rail').scrollLeft>0`), 'horizontal filter rail did not scroll')
  const lastCategory = await page.evaluate(`new URL(document.querySelector('.ps-filter-rail a:last-child').href).searchParams.get('categories')`)
  for (const edge of ['center', 'left', 'right']) await controlProof(page, '.ps-filter-rail a:last-child', edge)
  await click(page, '.ps-filter-rail a:last-child', kind, 'right')
  await expectCards(page, 5, 'categories', lastCategory)
  const beforeDetail = await page.evaluate('location.search')
  await page.evaluate(`document.querySelector('.ps-catalogue-action').scrollIntoView({block:'center'})`)
  await settled(page)
  await click(page, '.ps-catalogue-action', kind)
  await waitFor(() => page.evaluate(`!!document.querySelector('.ps-detail-panel')&&new URLSearchParams(location.search).has('detail')`), 'physical card action did not open its detail')
  assert(await page.evaluate(`document.querySelector('.ps-detail-panel').contains(document.activeElement)`), 'details did not take focus')
  await click(page, '[aria-label="Close details"]', kind)
  await waitFor(() => page.evaluate(`!document.querySelector('.ps-detail-panel')&&location.search===${JSON.stringify(beforeDetail)}`), 'detail close failed to restore filter URL')
  await historyStep(page, 1)
  await waitFor(() => page.evaluate(`!!document.querySelector('.ps-detail-panel')`), 'browser Forward did not reopen details')
  await historyStep(page, -1)
  await waitFor(() => page.evaluate(`!document.querySelector('.ps-detail-panel')`), 'browser Back did not close details')
  await sticky(page)
  for (const width of [320, 640, 768, 1440, 390]) {
    await viewport(page, width)
    await sticky(page)
    await controlProof(page, '.ps-type-toggle a:first-child')
    await controlProof(page, '.ps-type-toggle a:last-child')
    assert(await page.evaluate(`document.querySelector('.ps-nav').getBoundingClientRect().bottom<0`), `${width}px resize returned nav into filters`)
  }
  await click(page, '.ps-host-acquisition-trigger', kind)
  await waitFor(() => page.evaluate(`!!document.querySelector('#host-acquisition-sheet')`), 'scrolled Start hosting did not open choices')
  assert(await page.evaluate(`document.querySelector('#host-acquisition-sheet').contains(document.activeElement)`), 'Host sheet did not own focus')
  await key(page, 'Escape', 27)
  await waitFor(() => page.evaluate(`!document.querySelector('#host-acquisition-sheet')&&document.activeElement.matches('.ps-host-acquisition-trigger')`), 'Host sheet Escape/focus return failed')
  await wheel(page, -20000)
  await waitFor(() => page.evaluate('scrollY===0'), 'native upward scroll did not return to top')
  await controlProof(page, '.ps-menu-button')
  counters.journeys++
  console.log(`PASS #2983 physical ${kind} ${route}: types/categories/intent/rail/detail/history/resize/Host sheet`)
}

async function menuJourney(page, base, route) {
  await viewport(page)
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: false })
  await navigate(page, base, route)
  await click(page, '.ps-menu-button')
  await waitFor(() => page.evaluate(`!!document.querySelector('#page-system-audience-menu')&&document.querySelector('#page-system-audience-menu').contains(document.activeElement)`), 'side menu did not own focus')
  const exploreSelector = '#page-system-audience-menu button[aria-haspopup="dialog"]'
  await click(page, exploreSelector)
  await waitFor(() => page.evaluate(`!![...document.querySelectorAll('[role="dialog"]')].find(n=>n.textContent.includes('Scan to get Mingla'))`), 'nested QR did not open')
  await waitFor(() => page.evaluate(`document.activeElement?.getAttribute('aria-label')==='Close'`), 'nested QR did not take focus')
  await key(page, 'Tab', 9, 8)
  assert(await page.evaluate(`document.activeElement.closest('[role="dialog"]')?.textContent.includes('Scan to get Mingla')`), 'Shift+Tab escaped nested QR')
  await key(page, 'Tab', 9)
  assert.equal(await page.evaluate(`document.activeElement?.getAttribute('aria-label')`), 'Close', 'Tab did not wrap back to QR close control')
  await key(page, 'Escape', 27)
  await waitFor(() => page.evaluate(`![...document.querySelectorAll('[role="dialog"]')].some(n=>n.textContent.includes('Scan to get Mingla'))&&document.activeElement===document.querySelector(${JSON.stringify(exploreSelector)})`), 'QR Escape must close only QR and restore its exact menu trigger')
  assert(await page.evaluate(`!!document.querySelector('#page-system-audience-menu')&&document.body.style.overflow==='hidden'`), 'QR close lost menu/body-lock ownership')
  await key(page, 'Escape', 27)
  await waitFor(() => page.evaluate(`!document.querySelector('#page-system-audience-menu')&&document.activeElement.matches('.ps-menu-button')&&document.body.style.overflow!=='hidden'`), 'second Escape must close menu, restore trigger and release body lock')
  counters.menus++
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  await new Promise(resolve => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve() }, 2000)
    child.once('exit', () => { clearTimeout(timer); resolve() })
    child.kill('SIGTERM')
  })
}

async function browserContract() {
  if (process.env.VERCEL === '1') {
    assert(!FIXED_REVERT, 'regression proof cannot skip its browser')
    console.log('SKIP #2983 independent header browser on Vercel only; source/artifact gates executed, local/GitHub require browser')
    return
  }
  assert(CHROME, 'Chrome executable required for independent city-header browser proof')
  assert.equal(typeof WebSocket, 'function', 'Node20 browser guard requires command-scoped --experimental-websocket')
  const serverPort = await freePort(), chromePort = await freePort(), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mingla-2983-header-adversarial-'))
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(serverPort)], { cwd: ROOT, env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' }, stdio: 'ignore' })
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${chromePort}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', 'about:blank'], { stdio: 'ignore' })
  let page
  try {
    const base = `http://127.0.0.1:${serverPort}`
    await waitFor(async () => (await fetch(base + '/robots.txt')).ok, 'local Next server did not start')
    await waitFor(async () => (await fetch(`http://127.0.0.1:${chromePort}/json/version`)).ok, 'owned Chrome did not start')
    const target = await fetch(`http://127.0.0.1:${chromePort}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json())
    page = new Page(target.webSocketDebuggerUrl)
    await page.send('Page.enable')
    await page.send('Runtime.enable')
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('mingla_consent_v1',JSON.stringify({value:'denied',ts:Date.now()}))` })
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })

    if (FIXED_REVERT) {
      await viewport(page)
      await navigate(page, base, '/cities/lagos?type=plans')
      await sticky(page)
      await oldRules(page, true)
      assert.deepEqual(await page.evaluate(`({root:getComputedStyle(document.querySelector('.city-hub-root')).position,shell:getComputedStyle(document.querySelector('.city-hub-root>[data-cutout]>.cut-shell')).position,nav:getComputedStyle(document.querySelector('.ps-nav')).position})`), { root: 'static', shell: 'relative', nav: 'fixed' }, 'runtime revert must activate all three actual historical positioning rules')
      const point = await page.evaluate(`(()=>{const e=document.querySelector('.ps-type-toggle a:first-child'),r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);return {x,y,owned:!!hit&&(hit===e||e.contains(hit)),hit:hit?.outerHTML.slice(0,200)}})()`)
      assert.equal(point.owned, false, 'historical CSS must actually intercept Places; otherwise the reversion fixture is invalid')
      await nativeInput(page, point, 'pointer')
      await waitFor(() => page.evaluate("location.pathname==='/'"), 'historical physical hit must reproduce home navigation, not merely produce a test error')
      const pathname = await page.evaluate('location.pathname')
      console.log(`RED EVIDENCE #2983 active historical fixed-nav hit ${JSON.stringify(point)}; physical Places input navigated to ${pathname}`)
      assert.equal(pathname, '/cities/lagos', 'REGRESSION: fixed-nav revert steals physical Places input into Mingla home')
    }

    for (const slug of SLUGS) {
      await viewport(page)
      for (const state of ['review', 'stale-layout', 'notice-absent-layout']) {
        await navigate(page, base, `/cities/${slug}`)
        if (state === 'stale-layout') await page.evaluate(`(()=>{const e=document.querySelector('.city-lifecycle-notice');e.querySelector('strong').textContent='This city guide is being refreshed.';e.querySelector('span').textContent='Current details are being checked before this guide returns to search.'})()`)
        if (state === 'notice-absent-layout') await page.evaluate(`document.querySelector('.city-lifecycle-notice').remove()`)
        await settled(page)
        const current = await page.evaluate(framing)
        await oldRules(page, true)
        assertFraming(current, await page.evaluate(framing), `${slug}/${state}`)
        await oldRules(page, false)
        assertFraming(await page.evaluate(framing), current, `${slug}/${state}/restore`)
        counters.initialStates++
      }
      await navigate(page, base, `/cities/${slug}`)
      await wheel(page, 1400)
      assert(await page.evaluate(`scrollY>500&&document.querySelector('.ps-nav').getBoundingClientRect().bottom<0`), `${slug}: native scroll did not clear navigation`)
      await controlProof(page, '.ps-host-acquisition-trigger')
      counters.scrolledCities++
    }
    for (const route of ROUTES) {
      for (const kind of ['pointer', 'touch']) await journey(page, base, route, kind)
      await menuJourney(page, base, route)
    }

    await page.send('Emulation.setTouchEmulationEnabled', { enabled: false })
    await page.send('Emulation.setScriptExecutionDisabled', { value: true })
    page.scriptingDisabled = true
    for (const slug of SLUGS) {
      await viewport(page)
      await navigate(page, base, `/cities/${slug}`)
      assert.equal(await page.evaluate(`document.querySelectorAll('.ps-catalogue-card').length`), slug === 'lagos' ? 50 : 0)
      await wheel(page, 1400)
      assert(await page.evaluate(`scrollY>500&&document.querySelector('.ps-nav').getBoundingClientRect().bottom<0`), `${slug}: no-JS native scrolling must clear navigation`)
      counters.noJsCities++
    }
    await page.send('Emulation.setScriptExecutionDisabled', { value: false })
    page.scriptingDisabled = false
    for (const slug of SLUGS) {
      await viewport(page, 640)
      await navigate(page, base, `/cities/${slug}`)
      await page.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 })
      await wheel(page, 1600, 0, { x: 150, y: 300 })
      const zoom = await page.evaluate(`({scale:visualViewport.scale,width:visualViewport.width,viewportWidth:innerWidth,layoutWidth:document.documentElement.clientWidth,navBottom:document.querySelector('.ps-nav').getBoundingClientRect().bottom,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,h1:document.querySelectorAll('h1').length})`)
      assert.equal(zoom.scale, 2)
      assert.equal(zoom.viewportWidth, 640)
      assert(Math.abs(zoom.width - zoom.layoutWidth / 2) <= 1)
      assert(zoom.navBottom < 0, `${slug}: zoomed scrolled navigation remained onscreen`)
      assert.equal(zoom.overflow, 0)
      assert.equal(zoom.h1, 1)
      counters.zoomCities++
    }
    console.log(`PASS #2983 independent header browser ${JSON.stringify(counters)}; native inputs, old/new framing, reduced motion, no-JS, 200% page/pinch zoom; separate 320px reflow`)
  } finally {
    page?.close()
    await Promise.all([stop(chrome), stop(server)])
    fs.rmSync(profile, { recursive: true, force: true })
  }
}

assert(!(SOURCE_ONLY && BUILT_ONLY), 'choose one guard mode')
if (!BUILT_ONLY) sourceContract()
if (!SOURCE_ONLY) { artifactContract(); await browserContract() }
