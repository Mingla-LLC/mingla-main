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
const ROUTES = [
  'city-lagos',
  'explorer-event-guide',
  'host-event-promoter-guide',
]
const BROWSER_MODE = process.argv.includes('--browser')
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

function decodeHtml(value) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
}

function textContent(value) {
  return decodeHtml(value.replace(/<!--.*?-->/gs, '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function readBuildFile(relativePath) {
  const filename = path.join(ROOT, '.next', relativePath)
  assert(fs.existsSync(filename), `missing built artifact ${relativePath}; run npm run build first`)
  return fs.readFileSync(filename, 'utf8')
}

function buildArtifactPath(href) {
  const url = new URL(href, 'https://page-system.invalid')
  assert.equal(url.origin, 'https://page-system.invalid', `unexpected stylesheet origin ${href}`)
  assert(url.pathname.startsWith('/_next/'), `unexpected stylesheet path ${href}`)
  return url.pathname.slice('/_next/'.length)
}

function linkedCss(html) {
  const hrefs = [...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/g)]
    .map((match) => match[1])
  assert(hrefs.length > 0, 'built route must link at least one stylesheet')
  return hrefs.map((href) => {
    return readBuildFile(buildArtifactPath(href))
  }).join('\n')
}

assert.equal(
  buildArtifactPath('/_next/static/css/example.css?dpl=dpl_preview'),
  'static/css/example.css',
  'deployment cache-busting parameters must not become filesystem paths',
)

function assertFivePrintSafeFaqPairs(slug) {
  const html = readBuildFile(`server/app/internal/page-system/${slug}.html`)
  const pairs = [...html.matchAll(
    /<details\b[^>]*class="ps-faq"[^>]*>([\s\S]*?)<\/details><article\b[^>]*class="ps-faq-print-answer"[^>]*data-print-faq-answer="true"[^>]*>([\s\S]*?)<\/article>/g,
  )]

  assert.equal(pairs.length, 5, `${slug} must emit five screen/print FAQ sibling pairs in the production HTML`)
  for (const [index, pair] of pairs.entries()) {
    const screenQuestion = textContent(pair[1].match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/)?.[1] ?? '')
      .replace(/\+$/, '').trim()
    const screenAnswer = textContent(pair[1].match(/class="ps-faq-answer"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? '')
    const printQuestion = textContent(pair[2].match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/)?.[1] ?? '')
    const printAnswer = textContent(pair[2].match(/<p\b[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? '')

    assert(screenQuestion.length > 12, `${slug} FAQ ${index + 1} has a material question`)
    assert(screenAnswer.length > 24, `${slug} FAQ ${index + 1} has a material answer`)
    assert.equal(printQuestion, screenQuestion, `${slug} FAQ ${index + 1} print question matches its interactive sibling`)
    assert.equal(printAnswer, screenAnswer, `${slug} FAQ ${index + 1} print answer matches its interactive sibling`)
  }

  assert.equal((html.match(/data-print-faq-answer="true"/g) ?? []).length, 5, `${slug} has no orphan or duplicate print FAQ copies`)
  assert.equal((html.match(/<details\b[^>]*class="ps-faq"/g) ?? []).length, 5, `${slug} retains five native interactive FAQ controls`)

  const css = linkedCss(html)
  assert.match(css, /\.ps-faq-print-answer\{display:none\}/, `${slug} hides print copies on screen`)
  const printCss = css.slice(css.lastIndexOf('@media print{'))
  assert(printCss.length > 0, `${slug} includes print media rules`)
  assert.match(printCss, /\.ps-faq\{display:none!important\}/, `${slug} removes interactive details from print`)
  assert.match(printCss, /\.ps-faq-print-answer\{[^}]*display:block!important/, `${slug} exposes complete answer copies in print`)
}

async function availablePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert(address && typeof address === 'object')
  const { port } = address
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return port
}

function request(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname }, (response) => {
      response.resume()
      response.once('end', () => resolve(response.statusCode ?? 0))
    })
    req.once('error', reject)
    req.end()
  })
}

