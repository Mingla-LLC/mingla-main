#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Independent angle: verify the rendered relationship between the Cutout shell,
// navigation and lifecycle notice instead of accepting the product declaration.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SELF = path.basename(fileURLToPath(import.meta.url))
const SOURCE_ONLY = process.argv.includes('--source-only')
const BUILT_ONLY = process.argv.includes('--built-only')
const SLUGS = ['lagos', 'durham-nc', 'cary-nc', 'raleigh-nc', 'new-york-city', 'brussels', 'paris', 'london', 'fort-lauderdale', 'washington-dc']
const SPEC_WIDTHS = [320, 390, 639, 640, 760, 767, 768, 1024, 1117, 1280, 1440]
const REPRESENTATIVE_WIDTHS = [390, 1440]
const CDP_REQUEST_TIMEOUT_MS = 25_000
const BROWSER_CLOSE_TIMEOUT_MS = 2_000
const CHILD_STOP_TIMEOUT_MS = 2_000
const CHROME = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean).find(candidate => fs.existsSync(candidate))
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8')

function sourceContract() {
  const scripts = JSON.parse(read('package.json')).scripts
  for (const mode of ['--source-only', '--built-only']) {
    assert(scripts.build.includes(`node --experimental-websocket scripts/${SELF} ${mode}`), `tester ${mode} guard must remain build-enforced`)
  }
  assert.equal(scripts['test:city-review-spacing'], `node --experimental-websocket scripts/${SELF}`, 'focused tester command must remain available')

  const css = read('components/cities/city-hubs.css').replace(/\/\*[\s\S]*?\*\//g, '')
  const shellBlocks = [...css.matchAll(/\.city-hub-root\s*>\s*\[data-cutout\]\s*>\s*\.cut-shell\s*\{([^}]*)\}/g)].map(match => match[1])
  assert(shellBlocks.some(block => /(?:^|;)\s*display\s*:\s*flow-root\s*(?:;|$)/.test(block)), 'REGRESSION: city shell lost the flow-root that contains the notice margin')
  assert.doesNotMatch(read('components/cutout/cutout.css'), /\.cut-shell\s*\{[^}]*display\s*:\s*flow-root/, 'containment must stay city-scoped')

  const component = read('components/cities/city-hub.tsx')
  for (const copy of ['City guide in review', 'This city guide is being refreshed.', 'This city guide is no longer actively updated.']) {
    assert(component.includes(copy), `missing lifecycle state: ${copy}`)
  }
  assert.match(component, /if \(lifecycle === 'search_ready'\) return null/, 'search-ready cities must keep the no-notice state')
  assert.match(component, /className="city-lifecycle-notice" role="status"/, 'notice must remain an announced status')
  assert.deepEqual(SPEC_WIDTHS, [320, 390, 639, 640, 760, 767, 768, 1024, 1117, 1280, 1440], 'the binding responsive-width matrix must remain exact')
  console.log('PASS #3135 tester source: city-scoped containment, three notice states and no-notice state are build-enforced')
}

function artifactContract() {
  assert(fs.existsSync(path.join(ROOT, '.next/BUILD_ID')), 'run a production build before the #3135 artifact/runtime guard')
  const compiledCss = fs.readdirSync(path.join(ROOT, '.next/static/css')).filter(name => name.endsWith('.css')).map(name => read(`.next/static/css/${name}`)).join('\n')
  assert.match(compiledCss, /\.city-hub-root>\[data-cutout\]>.cut-shell\{[^}]*display:flow-root[^}]*\}/, 'compiled CSS lost city-shell containment')
  for (const slug of SLUGS) {
    const html = read(`.next/server/app/cities/${slug}.html`)
    assert.match(html, /class="city-lifecycle-notice" role="status"/, `${slug}: SSR lifecycle notice missing`)
    assert.match(html, /City guide in review/, `${slug}: SSR review state missing`)
    assert.equal((html.match(/class="city-lifecycle-notice"/g) ?? []).length, 1, `${slug}: notice must render once`)
  }
  console.log('PASS #3135 tester artifact: compiled containment and 10/10 SSR review notices')
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
      const message = JSON.parse(String(data))
      const pending = this.pending.get(message.id)
      if (!pending) return
      message.error ? pending.reject(Error(message.error.message)) : pending.resolve(message.result)
    })
  }
  async send(method, params = {}, timeoutMs = CDP_REQUEST_TIMEOUT_MS) {
    await this.ready
    const id = ++this.next
    return new Promise((resolve, reject) => {
      const finish = (callback, value) => {
        const pending = this.pending.get(id)
        if (!pending) return
        clearTimeout(pending.timer)
        this.pending.delete(id)
        callback(value)
      }
      const timer = setTimeout(() => finish(reject, Error(`CDP timeout: ${method}`)), timeoutMs)
      this.pending.set(id, {
        resolve: result => finish(resolve, result),
        reject: error => finish(reject, error),
        timer,
      })
      try {
        this.socket.send(JSON.stringify({ id, method, params }))
      } catch (error) {
        finish(reject, error)
      }
    })
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    assert(!result.exceptionDetails, result.exceptionDetails?.exception?.description ?? result.exceptionDetails?.text)
    return result.result.value
  }
  async closeBrowserGracefully() { return this.send('Browser.close', {}, BROWSER_CLOSE_TIMEOUT_MS) }
  close() { this.socket.close() }
}

