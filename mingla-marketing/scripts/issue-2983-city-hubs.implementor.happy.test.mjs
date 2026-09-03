#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_ONLY = process.argv.includes('--source-only')
const BUILT_ONLY = process.argv.includes('--built-only')
const SELF_TEST = process.argv.includes('--self-test')
const BROWSER_MODE = process.argv.includes('--browser')
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const CITY_SLUGS = [
  'lagos', 'durham-nc', 'cary-nc', 'raleigh-nc', 'new-york-city',
  'brussels', 'paris', 'london', 'fort-lauderdale', 'washington-dc',
]
const CITY_NAMES = [
  'Lagos', 'Durham', 'Cary', 'Raleigh', 'New York City',
  'Brussels', 'Paris', 'London', 'Fort Lauderdale', 'Washington, DC',
]
const CASE_VARIANTS = [
  'LAGOS', 'Durham-nc', 'CARY-nc', 'Raleigh-NC', 'NEW-york-city',
  'BRUSSELS', 'Paris', 'LONDON', 'Fort-Lauderdale', 'Washington-DC',
]
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const decode = (value) => value.replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#x27;|&#39;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
const visibleText = (html) => decode(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').replace(/\s+([.,!?])/g, '$1').trim()

function loadRegistryModule(source = read('content/cities/registry.ts')) {
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} }
  new Function('exports', 'module', javascript)(module.exports, module)
  return module.exports
}

function clone(value) {
  return structuredClone(value)
}

function validPromotionFixture(registry, slug = 'durham-nc') {
  const fixture = clone(registry.CITY_HUBS.find((record) => record.slug === slug))
  fixture.lifecycle = 'search_ready'
  fixture.localReview = {
    status: 'reviewed',
    name: 'Amina Verified',
    relationship: `${fixture.city} resident and local editor`,
    reviewedAt: '2026-09-03',
  }
  return fixture
}

function readinessCodes(registry, record) {
  return registry.cityHubReadinessReasons(record, { asOf: '2026-09-03' }).map((reason) => reason.code)
}