async function waitFor(predicate, message, timeout = 15_000) {
  const deadline = Date.now() + timeout
  let lastError
  while (Date.now() < deadline) {
    try {
      const value = await predicate()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`${message}${lastError ? `: ${lastError.message}` : ''}`)
}

class CdpPage {
  constructor(webSocketUrl) {
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Map()
    this.socket = new WebSocket(webSocketUrl)
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true })
      this.socket.addEventListener('error', reject, { once: true })
    })
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      if (message.id) {
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        if (message.error) pending.reject(new Error(message.error.message))
        else pending.resolve(message.result)
        return
      }
      for (const listener of this.listeners.get(message.method) ?? []) listener(message.params)
    })
  }

  async send(method, params = {}) {
    await this.ready
    const id = this.nextId++
    const response = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
    this.socket.send(JSON.stringify({ id, method, params }))
    return response
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? []
    listeners.push(listener)
    this.listeners.set(method, listeners)
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'browser evaluation failed')
    return result.result.value
  }

  close() {
    this.socket.close()
  }
}

async function createPage(debugPort) {
  const target = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' }).then((response) => response.json())
  const page = new CdpPage(target.webSocketDebuggerUrl)
  page.targetId = target.id
  await page.send('Page.enable')
  await page.send('Runtime.enable')
  await page.send('Network.enable')
  return page
}

async function navigate(page, url) {
  await page.send('Page.navigate', { url })
  await waitFor(
    () => page.evaluate("document.readyState === 'complete' && Boolean(document.querySelector('h1'))"),
    `page did not become ready: ${url}`,
  )
}

async function dispatchKey(page, key, code = key) {
  const virtualKeyCode = key === 'Enter' ? 13 : key === ' ' ? 32 : 0
  await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: virtualKeyCode, nativeVirtualKeyCode: virtualKeyCode })
  if (key === 'Enter' || key === ' ') {
    await page.send('Input.dispatchKeyEvent', { type: 'char', key, code, text: key === 'Enter' ? '\r' : ' ', windowsVirtualKeyCode: virtualKeyCode, nativeVirtualKeyCode: virtualKeyCode })
  }
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: virtualKeyCode, nativeVirtualKeyCode: virtualKeyCode })
}

function mediaSnapshotExpression() {
  return `(() => {
    const frame = document.querySelector('.ps-host-image-frame');
    const image = document.querySelector('.ps-host-concept-image');
    const fallback = document.querySelector('.ps-host-media-fallback');
    const status = frame?.querySelector('[role="status"]');
    return {
      state: frame?.dataset.mediaState,
      complete: image?.complete,
      naturalWidth: image?.naturalWidth,
      naturalHeight: image?.naturalHeight,
      imageAriaHidden: image?.getAttribute('aria-hidden'),
      imageOpacity: image ? getComputedStyle(image).opacity : null,
      fallbackAriaHidden: fallback?.getAttribute('aria-hidden'),
      fallbackRole: fallback?.getAttribute('role'),
      fallbackLabel: fallback?.getAttribute('aria-label'),
      status: status?.textContent?.trim()
    };
  })()`
}

function assertMediaSnapshot(snapshot, expected) {
  assert.equal(snapshot.state, expected)
  assert.equal(snapshot.fallbackRole, 'img')
  assert.equal(snapshot.fallbackLabel, 'Mingla Host event-planning illustration')
  if (expected === 'pending') {
    assert.equal(snapshot.fallbackAriaHidden, 'true')
    assert.notEqual(snapshot.imageAriaHidden, 'true')
    assert.equal(snapshot.imageOpacity, '0')
    assert.equal(snapshot.status, 'Loading the illustrative Mingla Host concept image.')
  } else if (expected === 'loaded') {
    assert(snapshot.naturalWidth > 0 && snapshot.naturalHeight > 0)
    assert.equal(snapshot.fallbackAriaHidden, 'true')
    assert.notEqual(snapshot.imageAriaHidden, 'true')
    assert.equal(snapshot.imageOpacity, '1')
    assert.equal(snapshot.status, 'The illustrative Mingla Host concept image loaded.')
  } else {
    assert.equal(snapshot.naturalWidth, 0)
    assert.equal(snapshot.fallbackAriaHidden, 'false')
    assert.equal(snapshot.imageAriaHidden, 'true')
    assert.equal(snapshot.imageOpacity, '0')
    assert.equal(snapshot.status, 'The concept image could not load. A branded Mingla Host fallback is shown.')
  }
}

