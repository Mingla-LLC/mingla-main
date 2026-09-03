#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_ONLY = process.argv.includes('--source-only')
const BUILT_ONLY = process.argv.includes('--built-only')
const SELF_TEST = process.argv.includes('--self-test')
const CITY_SLUGS = [
  'lagos', 'durham-nc', 'cary-nc', 'raleigh-nc', 'new-york-city',
  'brussels', 'paris', 'london', 'fort-lauderdale', 'washington-dc',
]
const CITY_NAMES = [
  'Lagos', 'Durham', 'Cary', 'Raleigh', 'New York City',
  'Brussels', 'Paris', 'London', 'Fort Lauderdale', 'Washington, DC',
]
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const decode = (value) => value.replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#x27;|&#39;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
const visibleText = (html) => decode(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').replace(/\s+([.,!?])/g, '$1').trim()

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
  assert.match(registry, /record\.scopeApproval !== 'approved'/)
  assert.match(registry, /record\.localReview\.status !== 'reviewed'/)
  assert.match(registry, /claim\.evidenceIds\.every\(\(id\) => evidenceIds\.has\(id\)\)/)
  assert.match(registry, /record\.media\.some\(\(item\) => !item\.commercialRights\)/)
  assert.match(registry, /record\.inventory\.some\(\(item\) => item\.lifecycle !== 'search_ready'\)/)

  assert.match(routeRegistry, /export const CITY_ROUTE_CONTRACTS[\s\S]*CITY_HUBS\.map/)
  assert.match(routeRegistry, /\.\.\.CITY_ROUTE_CONTRACTS/)
  assert.match(metadata, /follow: true/)
  assert.match(metadata, /record\.wasSearchReady/)
  assert.match(page, /generateStaticParams/)
  assert.match(page, /if \(!record\) notFound\(\)/)
  assert.match(page, /structuredData \? \(/)
  assert.match(schema, /if \(!isCityHubSearchReady\(record\)\) return null/)
  assert.match(schema, /JSON\.stringify\(value\)\.replace\(\/<\/g, '\\\\u003c'\)/)
  assert(!fs.existsSync(path.join(ROOT, 'app/cities/page.tsx')), '#3000 owns /cities; #2983 must not add it')

  assert.match(hub, /Find the right plan in \{record\.city\}\./)
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

async function runtimeContract() {
  assert(fs.existsSync(path.join(ROOT, '.next', 'BUILD_ID')), 'run next build before the #2983 built contract')
  const port = await availablePort()
  const child = spawn(process.execPath, [path.join(ROOT, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk })
  child.stderr.on('data', (chunk) => { output += chunk })
  try {
    await waitReady(port, child)
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
    process.stdout.write('PASS #2983 all ten runtime routes, crawler/query parity, noindex and atomic discovery gates\n')
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
  process.stdout.write('PASS #2983 guard self-test rejects city removal and premature promotion\n')
} else {
  if (!BUILT_ONLY) sourceContract()
  if (!SOURCE_ONLY) await runtimeContract()
}
