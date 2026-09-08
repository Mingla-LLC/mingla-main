#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_ONLY = process.argv.includes('--source-only')
const BUILT_ONLY = process.argv.includes('--built-only')
const EXTERNAL_BASE_URL = process.env.HOST_TRIP_BENTO_TEST_BASE_URL?.replace(/\/$/, '')
const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean)
const CHROME = CHROME_CANDIDATES.find((candidate) => fs.existsSync(candidate))
const VIEWPORTS = [
  { width: 320, height: 844 },
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 1024, height: 900 },
  { width: 1117, height: 837 },
  { width: 1280, height: 900 },
  { width: 1440, height: 900 },
]
const CHIP_LABELS = ['Group chat', 'Instalments', 'Itineraries']
const CHROME_START_TIMEOUT_MS = 20_000
const CHILD_OUTPUT_TAIL_BYTES = 8 * 1024
const BROWSER_CLOSE_ACK_TIMEOUT_MS = 2_000
const CHILD_STOP_TIMEOUT_MS = 2_000
const PROFILE_CLEANUP_POLICY = Object.freeze({
  recursive: true,
  force: true,
  maxRetries: 8,
  retryDelay: 100,
})
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

function removeBrowserProfile(profile, remove = fs.rmSync) {
  return remove(profile, PROFILE_CLEANUP_POLICY)
}