async function runPreHydrationMediaCase(debugPort, baseUrl, expected) {
  const page = await createPage(debugPort)
  const pausedScripts = []
  let releaseScripts = false
  let imageSettled = false
  page.on('Fetch.requestPaused', (event) => {
    if (event.resourceType === 'Script') {
      if (releaseScripts) void page.send('Fetch.continueRequest', { requestId: event.requestId })
      else pausedScripts.push(event.requestId)
    } else if (event.request.url.includes('/marketing/host-icp/events-hall.jpg')) {
      imageSettled = true
      if (expected === 'failed') void page.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'Failed' })
      else void page.send('Fetch.continueRequest', { requestId: event.requestId })
    } else {
      void page.send('Fetch.continueRequest', { requestId: event.requestId })
    }
  })
  await page.send('Network.setCacheDisabled', { cacheDisabled: expected === 'failed' })
  await page.send('Fetch.enable', { patterns: [
    { urlPattern: '*', resourceType: 'Script', requestStage: 'Request' },
    { urlPattern: '*events-hall.jpg*', resourceType: 'Image', requestStage: 'Request' },
  ] })
  await page.send('Page.navigate', { url: `${baseUrl}/internal/page-system/host-event-promoter-guide?prehydrate=${expected}` })
  await waitFor(async () => {
    const snapshot = await page.evaluate(mediaSnapshotExpression())
    return snapshot?.complete && (expected === 'loaded' ? snapshot.naturalWidth > 0 : snapshot.naturalWidth === 0) && imageSettled && pausedScripts.length > 0 && snapshot
  }, `${expected} image did not settle while hydration scripts were paused`)
  const beforeHydration = await page.evaluate(mediaSnapshotExpression())
  assert.equal(beforeHydration.state, 'pending', 'server media state remains pending before hydration')
  releaseScripts = true
  await Promise.all(pausedScripts.splice(0).map((requestId) => page.send('Fetch.continueRequest', { requestId })))
  const terminal = await waitFor(async () => {
    const snapshot = await page.evaluate(mediaSnapshotExpression())
    return snapshot.state === expected && snapshot
  }, `post-hydration ${expected} state was not reconciled`)
  assertMediaSnapshot(terminal, expected)
  await page.send('Fetch.disable')
  page.close()
  return { beforeHydration, terminal }
}

