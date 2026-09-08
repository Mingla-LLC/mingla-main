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
const CITY_EVENTS = [
  'city_hub_view',
  'city_hub_explorer_action',
  'city_hub_host_action',
  'city_hub_inventory_action',
  'city_hub_switch_city',
]
const CANARIES = [
  'warm-query-2983',
  'warm.person.2983@example.invalid',
  '6.5244',
  'warm-evidence-2983',
  'warm-reviewer-2983',
  'warm-referrer-2983',
]

const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')

function sourceContract() {
  const pkg = JSON.parse(read('package.json'))
  const css = read('components/cities/city-hubs.css')
  const provider = read('components/marketing/posthog-provider.tsx')
  const testerName = 'issue-2983-city-release.tester.adversarial.test.mjs'

  assert.match(pkg.scripts.build, new RegExp(`${testerName.replaceAll('.', '\\.') } --source-only`))
  assert.doesNotMatch(pkg.scripts.build, new RegExp(`${testerName.replaceAll('.', '\\.') } --built-only`))
  assert.equal(
    pkg.scripts['test:city-analytics'],
    'node scripts/issue-2983-city-analytics-privacy.implementor.happy.test.mjs --built-only',
    'implementor-owned city analytics command must remain exact',
  )
  assert.equal(pkg.scripts['test:city-release'], `node scripts/${testerName} --built-only`)
  assert.match(provider, /before_send: routeAwarePostHogBeforeSend/)
  assert.match(provider, /capture_pageview: cityHub \? false : true/)
  assert.match(provider, /send_page_view: false/)
  assert.match(provider, /page_referrer: ''/)
  assert.match(css, /\.city-breadcrumbs a \{[^}]*min-width: 44px;[^}]*min-height: 44px;/s)
  assert.match(css, /\.city-faq-print-answer \{[^}]*display: block !important;/s)
  process.stdout.write('PASS #2983 tester source guard: automatic wiring and repaired privacy/UI contracts\n')
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

async function waitFor(check, message, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const value = await check()
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
    this.handlers = new Map()
    this.eventErrors = []
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
      for (const handler of this.handlers.get(message.method) ?? []) {
        void Promise.resolve(handler(message.params)).catch((error) => this.eventErrors.push(error))
      }
    })
  }

  on(method, handler) {
    const handlers = this.handlers.get(method) ?? []
    handlers.push(handler)
    this.handlers.set(method, handlers)
  }

  async send(method, params = {}) {
    await this.ready
    const id = this.nextId++
    const response = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
    this.socket.send(JSON.stringify({ id, method, params }))
    return response
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
  await page.send('Page.enable')
  await page.send('Runtime.enable')
  return page
}

function fulfillmentBody(value) {
  return Buffer.from(value).toString('base64')
}

const gaMock = `(() => {
  const layer = window.dataLayer = window.dataLayer || [];
  const send = (entry) => {
    if (!entry) return;
    const command = entry[0];
    const name = entry[1];
    const properties = entry[2] && typeof entry[2] === 'object' ? entry[2] : {};
    if (command === 'config' && properties.send_page_view !== false) {
      fetch('https://analytics.google.com/g/collect?en=page_view', {
        method: 'POST', mode: 'no-cors', body: JSON.stringify({
          event: 'page_view', properties,
          page_location: Object.hasOwn(properties, 'page_location') ? properties.page_location : location.href,
          page_referrer: Object.hasOwn(properties, 'page_referrer') ? properties.page_referrer : document.referrer,
        }),
      });
    }
    if (command === 'event') {
      fetch('https://analytics.google.com/g/collect?en=' + encodeURIComponent(name), {
        method: 'POST', mode: 'no-cors', body: JSON.stringify({
          event: name, properties,
          page_location: Object.hasOwn(properties, 'page_location') ? properties.page_location : location.href,
          page_referrer: Object.hasOwn(properties, 'page_referrer') ? properties.page_referrer : document.referrer,
        }),
      });
    }
  };
  layer.slice().forEach(send);
  const push = layer.push.bind(layer);
  layer.push = (...entries) => { entries.forEach(send); return push(...entries); };
})();`

const browserRecorder = `(() => {
  localStorage.setItem('mingla_consent_v1', JSON.stringify({ value: 'granted', ts: Date.now() }));
  window.__tester2983Packets = [];
  const record = (url, body) => {
    const target = String(url || '');
    if (!/(?:google-analytics\\.com|analytics\\.google\\.com|posthog\\.com)/.test(target)) return;
    const entry = { url: target, body: '' };
    window.__tester2983Packets.push(entry);
    if (body instanceof Blob) body.text().then((text) => { entry.body = text; });
    else if (body instanceof URLSearchParams) entry.body = body.toString();
    else if (body != null) entry.body = String(body);
  };
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    record(typeof input === 'string' ? input : input?.url, init?.body);
    return nativeFetch(input, init);
  };
  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__tester2983Url = String(url);
    return nativeOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function(body) {
    record(this.__tester2983Url, body);
    return nativeSend.call(this, body);
  };
  const nativeBeacon = navigator.sendBeacon?.bind(navigator);
  if (nativeBeacon) navigator.sendBeacon = (url, body) => {
    record(url, body);
    return nativeBeacon(url, body);
  };
})();`

