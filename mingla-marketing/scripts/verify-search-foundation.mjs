#!/usr/bin/env node

import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { spawn } from 'node:child_process'

const APEX_HOST = 'usemingla.com'
const APEX_ORIGIN = `https://${APEX_HOST}`
const BROWSER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128 Safari/537.36'
const CRAWLER_AGENT =
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'

const SEARCH_READY_PATHS = [
  '/',
  '/host',
  '/tools',
  '/tools/events',
  '/tools/venues',
  '/tools/trips',
  '/tools/pricing',
  '/support',
  '/privacy-policy',
  '/terms-of-service',
]

const PUBLIC_NOINDEX_PATHS = [
  '/links',
  '/download',
  '/host/download',
  '/unsubscribe',
  '/schedule',
  '/sms-terms',
  '/delete-account',
  '/event-preview',
  '/trip-preview',
  '/venue-preview',
  '/venue-preview/lookbook',
  '/intent-preview',
  '/tools/events/report',
  '/tools/venues/report',
  '/tools/trips/report',
  '/tools/pricing/report',
]

const PUBLIC_NOINDEX_FAMILY_SAMPLES = [
  '/orders/search-contract',
  '/chat/search-contract',
  '/board/search-contract',
  '/invite/search-contract',
]

const REDIRECTS = [
  ['/organisers', '/host'],
  ['/organisers/events', '/host/events'],
  ['/business', '/host'],
  ['/business/venues', '/host/venues'],
  ['/tools/book', '/schedule'],
]

let passed = 0

function pass(label) {
  passed += 1
  process.stdout.write(`PASS ${label}\n`)
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
  )
    .replace(/\s+/g, ' ')
    .trim()
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
  const title = textContent(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '')
  const description = tagAttribute(html, 'meta', 'name', 'description', 'content')
  const robots = tagAttribute(html, 'meta', 'name', 'robots', 'content') ?? ''
  const canonical = tagAttribute(html, 'link', 'rel', 'canonical', 'href')
  const h1 = textContent(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '')
  const main = textContent(html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? '')
  const jsonLd = [...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => decodeHtml(match[1]).trim())
  return { title, description, robots, canonical, h1, main, jsonLd }
}

function canonicalFor(pathname) {
  // Next normalizes the root metadata URL to the equivalent bare origin.
  return pathname === '/' ? APEX_ORIGIN : `${APEX_ORIGIN}${pathname}`
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

function request(port, path, { host = APEX_HOST, userAgent = BROWSER_AGENT } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'GET',
        headers: { Host: host, 'User-Agent': userAgent, Accept: '*/*' },
      },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () => {
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks),
          })
        })
      },
    )
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

function walkJson(value, visit) {
  if (Array.isArray(value)) {
    for (const entry of value) walkJson(entry, visit)
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    visit(key, child)
    walkJson(child, visit)
  }
}

function assertPngDimensions(body, width, height, label) {
  assert(body.subarray(1, 4).equals(Buffer.from('PNG')), `${label} PNG signature`)
  assert.equal(body.readUInt32BE(16), width, `${label} width`)
  assert.equal(body.readUInt32BE(20), height, `${label} height`)
}

function assertIcoDimensions(body, width, height, label) {
  assert.equal(body.readUInt16LE(0), 0, `${label} reserved header`)
  assert.equal(body.readUInt16LE(2), 1, `${label} image type`)
  assert.equal(body.readUInt16LE(4), 1, `${label} image count`)
  assert.equal(body[6] || 256, width, `${label} width`)
  assert.equal(body[7] || 256, height, `${label} height`)
}