function registryIssues(source) {
  const issues = []
  const slugs = [...source.matchAll(/\n\s*slug: '([^']+)'/g)].map((match) => match[1])
  if (JSON.stringify(slugs) !== JSON.stringify(CITY_SLUGS)) issues.push('ten-city slug order changed')
  if ((source.match(/lifecycle: 'public_noindex'/g) ?? []).length !== 10) issues.push('all ten initial lifecycles must stay public_noindex')
  if ((source.match(/utilitySections: \[/g) ?? []).length !== 10) issues.push('every city needs one utility tuple')
  if ((source.match(/hostUtilities: \[/g) ?? []).length !== 10) issues.push('every city needs one Host utility tuple')
  if ((source.match(/scopeApproval: 'founder_pending'/g) ?? []).length !== 2) issues.push('Lagos and Brussels founder holds must remain explicit')
  if ((source.match(/localReview: \{ status: 'pending' \}/g) ?? []).length !== 10) issues.push('all local reviews must remain pending at this checkpoint')
  return issues
}

function sourceContract() {
  const registry = read('content/cities/registry.ts')
  const routeRegistry = read('lib/search/route-registry.ts')
  const metadata = read('lib/search/metadata.ts')
  const schema = read('lib/search/city-schema.ts')
  const middleware = read('middleware.ts')
  const page = read('app/cities/[city]/page.tsx')
  const hub = read('components/cities/city-hub.tsx')
  const actions = read('components/cities/city-actions.tsx')
  const deviceCta = read('components/cutout/device-cta.tsx')
  const hostBar = read('components/page-system/city-host-acquisition-bar.tsx')
  const css = read('components/cities/city-hubs.css')
  const explorerRoot = read('app/(explorer)/page.tsx')
  const hostRoot = read('app/host/page.tsx')
  const packageJson = JSON.parse(read('package.json'))

  assert.deepEqual(registryIssues(registry), [], 'registry lifecycle/identity contract failed')
  for (const name of CITY_NAMES) assert(registry.includes(`city: '${name}'`), `missing city identity ${name}`)
  for (const exact of [
    "locale: 'en-NG', timezone: 'Africa/Lagos', currency: 'NGN'",
    "locale: 'en-BE', timezone: 'Europe/Brussels', currency: 'EUR'",
    "locale: 'en-FR', timezone: 'Europe/Paris', currency: 'EUR'",
    "locale: 'en-GB', timezone: 'Europe/London', currency: 'GBP'",
  ]) assert(registry.includes(exact), `missing formatting identity ${exact}`)
  assert.match(registry, /Build a Bull City day/)
  assert.match(registry, /without turning Cary into “near Raleigh.”/)
  assert.match(registry, /Raleigh city limits/)
  assert.match(registry, /Wake County/)
  assert.doesNotMatch(registry, /city: 'Triangle'|scopeLabel: 'Triangle'/i)
  assert.equal((registry.match(/hostUtilities: \[[\s\S]*?\n\s*\],/g) ?? []).length, 10)
  assert.equal((registry.match(/faqs: \[[\s\S]*?\n\s*\],/g) ?? []).length, 10)
  assert.match(registry, /export function cityHubReadinessReasons/)
  assert.match(registry, /CityHubReadinessReasonCode/)
  for (const reason of [
    'source_url_invalid', 'source_id_duplicate', 'source_unverified', 'source_expired',
    'claim_evidence_not_live', 'faq_content_duplicate', 'reviewer_identity_incomplete',
    'jurisdiction_contract_mismatch', 'boundary_version_invalid', 'content_contract_mismatch',
  ]) assert(registry.includes(`'${reason}'`), `missing fail-closed reason ${reason}`)
  assert.match(registry, /APPROVED_CITY_CONTENT_FINGERPRINTS/)
  assert.match(registry, /directAnswer: \[normalizedContent\(record\.directAnswer\), \[\.\.\.record\.directAnswerEvidenceIds\]\]/)
  assert.equal((registry.match(/\.\.\.evidenceIds/g) ?? []).length, 3, 'utility, Host utility and FAQ mappings must be fingerprinted')
  assert.match(registry, /record\.explorer\.evidenceIds/)
  assert.match(registry, /record\.host\.evidenceIds/)
  assert.match(registry, /CITY_JURISDICTIONS/)
  assert.match(registry, /boundaryEvidenceIds/)
  assert.equal((registry.match(/directAnswerEvidenceIds:/g) ?? []).length, 11, 'type plus all ten direct answers need evidence IDs')
  assert.match(registry, /cityHubEffectiveLifecycle/)
  assert.match(registry, /isStableInventoryHref/)

  assert.match(routeRegistry, /export const CITY_ROUTE_CONTRACTS[\s\S]*CITY_HUBS\.map/)
  assert.match(routeRegistry, /\.\.\.CITY_ROUTE_CONTRACTS/)
  assert.match(routeRegistry, /lifecycle: cityHubEffectiveLifecycle\(record\)/)
  assert.match(routeRegistry, /export function isCityHubCaseVariantPath/)
  assert.match(metadata, /follow: true/)
  assert.match(metadata, /record\.wasSearchReady/)
  assert.match(metadata, /const lifecycle = cityHubEffectiveLifecycle\(record\)/)
  assert.match(page, /generateStaticParams/)
  assert.match(page, /export const dynamicParams = false/)
  assert.match(page, /if \(!record\) notFound\(\)/)
  assert.match(page, /structuredData \? \(/)
  assert.match(schema, /if \(!isCityHubSearchReady\(record\)\) return null/)
  assert.match(schema, /JSON\.stringify\(value\)\.replace\(\/<\/g, '\\\\u003c'\)/)
  assert.match(middleware, /if \(isCityHubCaseVariantPath\(pathname\)\)/)
  assert.match(middleware, /status: 404/)
  assert(!fs.existsSync(path.join(ROOT, 'app/cities/page.tsx')), '#3000 owns /cities; #2983 must not add it')

  assert.match(hub, /Find the right plan in \{record\.city\}\./)
  assert.match(hub, /evidenceIds=\{record\.directAnswerEvidenceIds\}/)
  assert.match(hub, /Choose your Mingla path in \{record\.city\}\./)
  assert.match(hub, /record\.utilitySections\.map/)
  assert.match(hub, /record\.hostUtilities\.map/)
  assert.match(hub, /<details key=\{faq\.question\}/)
  assert.match(hub, /How this \{record\.city\} guide is checked\./)
  assert.match(hub, /Pending — this page is not yet in search/)
  assert.match(hub, /record\.sources\.map/)
  assert.match(hub, /isCityHubSearchReady\(city\)/)
  assert.match(hub, /aria-current="page"/)
  assert.doesNotMatch(hub, /record\.(?:rating|ranking|reviewCount|price|openingHours)|city photograph/i)
  assert.match(hostBar, /city = 'Lagos'/)
  for (const route of ['event/create', 'trip/create', 'experience/create', 'venue/create']) assert(hostBar.includes(`host.usemingla.com/${route}`))

  assert.match(deviceCta, /if \(!hydrated\)[\s\S]*href="\/download"/)
  assert.match(deviceCta, /captureDefaultAnalytics/)
  for (const event of ['city_hub_explorer_action', 'city_hub_host_action', 'city_hub_inventory_action', 'city_hub_switch_city', 'city_hub_view']) {
    assert(actions.includes(event) || hub.includes(event), `missing closed analytics event ${event}`)
  }
  for (const prop of ['city_slug', 'country_code', "page_family: 'city_hub'", 'destination_type']) assert(actions.includes(prop) || hostBar.includes(prop), `missing analytics property ${prop}`)

  assert.match(css, /--city-host-bar-height: calc\(52px \+ env\(safe-area-inset-top\)\)/)
  assert.match(css, /--city-host-bar-height: calc\(56px \+ env\(safe-area-inset-top\)\)/)
  assert.match(css, /\.city-hub-root \.ps-host-acquisition-trigger \{ min-width: 44px; min-height: 44px; \}/)
  assert.match(css, /top: calc\(var\(--city-host-bar-height\) \+ 12px\)/)
  assert.match(css, /\.page-system-root\.city-hub-root\[data-host-acquisition='true'\] \.ps-nav/)
  assert.match(css, /@media \(max-width: 767px\)/)
  assert.match(css, /@media \(min-width: 520px\) and \(max-width: 999px\)/)
  assert.match(css, /grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/)
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\)/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/)

  assert.match(explorerRoot, /showCityLaunch = allCityHubsSearchReady\(\)/)
  assert.match(explorerRoot, /<RootCityGrid surface="explorer"/)
  assert.match(hostRoot, /showCityLaunch = allCityHubsSearchReady\(\)/)
  assert.match(hostRoot, /<RootCityGrid surface="host"/)
  assert(packageJson.scripts.build.includes('issue-2983-city-hubs.implementor.happy.test.mjs --source-only'))
  assert(packageJson.scripts.build.includes('next build && node scripts/issue-2983-city-hubs.implementor.happy.test.mjs --built-only'))
  assert(packageJson.scripts['test:city-hubs'].includes('issue-2983-city-hubs.implementor.happy.test.mjs'))
  assert(packageJson.scripts['test:city-hubs:browser'].includes('--browser'))
  process.stdout.write('PASS #2983 ten-city registry, lifecycle, evidence, UI and root-gate source contract\n')
}

async function availablePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  assert(address && typeof address === 'object')
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return address.port
}