async function sourceContract() {
  const packageJson = JSON.parse(read('package.json'))
  const self = path.basename(fileURLToPath(import.meta.url))

  assert.match(
    packageJson.scripts.build,
    new RegExp(self.replaceAll('.', '\\.') + String.raw` --built-only`),
    'the real-browser tester guard must run after the production artifact exists in CI',
  )
  assert.match(
    packageJson.scripts['test:host-trip-bento'],
    /issue-2983-host-trip-bento-overlap\.implementor\.happy\.test\.mjs[\s\S]*issue-2983-host-trip-bento-overlap\.tester\.adversarial\.test\.mjs/,
    'the named Host Trips gate must run both independent regression guards',
  )
  assert.equal(VIEWPORTS.map(({ width }) => width).join(','), '320,390,768,1024,1117,1280,1440')
  const cleanupCalls = []
  removeBrowserProfile('/tmp/mingla-2983-cleanup-policy-proof', (target, options) => {
    cleanupCalls.push({ target, options })
  })
  assert.deepEqual(cleanupCalls, [{
    target: '/tmp/mingla-2983-cleanup-policy-proof',
    options: { recursive: true, force: true, maxRetries: 8, retryDelay: 100 },
  }], 'browser profile cleanup must use the exact bounded retry policy')
  const persistentCleanupError = new Error('persistent cleanup failure')
  assert.throws(
    () => removeBrowserProfile('/tmp/mingla-2983-cleanup-failure-proof', () => { throw persistentCleanupError }),
    (error) => error === persistentCleanupError,
    'persistent browser profile cleanup errors must remain fatal',
  )
  assert.equal(BROWSER_CLOSE_ACK_TIMEOUT_MS, 2_000, 'Browser.close acknowledgement must remain bounded at 2,000ms')
  assert.equal(CHILD_STOP_TIMEOUT_MS, 2_000, 'child termination waits must remain bounded at 2,000ms')
  assert.equal(CHROME_START_TIMEOUT_MS, 20_000, 'Chrome startup must retain its 20,000ms ceiling')
  assert.equal(CHILD_OUTPUT_TAIL_BYTES, 8 * 1024, 'Chrome output diagnostics must remain capped at 8KiB per stream')
  const source = read(`scripts/${self}`)
  assert.match(source, /await waitForChromeStart\(/, 'Chrome startup must use the diagnostic owner')
  assert.doesNotMatch(source, /Chrome did not start'\)/, 'the old opaque Chrome-start predicate must not return')

  const lifecycle = []
  const listeners = new Map()
  const socket = {
    addEventListener(type, listener) {
      listeners.set(type, listener)
    },
    send(payload) {
      const request = JSON.parse(payload)
      lifecycle.push(`send:${request.method}`)
      queueMicrotask(() => listeners.get('message')?.({ data: JSON.stringify({ id: request.id, result: {} }) }))
    },
    close() {
      lifecycle.push('socket.close')
    },
  }
  const page = new CdpPage('ws://lifecycle-proof', () => socket)
  listeners.get('open')?.()
  assert.equal(await closeCdpBeforeSocket(page), undefined)
  assert.deepEqual(
    lifecycle,
    ['send:Browser.close', 'socket.close'],
    'Browser.close must be acknowledged before the CDP socket closes',
  )

  const fakeChild = new EventEmitter()
  fakeChild.exitCode = null
  fakeChild.signalCode = null
  fakeChild.kills = []
  fakeChild.kill = (signal) => {
    fakeChild.kills.push(signal)
    return true
  }
  let stopSettled = false
  const stopping = stopChild(fakeChild, { termTimeoutMs: 1, killTimeoutMs: 100 })
    .then(() => { stopSettled = true })
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.deepEqual(fakeChild.kills, ['SIGTERM', 'SIGKILL'], 'child fallback must escalate from SIGTERM to SIGKILL')
  assert.equal(stopSettled, false, 'stopChild must wait for terminal exit after SIGKILL')
  fakeChild.exitCode = 0
  fakeChild.emit('exit', 0, null)
  await stopping
  assert.equal(stopSettled, true, 'stopChild must resolve after the child emits terminal exit')

  const fakeChrome = () => {
    const child = new EventEmitter()
    child.exitCode = null
    child.signalCode = null
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    return child
  }
  const exitedChrome = fakeChrome()
  const exitedDiagnostics = observeChrome(exitedChrome)
  exitedChrome.stderr.emit('data', 'missing shared library')
  exitedChrome.exitCode = 127
  exitedChrome.emit('exit', 127, null)
  await assert.rejects(
    () => waitForChromeStart({ debugPort: 9222, chrome: exitedChrome, diagnostics: exitedDiagnostics, timeoutMs: 1 }),
    /endpoint=http:\/\/127\.0\.0\.1:9222\/json\/version[\s\S]*exitCode=127[\s\S]*stderr=missing shared library/,
    'an immediate Chrome exit must expose its terminal state and stderr tail',
  )
  const spawnErrorChrome = fakeChrome()
  const spawnErrorDiagnostics = observeChrome(spawnErrorChrome)
  spawnErrorChrome.emit('error', new Error('spawn EACCES'))
  await assert.rejects(
    () => waitForChromeStart({ debugPort: 9223, chrome: spawnErrorChrome, diagnostics: spawnErrorDiagnostics, timeoutMs: 1 }),
    /spawnError=spawn EACCES[\s\S]*stdout=<empty>[\s\S]*stderr=<empty>/,
    'a Chrome spawn error must fail fast with labeled empty tails',
  )
  const timeoutChrome = fakeChrome()
  const timeoutDiagnostics = observeChrome(timeoutChrome)
  timeoutChrome.stdout.emit('data', 'stdout tail')
  timeoutChrome.stderr.emit('data', 'stderr tail')
  await assert.rejects(
    () => waitForChromeStart({ debugPort: 9224, chrome: timeoutChrome, diagnostics: timeoutDiagnostics, timeoutMs: 0 }),
    /startup timed out[\s\S]*stdout=stdout tail[\s\S]*stderr=stderr tail/,
    'a Chrome startup timeout must include both bounded output tails',
  )
  const capChrome = fakeChrome()
  const capDiagnostics = observeChrome(capChrome)
  capChrome.stdout.emit('data', Buffer.concat([Buffer.alloc(CHILD_OUTPUT_TAIL_BYTES, 65), Buffer.from('TAIL')]))
  assert.equal(Buffer.byteLength(capDiagnostics.snapshot().stdout), CHILD_OUTPUT_TAIL_BYTES)
  assert.equal(capDiagnostics.snapshot().stdout.endsWith('TAIL'), true, 'stdout diagnostics must retain the newest capped tail')
  const readyChrome = fakeChrome()
  const readyDiagnostics = observeChrome(readyChrome)
  await waitForChromeStart({
    debugPort: 9225,
    chrome: readyChrome,
    diagnostics: readyDiagnostics,
    fetchVersion: async () => ({ ok: true }),
    timeoutMs: 1,
  })
  assert.throws(
    () => assert.match('Chrome did not start: fetch failed', /endpoint=/),
    /endpoint/,
    'the old generic startup error must fail the diagnostic contract',
  )
  const primaryFailure = new Error('primary runtime failure')
  const successfulCloseCalls = []
  const successfulClosePage = {
    async closeBrowserGracefully() { successfulCloseCalls.push('graceful-close') },
    close() { successfulCloseCalls.push('socket-close') },
  }
  assert.equal(
    await retainPrimaryAfterCdpClose(primaryFailure, successfulClosePage),
    primaryFailure,
    'a successful graceful close must not overwrite an earlier runtime failure',
  )
  assert.deepEqual(successfulCloseCalls, ['graceful-close', 'socket-close'])
  const failedClosePage = {
    async closeBrowserGracefully() { throw new Error('graceful close failure') },
    close() {},
  }
  assert.equal(
    await retainPrimaryAfterCdpClose(primaryFailure, failedClosePage),
    primaryFailure,
    'an earlier runtime failure must outrank a graceful-close failure',
  )
  process.stdout.write('PASS #2983 tester source guard: CI-wired seven-width real-browser contract\n')
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

function appendTail(tail, chunk) {
  const combined = Buffer.concat([tail, Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))])
  return combined.length > CHILD_OUTPUT_TAIL_BYTES ? combined.subarray(-CHILD_OUTPUT_TAIL_BYTES) : combined
}

function observeChrome(chrome) {
  let stdout = Buffer.alloc(0)
  let stderr = Buffer.alloc(0)
  let spawnError
  let exitCode = chrome.exitCode ?? null
  let signalCode = chrome.signalCode ?? null
  chrome.stdout?.on('data', (chunk) => { stdout = appendTail(stdout, chunk) })
  chrome.stderr?.on('data', (chunk) => { stderr = appendTail(stderr, chunk) })
  chrome.once('error', (error) => { spawnError = error })
  chrome.once('exit', (code, signal) => {
    exitCode = code
    signalCode = signal
  })
  return {
    snapshot() {
      return {
        stdout: stdout.length ? stdout.toString('utf8') : '<empty>',
        stderr: stderr.length ? stderr.toString('utf8') : '<empty>',
        spawnError,
        exitCode: chrome.exitCode ?? exitCode,
        signalCode: chrome.signalCode ?? signalCode,
      }
    },
  }
}

function chromeStartupError({ endpoint, diagnostics, reason, lastError }) {
  const state = diagnostics.snapshot()
  return new Error(
    `Chrome startup failed: ${reason}; endpoint=${endpoint}; exitCode=${state.exitCode ?? '<null>'}; `
    + `signalCode=${state.signalCode ?? '<null>'}; spawnError=${state.spawnError?.message ?? '<none>'}; `
    + `lastProbeError=${lastError?.message ?? '<none>'}; stdout=${state.stdout}; stderr=${state.stderr}`,
  )
}

async function waitForChromeStart({
  debugPort,
  chrome,
  diagnostics,
  fetchVersion = fetch,
  timeoutMs = CHROME_START_TIMEOUT_MS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const endpoint = `http://127.0.0.1:${debugPort}/json/version`
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    const state = diagnostics.snapshot()
    if (state.spawnError) throw chromeStartupError({ endpoint, diagnostics, reason: 'Chrome emitted a spawn error', lastError })
    if (state.exitCode !== null || state.signalCode !== null) {
      throw chromeStartupError({ endpoint, diagnostics, reason: 'Chrome exited before CDP became ready', lastError })
    }
    try {
      if ((await fetchVersion(endpoint)).ok) return
    } catch (error) {
      lastError = error
    }
    await sleep(60)
  }
  const state = diagnostics.snapshot()
  if (state.spawnError) throw chromeStartupError({ endpoint, diagnostics, reason: 'Chrome emitted a spawn error', lastError })
  if (state.exitCode !== null || state.signalCode !== null) {
    throw chromeStartupError({ endpoint, diagnostics, reason: 'Chrome exited before CDP became ready', lastError })
  }
  throw chromeStartupError({ endpoint, diagnostics, reason: 'startup timed out', lastError })
}

class CdpPage {
  constructor(webSocketUrl, createSocket = (url) => new WebSocket(url)) {
    this.nextId = 1
    this.pending = new Map()
    this.socket = createSocket(webSocketUrl)
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
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'browser evaluation failed')
    return result.result.value
  }

  async closeBrowserGracefully(timeoutMs = BROWSER_CLOSE_ACK_TIMEOUT_MS) {
    await this.ready
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const finish = (callback, value) => {
        clearTimeout(timer)
        this.pending.delete(id)
        callback(value)
      }
      const timer = setTimeout(
        () => finish(reject, new Error(`Browser.close did not acknowledge within ${timeoutMs}ms`)),
        timeoutMs,
      )
      this.pending.set(id, {
        resolve: (result) => finish(resolve, result),
        reject: (error) => finish(reject, error),
      })
      try {
        this.socket.send(JSON.stringify({ id, method: 'Browser.close', params: {} }))
      } catch (error) {
        finish(reject, error)
      }
    })
  }

  close() {
    this.socket.close()
  }
}

