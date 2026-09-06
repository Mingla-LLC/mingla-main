#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_ONLY = process.argv.includes('--source-only')
const BUILT_ONLY = process.argv.includes('--built-only')
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')

function sourceContract() {
  const page = read('app/cities/[city]/page.tsx')
  const hub = read('components/cities/city-hub.tsx')
  const catalogue = read('components/page-system/city-catalogue.tsx')
  const css = read('components/page-system/page-system.css')
  const packageJson = JSON.parse(read('package.json'))

  assert.doesNotMatch(page, /searchParams/, 'query support must not make all ten city hubs dynamic')
  assert.match(catalogue, /syncFromLocation\(\)\s*\n\s*window\.addEventListener\('popstate', syncFromLocation\)/)
  assert.match(catalogue, /window\.history\.pushState/)
  assert.match(catalogue, /new URL\(href, window\.location\.href\)\.searchParams\.get\('detail'\)/)
  assert.match(css, /\.page-system-root\[data-host-acquisition='true'\] \.ps-catalogue-controls \{ top: var\(--page-host-bar-height\); \}/)
  assert.match(hub, /catalogue \? null : <CityNavigator/)
  assert.match(hub, /catalogue \? null : <CityFinalActions/)
  assert.match(packageJson.scripts.build, /issue-2983-lagos-catalogue-transfer\.tester\.adversarial\.test\.mjs --source-only/)
  assert.doesNotMatch(packageJson.scripts.build, /issue-2983-lagos-catalogue-transfer\.tester\.adversarial\.test\.mjs --built-only/, 'browser runtime must not be required inside Chrome-less deployment builds')
  process.stdout.write('PASS #2983 tester source guard: static city family and URL-owned public catalogue\n')
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

function request(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: pathname }, (response) => {
      response.resume()
      response.once('end', () => resolve(response.statusCode ?? 0))
    })
    req.once('error', reject)
  })
}

async function waitFor(check, message, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const value = await check()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 60))
  }
  throw new Error(`${message}${lastError ? `: ${lastError.message}` : ''}`)
}

class CdpPage {
  constructor(webSocketUrl) {
    this.nextId = 1
    this.pending = new Map()
    this.socket = new WebSocket(webSocketUrl)
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true })
      this.socket.addEventListener('error', reject, { once: true })
    })
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      if (!message.id) return
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message))
      else pending.resolve(message.result)
    })
  }

  async send(method, params = {}) {
    await this.ready
    const id = this.nextId++
    const result = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
    this.socket.send(JSON.stringify({ id, method, params }))
    return result
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'browser evaluation failed')
    return result.result.value
  }

  close() { this.socket.close() }
}

async function createPage(debugPort) {
  const target = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' }).then((response) => response.json())
  const page = new CdpPage(target.webSocketDebuggerUrl)
  await page.send('Page.enable')
  await page.send('Runtime.enable')
  return page
}

async function runtimeContract() {
  assert(fs.existsSync(CHROME), `Chrome executable not found at ${CHROME}`)
  assert(fs.existsSync(path.join(ROOT, '.next', 'BUILD_ID')), 'run next build before #2983 catalogue tester')
  const serverPort = await availablePort()
  const debugPort = await availablePort()
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mingla-2983-catalogue-tester-'))
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(serverPort)], {
    cwd: ROOT,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-extensions',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  let page
  try {
    await waitFor(async () => (await request(serverPort, '/robots.txt')) === 200, 'Next server did not start')
    await waitFor(async () => (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok, 'Chrome did not start')
    page = await createPage(debugPort)
    await page.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 844, deviceScaleFactor: 1, mobile: false })
    await page.send('Page.navigate', { url: `http://127.0.0.1:${serverPort}/cities/lagos?type=plans&intents=romantic` })
    await waitFor(() => page.evaluate("document.querySelector('.ps-catalogue-result-heading h2')?.textContent.trim() === '1 Lagos plans'"), 'direct plan query did not hydrate')

    const directPlan = await page.evaluate(`({
      cards: document.querySelectorAll('.ps-catalogue-card').length,
      kind: document.querySelector('.ps-catalogue-card')?.dataset.kind,
      internalLeak: [...document.querySelectorAll('a[href]')].some((link) => link.href.includes('/internal/page-system/city-lagos')),
      sticky: getComputedStyle(document.querySelector('.ps-catalogue-controls')).position,
      stickyTop: parseFloat(getComputedStyle(document.querySelector('.ps-catalogue-controls')).top),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    })`)
    assert.deepEqual(directPlan, { cards: 1, kind: 'plan', internalLeak: false, sticky: 'sticky', stickyTop: 56, overflow: false })

    await page.evaluate("document.querySelector('.ps-type-toggle a[href*=\"type%3Dplaces\"], .ps-type-toggle a[href*=\"type=places\"]')?.click()")
    await waitFor(() => page.evaluate("document.querySelector('.ps-catalogue-result-heading h2')?.textContent.trim() === '50 Lagos places'"), 'Places toggle did not restore all 50')
    await page.evaluate("[...document.querySelectorAll('.ps-filter-rail a')].find((link) => link.textContent.trim() === 'Nature & Views')?.click()")
    await waitFor(() => page.evaluate("document.querySelector('.ps-catalogue-result-heading h2')?.textContent.trim() === '5 Lagos places'"), 'category filter did not narrow to five')
    const categoryState = await page.evaluate(`({
      cards: document.querySelectorAll('.ps-catalogue-card').length,
      url: location.pathname + location.search,
      pressed: [...document.querySelectorAll('.ps-filter-rail a')].find((link) => link.textContent.trim() === 'Nature & Views')?.getAttribute('aria-pressed'),
    })`)
    assert.equal(categoryState.cards, 5)
    assert.match(categoryState.url, /^\/cities\/lagos\?type=places&categories=nature$/)
    assert.equal(categoryState.pressed, 'true')

    await page.evaluate("document.querySelector('.ps-catalogue-detail-link')?.click()")
    await waitFor(() => page.evaluate("Boolean(document.querySelector('[data-catalogue-detail][role]') || document.querySelector('[data-catalogue-detail] .ps-detail-panel[role=dialog]'))"), 'place detail did not open')
    const detail = await page.evaluate(`({
      url: location.pathname + location.search,
      appAction: Boolean(document.querySelector('.ps-detail-app-cta')),
      back: document.querySelector('.ps-back-link')?.textContent.trim(),
    })`)
    assert.match(detail.url, /^\/cities\/lagos\?type=places&categories=nature&detail=place%3A/)
    assert.equal(detail.appAction, true)
    assert.equal(detail.back, 'Back to Lagos picks')
    await page.evaluate("document.querySelector('.ps-detail-header > a')?.click()")
    await waitFor(() => page.evaluate("!document.querySelector('[data-catalogue-detail]') && !location.search.includes('detail=')"), 'detail close did not restore catalogue URL')
    process.stdout.write('PASS #2983 adversarial mobile URL, filter, sticky-control and detail behaviour\n')
  } finally {
    page?.close()
    chrome.kill('SIGTERM')
    server.kill('SIGTERM')
    await Promise.all([
      new Promise((resolve) => chrome.once('exit', resolve)),
      new Promise((resolve) => server.once('exit', resolve)),
    ])
    fs.rmSync(profile, { recursive: true, force: true })
  }
}

if (!BUILT_ONLY) sourceContract()
if (!SOURCE_ONLY) await runtimeContract()