function waitForChildExit(child, timeoutMs, message) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const onExit = () => { clearTimeout(timer); resolve() }
    const timer = setTimeout(() => { child.removeListener('exit', onExit); reject(Error(message)) }, timeoutMs)
    child.once('exit', onExit)
    if (child.exitCode !== null || child.signalCode !== null) onExit()
  })
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const afterTerm = waitForChildExit(child, CHILD_STOP_TIMEOUT_MS, 'owned child did not exit after SIGTERM')
  child.kill('SIGTERM')
  try {
    await afterTerm
    return
  } catch {
    if (child.exitCode !== null || child.signalCode !== null) return
  }
  const afterKill = waitForChildExit(child, CHILD_STOP_TIMEOUT_MS, 'owned child did not exit after SIGKILL')
  child.kill('SIGKILL')
  await afterKill
}

async function teardownBrowser({ page, chrome, server, profile }) {
  let teardownError
  try {
    if (page) await page.closeBrowserGracefully()
  } catch (error) {
    teardownError = error
  } finally {
    page?.close()
  }
  let chromeTerminal = false
  try {
    await stopChild(chrome)
    chromeTerminal = true
  } catch (error) {
    teardownError ??= error
  }
  try {
    await stopChild(server)
  } catch (error) {
    teardownError ??= error
  }
  if (chromeTerminal) {
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
    } catch (error) {
      teardownError ??= error
    }
  }
  if (teardownError) throw teardownError
}

async function viewport(page, width, height) {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  await page.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 })
}

async function settled(page) {
  await page.evaluate(`(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));})()`)
}

async function navigate(page, base, route) {
  await page.send('Page.navigate', { url: base + route })
  const pathname = new URL(base + route).pathname
  await waitFor(() => page.evaluate(`location.pathname===${JSON.stringify(pathname)}&&document.readyState==='complete'&&!!document.querySelector('.city-hub-root')`), `${route}: city page did not load`)
  await settled(page)
}

const geometryExpression = `(()=>{
  const rect=s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height}}
  const shell=rect('.city-hub-root>[data-cutout]>.cut-shell'),nav=rect('.ps-nav'),notice=rect('.city-lifecycle-notice'),crumb=rect('.city-breadcrumbs')
  return {shell,nav,notice,crumb,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,position:getComputedStyle(document.querySelector('.city-hub-root>[data-cutout]>.cut-shell')).display}
})()`

function near(actual, expected, label) {
  assert(Math.abs(actual - expected) <= 1, `${label}: expected ${expected}px, got ${actual}px`)
}

function assertNoticeGeometry(g, width, slug, state) {
  const label = `${slug}/${width}px/${state}`
  assert(g.shell && g.nav && g.notice, `${label}: framing node missing`)
  const expectedShell = width < 640 ? 8 : 12
  const expectedInternalGap = width < 768 ? 140 : 136
  const expectedNotice = expectedShell + expectedInternalGap
  near(g.shell.top, expectedShell, `${label}: shell top`)
  near(g.notice.top, expectedNotice, `${label}: notice top`)
  near(g.notice.top - g.shell.top, expectedInternalGap, `${label}: shell-to-notice gap`)
  assert(g.notice.top - g.nav.bottom >= 24, `${label}: notice is less than 24px below navigation (${g.notice.top - g.nav.bottom}px)`)
  assert.equal(g.overflow, 0, `${label}: horizontal overflow`)
}

async function assertNoticeStates(page, width, slug) {
  const baseline = await page.evaluate(geometryExpression)
  assertNoticeGeometry(baseline, width, slug, 'review')
  for (const [state, strong, span] of [
    ['stale', 'This city guide is being refreshed.', 'Current details are being checked before this guide returns to search.'],
    ['retired', 'This city guide is no longer actively updated.', 'Current events and availability are not shown.'],
  ]) {
    await page.evaluate(`(()=>{const n=document.querySelector('.city-lifecycle-notice');n.querySelector('strong').textContent=${JSON.stringify(strong)};n.querySelector('span').textContent=${JSON.stringify(span)}})()`)
    await settled(page)
    assertNoticeGeometry(await page.evaluate(geometryExpression), width, slug, state)
  }
  await page.evaluate(`document.querySelector('.city-lifecycle-notice').remove()`)
  await settled(page)
  const absent = await page.evaluate(geometryExpression)
  assert.equal(absent.notice, null, `${slug}/${width}px/no-notice: notice still present`)
  assert(absent.crumb.top - absent.nav.bottom >= 24, `${slug}/${width}px/no-notice: content is less than 24px below navigation`)
  assert.equal(absent.overflow, 0, `${slug}/${width}px/no-notice: horizontal overflow`)
}

