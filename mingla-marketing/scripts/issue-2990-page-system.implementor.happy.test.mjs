#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_ONLY = process.argv.includes('--source-only')
const BROWSER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128 Safari/537.36'
const CRAWLER_AGENT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'

const ROUTES = [
  {
    pathname: '/internal/page-system/city-lagos',
    page: 'app/internal/page-system/city-lagos/page.tsx',
    h1: 'Find the right plan in Lagos.',
    mustContain: [
      'Illustrative concept — an abstract planning composition, not Lagos location evidence.',
      'Explore Mingla',
      'Explore Mingla Host',
      'Evidence review pending',
    ],
  },
  {
    pathname: '/internal/page-system/explorer-event-guide',
    page: 'app/internal/page-system/explorer-event-guide/page.tsx',
    h1: 'Events near you this weekend: 8 checks before you commit',
    mustContain: [
      'Do not begin with the longest list of events. Begin with the plan.',
      'Illustrative product demo — three fictional choices',
      'This is a decision aid, not a recommendation score.',
      'Blank three-option comparison',
    ],
  },
  {
    pathname: '/internal/page-system/host-event-promoter-guide',
    page: 'app/internal/page-system/host-event-promoter-guide/page.tsx',
    h1: 'Event promotion checklist: 30 days from launch to the door',
    mustContain: [
      'Illustrative concept image — not a real event, customer or performance claim.',
      'Event promotion is not “post more.”',
      'Checklist completion does not prove legal compliance, reach, attendance, sales or operational readiness.',
      'Day 30',
      '+7',
    ],
  },
]

let passed = 0

function pass(label) {
  passed += 1
  process.stdout.write(`PASS ${label}\n`)
}

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
}

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
  return decodeHtml(
    value
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ').trim()
}

function tagAttribute(html, tagName, attributeName, attributeValue, resultAttribute) {
  const tags = html.match(new RegExp(`<${tagName}\\b[^>]*>`, 'gi')) ?? []
  for (const tag of tags) {
    const attributes = Object.fromEntries(
      [...tag.matchAll(/([:\w-]+)=(?:"([^"]*)"|'([^']*)')/g)].map((match) => [
        match[1].toLowerCase(),
        decodeHtml(match[2] ?? match[3] ?? ''),
      ]),
    )
    if ((attributes[attributeName.toLowerCase()] ?? '').toLowerCase() === attributeValue) {
      return attributes[resultAttribute.toLowerCase()] ?? null
    }
  }
  return null
}

function pageFacts(html) {
  const h1Matches = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)]
  return {
    h1Count: h1Matches.length,
    h1: textContent(h1Matches[0]?.[1] ?? ''),
    main: textContent(html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? ''),
    robots: tagAttribute(html, 'meta', 'name', 'robots', 'content') ?? '',
    canonical: tagAttribute(html, 'link', 'rel', 'canonical', 'href'),
    jsonLdCount: (html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>/gi) ?? []).length,
  }
}

function filesBelow(relativeDirectory) {
  const directory = path.join(ROOT, relativeDirectory)
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativeEntry = path.join(relativeDirectory, entry.name)
    return entry.isDirectory() ? filesBelow(relativeEntry) : [relativeEntry]
  })
}