function decodedPacket(packet) {
  let value = `${packet.url}\n${packet.body ?? ''}`
  for (let pass = 0; pass < 4; pass += 1) {
    try {
      const decoded = decodeURIComponent(value.replace(/\+/g, ' '))
      if (decoded === value) break
      value = decoded
    } catch {
      break
    }
  }
  return value.toLowerCase()
}

function assertWarmPackets(packets) {
  const decoded = packets.map(decodedPacket).join('\n')
  for (const canary of CANARIES) assert(!decoded.includes(canary), `warm city transition leaked ${canary}`)
  for (const forbidden of ['$pageview', '$pageleave', '$autocapture', 'consent_granted']) {
    assert(!decoded.includes(forbidden), `warm city transition emitted forbidden event ${forbidden}`)
  }
  const observedCityEvents = CITY_EVENTS.filter((event) => decoded.includes(event))
  assert(observedCityEvents.includes('city_hub_view'), `warm city transition did not emit city_hub_view: ${decoded}`)
}

async function runtimeContract() {
  assert(fs.existsSync(CHROME), `Chrome executable not found at ${CHROME}`)
  assert(fs.existsSync(path.join(ROOT, '.next', 'BUILD_ID')), 'run next build before #2983 tester runtime guard')
  const serverPort = await availablePort()
  const debugPort = await availablePort()
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mingla-2983-tester-'))
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
    '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  let page
  try {
    await waitFor(async () => (await request(serverPort, '/robots.txt')) === 200, 'Next server did not start')
    await waitFor(async () => (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok, 'Chrome did not start')
    page = await createPage(debugPort)
    await page.send('Network.enable')
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: browserRecorder })
    page.on('Fetch.requestPaused', async ({ request, requestId }) => {
      if (request.url.startsWith('https://www.googletagmanager.com/gtag/js')) {
        await page.send('Fetch.fulfillRequest', {
          requestId,
          responseCode: 200,
          responseHeaders: [
            { name: 'content-type', value: 'application/javascript' },
            { name: 'access-control-allow-origin', value: '*' },
          ],
          body: fulfillmentBody(gaMock),
        })
        return
      }
      await page.send('Fetch.fulfillRequest', {
        requestId,
        responseCode: 200,
        responseHeaders: [
          { name: 'content-type', value: 'application/json' },
          { name: 'access-control-allow-origin', value: '*' },
        ],
        body: fulfillmentBody('{}'),
      })
    })
    await page.send('Fetch.enable', { patterns: [
      { urlPattern: 'https://www.googletagmanager.com/*', requestStage: 'Request' },
      { urlPattern: 'https://analytics.google.com/*', requestStage: 'Request' },
      { urlPattern: 'https://www.google-analytics.com/*', requestStage: 'Request' },
      { urlPattern: 'https://us.i.posthog.com/*', requestStage: 'Request' },
      { urlPattern: 'https://us-assets.i.posthog.com/*', requestStage: 'Request' },
    ] })
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 320, height: 844, deviceScaleFactor: 1, mobile: false,
    })

    const cityUrl = `http://127.0.0.1:${serverPort}/cities/lagos?query=warm-query-2983&email=warm.person.2983%40example.invalid&lat=6.5244&evidence=warm-evidence-2983&reviewer=warm-reviewer-2983`
    await page.send('Page.navigate', { url: cityUrl, referrer: `http://127.0.0.1:${serverPort}/?ref=warm-referrer-2983` })
    await waitFor(() => page.evaluate("document.readyState === 'complete' && document.querySelector('.city-breadcrumbs a')?.textContent.trim() === 'Home'"), 'city route did not hydrate')
    await new Promise((resolve) => setTimeout(resolve, 700))
    const analyticsConfigured = await page.evaluate(`Boolean(
      document.querySelector('script[src*="googletagmanager.com/gtag/js"]') ||
      (window.__tester2983Packets ?? []).length
    )`)
    if (analyticsConfigured) {
      await waitFor(() => page.evaluate(`(window.__tester2983Packets ?? []).some((packet) =>
        packet.body.includes('city_hub_view') || packet.body.includes('warm-query-2983') || packet.body.includes('consent_granted'))`), 'configured city analytics did not reach the mock')
      await new Promise((resolve) => setTimeout(resolve, 200))
      assertWarmPackets(await page.evaluate('window.__tester2983Packets ?? []'))

      await page.evaluate("document.querySelector('.city-breadcrumbs a').click()")
      await waitFor(() => page.evaluate("location.pathname === '/' && Boolean(document.querySelector('main'))"), 'breadcrumb did not client-navigate home')
      await new Promise((resolve) => setTimeout(resolve, 200))
      await page.evaluate("window.__tester2983Packets = []; history.back()")
      await waitFor(() => page.evaluate("location.pathname === '/cities/lagos' && Boolean(document.querySelector('.city-hub-root'))"), 'history return did not restore city route')
      await waitFor(() => page.evaluate("(window.__tester2983Packets ?? []).some((packet) => packet.body.includes('city_hub_view'))"), 'warm return city view did not reach mocked analytics')
      await new Promise((resolve) => setTimeout(resolve, 300))
      assertWarmPackets(await page.evaluate('window.__tester2983Packets ?? []'))
    }

    const geometry = await page.evaluate(`(() => {
      const visible = (node) => {
        if (node.closest('details:not([open])')) return false;
        if (node.classList.contains('sr-only') && document.activeElement !== node) return false;
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const failures = [];
      for (const node of document.querySelectorAll('a[href], button:not([disabled]), summary')) {
        if (!visible(node)) continue;
        const rect = node.getBoundingClientRect();
        const horizontalRail = Boolean(node.closest('.ps-filter-rail'));
        if (rect.width < 44 || rect.height < 44 || (!horizontalRail && (rect.left < -0.5 || rect.right > innerWidth + 0.5))) {
          failures.push({ tag: node.tagName, name: node.getAttribute('aria-label') || node.textContent.trim().slice(0, 80), x: rect.x, width: rect.width, height: rect.height });
        }
      }
      return { count: document.querySelectorAll('a[href], button:not([disabled]), summary').length, failures, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth };
    })()`)
    assert(geometry.count > 40, `unexpectedly shallow city action surface: ${JSON.stringify(geometry)}`)
    assert.deepEqual(geometry.failures, [], `320px city actions regressed: ${JSON.stringify(geometry.failures)}`)
    assert.equal(geometry.scrollWidth, geometry.clientWidth, '320px city route has horizontal overflow')

    await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    const focus = await page.evaluate(`(() => {
      const link = document.querySelector('.city-breadcrumbs a');
      link.focus();
      const style = getComputedStyle(link);
      const rect = link.getBoundingClientRect();
      return { active: document.activeElement === link, width: rect.width, height: rect.height, outlineWidth: parseFloat(style.outlineWidth), outlineStyle: style.outlineStyle, outlineOffset: parseFloat(style.outlineOffset) };
    })()`)
    assert.equal(focus.active, true)
    assert(focus.width >= 44 && focus.height >= 44, `breadcrumb target regressed: ${JSON.stringify(focus)}`)
    assert(focus.outlineWidth >= 3 && focus.outlineStyle !== 'none' && focus.outlineOffset >= 2, `breadcrumb focus ring regressed: ${JSON.stringify(focus)}`)

    await page.send('Emulation.setEmulatedMedia', { media: 'print' })
    const print = await page.evaluate(`(() => ({
      answers: [...document.querySelectorAll('.city-faq-print-answer')].map((node) => ({
        display: getComputedStyle(node).display,
        width: node.getBoundingClientRect().width,
        height: node.getBoundingClientRect().height,
        text: node.textContent.trim(),
      })),
    }))()`)
    assert.equal(print.answers.length, 3, `expected three printable FAQ answers: ${JSON.stringify(print)}`)
    for (const answer of print.answers) {
      assert(answer.display !== 'none' && answer.width > 0 && answer.height > 0 && answer.text.length > 80, `print FAQ answer hidden/truncated: ${JSON.stringify(answer)}`)
    }

    assert.deepEqual(page.eventErrors, [], 'CDP interception reported an error')
    const privacyMode = analyticsConfigured ? 'warm route privacy' : 'analytics-unconfigured preview'
    process.stdout.write(`PASS #2983 tester runtime guard: ${privacyMode} + ${geometry.count} actions + focus + 3 printable FAQs\n`)
  } finally {
    page?.close()
    chrome.kill('SIGTERM')
    server.kill('SIGTERM')
    await Promise.all([
      new Promise((resolve) => { chrome.once('exit', resolve); setTimeout(resolve, 1500) }),
      new Promise((resolve) => { server.once('exit', resolve); setTimeout(resolve, 1500) }),
    ])
    fs.rmSync(profile, { recursive: true, force: true })
  }
}

if (!BUILT_ONLY) sourceContract()
if (!SOURCE_ONLY) await runtimeContract()