async function runCorruptAndSlowMediaCases(debugPort, baseUrl) {
  const corrupt = await createPage(debugPort)
  corrupt.on('Fetch.requestPaused', (event) => {
    if (event.request.url.includes('/marketing/host-icp/events-hall.jpg')) {
      void corrupt.send('Fetch.fulfillRequest', {
        requestId: event.requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'image/jpeg' }],
        body: Buffer.from('not an image').toString('base64'),
      })
    } else void corrupt.send('Fetch.continueRequest', { requestId: event.requestId })
  })
  await corrupt.send('Network.setCacheDisabled', { cacheDisabled: true })
  await corrupt.send('Fetch.enable', { patterns: [{ urlPattern: '*events-hall.jpg*', resourceType: 'Image', requestStage: 'Request' }] })
  await navigate(corrupt, `${baseUrl}/internal/page-system/host-event-promoter-guide?media=corrupt`)
  const corruptResult = await waitFor(async () => {
    const snapshot = await corrupt.evaluate(mediaSnapshotExpression())
    return snapshot.state === 'failed' && snapshot
  }, 'corrupt image did not reach failed state')
  assertMediaSnapshot(corruptResult, 'failed')
  corrupt.close()

  const slow = await createPage(debugPort)
  let heldImage
  slow.on('Fetch.requestPaused', (event) => {
    if (event.request.url.includes('/marketing/host-icp/events-hall.jpg')) heldImage = event.requestId
    else void slow.send('Fetch.continueRequest', { requestId: event.requestId })
  })
  await slow.send('Network.setCacheDisabled', { cacheDisabled: true })
  await slow.send('Fetch.enable', { patterns: [{ urlPattern: '*events-hall.jpg*', resourceType: 'Image', requestStage: 'Request' }] })
  await slow.send('Page.navigate', { url: `${baseUrl}/internal/page-system/host-event-promoter-guide?media=slow` })
  const pending = await waitFor(async () => heldImage && slow.evaluate(mediaSnapshotExpression()), 'slow image request was not held')
  assertMediaSnapshot(pending, 'pending')
  await slow.send('Fetch.failRequest', { requestId: heldImage, errorReason: 'TimedOut' })
  const slowResult = await waitFor(async () => {
    const snapshot = await slow.evaluate(mediaSnapshotExpression())
    return snapshot.state === 'failed' && snapshot
  }, 'slow image did not leave pending for failed state')
  assertMediaSnapshot(slowResult, 'failed')
  slow.close()
}