function runSourceContract() {
  const registry = read('lib/search/route-registry.ts')
  const verification = read('scripts/verify-search-foundation.mjs')
  const strictGate = read('../.github/scripts/strict-grep/issue-2981-marketing-search-foundation.mjs')
  const packageJson = JSON.parse(read('package.json'))
  const sitemap = read('app/sitemap.ts')
  const globals = read('app/globals.css')
  const layout = read('app/internal/page-system/layout.tsx')
  const shell = read('components/page-system/page-system-shell.tsx')
  const faqs = read('components/page-system/content-blocks.tsx')
  const editorialHero = read('components/page-system/editorial-hero.tsx')
  const hostMedia = read('components/page-system/host-hero-media.tsx')
  const planFit = read('components/page-system/plan-fit-check.tsx')
  const launchTimeline = read('components/page-system/launch-to-door-timeline.tsx')
  const content = [
    read('content/page-system/shared.ts'),
    read('content/page-system/city-lagos.ts'),
    read('content/page-system/explorer-event-guide.ts'),
    read('content/page-system/host-event-promoter-guide.ts'),
  ].join('\n')
  const pageSystemSources = filesBelow('app/internal/page-system')
    .concat(filesBelow('components/page-system'), filesBelow('content/page-system'))
    .filter((filename) => /\.(?:css|tsx?|mjs)$/.test(filename))
    .map((filename) => read(filename))
    .join('\n')

  assert.deepEqual(
    filesBelow('app/internal/page-system').filter((filename) => filename.endsWith('/page.tsx')).sort(),
    ROUTES.map((route) => route.page).sort(),
    'the review namespace must expose exactly three page fixtures',
  )
  for (const route of ROUTES) {
    assert(registry.includes(`['${route.pathname}', 'page-system-`), `${route.pathname} registry ownership`)
    assert(verification.includes(`'${route.pathname}'`), `${route.pathname} runtime search-foundation coverage`)
    assert(strictGate.includes(`['${route.pathname}', '${route.page.replace('app/', 'mingla-marketing/app/')}']`), `${route.pathname} strict-grep file oracle`)
    const page = read(route.page)
    assert(page.includes(`const CURRENT_PATH = '${route.pathname}' as const`), `${route.pathname} fixed current path`)
    assert(page.includes(`publicNoindexMetadata('${route.pathname}'`), `${route.pathname} fail-closed metadata`)
    assert(!/application\/ld\+json|MinglaEntityGraph|jsonLd/i.test(page), `${route.pathname} has no production JSON-LD`)
  }
  assert.equal(packageJson.scripts['test:page-system'], 'node scripts/issue-2990-page-system.implementor.happy.test.mjs')
  assert(packageJson.scripts.build.startsWith('node scripts/issue-2990-page-system.implementor.happy.test.mjs --source-only && '))
  assert.match(sitemap, /searchReadyRoutes\(\)/)
  assert.doesNotMatch(sitemap, /page-system/)
  pass('exact private route ownership and automatic build guard')

  assert.match(layout, /page-system\.css/)
  assert.match(shell, /page-system-printable/)
  assert.match(globals, /html:not\(:has\(\.page-system-printable\)\)/)
  assert.match(globals, /body:not\(:has\(\.page-system-printable\)\)/)
  assert.match(faqs, /<details[\s\S]*<summary>[\s\S]*ps-faq-answer/)
  assert.match(pageSystemSources, /@media \(prefers-reduced-motion: reduce\)/)
  assert.match(pageSystemSources, /IntersectionObserver/)
  assert.match(pageSystemSources, /document\.visibilityState/)
  assert.match(pageSystemSources, /@media print/)
  for (const asset of [
    'public/brand/mingla-wordmark.svg',
    'public/brand/mingla-business-logo.svg',
    'public/marketing/host-icp/events-hall.jpg',
  ]) assert(fs.existsSync(path.join(ROOT, asset)), `required existing asset ${asset}`)
  assert.doesNotMatch(pageSystemSources, /from ['"](?:framer-motion|recharts|chart\.js|d3|gsap)/)
  assert.doesNotMatch(pageSystemSources, /<canvas\b/)
  pass('native, route-scoped, reduced-motion and printable presentation')

  assert.match(shell, /data-private-review-dock/)
  assert.match(editorialHero, /data-hero-actions/)
  assert.match(editorialHero, /data-hero-action="primary"/)
  assert.match(editorialHero, /data-hero-action="secondary"/)
  assert.match(pageSystemSources, /--page-review-dock-clearance:/)
  assert.match(pageSystemSources, /padding:\s*120px 48px var\(--page-review-dock-clearance\)/)
  assert.match(pageSystemSources, /@media \(max-width: 767px\)[\s\S]*padding:\s*96px 20px var\(--page-review-dock-clearance\)/)
  assert.match(pageSystemSources, /@media \(max-height: 620px\)[\s\S]*\.ps-hero-visual \{ display: none; \}/)
  assert.match(pageSystemSources, /\.ps-breadcrumbs a \{ min-width: 44px; min-height: 44px;/)
  pass('persistent-dock clearance, compact-height hero and 44px breadcrumb targets')

  for (const state of ['pending', 'loaded', 'failed']) assert(hostMedia.includes(state), `missing Host media state ${state}`)
  assert.match(hostMedia, /onLoad=\{\(\) => setMediaState\('loaded'\)\}/)
  assert.match(hostMedia, /onError=\{\(\) => setMediaState\('failed'\)\}/)
  assert.match(hostMedia, /role="status" aria-live="polite" aria-atomic="true"/)
  assert.match(hostMedia, /ps-host-media-fallback/)
  assert.match(hostMedia, /Mingla Host event-planning illustration/)
  assert.match(pageSystemSources, /data-media-state='loaded'[\s\S]*\.ps-host-concept-image \{ opacity: 1; \}/)
  assert.match(pageSystemSources, /\.ps-host-concept-image \{[\s\S]*position: absolute;[\s\S]*opacity: 0;/)
  pass('reserved Host media pending/load/error boundary and branded fallback')

  const cities = ['Lagos', 'Durham', 'Cary', 'Raleigh', 'New York City', 'Brussels', 'Paris', 'London', 'Fort Lauderdale', 'Washington DC']
  for (const city of cities) assert(content.includes(`'${city}'`), `missing city ${city}`)
  assert.doesNotMatch(pageSystemSources, /(?:research|raleigh[- /]+durham[- /]+cary) triangle/i)
  assert.match(content, /audience: 'Explorer'/)
  assert.match(content, /audience: 'Mingla Host'/)
  assert.match(content, /Find → shape → share the plan\./)
  assert.match(content, /Publish → connect the action → run the guest experience\./)
  pass('ten independent city identities and balanced Explorer/Host path')

  for (const status of ['Not checked', 'Works for this plan', 'Needs confirmation', 'Does not work']) {
    assert(planFit.includes(`'${status}'`) || content.includes(`'${status}'`), `missing Plan Fit status ${status}`)
  }
  assert.match(planFit, /if \(failures > 0\)[\s\S]*Poor fit/)
  assert.match(planFit, /if \(essentialUnknowns > 0\)[\s\S]*Not enough evidence/)
  assert.match(planFit, /if \(confirmations > 0\)[\s\S]*Possible fit/)
  assert.match(planFit, /works === EXPLORER_EVENT_GUIDE\.checks\.length[\s\S]*Strong fit/)
  assert.match(planFit, /type="radio"/)
  assert.match(planFit, /type="checkbox"/)
  assert.match(planFit, /Clear selections/)
  assert.match(planFit, /requestAnimationFrame\(\(\) => headingRef\.current\?\.focus\(\)\)/)
  assert.equal((content.match(/id: '(?:people|mood|time|cost|journey|entry|comfort|source)'/g) ?? []).length, 8)
  pass('deterministic eight-row Plan Fit Check and safe reset')

  for (const phase of ['Day 30', 'Day 21', 'Day 14', 'Day 7', 'Day 3', 'Day 1', 'Event day', '+1', '+7']) {
    assert(content.includes(`label: '${phase}'`), `missing phase ${phase}`)
  }
  for (const status of ['Not started', 'Ready', 'Needs attention', 'Not applicable']) {
    assert(launchTimeline.includes(status) || content.includes(`'${status}'`), `missing launch status ${status}`)
  }
  assert.match(launchTimeline, /state\[task\.id\] !== 'Not applicable'/)
  assert.match(launchTimeline, /summary\.ready\.length} of {summary\.applicable\.length} applicable items ready/)
  assert.match(launchTimeline, /Needs attention/)
  assert.match(launchTimeline, /Next unfinished phase:/)
  assert.match(launchTimeline, /Clear states/)
  pass('complete launch-to-door worksheet semantics')

  assert.doesNotMatch(pageSystemSources, /\bfetch\s*\(|localStorage|sessionStorage|navigator\.sendBeacon|posthog|gtag\s*\(/i)
  assert.match(planFit, /Your selections stay in this browser and are not uploaded\./)
  assert.match(launchTimeline, /without entering an event name, guest detail, budget or audience record\./)
  assert.match(pageSystemSources, /Illustrative product demo — three fictional choices/)
  assert.match(pageSystemSources, /Illustrative concept image — not a real event, customer or performance claim\./)
  assert.doesNotMatch(pageSystemSources, /\b(?:guarantees? (?:attendance|sales|revenue|reach)|proven to|trusted by \d|customers? increased)\b/i)
  pass('local-only controls and explicit claim boundaries')
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
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  return port
}

function request(port, pathname, userAgent = BROWSER_AGENT) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathname,
      method: 'GET',
      headers: { Host: 'usemingla.com', 'User-Agent': userAgent, Accept: 'text/html,*/*' },
    }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => resolve({
        status: response.statusCode,
        contentType: String(response.headers['content-type'] ?? ''),
        body: Buffer.concat(chunks).toString('utf8'),
      }))
    })
    req.once('error', reject)
    req.end()
  })
}

