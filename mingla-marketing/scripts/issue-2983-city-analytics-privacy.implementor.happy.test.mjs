#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import ts from 'typescript'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = fileURLToPath(import.meta.url)
const SOURCE_ONLY = process.argv.includes('--source-only')
const BUILT_ONLY = process.argv.includes('--built-only')
const ARTIFACT_ONLY = process.argv.includes('--artifact-only')
const PORTABILITY_SELF_TEST = process.argv.includes('--portability-self-test')
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const CANARIES = [
  'never_send',
  'person@example.com',
  '6.5244',
  'dur-bound-01',
  'amina-private-reviewer',
  'never-referrer',
]
const CITY_EVENTS = new Set([
  'city_hub_view',
  'city_hub_explorer_action',
  'city_hub_host_action',
  'city_hub_inventory_action',
  'city_hub_switch_city',
])

const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')

function loadAnalyticsContract() {
  const compiled = ts.transpileModule(read('lib/city-hub-analytics.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} }
  Function('module', 'exports', compiled)(module, module.exports)
  return module.exports
}

function sourceContract() {
  const analytics = loadAnalyticsContract()
  const validDestinations = {
    city_hub_view: 'city_hub',
    city_hub_explorer_action: 'explorer_qr',
    city_hub_host_action: 'host_web',
    city_hub_inventory_action: 'place',
    city_hub_switch_city: 'city_hub',
  }
  assert.deepEqual([...analytics.CITY_HUB_ANALYTICS_EVENTS], [...CITY_EVENTS], 'binding five-event allowlist drifted')
  for (const [event, destination_type] of Object.entries(validDestinations)) {
    const result = analytics.sanitizeCityHubAnalytics(event, {
      city_slug: 'lagos',
      country_code: 'NG',
      page_family: 'city_hub',
      destination_type,
      secret_query: 'never_send',
      evidence_id: 'DUR-BOUND-01',
      reviewer: 'amina-private-reviewer',
      latitude: 6.5244,
    })
    assert.deepEqual(result, {
      event,
      properties: {
        city_slug: 'lagos',
        country_code: 'NG',
        page_family: 'city_hub',
        destination_type,
      },
    }, `${event} did not reduce to the closed property allowlist`)
  }
  const base = {
    city_slug: 'lagos',
    country_code: 'NG',
    page_family: 'city_hub',
    destination_type: 'city_hub',
  }
  for (const [label, event, mutation] of [
    ['unapproved event', 'consent_granted', {}],
    ['destination/event mismatch', 'city_hub_view', { destination_type: 'host_web' }],
    ['uppercase slug', 'city_hub_view', { city_slug: 'Lagos' }],
    ['invalid country', 'city_hub_view', { country_code: 'Nigeria' }],
    ['wrong family', 'city_hub_view', { page_family: 'marketing' }],
  ]) {
    assert.equal(analytics.sanitizeCityHubAnalytics(event, { ...base, ...mutation }), null, `${label} must fail closed`)
  }
  assert.equal(analytics.isCityHubPathname('/cities/lagos'), true)
  assert.equal(analytics.isCityHubPathname('/cities/lagos/'), true)
  assert.equal(analytics.isCityHubPathname('/cities/Lagos'), false)
  assert.equal(analytics.isCityHubPathname('/cities/lagos?secret_query=never_send'), false)

  const provider = read('components/marketing/posthog-provider.tsx')
  const actions = read('components/cities/city-actions.tsx')
  const layout = read('app/layout.tsx')
  const packageJson = JSON.parse(read('package.json'))
  for (const contract of [
    /capture_pageview: cityHub \? false : true/,
    /capture_pageleave: cityHub \? false : true/,
    /autocapture: cityHub \? false : true/,
    /disable_session_recording: cityHub \? true : false/,
    /maskAllInputs: true/,
    /person_profiles: cityHub \? 'never' : 'identified_only'/,
    /before_send: routeAwarePostHogBeforeSend/,
    /send_page_view: false/,
    /page_location: pageLocation/,
    /page_referrer: ''/,
    /if \(!isCityHubPathname\(window\.location\.pathname\)\) posthog\.capture\('\$pageview'\)/,
    /if \(isCityHubPathname\(window\.location\.pathname\)\) return/,
    /transport: 'XHR'/,
  ]) assert.match(provider, contract)
  assert.match(layout, /<PostHogProvider>\s*<GoogleAnalytics gaId=\{GA4_MEASUREMENT_ID\} \/>\s*<\/PostHogProvider>/)
  assert.match(actions, /subscribeMarketingConsent\(capture\)/)
  for (const event of CITY_EVENTS) assert.match(`${actions}\n${read('lib/city-hub-analytics.ts')}`, new RegExp(`['"]${event}['"]`))
  assert.match(packageJson.scripts.build, /issue-2983-city-analytics-privacy\.implementor\.happy\.test\.mjs --source-only/)
  assert.match(packageJson.scripts.build, /issue-2983-city-analytics-privacy\.implementor\.happy\.test\.mjs --artifact-only/)
  assert.doesNotMatch(packageJson.scripts.build, /issue-2983-city-analytics-privacy\.implementor\.happy\.test\.mjs --built-only/)
  assert.equal(packageJson.scripts['test:city-analytics'], 'node scripts/issue-2983-city-analytics-privacy.implementor.happy.test.mjs --built-only')
  assert.equal(packageJson.scripts['test:city-analytics:artifact'], 'node scripts/issue-2983-city-analytics-privacy.implementor.happy.test.mjs --artifact-only')
  assert.equal(packageJson.scripts['test:city-analytics:portability'], 'node scripts/issue-2983-city-analytics-privacy.implementor.happy.test.mjs --portability-self-test')
  process.stdout.write('PASS #2983 city analytics privacy source contract\n')
}

function artifactContract() {
  const nextRoot = path.join(ROOT, '.next')
  assert(fs.existsSync(path.join(nextRoot, 'BUILD_ID')), 'run next build before #2983 city analytics artifact proof')
  const manifest = JSON.parse(fs.readFileSync(path.join(nextRoot, 'app-build-manifest.json'), 'utf8'))
  const rootLayoutFiles = manifest.pages?.['/layout']?.filter((entry) => entry.endsWith('.js')) ?? []
  assert(rootLayoutFiles.length > 0, 'compiled root layout chunks missing from app build manifest')
  const rootLayoutBundle = rootLayoutFiles
    .map((relative) => fs.readFileSync(path.join(nextRoot, relative), 'utf8'))
    .join('\n')
  for (const token of [
    ...CITY_EVENTS,
    'city_hub_anonymous',
    'city_slug',
    'country_code',
    'destination_type',
    'send_page_view',
    'page_referrer',
    'capture_pageview',
    'capture_pageleave',
    'autocapture',
    'disable_session_recording',
    'person_profiles',
    'mingla_consent_v1',
  ]) assert(rootLayoutBundle.includes(token), `compiled root analytics owner missing ${token}`)

  const cityOutput = path.join(nextRoot, 'server', 'app', 'cities')
  const cityHtmlFiles = fs.readdirSync(cityOutput).filter((entry) => entry.endsWith('.html')).sort()
  assert.equal(cityHtmlFiles.length, 10, 'browserless proof expected all ten compiled city HTML artifacts')
  for (const cityHtmlFile of cityHtmlFiles) {
    const html = fs.readFileSync(path.join(cityOutput, cityHtmlFile), 'utf8')
    assert(!/googletagmanager\.com|google-analytics\.com|posthog\.com/.test(html), `${cityHtmlFile} eagerly renders an analytics vendor`)
  }
  process.stdout.write('PASS #2983 browserless compiled analytics artifact (root owner present; 10/10 city HTML files vendor-dark)\n')
}

function portabilitySelfTest() {
  const missingChrome = path.join(os.tmpdir(), 'mingla-2983-intentionally-missing-chrome')
  const env = { ...process.env, CHROME_BIN: missingChrome }
  const artifact = spawnSync(process.execPath, [SCRIPT, '--artifact-only'], { cwd: ROOT, env, encoding: 'utf8' })
  assert.equal(artifact.status, 0, `browserless artifact mode required Chrome:\n${artifact.stdout}${artifact.stderr}`)
  assert.match(artifact.stdout, /PASS #2983 browserless compiled analytics artifact/)
  const browser = spawnSync(process.execPath, [SCRIPT, '--built-only'], { cwd: ROOT, env, encoding: 'utf8' })
  assert.notEqual(browser.status, 0, 'full browser mode silently passed without Chrome')
  assert.match(`${browser.stdout}${browser.stderr}`, /Chrome executable not found/)
  process.stdout.write('PASS #2983 analytics portability split (artifact mode browserless; full browser mode fails closed without Chrome)\n')
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
      const handlers = this.handlers.get(message.method) ?? []
      for (const handler of handlers) {
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

const gaMock = `(() => {
  const layer = window.dataLayer = window.dataLayer || [];
  const send = (entry) => {
    const command = entry && entry[0];
    const name = entry && entry[1];
    const properties = entry && entry[2] && typeof entry[2] === 'object' ? entry[2] : {};
    if (command === 'config' && properties.send_page_view !== false) {
      fetch('https://analytics.google.com/g/collect?en=page_view', {
        method: 'POST', mode: 'no-cors', body: JSON.stringify({
          event: 'page_view',
          properties,
          page_location: Object.hasOwn(properties, 'page_location') ? properties.page_location : window.location.href,
          page_referrer: Object.hasOwn(properties, 'page_referrer') ? properties.page_referrer : document.referrer,
        }),
      });
    }
    if (command === 'event') {
      fetch('https://analytics.google.com/g/collect?en=' + encodeURIComponent(name), {
        method: 'POST', mode: 'no-cors', body: JSON.stringify({
          event: name,
          properties,
          page_location: Object.hasOwn(properties, 'page_location') ? properties.page_location : window.location.href,
          page_referrer: Object.hasOwn(properties, 'page_referrer') ? properties.page_referrer : document.referrer,
        }),
      });
    }
  };
  layer.slice().forEach(send);
  const originalPush = layer.push.bind(layer);
  layer.push = function (...entries) {
    entries.forEach(send);
    return originalPush(...entries);
  };
})();`

const vendorBodyRecorder = `(() => {
  const records = window.__minglaAnalyticsBodies = [];
  const record = (url, body) => {
    const target = String(url || '');
    if (!/(?:google-analytics\.com|us\.i\.posthog\.com)/.test(target)) return;
    const entry = { url: target, body: '' };
    records.push(entry);
    if (body instanceof Blob) body.text().then((text) => { entry.body = text; });
    else if (typeof body === 'string') entry.body = body;
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
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__minglaUrl = String(url);
    return nativeOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (body) {
    record(this.__minglaUrl, body);
    return nativeSend.call(this, body);
  };
  const nativeBeacon = navigator.sendBeacon?.bind(navigator);
  if (nativeBeacon) navigator.sendBeacon = (url, body) => {
    record(url, body);
    return nativeBeacon(url, body);
  };
})();`

function fulfillmentBody(value) {
  return Buffer.from(value).toString('base64')
}

function decodedPacket(packet) {
  let value = `${packet.url}\n${packet.body ?? ''}`
  for (let pass = 0; pass < 3; pass += 1) {
    try {
      const decoded = decodeURIComponent(value.replace(/\+/g, ' '))
      if (decoded === value) break
      value = decoded
    } catch {
      break
    }
  }
  return value.toLocaleLowerCase('en')
}

function parsedBody(packet) {
  if (!packet.body) return null
  try {
    return JSON.parse(packet.body)
  } catch {
    const form = new URLSearchParams(packet.body)
    const data = form.get('data')
    if (!data) return null
    try {
      return JSON.parse(Buffer.from(data, 'base64').toString('utf8'))
    } catch {
      return null
    }
  }
}

function assertPacketsMinimized(packets) {
  for (const packet of packets) {
    const decoded = decodedPacket(packet)
    for (const canary of CANARIES) {
      assert(!decoded.includes(canary), `${packet.vendor} leaked forbidden canary ${canary}: ${decoded}`)
    }
  }
}

async function runtimeContract() {
  assert(fs.existsSync(CHROME), `Chrome executable not found at ${CHROME}`)
  assert(fs.existsSync(path.join(ROOT, '.next', 'BUILD_ID')), 'run next build before #2983 city analytics runtime proof')
  const serverPort = await availablePort()
  const debugPort = await availablePort()
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mingla-2983-analytics-'))
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
  const packets = []
  const networkBodies = new Map()
  let page
  try {
    await waitFor(async () => (await request(serverPort, '/robots.txt')) === 200, 'Next server did not start')
    await waitFor(async () => (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok, 'Chrome did not start')
    page = await createPage(debugPort)
    await page.send('Network.enable')
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: vendorBodyRecorder })
    page.on('Network.requestWillBeSent', ({ requestId, request: networkRequest }) => {
      const entry = networkRequest.postDataEntries?.[0]
      const body = networkRequest.postData
        ?? (typeof entry?.bytes === 'string' ? Buffer.from(entry.bytes, 'base64').toString('utf8') : '')
      if (body) networkBodies.set(requestId, body)
    })
    page.on('Fetch.requestPaused', async ({ request: pausedRequest, requestId, networkId }) => {
      const url = pausedRequest.url
      const postData = pausedRequest.postData ?? networkBodies.get(networkId) ?? (networkId
        ? await page.send('Network.getRequestPostData', { requestId: networkId })
          .then((result) => result.postData ?? '')
          .catch(() => '')
        : '')
      if (url.startsWith('https://www.googletagmanager.com/gtag/js')) {
        packets.push({ vendor: 'ga-script', url, body: postData })
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
      if (/^https:\/\/(?:analytics\.google\.com|www\.google-analytics\.com)\//.test(url)) {
        packets.push({ vendor: 'ga', url, body: postData })
      } else if (/^https:\/\/(?:us\.i|us-assets\.i)\.posthog\.com\//.test(url)) {
        packets.push({ vendor: 'posthog', url, body: postData })
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
    const pathWithCanaries = '/cities/lagos?secret_query=never_send&email=person%40example.com&lat=6.5244&evidence=DUR-BOUND-01&reviewer=amina-private-reviewer'
    await page.send('Page.navigate', {
      url: `http://127.0.0.1:${serverPort}${pathWithCanaries}`,
      referrer: `http://127.0.0.1:${serverPort}/?referrer=never-referrer`,
    })
    await waitFor(() => page.evaluate("document.readyState === 'complete' && Boolean(document.querySelector('[aria-label=\"Cookie consent\"]'))"), 'city consent UI did not become ready')
    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.deepEqual(packets, [], 'city analytics network must remain completely dark before consent')

    await page.evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent.trim() === 'Accept all');
      if (!button) throw new Error('Accept all button missing');
      button.click();
    })()`)
    await waitFor(() => packets.some((packet) => packet.vendor === 'ga'), 'post-consent GA event did not reach the mock collector')
    await new Promise((resolve) => setTimeout(resolve, 300))
    if (process.env.NEXT_PUBLIC_POSTHOG_KEY) {
      await waitFor(
        () => page.evaluate(`window.__minglaAnalyticsBodies?.some((entry) =>
          entry.url.includes('us.i.posthog.com') && entry.body.includes('city_hub_view'))`),
        `post-consent PostHog event did not reach the mock collector: ${JSON.stringify(packets)}`,
      )
    }
    const recordedBodies = await page.evaluate('window.__minglaAnalyticsBodies ?? []')
    const unmatchedBodies = [...recordedBodies]
    for (const packet of packets) {
      if (packet.body) continue
      const matchIndex = unmatchedBodies.findIndex((entry) => entry.url === packet.url && entry.body)
      if (matchIndex === -1) continue
      packet.body = unmatchedBodies.splice(matchIndex, 1)[0].body
    }
    assertPacketsMinimized(packets)

    await page.evaluate(`(() => {
      const explorer = document.querySelector('.city-hero-actions button, .city-hero-actions a');
      explorer?.addEventListener('click', (event) => event.preventDefault(), { once: true });
      explorer?.click();
      const host = document.querySelector('.city-hero-actions a:nth-of-type(2), .city-hero-actions a[href*="host.usemingla.com"]');
      host?.addEventListener('click', (event) => event.preventDefault(), { once: true });
      host?.click();
    })()`)
    await waitFor(() => {
      const bodies = packets.map(parsedBody).filter(Boolean)
      return bodies.some((body) => body.event === 'city_hub_explorer_action') && bodies.some((body) => body.event === 'city_hub_host_action')
    }, 'city Explorer and Host actions did not reach the mock collectors')
    await new Promise((resolve) => setTimeout(resolve, 250))

    const actionBodies = await page.evaluate('window.__minglaAnalyticsBodies ?? []')
    for (const packet of packets) {
      if (packet.body) continue
      const matchIndex = actionBodies.findIndex((entry) => entry.url === packet.url && entry.body)
      if (matchIndex !== -1) packet.body = actionBodies.splice(matchIndex, 1)[0].body
    }

    assert.deepEqual(page.eventErrors, [], 'CDP interception failed')
    assertPacketsMinimized(packets)
    const eventPackets = packets
      .filter((packet) => packet.vendor === 'ga' || packet.vendor === 'posthog')
      .map((packet) => ({ ...packet, parsed: parsedBody(packet) }))
      .filter((packet) => typeof packet.parsed?.event === 'string')
    assert(eventPackets.length > 0, 'mock collectors captured no analytics events')
    for (const packet of eventPackets) {
      assert(CITY_EVENTS.has(packet.parsed.event), `${packet.vendor} emitted forbidden city event ${packet.parsed.event}`)
      const properties = packet.parsed.properties
      assert.equal(properties.city_slug, 'lagos')
      assert.equal(properties.country_code, 'NG')
      assert.equal(properties.page_family, 'city_hub')
      assert.equal(typeof properties.destination_type, 'string')
      const vendorContextKeys = packet.vendor === 'posthog'
        ? ['distinct_id', 'token']
        : ['page_location', 'page_referrer']
      assert.deepEqual(
        Object.keys(properties).sort(),
        ['city_slug', 'country_code', 'destination_type', 'page_family', ...vendorContextKeys].sort(),
        `${packet.vendor} emitted an arbitrary city property`,
      )
      if (packet.vendor === 'posthog') assert.equal(properties.distinct_id, 'city_hub_anonymous')
      else {
        assert.equal(properties.page_location, 'https://usemingla.com/cities/lagos')
        assert.equal(properties.page_referrer, '')
      }
    }
    for (const event of ['city_hub_view', 'city_hub_explorer_action', 'city_hub_host_action']) {
      assert(eventPackets.some((packet) => packet.vendor === 'ga' && packet.parsed.event === event), `GA missing ${event}`)
      if (process.env.NEXT_PUBLIC_POSTHOG_KEY) {
        assert(eventPackets.some((packet) => packet.vendor === 'posthog' && packet.parsed.event === event), `PostHog missing ${event}`)
      }
    }
    process.stdout.write(`PASS #2983 city analytics privacy (${packets.length} mocked vendor requests; pre-consent dark; post-consent city event and canary allowlists clean)\n`)
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

const selectedModes = [SOURCE_ONLY, BUILT_ONLY, ARTIFACT_ONLY, PORTABILITY_SELF_TEST].filter(Boolean).length
assert(selectedModes <= 1, 'choose only one #2983 analytics guard mode')
if (PORTABILITY_SELF_TEST) {
  portabilitySelfTest()
} else if (SOURCE_ONLY) {
  sourceContract()
} else if (ARTIFACT_ONLY) {
  artifactContract()
} else {
  if (!BUILT_ONLY) sourceContract()
  await runtimeContract()
  process.exit(0)
}