async function assertPrint(page, slug) {
  await page.send('Emulation.setEmulatedMedia', { media: 'print' })
  await settled(page)
  const print = await page.evaluate(geometryExpression)
  near(print.notice.top, 0, `${slug}/print: notice top`)
  assert.equal(print.nav.height, 0, `${slug}/print: navigation must be hidden`)
  assert.equal(print.overflow, 0, `${slug}/print: horizontal overflow`)
  await page.send('Emulation.setEmulatedMedia', { media: 'screen' })
}

async function assertZoom(page, width, slug) {
  await page.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 })
  await settled(page)
  const zoom = await page.evaluate(`({geometry:${geometryExpression},scale:visualViewport.scale,visualWidth:visualViewport.width,layoutWidth:document.documentElement.clientWidth})`)
  assert.equal(zoom.scale, 2, `${slug}/${width}px: 200% zoom did not apply`)
  assert(Math.abs(zoom.visualWidth - zoom.layoutWidth / 2) <= 1, `${slug}/${width}px: visual viewport did not halve at 200% zoom`)
  assertNoticeGeometry(zoom.geometry, width, slug, 'zoom-200')
  await page.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 })
}

async function assertLagosSticky(page) {
  await viewport(page, 390, 844)
  await navigate(page, page.base, '/cities/lagos?type=places')
  const target = await page.evaluate(`(()=>{const r=document.querySelector('.ps-catalogue-controls').getBoundingClientRect();return scrollY+r.top+40})()`)
  await page.evaluate(`scrollTo(0,${target})`)
  await settled(page)
  const result = await page.evaluate(`(()=>{const b=document.querySelector('.ps-host-acquisition').getBoundingClientRect(),c=document.querySelector('.ps-catalogue-controls').getBoundingClientRect();return {gap:c.top-b.bottom,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,visible:c.bottom>0&&c.top<innerHeight}})()`)
  assert(Math.abs(result.gap) <= 1, `Lagos sticky controls missed Host bar by ${result.gap}px`)
  assert.equal(result.overflow, 0, 'Lagos sticky catalogue created horizontal overflow')
  assert(result.visible, 'Lagos sticky catalogue controls are not visible')
}

async function browserContract() {
  if (process.env.VERCEL === '1') {
    console.log('SKIP #3135 tester browser on Vercel only; source/artifact gates executed')
    return
  }
  assert(CHROME, 'Chrome executable required for #3135 independent geometry proof')
  assert.equal(typeof WebSocket, 'function', 'run this guard with Node command-scoped --experimental-websocket')
  const serverPort = await freePort()
  const chromePort = await freePort()
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mingla-3135-spacing-'))
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(serverPort)], { cwd: ROOT, env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' }, stdio: 'ignore' })
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${chromePort}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions', 'about:blank'], { stdio: 'ignore' })
  let page
  try {
    const base = `http://127.0.0.1:${serverPort}`
    await waitFor(async () => (await fetch(base + '/robots.txt')).ok, 'local Next server did not start')
    await waitFor(async () => (await fetch(`http://127.0.0.1:${chromePort}/json/version`)).ok, 'owned Chrome did not start')
    const target = await fetch(`http://127.0.0.1:${chromePort}/json/new?about:blank`, { method: 'PUT' }).then(response => response.json())
    page = new Page(target.webSocketDebuggerUrl)
    page.base = base
    await page.send('Page.enable')
    await page.send('Runtime.enable')
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('mingla_consent_v1',JSON.stringify({value:'denied',ts:Date.now()}))` })

    for (const width of REPRESENTATIVE_WIDTHS) {
      const height = width < 768 ? 844 : 1000
      for (const slug of SLUGS) {
        await viewport(page, width, height)
        await navigate(page, base, `/cities/${slug}`)
        await assertNoticeStates(page, width, slug)
        await navigate(page, base, `/cities/${slug}`)
        await assertZoom(page, width, slug)
      }
    }
    for (const width of SPEC_WIDTHS) {
      await viewport(page, width, width < 768 ? 844 : 1000)
      await navigate(page, base, '/cities/lagos')
      await assertNoticeStates(page, width, 'lagos')
    }
    await viewport(page, 1440, 1000)
    for (const slug of SLUGS) {
      await navigate(page, base, `/cities/${slug}`)
      await assertPrint(page, slug)
    }
    await assertLagosSticky(page)
    console.log(`PASS #3135 tester browser: exact widths ${SPEC_WIDTHS.join(',')}; 10 routes × 390/1440 × review/stale/retired/none/200% zoom; print and Lagos sticky geometry`)
  } finally {
    await teardownBrowser({ page, chrome, server, profile })
  }
}

assert(!(SOURCE_ONLY && BUILT_ONLY), 'choose only one #3135 guard mode')
if (!BUILT_ONLY) sourceContract()
if (!SOURCE_ONLY) { artifactContract(); await browserContract() }