async function closeCdpBeforeSocket(page) {
  let gracefulCloseError
  try {
    await page.closeBrowserGracefully()
  } catch (error) {
    gracefulCloseError = error
  } finally {
    page.close()
  }
  return gracefulCloseError
}

async function retainPrimaryAfterCdpClose(primaryError, page) {
  const closeError = await closeCdpBeforeSocket(page)
  return primaryError ?? closeError
}

async function createPage(debugPort) {
  const target = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' })
    .then((response) => response.json())
  const page = new CdpPage(target.webSocketDebuggerUrl)
  await page.send('Page.enable')
  await page.send('Runtime.enable')
  return page
}

function geometryExpression() {
  return `(() => {
    const chipsExpected = ${JSON.stringify(CHIP_LABELS)};
    const section = document.querySelector('section[aria-label="What Mingla Host does"]');
    const heading = [...(section?.querySelectorAll('h3') ?? [])]
      .find((node) => node.textContent.trim() === 'Trips');
    const card = heading?.closest('.group');
    const grid = card?.parentElement;
    const body = heading?.parentElement?.querySelector('p');
    const figure = card?.querySelector('[role="img"][aria-label^="A hosted trip from"]');
    const chips = [...(card?.querySelectorAll('span') ?? [])]
      .filter((node) => chipsExpected.includes(node.textContent.trim()));

    if (!section || !heading || !card || !grid || !body || !figure || chips.length !== chipsExpected.length) {
      return {
        error: 'Host Trips structure missing',
        found: { section: Boolean(section), heading: Boolean(heading), card: Boolean(card), grid: Boolean(grid), body: Boolean(body), figure: Boolean(figure), chips: chips.length },
      };
    }

    const rect = (node) => {
      const box = node.getBoundingClientRect();
      return { top: box.top, right: box.right, bottom: box.bottom, left: box.left, width: box.width, height: box.height };
    };
    const cardRect = rect(card);
    const figureRect = rect(figure);
    const chipRects = chips.map((node) => ({ label: node.textContent.trim(), ...rect(node) }));
    const firstChipTop = Math.min(...chipRects.map(({ top }) => top));
    const lastChipBottom = Math.max(...chipRects.map(({ bottom }) => bottom));
    const siblingRects = [...grid.children]
      .filter((node) => node !== card)
      .map((node) => ({ title: node.querySelector('h3')?.textContent.trim() ?? '', ...rect(node) }));
    const collisions = siblingRects.filter((sibling) =>
      Math.min(cardRect.right, sibling.right) - Math.max(cardRect.left, sibling.left) > 0.5
      && Math.min(cardRect.bottom, sibling.bottom) - Math.max(cardRect.top, sibling.top) > 0.5
    );
    const follows = (earlier, later) => Boolean(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING);
    const visible = (node, box) => {
      const style = getComputedStyle(node);
      return box.width > 0 && box.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0;
    };
    const cardStyle = getComputedStyle(card);
    const figureStyle = getComputedStyle(figure);

    return {
      viewport: { width: innerWidth, height: innerHeight },
      gridAutoRows: getComputedStyle(grid).gridAutoRows,
      card: cardRect,
      figure: figureRect,
      chips: chipRects,
      gap: firstChipTop - figureRect.bottom,
      bottomBreathingRoom: cardRect.bottom - lastChipBottom,
      everyChipInside: chipRects.every((chip) =>
        chip.left >= cardRect.left - 0.5 && chip.right <= cardRect.right + 0.5
        && chip.top >= cardRect.top - 0.5 && chip.bottom <= cardRect.bottom + 0.5
      ),
      figureInside: figureRect.left >= cardRect.left - 0.5 && figureRect.right <= cardRect.right + 0.5
        && figureRect.top >= cardRect.top - 0.5 && figureRect.bottom <= cardRect.bottom + 0.5,
      everyChipVisible: chipRects.every((chip, index) => visible(chips[index], chip)),
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      collisions: collisions.map(({ title }) => title),
      readingOrder: follows(heading, body) && follows(body, figure) && chips.every((chip) => follows(figure, chip)),
      ariaLabel: figure.getAttribute('aria-label'),
      content: {
        title: heading.textContent.trim(),
        body: body.textContent.trim(),
        chips: chips.map((chip) => chip.textContent.trim()),
      },
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      cardTransform: cardStyle.transform,
      figureTransform: figureStyle.transform,
      cardOpacity: cardStyle.opacity,
      figureOpacity: figureStyle.opacity,
    };
  })()`
}