function request(port, pathname, userAgent = 'Mozilla/5.0') {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, headers: { 'Accept-Encoding': 'identity', 'User-Agent': userAgent } }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.once('error', reject)
    req.end()
  })
}

async function waitReady(port, child) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`next start exited with ${child.exitCode}`)
    try { if ((await request(port, '/robots.txt')).status === 200) return } catch {}
    await new Promise((resolve) => setTimeout(resolve, 120))
  }
  throw new Error('next start did not become ready')
}

async function waitFor(predicate, message, timeout = 20_000) {
  const deadline = Date.now() + timeout
  let lastError
  while (Date.now() < deadline) {
    try {
      const value = await predicate()
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

async function navigate(page, url) {
  await page.send('Page.navigate', { url })
  await waitFor(
    () => page.evaluate("document.readyState === 'complete' && Boolean(document.querySelector('h1'))"),
    `page did not become ready: ${url}`,
  )
}

async function browserGeometryContract() {
  assert(fs.existsSync(CHROME), `Chrome executable not found at ${CHROME}`)
  const serverPort = await availablePort()
  const debugPort = await availablePort()
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mingla-2983-chrome-'))
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
    '--hide-scrollbars',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  let page
  try {
    await waitFor(async () => (await request(serverPort, '/robots.txt')).status === 200, 'Next server did not start')
    await waitFor(async () => (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok, 'Chrome did not start')
    page = await createPage(debugPort)
    let cases = 0
    for (const width of [390, 320]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: width === 390 ? 844 : 480, deviceScaleFactor: 1, mobile: true })
      for (const slug of CITY_SLUGS) {
        await navigate(page, `http://127.0.0.1:${serverPort}/cities/${slug}?geometry=${width}`)
        const geometry = await page.evaluate(`(() => {
          const trigger = document.querySelector('.ps-host-acquisition-trigger');
          const bar = document.querySelector('.ps-host-acquisition');
          const triggerRect = trigger?.getBoundingClientRect();
          const barRect = bar?.getBoundingClientRect();
          const hit = triggerRect ? document.elementFromPoint(triggerRect.left + triggerRect.width / 2, triggerRect.top + triggerRect.height / 2) : null;
          return {
            trigger: triggerRect ? { left: triggerRect.left, right: triggerRect.right, width: triggerRect.width, height: triggerRect.height } : null,
            bar: barRect ? { left: barRect.left, right: barRect.right, height: barRect.height } : null,
            hit: Boolean(trigger && hit && (trigger === hit || trigger.contains(hit))),
            clientWidth: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
          };
        })()`)
        assert(geometry.trigger, `${slug} ${width}px exposes Start hosting`)
        assert(geometry.trigger.width >= 44 && geometry.trigger.height >= 44, `${slug} ${width}px Start hosting is at least 44x44; got ${geometry.trigger.width}x${geometry.trigger.height}`)
        assert(geometry.trigger.left >= 0 && geometry.trigger.right <= width, `${slug} ${width}px Start hosting stays on-screen`)
        assert(geometry.hit, `${slug} ${width}px Start hosting center is not obstructed`)
        assert(geometry.bar && Math.abs(geometry.bar.height - 56) <= 1, `${slug} ${width}px keeps the 56px Host bar; got ${geometry.bar?.height}`)
        assert(geometry.scrollWidth <= geometry.clientWidth + 1, `${slug} ${width}px has horizontal overflow`)
        cases += 1
      }
    }
    process.stdout.write(`PASS #2983 rendered mobile Start hosting geometry (${cases}/20 at 390px and 320px)\n`)
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

async function runtimeContract() {
  assert(fs.existsSync(path.join(ROOT, '.next', 'BUILD_ID')), 'run next build before the #2983 built contract')
  const port = await availablePort()
  const child = spawn(process.execPath, [path.join(ROOT, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk })
  child.stderr.on('data', (chunk) => { output += chunk })
  try {
    await waitReady(port, child)
    for (const variant of CASE_VARIANTS) {
      const first = await request(port, `/cities/${variant}`)
      const second = await request(port, `/cities/${variant}`)
      assert.equal(first.status, 404, `/cities/${variant} first cold request must be a stable 404`)
      assert.equal(second.status, 404, `/cities/${variant} repeated request must remain 404`)
    }
    for (let index = 0; index < CITY_SLUGS.length; index += 1) {
      const pathname = `/cities/${CITY_SLUGS[index]}`
      const [browser, crawler, query] = await Promise.all([
        request(port, pathname),
        request(port, pathname, 'Googlebot/2.1 (+http://www.google.com/bot.html)'),
        request(port, `${pathname}?city=lagos&utm_source=guard`),
      ])
      assert.equal(browser.status, 200, `${pathname} must render during public noindex review`)
      assert.equal(crawler.status, 200, `${pathname} crawler parity failed`)
      assert.equal(query.status, 200, `${pathname} query parity failed`)
      const text = visibleText(browser.body)
      assert(text.includes(`Find the right plan in ${CITY_NAMES[index]}.`), `${pathname} lost its exact H1`)
      assert(text.includes('City guide in review'), `${pathname} lost lifecycle notice`)
      assert(text.includes(`Choose your Mingla path in ${CITY_NAMES[index]}.`), `${pathname} lost balanced audience fork`)
      assert(text.includes(`How this ${CITY_NAMES[index]} guide is checked.`), `${pathname} lost evidence panel`)
      assert(text.includes('Pending — this page is not yet in search'), `${pathname} leaked a false local review`)
      assert.equal((browser.body.match(/<h1\b/gi) ?? []).length, 1, `${pathname} needs exactly one H1`)
      assert.equal((browser.body.match(/<details\b/gi) ?? []).length, 3, `${pathname} needs three SSR FAQs`)
      assert.equal((browser.body.match(/<article\b[^>]*city-host-utility-card/gi) ?? []).length, 2, `${pathname} needs two Host utility cards`)
      assert.match(browser.body, /name="robots" content="noindex, follow"|content="noindex, follow" name="robots"/i, `${pathname} must be noindex,follow`)
      assert.doesNotMatch(browser.body, /rel="canonical"/i, `${pathname} must not canonicalise before publication`)
      assert.doesNotMatch(browser.body, /application\/ld\+json/i, `${pathname} must not leak JSON-LD before search_ready`)
      assert.doesNotMatch(browser.body, /(?:LAG|DUR|CARY|RAL|NYC|BRU|PAR|LON|FTL|DC)-(?:BOUND|SCOPE|CULT|EVENT|MOVE|HOST|AUTH)-\d+/i, `${pathname} leaked internal evidence IDs`)
      assert.equal(visibleText(crawler.body), visibleText(browser.body), `${pathname} changed truth for Googlebot`)
      assert(visibleText(query.body).includes(`Find the right plan in ${CITY_NAMES[index]}.`), `${pathname} query changed city identity`)
    }
    assert.equal((await request(port, '/cities')).status, 404, '#3000 still owns /cities')
    assert.equal((await request(port, '/cities/not-a-real-city')).status, 404, 'unknown city must be a real 404')
    const sitemap = await request(port, '/sitemap.xml')
    for (const slug of CITY_SLUGS) assert(!sitemap.body.includes(`/cities/${slug}`), `${slug} leaked into sitemap before search_ready`)
    const [home, host] = await Promise.all([request(port, '/'), request(port, '/host')])
    assert.doesNotMatch(home.body, /city-root-module/, 'Explorer root leaked a partial city module')
    assert.doesNotMatch(host.body, /city-root-module/, 'Host root leaked a partial city module')
    process.stdout.write('PASS #2983 cold exact-case 404s, ten runtime routes, crawler/query parity, noindex and atomic discovery gates\n')
  } finally {
    child.kill('SIGTERM')
    await new Promise((resolve) => { child.once('exit', resolve); setTimeout(resolve, 1500) })
    if (child.exitCode && child.exitCode !== 0) process.stderr.write(output)
  }
}

if (SELF_TEST) {
  const source = read('content/cities/registry.ts')
  assert.equal(registryIssues(source).length, 0)
  const reverted = source.replace(/\n\s*slug: 'washington-dc'[\s\S]*?\n\s*\},\n\] as const/, '\n] as const')
  assert(registryIssues(reverted).length > 0, 'guard must fail when a city record is reverted')
  const promoted = source.replace("slug: 'lagos'", "slug: 'lagos'").replace("lifecycle: 'public_noindex'", "lifecycle: 'search_ready'")
  assert(registryIssues(promoted).length > 0, 'guard must fail premature lifecycle promotion')
  const registry = loadRegistryModule(source)
  const valid = validPromotionFixture(registry)
  assert.deepEqual(readinessCodes(registry, valid), [], 'fully evidenced non-held city promotion fixture must pass')
  assert.equal(registry.isCityHubSearchReady(valid, { asOf: '2026-09-03' }), true)
  assert.equal(registry.cityHubEffectiveLifecycle(valid), 'search_ready')

  const mutations = [
    ['blank source URL', 'source_url_invalid', (record) => { record.sources[0].href = '' }],
    ['duplicate source ID', 'source_id_duplicate', (record) => { record.sources[1].id = record.sources[0].id }],
    ['expired evidence', 'source_expired', (record) => { for (const item of record.sources) item.expiresAt = '2020-01-01' }],
    ['unverified evidence', 'source_unverified', (record) => { record.sources[0].verifiedBy = '' }],
    ['expired record review', 'source_review_invalid', (record) => { record.nextReviewAt = '2020-01-01' }],
    ['claim without live evidence', 'claim_evidence_not_live', (record) => { record.utilitySections[0].evidenceIds = ['MISSING-EVIDENCE'] }],
    ['direct answer without evidence', 'claim_evidence_missing', (record) => { record.directAnswerEvidenceIds = [] }],
    ['direct answer unrelated live-ID swap', 'content_contract_mismatch', (record) => { record.directAnswerEvidenceIds = ['DUR-BOUND-01'] }],
    ['utility unrelated live-ID swap', 'content_contract_mismatch', (record) => { record.utilitySections[0].evidenceIds = ['DUR-BOUND-01'] }],
    ['live evidence-ID reorder', 'content_contract_mismatch', (record) => { record.utilitySections[2].evidenceIds = [...record.utilitySections[2].evidenceIds].reverse() }],
    ['unrelated live evidence-ID addition', 'content_contract_mismatch', (record) => { record.utilitySections[0].evidenceIds = [...record.utilitySections[0].evidenceIds, 'DUR-BOUND-01'] }],
    ['approved live evidence-ID removal', 'content_contract_mismatch', (record) => { record.utilitySections[2].evidenceIds = record.utilitySections[2].evidenceIds.slice(0, -1) }],
    ['duplicated FAQ substitution', 'faq_content_duplicate', (record) => { record.faqs = [clone(record.faqs[0]), clone(record.faqs[0]), clone(record.faqs[0])] }],
    ['substituted direct answer', 'content_contract_mismatch', (record) => { record.directAnswer = registry.CITY_HUBS.find((city) => city.slug === 'cary-nc').directAnswer }],
    ['incomplete reviewer', 'reviewer_identity_incomplete', (record) => { record.localReview.name = '   ' }],
    ['wrong combined-region scope', 'jurisdiction_contract_mismatch', (record) => { record.jurisdictionScope = 'Durham, Cary and Raleigh are one combined Triangle city.' }],
    ['missing boundary version', 'boundary_version_invalid', (record) => { record.jurisdiction.boundaryVersion = '' }],
    ['missing boundary evidence', 'boundary_evidence_missing', (record) => { record.jurisdiction.boundaryEvidenceIds = ['MISSING-BOUNDARY'] }],
  ]
  for (const [name, reason, mutate] of mutations) {
    const invalid = clone(valid)
    mutate(invalid)
    const codes = readinessCodes(registry, invalid)
    assert(codes.includes(reason), `${name} must return ${reason}; got ${codes.join(', ')}`)
    assert.equal(registry.isCityHubSearchReady(invalid, { asOf: '2026-09-03' }), false, `${name} must fail closed`)
    assert.equal(registry.cityHubEffectiveLifecycle(invalid), 'public_noindex', `${name} must remain noindex`)
  }

  for (const slug of ['lagos', 'brussels']) {
    const held = validPromotionFixture(registry, slug)
    assert(readinessCodes(registry, held).includes('scope_approval_pending'), `${slug} founder hold must remain binding`)
    assert.equal(registry.isCityHubSearchReady(held, { asOf: '2026-09-03' }), false)
  }

  const sameSiteInventory = clone(valid)
  sameSiteInventory.inventory = [{ title: 'Verified Durham plan', href: '/plans/verified-durham-plan', lifecycle: 'search_ready' }]
  assert.deepEqual(readinessCodes(registry, sameSiteInventory), [], 'stable same-site child inventory route is valid')
  process.stdout.write(`PASS #2983 guard self-test rejects ${mutations.length} fail-closed promotion mutations and accepts a valid fixture\n`)
} else {
  if (!BUILT_ONLY) sourceContract()
  if (!SOURCE_ONLY) await runtimeContract()
  if (BROWSER_MODE) await browserGeometryContract()
}