async function waitUntilReady(port, child) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`next start exited early with ${child.exitCode}`)
    try {
      const response = await request(port, '/robots.txt')
      if (response.status === 200) return
    } catch {
      // The server socket is not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('next start did not become ready within 20 seconds')
}

function routeChunkReport(route) {
  const directory = path.join('.next/static/chunks/app', route.pathname.replace(/^\//, ''))
  const chunks = filesBelow(directory).filter((filename) => filename.endsWith('.js'))
  assert(chunks.length > 0, `${route.pathname} page-specific JavaScript chunk exists`)
  const rawBytes = chunks.reduce((total, filename) => total + fs.statSync(path.join(ROOT, filename)).size, 0)
  const gzipBytes = chunks.reduce((total, filename) => total + gzipSync(fs.readFileSync(path.join(ROOT, filename))).byteLength, 0)
  assert(gzipBytes <= 35 * 1024, `${route.pathname} page-specific JavaScript must be <=35 KB gzip; received ${gzipBytes}`)
  return { chunks: chunks.length, rawBytes, gzipBytes }
}

async function runRuntimeContract() {
  assert(fs.existsSync(path.join(ROOT, '.next/BUILD_ID')), 'run npm run build before the runtime page-system test')
  const port = await availablePort()
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: ROOT,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk })
  child.stderr.on('data', (chunk) => { output += chunk })

  try {
    await waitUntilReady(port, child)
    for (const route of ROUTES) {
      const browser = await request(port, route.pathname, BROWSER_AGENT)
      const crawler = await request(port, route.pathname, CRAWLER_AGENT)
      assert.equal(browser.status, 200, `${route.pathname} browser status`)
      assert.equal(crawler.status, 200, `${route.pathname} crawler status`)
      assert.match(browser.contentType, /^text\/html\b/)
      const browserFacts = pageFacts(browser.body)
      const crawlerFacts = pageFacts(crawler.body)
      assert.equal(browserFacts.h1Count, 1, `${route.pathname} one H1`)
      assert.equal(browserFacts.h1, route.h1, `${route.pathname} expected H1`)
      assert.equal(browserFacts.h1, crawlerFacts.h1, `${route.pathname} crawler H1 parity`)
      assert.equal(browserFacts.main, crawlerFacts.main, `${route.pathname} crawler primary-content parity`)
      assert(browserFacts.main.length >= 3_000, `${route.pathname} material answer-first server HTML`)
      assert.match(browserFacts.robots, /noindex/i, `${route.pathname} noindex`)
      assert.match(browserFacts.robots, /nofollow/i, `${route.pathname} nofollow`)
      assert.equal(crawlerFacts.robots, browserFacts.robots, `${route.pathname} robots parity`)
      assert.equal(browserFacts.canonical, null, `${route.pathname} no canonical`)
      assert.equal(browserFacts.jsonLdCount, 0, `${route.pathname} no JSON-LD`)
      assert.doesNotMatch(browser.body, /(?:research|raleigh[- /]+durham[- /]+cary) triangle/i)
      for (const phrase of route.mustContain) assert(browserFacts.main.includes(phrase), `${route.pathname} contains ${phrase}`)
      assert(browser.body.includes('data-private-review-dock="true"') || browser.body.includes('data-private-review-dock=""'), `${route.pathname} persistent review dock marker`)
      assert(browser.body.includes('data-hero-action="primary"'), `${route.pathname} primary hero action marker`)
      if (route.pathname !== '/internal/page-system/city-lagos') {
        assert(browser.body.includes('data-hero-action="secondary"'), `${route.pathname} secondary hero action marker`)
      }
      if (route.pathname === '/internal/page-system/host-event-promoter-guide') {
        assert(browser.body.includes('data-media-state="pending"'), 'Host media has a server-visible pending state')
        assert(browserFacts.main.includes('Make the event clear from launch to the door.'), 'Host media fallback is server rendered')
        assert(browserFacts.main.includes('Loading the illustrative Mingla Host concept image.'), 'Host media pending status is accessible')
      }
      const chunkReport = routeChunkReport(route)
      process.stdout.write(`ROUTE ${route.pathname} html=${Buffer.byteLength(browser.body)}B chunks=${chunkReport.chunks} raw-js=${chunkReport.rawBytes}B gzip-js=${chunkReport.gzipBytes}B\n`)
    }
    pass('three 200 noindex/nofollow server-rendered fixture routes')

    const sitemap = await request(port, '/sitemap.xml')
    assert.equal(sitemap.status, 200)
    for (const route of ROUTES) assert(!sitemap.body.includes(route.pathname), `${route.pathname} absent from sitemap`)
    for (const pathname of ['/', '/host']) {
      const response = await request(port, pathname)
      assert.equal(response.status, 200, `${pathname} status`)
      for (const route of ROUTES) assert(!response.body.includes(route.pathname), `${route.pathname} absent from ${pathname} global navigation`)
    }
    pass('review fixtures absent from sitemap and production global navigation')
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nnext output:\n${output}`)
  } finally {
    child.kill('SIGTERM')
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve()
      child.once('exit', resolve)
      setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL')
        resolve()
      }, 2_000)
    })
  }
}

runSourceContract()
if (!SOURCE_ONLY) await runRuntimeContract()
process.stdout.write(`PASS issue #2990 page-system contract (${passed} groups)\n`)