function assertGeometry(result, width) {
  assert.equal(result.error, undefined, `${width}px: ${result.error ?? ''} ${JSON.stringify(result.found ?? {})}`)
  assert.equal(result.viewport.width, width, `${width}px: Chrome did not apply the requested CSS viewport`)
  assert.ok(result.gap >= 16, `${width}px: Trips figure-to-chip gap was ${result.gap}px; expected at least 16px`)
  assert.ok(
    result.bottomBreathingRoom >= 24,
    `${width}px: Trips chip bottom breathing room was ${result.bottomBreathingRoom}px; expected at least 24px`,
  )
  assert.equal(result.everyChipInside, true, `${width}px: at least one Trips capability chip escaped its card`)
  assert.equal(result.figureInside, true, `${width}px: the Trips figure escaped or was clipped by its card`)
  assert.equal(result.everyChipVisible, true, `${width}px: at least one Trips capability chip was hidden`)
  assert.equal(result.documentOverflow, 0, `${width}px: document overflowed horizontally by ${result.documentOverflow}px`)
  assert.deepEqual(result.collisions, [], `${width}px: Trips card collided with ${result.collisions.join(', ')}`)
  assert.equal(result.readingOrder, true, `${width}px: title/body/figure/chip DOM reading order regressed`)
  assert.match(result.ariaLabel, /^A hosted trip from .+ to .+, 12 to 14 September, six travelling, paid in instalments of .+\.$/)
  assert.deepEqual(result.content, {
    title: 'Trips',
    body: 'Host trips and let the group plan them together.',
    chips: CHIP_LABELS,
  })
  assert.equal(result.reducedMotion, true, `${width}px: reduced-motion media emulation did not reach the page`)
  assert.equal(result.cardTransform, 'none', `${width}px: reduced-motion left a card transform active`)
  assert.equal(result.figureTransform, 'none', `${width}px: reduced-motion left a Trips figure transform active`)
  assert.equal(result.cardOpacity, '1', `${width}px: Trips card content was not fully visible`)
  assert.equal(result.figureOpacity, '1', `${width}px: Trips figure content was not fully visible`)
}