async function runBrowserContract() {
  assert(fs.existsSync(CHROME), `Chrome executable not found at ${CHROME}`)
  const serverPort = await availablePort()
  const debugPort = await availablePort()
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mingla-2990-chrome-'))
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(serverPort)], {
    cwd: ROOT,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let serverOutput = ''
  server.stdout.on('data', (chunk) => { serverOutput += chunk })
  server.stderr.on('data', (chunk) => { serverOutput += chunk })
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-extensions',
    '--hide-scrollbars',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  let chromeOutput = ''
  chrome.stdout.on('data', (chunk) => { chromeOutput += chunk })
  chrome.stderr.on('data', (chunk) => { chromeOutput += chunk })
  const baseUrl = `http://127.0.0.1:${serverPort}`

  try {
    await waitFor(async () => (await request(serverPort, '/robots.txt')) === 200, `Next server failed to start: ${serverOutput}`, 20_000)
    await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
      return response.ok
    }, `Chrome failed to start: ${chromeOutput}`, 20_000)

    const geometryPage = await createPage(debugPort)
    const viewports = [
      [360, 800], [390, 844], [768, 1024], [1024, 768],
      [1280, 800], [1440, 900], [720, 450], [512, 384],
    ]
    let geometryCases = 0
    for (const slug of ROUTES) {
      for (const [width, height] of viewports) {
        await geometryPage.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 768 })
        await navigate(geometryPage, `${baseUrl}/internal/page-system/${slug}?geometry=${width}x${height}`)
        const consentRejected = await geometryPage.evaluate(`(() => {
          const dialog = document.querySelector('[role="dialog"][aria-label="Cookie consent"]');
          const reject = dialog ? [...dialog.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Reject') : null;
          reject?.click();
          return Boolean(reject);
        })()`)
        if (consentRejected) await waitFor(() => geometryPage.evaluate("!document.querySelector('[role=\"dialog\"][aria-label=\"Cookie consent\"]')"), 'consent choice did not dismiss')
        const facts = await geometryPage.evaluate(`(() => {
          const dock = document.querySelector('[data-private-review-dock]')?.getBoundingClientRect();
          const actions = [...document.querySelectorAll('[data-hero-action]')].map((action) => {
            const rect = action.getBoundingClientRect();
            const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
            const overlap = dock ? Math.max(0, Math.min(rect.right, dock.right) - Math.max(rect.left, dock.left)) * Math.max(0, Math.min(rect.bottom, dock.bottom) - Math.max(rect.top, dock.top)) : 0;
            return { label: action.textContent.trim(), top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height, hit: action === hit || action.contains(hit), hitTag: hit?.tagName, hitClass: hit?.className, overlap };
          });
          const crumbs = [...document.querySelectorAll('.ps-breadcrumbs a')].map((anchor) => {
            const rect = anchor.getBoundingClientRect(); return { width: rect.width, height: rect.height, name: anchor.textContent.trim() };
          });
          return { innerHeight, clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, actions, crumbs };
        })()`)
        assert(facts.actions.length >= 1, `${slug} ${width}x${height} exposes a hero action`)
        for (const action of facts.actions) {
          assert(action.top >= 0 && action.bottom <= height + 1, `${slug} ${width}x${height} action ${action.label} is in the initial viewport`)
          assert(action.width >= 44 && action.height >= 44, `${slug} ${width}x${height} action ${action.label} is at least 44px`)
          assert(action.hit, `${slug} ${width}x${height} action ${action.label} center hit reaches the action; got ${action.hitTag}.${action.hitClass}`)
          assert.equal(action.overlap, 0, `${slug} ${width}x${height} action ${action.label} is clear of the dock`)
        }
        for (const crumb of facts.crumbs) assert(crumb.width >= 44 && crumb.height >= 44, `${slug} ${width}x${height} breadcrumb ${crumb.name} is at least 44px`)
        assert(facts.scrollWidth <= facts.clientWidth + 1, `${slug} ${width}x${height} has no horizontal overflow`)
        geometryCases += 1
      }
    }
    process.stdout.write(`PASS browser geometry and hit testing (${geometryCases}/24)\n`)

    await geometryPage.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
    await navigate(geometryPage, `${baseUrl}/internal/page-system/explorer-event-guide?tool=explorer`)
    await geometryPage.evaluate(`(() => { for (const input of document.querySelectorAll('input[type="radio"][value="Works for this plan"]')) input.click(); })()`)
    await waitFor(() => geometryPage.evaluate("document.querySelector('#plan-fit-result-heading')?.textContent === 'Strong fit'"), 'Explorer all-works result')
    await geometryPage.evaluate(`document.querySelector('input[type="radio"][value="Does not work"]')?.click()`)
    await waitFor(() => geometryPage.evaluate("document.querySelector('#plan-fit-result-heading')?.textContent === 'Poor fit'"), 'Explorer failure precedence')
    await geometryPage.evaluate(`document.querySelector('.ps-faq summary')?.focus()`)
    await dispatchKey(geometryPage, 'Enter')
    assert.equal(await geometryPage.evaluate("document.querySelector('.ps-faq')?.open"), true, 'FAQ opens by keyboard')
    process.stdout.write('PASS Explorer deterministic logic and keyboard FAQ semantics\n')

    await navigate(geometryPage, `${baseUrl}/internal/page-system/host-event-promoter-guide?tool=host`)
    await waitFor(() => geometryPage.evaluate("document.querySelector('.ps-host-image-frame')?.dataset.mediaState === 'loaded'"), 'Host guide did not hydrate before tool interaction')
    await geometryPage.evaluate(`(() => { for (const input of document.querySelectorAll('input[type="radio"][value="Ready"]')) input.click(); })()`)
    await waitFor(() => geometryPage.evaluate("document.querySelector('#launch-result-heading')?.textContent === 'All applicable items marked ready'"), 'Host all-ready result')
    await geometryPage.evaluate(`document.querySelector('input[type="radio"][value="Needs attention"]')?.click()`)
    await waitFor(() => geometryPage.evaluate("document.querySelector('.ps-attention-groups li') !== null"), 'Host attention grouping')
    process.stdout.write('PASS Host deterministic logic and attention grouping\n')
    geometryPage.close()

    const motionPage = await createPage(debugPort)
    await motionPage.send('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    await navigate(motionPage, `${baseUrl}/internal/page-system/explorer-event-guide?motion=reduced`)
    const reduced = await motionPage.evaluate(`(() => { const wheel = document.querySelector('.ps-check-wheel'); return { matches: matchMedia('(prefers-reduced-motion: reduce)').matches, animation: getComputedStyle(wheel).animationName, transition: getComputedStyle(wheel).transitionDuration, h1Opacity: getComputedStyle(document.querySelector('h1')).opacity }; })()`)
    assert.equal(reduced.matches, true)
    assert.equal(reduced.animation, 'none')
    assert.equal(reduced.transition, '0s')
    assert.equal(reduced.h1Opacity, '1')
    await motionPage.send('Emulation.setEmulatedMedia', { media: 'screen', features: [] })
    await motionPage.evaluate(`window.scrollTo(0, document.body.scrollHeight)`)
    await waitFor(() => motionPage.evaluate("document.querySelector('.ps-montage')?.dataset.motionActive === 'false'"), 'offscreen montage pause')
    motionPage.close()
    process.stdout.write('PASS reduced and offscreen motion states\n')

    const warm = await createPage(debugPort)
    await navigate(warm, `${baseUrl}/internal/page-system/host-event-promoter-guide?media=warm-prime`)
    const warmed = await waitFor(async () => {
      const snapshot = await warm.evaluate(mediaSnapshotExpression())
      return snapshot.state === 'loaded' && snapshot
    }, 'warm-cache prime did not load')
    assertMediaSnapshot(warmed, 'loaded')
    await warm.send('Page.reload', { ignoreCache: false })
    const warmReload = await waitFor(async () => {
      const snapshot = await warm.evaluate(mediaSnapshotExpression())
      return snapshot.state === 'loaded' && snapshot
    }, 'warm-cache reload did not settle loaded')
    assertMediaSnapshot(warmReload, 'loaded')
    await warm.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
    await new Promise((resolve) => setTimeout(resolve, 150))
    assertMediaSnapshot(await warm.evaluate(mediaSnapshotExpression()), 'loaded')
    await warm.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
    warm.close()
    process.stdout.write('PASS warm-cache media and offline-after-load retention\n')

    const preHydrationSuccess = await runPreHydrationMediaCase(debugPort, baseUrl, 'loaded')
    process.stdout.write('PASS pre-hydration successful media reconciliation\n')
    const preHydrationFailure = await runPreHydrationMediaCase(debugPort, baseUrl, 'failed')
    process.stdout.write('PASS pre-hydration failed media reconciliation\n')
    await runCorruptAndSlowMediaCases(debugPort, baseUrl)
    process.stdout.write('PASS corrupt and slow media terminal-state handling\n')

    process.stdout.write(`PASS browser matrix geometry=${geometryCases}/24 media=warm+prehydrate-success+prehydrate-failure+corrupt+slow+offline\n`)
    process.stdout.write(`EVIDENCE prehydrate-loaded-before=${JSON.stringify(preHydrationSuccess.beforeHydration)} terminal=${JSON.stringify(preHydrationSuccess.terminal)}\n`)
    process.stdout.write(`EVIDENCE prehydrate-failed-before=${JSON.stringify(preHydrationFailure.beforeHydration)} terminal=${JSON.stringify(preHydrationFailure.terminal)}\n`)
  } finally {
    const stop = (child) => {
      if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL')
          resolve()
        }, 2_000)
        child.once('exit', () => {
          clearTimeout(timer)
          resolve()
        })
        child.kill('SIGTERM')
      })
    }
    await Promise.allSettled([stop(server), stop(chrome)])
    fs.rmSync(profile, { recursive: true, force: true })
  }
}

assert(fs.existsSync(path.join(ROOT, '.next', 'BUILD_ID')), 'production build is required')
for (const route of ROUTES) assertFivePrintSafeFaqPairs(route)

process.stdout.write('PASS issue #2990 tester adversarial built-artifact FAQ parity (15/15 print answers)\n')

if (BROWSER_MODE) await runBrowserContract()