async function main() {
  const port = await availablePort()
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: process.cwd(),
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let serverOutput = ''
  child.stdout.on('data', (chunk) => { serverOutput += chunk })
  child.stderr.on('data', (chunk) => { serverOutput += chunk })

  try {
    await waitUntilReady(port, child)

    for (const pathname of SEARCH_READY_PATHS) {
      const browser = await request(port, pathname, { userAgent: BROWSER_AGENT })
      const crawler = await request(port, pathname, { userAgent: CRAWLER_AGENT })
      assert.equal(browser.status, 200, `${pathname} browser status`)
      assert.equal(crawler.status, 200, `${pathname} Googlebot status`)
      assert.match(String(browser.headers['content-type']), /^text\/html\b/, `${pathname} HTML MIME`)

      const browserFacts = pageFacts(browser.body.toString('utf8'))
      const crawlerFacts = pageFacts(crawler.body.toString('utf8'))
      assert.equal(browserFacts.canonical, canonicalFor(pathname), `${pathname} self-canonical`)
      assert.equal(crawlerFacts.canonical, browserFacts.canonical, `${pathname} canonical parity`)
      assert.doesNotMatch(browserFacts.robots, /noindex/i, `${pathname} browser indexability`)
      assert.doesNotMatch(crawlerFacts.robots, /noindex/i, `${pathname} crawler indexability`)
      assert(browserFacts.title.length >= 12, `${pathname} has a useful title`)
      assert((browserFacts.description ?? '').length >= 50, `${pathname} has a useful description`)
      assert(browserFacts.h1.length >= 8, `${pathname} has one primary answer heading`)
      assert(browserFacts.main.length >= 100, `${pathname} has material server-rendered content`)
      assert.equal(crawlerFacts.title, browserFacts.title, `${pathname} title parity`)
      assert.equal(crawlerFacts.description, browserFacts.description, `${pathname} description parity`)
      assert.equal(crawlerFacts.h1, browserFacts.h1, `${pathname} H1 parity`)
      assert.equal(crawlerFacts.main, browserFacts.main, `${pathname} primary-content parity`)
      assert.deepEqual(crawlerFacts.jsonLd, browserFacts.jsonLd, `${pathname} JSON-LD parity`)

      if (pathname === '/' || pathname === '/host') {
        const html = browser.body.toString('utf8')
        assert.match(html, /<noscript>[\s\S]*search-primary-answer/, `${pathname} no-JS answer fallback`)
      }
      pass(`${pathname} browser/Googlebot search contract`)
    }

    const home = await request(port, '/')
    const homeFacts = pageFacts(home.body.toString('utf8'))
    assert.equal(homeFacts.jsonLd.length, 1, 'entity graph is mounted exactly once')
    const graph = JSON.parse(homeFacts.jsonLd[0])
    assert.equal(graph['@context'], 'https://schema.org')
    assert(Array.isArray(graph['@graph']))
    const types = graph['@graph'].map((entry) => entry['@type'])
    assert.deepEqual(types, ['Organization', 'WebSite', 'MobileApplication', 'MobileApplication'])
    assert(graph['@graph'].every((entry) => String(entry['@id']).startsWith(`${APEX_ORIGIN}/#`)))
    const serializedGraph = JSON.stringify(graph)
    assert.match(serializedGraph, /apps\.apple\.com\/app\/id6760440898/)
    assert.match(serializedGraph, /play\.google\.com\/store\/apps\/details\?id=com\.mingla\.app\.v2/)
    assert.match(serializedGraph, /apps\.apple\.com\/app\/id6768737367/)
    assert.match(serializedGraph, /play\.google\.com\/store\/apps\/details\?id=com\.sethogieva\.minglabusiness/)
    assert.match(serializedGraph, /mingla-logo-white-on-orange\.png/)
    assert.match(serializedGraph, /mingla-business-logo\.png/)
    const forbiddenSchemaKeys = new Set([
      'aggregateRating',
      'review',
      'ratingValue',
      'reviewCount',
      'downloadCount',
      'interactionStatistic',
      'userInteractionCount',
    ])
    walkJson(graph, (key) => assert(!forbiddenSchemaKeys.has(key), `forbidden JSON-LD key ${key}`))
    assert.doesNotMatch(serializedGraph, /illustrative|guaranteed revenue/i)
    pass('factual Organization/WebSite/App entity graph')

    for (const pathname of [...PUBLIC_NOINDEX_PATHS, ...PUBLIC_NOINDEX_FAMILY_SAMPLES]) {
      const response = await request(port, pathname)
      assert.equal(response.status, 200, `${pathname} public utility status`)
      const facts = pageFacts(response.body.toString('utf8'))
      assert.match(facts.robots, /noindex/i, `${pathname} explicit noindex`)
      assert.equal(facts.canonical, null, `${pathname} has no search canonical`)
    }
    pass('public-noindex routes and route families')

    const robots = await request(port, '/robots.txt')
    assert.equal(robots.status, 200)
    assert.match(String(robots.headers['content-type']), /^text\/plain\b/)
    const robotsBody = robots.body.toString('utf8')
    for (const agent of ['Googlebot', 'Bingbot', 'OAI-SearchBot', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot']) {
      assert.match(robotsBody, new RegExp(`User-Agent: ${agent}[\\s\\S]*?Allow: /`), `${agent} allowed`)
    }
    for (const agent of ['GPTBot', 'ClaudeBot', 'Google-Extended']) {
      assert.match(robotsBody, new RegExp(`User-Agent: ${agent}[\\s\\S]*?Disallow: /`), `${agent} blocked`)
    }
    assert.match(robotsBody, /Sitemap: https:\/\/usemingla\.com\/sitemap\.xml/)
    pass('search-agent allow and training-agent block policy')

    const sitemap = await request(port, '/sitemap.xml')
    assert.equal(sitemap.status, 200)
    assert.match(String(sitemap.headers['content-type']), /^(?:application|text)\/xml\b/)
    const sitemapBody = sitemap.body.toString('utf8')
    const locations = [...sitemapBody.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])
    const lastModified = [...sitemapBody.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((match) => match[1])
    assert.deepEqual(
      locations,
      SEARCH_READY_PATHS.map((pathname) =>
        pathname === '/' ? `${APEX_ORIGIN}/` : canonicalFor(pathname),
      ),
    )
    assert.equal(new Set(locations).size, locations.length)
    assert.equal(lastModified.length, locations.length)
    for (const value of lastModified) assert(new Date(value).getTime() <= Date.now(), `future lastmod ${value}`)
    assert.doesNotMatch(sitemapBody, /<loc>https:\/\/www\.|\/links<|\/download<|\/report<|\/orders|\/chat|\/board|\/invite/)
    for (const pathname of SEARCH_READY_PATHS) {
      assert.equal((await request(port, pathname)).status, 200, `sitemap target ${pathname}`)
    }
    pass('exact lifecycle-derived sitemap')

    for (const userAgent of [BROWSER_AGENT, CRAWLER_AGENT]) {
      const redirect = await request(port, '/host?source=parity', {
        host: 'www.usemingla.com',
        userAgent,
      })
      assert.equal(redirect.status, 308)
      assert.equal(redirect.headers.location, `${APEX_ORIGIN}/host?source=parity`)
    }
    pass('www browser/Googlebot exact 308 path-query parity')

    for (const [source, destination] of REDIRECTS) {
      const response = await request(port, `${source}?utm_source=contract`)
      assert.equal(response.status, 308, `${source} permanent status`)
      assert.equal(response.headers.location, `${destination}?utm_source=contract`, `${source} target`)
    }
    pass('registered permanent route redirects')

    for (const userAgent of [BROWSER_AGENT, CRAWLER_AGENT]) {
      const response = await request(port, '/a-route-that-does-not-exist', { userAgent })
      assert.equal(response.status, 404)
      assert.match(String(response.headers['content-type']), /^text\/html\b/)
    }
    pass('browser/Googlebot 404 parity')

    const careers = await request(port, '/', { host: 'career.usemingla.com' })
    assert.equal(careers.status, 200, 'careers host remains reachable')
    assert.match(textContent(careers.body.toString('utf8')), /Build Mingla with us\./)
    assert.notEqual(careers.headers.location, `${APEX_ORIGIN}/`)
    const aasa = await request(port, '/.well-known/apple-app-site-association', { host: 'www.usemingla.com' })
    assert.equal(aasa.status, 200, '.well-known remains reachable on its owner')
    assert.notEqual(aasa.status, 308)
    const share = await request(port, `/p/${'a'.repeat(36)}`, { host: 'www.usemingla.com' })
    assert.notEqual(share.status, 308, 'public share route is not captured by the www redirect')
    assert.equal(share.headers.location, undefined)
    pass('careers, association-file, and share-owner isolation')

    const manifest = await request(port, '/manifest.webmanifest')
    assert.equal(manifest.status, 200)
    assert.match(String(manifest.headers['content-type']), /^application\/manifest\+json\b/)
    const manifestJson = JSON.parse(manifest.body.toString('utf8'))
    assert.equal(manifestJson.name, 'Mingla — Date Plans & City Gems')
    assert.deepEqual(
      manifestJson.icons.map(({ src, sizes }) => [src, sizes]),
      [
        ['/brand/mingla-icon-192.png', '192x192'],
        ['/brand/mingla-icon-512.png', '512x512'],
      ],
    )
    for (const [pathname, width, height] of [
      ['/brand/mingla-icon-192.png', 192, 192],
      ['/brand/mingla-icon-512.png', 512, 512],
      ['/icon.png', 512, 512],
      ['/apple-icon.png', 180, 180],
    ]) {
      const icon = await request(port, pathname)
      assert.equal(icon.status, 200, `${pathname} status`)
      assert.match(String(icon.headers['content-type']), /^image\/png\b/, `${pathname} MIME`)
      assertPngDimensions(icon.body, width, height, pathname)
    }
    const favicon = await request(port, '/favicon.ico')
    assert.equal(favicon.status, 200)
    assert.match(String(favicon.headers['content-type']), /^image\/(?:x-icon|vnd\.microsoft\.icon)\b/)
    assertIcoDimensions(favicon.body, 32, 32, '/favicon.ico')
    const homeHtml = home.body.toString('utf8')
    assert.match(homeHtml, /rel="icon"[^>]+href="\/favicon\.ico"/)
    assert.match(homeHtml, /rel="apple-touch-icon"[^>]+href="\/apple-icon\.png"/)
    pass('real Mingla favicon, Apple icon, and 192/512 manifest icons')

    process.stdout.write(`\n#2981 search-foundation runtime PASS: ${passed} contract groups\n`)
  } catch (error) {
    process.stderr.write(`${error.stack ?? error}\n`)
    process.stderr.write(serverOutput)
    process.exitCode = 1
  } finally {
    child.kill('SIGTERM')
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ])
    if (child.exitCode === null) child.kill('SIGKILL')
  }
}

await main()
