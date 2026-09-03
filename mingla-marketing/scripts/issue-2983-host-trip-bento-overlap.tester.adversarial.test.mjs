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
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

function sourceContract() {
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
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'browser evaluation failed')
    return result.result.value
  }

  close() {
    this.socket.close()
  }
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

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  await new Promise((resolve) => {
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
  let page
  try {
    if (serverPort) {
      await waitFor(async () => (await request(serverPort, '/robots.txt')) === 200, 'Next server did not start')
    }
    await waitFor(async () => (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok, 'Chrome did not start')
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
  } finally {
    page?.close()
    await Promise.allSettled([stopChild(chrome), stopChild(server)])
    fs.rmSync(profile, { recursive: true, force: true })
    if (server && server.exitCode && server.exitCode !== 0 && server.signalCode !== 'SIGTERM') {
      process.stderr.write(serverOutput)
    }
  }
}

if (!BUILT_ONLY) sourceContract()
if (!SOURCE_ONLY) await runtimeContract()