function waitForChildExit(child, timeoutMs, message) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const onExit = () => {
      clearTimeout(timer)
      child.removeListener('exit', onExit)
      resolve()
    }
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit)
      reject(new Error(message))
    }, timeoutMs)
    child.once('exit', onExit)
    if (child.exitCode !== null || child.signalCode !== null) onExit()
  })
}

async function stopChild(child, {
  termTimeoutMs = CHILD_STOP_TIMEOUT_MS,
  killTimeoutMs = CHILD_STOP_TIMEOUT_MS,
} = {}) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const afterTerm = waitForChildExit(child, termTimeoutMs, `child did not exit after SIGTERM within ${termTimeoutMs}ms`)
  child.kill('SIGTERM')
  try {
    await afterTerm
    return
  } catch {
    if (child.exitCode !== null || child.signalCode !== null) return
  }
  const afterKill = waitForChildExit(child, killTimeoutMs, `child did not exit after SIGKILL within ${killTimeoutMs}ms`)
  child.kill('SIGKILL')
  await afterKill
}

async function runtimeContract() {
  if (process.env.VERCEL === '1' && !EXTERNAL_BASE_URL) {
    process.stdout.write('SKIP #2983 Host Trips real-browser geometry on Vercel; GitHub CI and local production builds execute it\n')
    return
  }
  assert(CHROME, `Chrome executable not found; checked ${CHROME_CANDIDATES.join(', ')}`)
  if (!EXTERNAL_BASE_URL) {
    assert(fs.existsSync(path.join(ROOT, '.next', 'BUILD_ID')), 'run next build before the #2983 Host Trips browser tester')
  }

  const debugPort = await availablePort()
  const serverPort = EXTERNAL_BASE_URL ? null : await availablePort()
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mingla-2983-host-trip-tester-'))
  let server
  let serverOutput = ''
  if (serverPort) {
    server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(serverPort)], {
      cwd: ROOT,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    server.stdout.on('data', (chunk) => { serverOutput += chunk })
    server.stderr.on('data', (chunk) => { serverOutput += chunk })
  }
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
  const chromeDiagnostics = observeChrome(chrome)
  let page
  let primaryError
  try {
    if (serverPort) {
      await waitFor(async () => (await request(serverPort, '/robots.txt')) === 200, 'Next server did not start')
    }
    await waitForChromeStart({ debugPort, chrome, diagnostics: chromeDiagnostics })
    page = await createPage(debugPort)
    await page.send('Emulation.setEmulatedMedia', {
      media: 'screen',
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    })
    const baseUrl = EXTERNAL_BASE_URL ?? `http://127.0.0.1:${serverPort}`

    const failures = []
    for (const viewport of VIEWPORTS) {
      await page.send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: false,
      })
      await page.send('Page.navigate', { url: `${baseUrl}/host?qa=host-trip-${viewport.width}#tools` })
      await waitFor(
        () => page.evaluate("Boolean(document.querySelector('[role=img][aria-label^=\"A hosted trip from\"]'))"),
        `${viewport.width}px: Host Trips figure did not hydrate`,
      )
      await page.evaluate(`(async () => {
        await document.fonts.ready;
        const figure = document.querySelector('[role="img"][aria-label^="A hosted trip from"]');
        figure?.closest('.group')?.scrollIntoView({ block: 'center' });
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      })()`)
      await waitFor(
        () => page.evaluate(`(() => {
          const figure = document.querySelector('[role="img"][aria-label^="A hosted trip from"]');
          const card = figure?.closest('.group');
          if (!card || !figure || !matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
          const cardStyle = getComputedStyle(card);
          const figureStyle = getComputedStyle(figure);
          return cardStyle.transform === 'none' && cardStyle.opacity === '1'
            && figureStyle.transform === 'none' && figureStyle.opacity === '1';
        })()`),
        `${viewport.width}px: reduced-motion Host card did not settle visibly`,
      )
      const result = await page.evaluate(geometryExpression())
      process.stdout.write(`EVIDENCE #2983 host-trip width=${viewport.width} ${JSON.stringify({
        gap: result.gap,
        bottomBreathingRoom: result.bottomBreathingRoom,
        card: result.card,
        figure: result.figure,
        chips: result.chips,
        gridAutoRows: result.gridAutoRows,
        documentOverflow: result.documentOverflow,
        collisions: result.collisions,
      })}\n`)
      try {
        assertGeometry(result, viewport.width)
      } catch (error) {
        failures.push(error.message)
      }
    }
    assert.deepEqual(failures, [], `Host Trips responsive contract failed:\n- ${failures.join('\n- ')}`)
    process.stdout.write(`PASS #2983 Host Trips real-browser geometry ${VIEWPORTS.length}/${VIEWPORTS.length} widths\n`)
  } catch (error) {
    primaryError = error
  } finally {
    let teardownError = primaryError
    let chromeTerminal = false
    if (page) teardownError = await retainPrimaryAfterCdpClose(teardownError, page)
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
        removeBrowserProfile(profile)
      } catch (error) {
        teardownError ??= error
      }
    }
    if (server && server.exitCode && server.exitCode !== 0 && server.signalCode !== 'SIGTERM') {
      process.stderr.write(serverOutput)
    }
    if (teardownError) throw teardownError
  }
}

if (!BUILT_ONLY) await sourceContract()
if (!SOURCE_ONLY) await runtimeContract()
