#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

const STATES = [
  'draft',
  'public_noindex',
  'search_ready',
  'stale',
  'expired_archived',
  'redirected',
  'gone',
]

const SEARCH_READY = [
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

const PUBLIC_NOINDEX = [
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

const PUBLIC_NOINDEX_FAMILIES = ['/orders', '/chat', '/board', '/invite']

const SEARCH_PAGE_FILES = new Map([
  ['/', 'mingla-marketing/app/(explorer)/page.tsx'],
  ['/host', 'mingla-marketing/app/host/page.tsx'],
  ['/tools', 'mingla-marketing/app/tools/page.tsx'],
  ['/tools/events', 'mingla-marketing/app/tools/events/page.tsx'],
  ['/tools/venues', 'mingla-marketing/app/tools/venues/page.tsx'],
  ['/tools/trips', 'mingla-marketing/app/tools/trips/page.tsx'],
  ['/tools/pricing', 'mingla-marketing/app/tools/pricing/page.tsx'],
  ['/support', 'mingla-marketing/app/support/page.tsx'],
  ['/privacy-policy', 'mingla-marketing/app/privacy-policy/page.tsx'],
  ['/terms-of-service', 'mingla-marketing/app/terms-of-service/page.tsx'],
])

const NOINDEX_PAGE_FILES = new Map([
  ['/links', 'mingla-marketing/app/links/page.tsx'],
  ['/download', 'mingla-marketing/app/download/page.tsx'],
  ['/host/download', 'mingla-marketing/app/host/download/page.tsx'],
  ['/unsubscribe', 'mingla-marketing/app/unsubscribe/page.tsx'],
  ['/schedule', 'mingla-marketing/app/schedule/page.tsx'],
  ['/sms-terms', 'mingla-marketing/app/sms-terms/page.tsx'],
  ['/delete-account', 'mingla-marketing/app/delete-account/page.tsx'],
  ['/event-preview', 'mingla-marketing/app/event-preview/page.tsx'],
  ['/trip-preview', 'mingla-marketing/app/trip-preview/page.tsx'],
  ['/venue-preview', 'mingla-marketing/app/venue-preview/page.tsx'],
  ['/venue-preview/lookbook', 'mingla-marketing/app/venue-preview/lookbook/page.tsx'],
  ['/intent-preview', 'mingla-marketing/app/intent-preview/page.tsx'],
  ['/tools/events/report', 'mingla-marketing/app/tools/events/report/page.tsx'],
  ['/tools/venues/report', 'mingla-marketing/app/tools/venues/report/page.tsx'],
  ['/tools/trips/report', 'mingla-marketing/app/tools/trips/report/page.tsx'],
  ['/tools/pricing/report', 'mingla-marketing/app/tools/pricing/report/page.tsx'],
])

const REQUIRED_FILES = new Set([
  'MARKETING.md',
  'docs/INVARIANT_REGISTRY.md',
  'mingla-marketing/lib/site.ts',
  'mingla-marketing/lib/search/route-registry.ts',
  'mingla-marketing/lib/search/metadata.ts',
  'mingla-marketing/lib/search/entity-graph.ts',
  'mingla-marketing/components/marketing/entity-graph.tsx',
  'mingla-marketing/components/marketing/app-link-landing.tsx',
  'mingla-marketing/app/(explorer)/page.tsx',
  'mingla-marketing/app/layout.tsx',
  'mingla-marketing/app/robots.ts',
  'mingla-marketing/app/sitemap.ts',
  'mingla-marketing/app/manifest.ts',
  'mingla-marketing/middleware.ts',
  'mingla-marketing/next.config.ts',
  'mingla-marketing/package.json',
  'mingla-marketing/scripts/verify-search-foundation.mjs',
  'scripts/apex-route-model/apex-route-resolver.mjs',
  ['.github', 'workflows', ['web-build-check', 'yml'].join('.')].join('/'),
  ...SEARCH_PAGE_FILES.values(),
  ...NOINDEX_PAGE_FILES.values(),
])

const BRAND_ASSETS = [
  ['mingla-marketing/public/brand/mingla-logo-white-on-orange.png', 768, 768],
  ['mingla-marketing/public/brand/mingla-business-logo.png', 2000, 2000],
  ['mingla-marketing/public/brand/mingla-icon-192.png', 192, 192],
  ['mingla-marketing/public/brand/mingla-icon-512.png', 512, 512],
  ['mingla-marketing/app/icon.png', 512, 512],
  ['mingla-marketing/app/apple-icon.png', 180, 180],
]

const FAVICON_ASSET = 'mingla-marketing/app/favicon.ico'

function actualIo() {
  return {
    read(relativePath) {
      return fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
    },
    buffer(relativePath) {
      return fs.readFileSync(path.join(ROOT, relativePath))
    },
    exists(relativePath) {
      return fs.existsSync(path.join(ROOT, relativePath))
    },
  }
}

function pngDimensions(buffer) {
  if (buffer.length < 24 || !buffer.subarray(1, 4).equals(Buffer.from('PNG'))) return null
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)]
}

function icoDimensions(buffer) {
  if (
    buffer.length < 22 ||
    buffer.readUInt16LE(0) !== 0 ||
    buffer.readUInt16LE(2) !== 1 ||
    buffer.readUInt16LE(4) < 1
  ) return null
  return [buffer[6] || 256, buffer[7] || 256]
}

function arraySlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  return start >= 0 && end > start ? source.slice(start, end) : ''
}

function quotedValues(source) {
  return [...source.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1])
}

function sorted(values) {
  return [...values].sort()
}

function sameMembers(actual, expected) {
  return JSON.stringify(sorted(actual)) === JSON.stringify(sorted(expected))
}

function validate(io) {
  const errors = []
  const fail = (code, detail) => errors.push(`${code}: ${detail}`)
  const read = (relativePath) => {
    try {
      return io.read(relativePath)
    } catch {
      fail('FILE_MISSING', relativePath)
      return ''
    }
  }

  const site = read('mingla-marketing/lib/site.ts')
  if (!/SITE_ORIGIN = 'https:\/\/usemingla\.com' as const/.test(site)) {
    fail('APEX_ORIGIN', 'SITE_ORIGIN must be the fixed usemingla.com apex')
  }
  if (/SITE_ORIGIN\s*=\s*['"]https:\/\/www\./.test(site) || /NEXT_PUBLIC_SITE_URL/.test(site)) {
    fail('APEX_ORIGIN', 'canonical identity cannot be www or environment-overridable')
  }
  for (const token of ['canonicalMarketingUrl', 'hostnameFromHeader', 'isWwwMarketingHost']) {
    if (!site.includes(`function ${token}`)) fail('APEX_HELPER', `missing ${token}`)
  }

  const registry = read('mingla-marketing/lib/search/route-registry.ts')
  const stateBlock = arraySlice(registry, 'ROUTE_LIFECYCLE_STATES = [', '] as const')
  if (!sameMembers(quotedValues(stateBlock), STATES)) {
    fail('LIFECYCLE_STATES', `expected exactly ${STATES.join(', ')}`)
  }

  const searchBlock = arraySlice(registry, 'const SEARCH_READY_ROUTES = [', '] as const satisfies readonly SearchReadyRouteContract[]')
  const searchPaths = [...searchBlock.matchAll(/pathname:\s*['"]([^'"]+)['"]/g)].map((match) => match[1])
  if (!sameMembers(searchPaths, SEARCH_READY)) {
    fail('SEARCH_ROUTE_SET', `expected ${SEARCH_READY.join(', ')}; received ${searchPaths.join(', ')}`)
  }

  const noindexBlock = arraySlice(registry, 'const PUBLIC_NOINDEX_ROUTES = [', '] as const')
  const noindexPaths = [...noindexBlock.matchAll(/\[['"]([^'"]+)['"],/g)].map((match) => match[1])
  if (!sameMembers(noindexPaths, PUBLIC_NOINDEX)) {
    fail('NOINDEX_ROUTE_SET', `expected ${PUBLIC_NOINDEX.join(', ')}; received ${noindexPaths.join(', ')}`)
  }

  const familyBlock = arraySlice(registry, 'const PUBLIC_NOINDEX_FAMILIES = [', '] as const')
  const familyPaths = [...familyBlock.matchAll(/\[['"]([^'"]+)['"],/g)].map((match) => match[1])
  if (!sameMembers(familyPaths, PUBLIC_NOINDEX_FAMILIES)) {
    fail('NOINDEX_FAMILY_SET', `expected ${PUBLIC_NOINDEX_FAMILIES.join(', ')}; received ${familyPaths.join(', ')}`)
  }
  for (const lifecycle of ['draft', 'public_noindex', 'stale', 'expired_archived']) {
    if (!new RegExp(`NOINDEX_LIFECYCLES[\\s\\S]*['"]${lifecycle}['"]`).test(registry)) {
      fail('NOINDEX_LIFECYCLES', `${lifecycle} is not owned by the noindex set`)
    }
  }
  for (const [source, destination] of [
    ['/organisers', '/host'],
    ['/business', '/host'],
    ['/tools/book', '/schedule'],
  ]) {
    if (!registry.includes(`source: '${source}'`) || !registry.includes(`destination: '${destination}'`)) {
      fail('REDIRECT_SET', `${source} -> ${destination} is missing`)
    }
  }
  if (!/searchReadyRoutes\(\)/.test(registry) || !/nextRedirectsFromRegistry/.test(registry)) {
    fail('REGISTRY_DERIVATION', 'sitemap and redirects must derive from the registry')
  }

  const metadata = read('mingla-marketing/lib/search/metadata.ts')
  if (!/requireRouteContract\(pathname, 'search_ready'\)/.test(metadata) || !/alternates:\s*\{\s*canonical\s*\}/.test(metadata)) {
    fail('CANONICAL_METADATA', 'search-ready metadata must require the lifecycle and emit a self-canonical')
  }
  if (!/robots:\s*\{\s*index:\s*true,\s*follow:\s*true\s*\}/.test(metadata)) {
    fail('INDEX_METADATA', 'search-ready metadata must explicitly allow indexing')
  }
  if (!/NOINDEX_LIFECYCLES\.has\(contract\.lifecycle\)/.test(metadata) || !/robots:\s*\{\s*index:\s*false/.test(metadata)) {
    fail('NOINDEX_METADATA', 'public noindex metadata must fail closed through the lifecycle set')
  }

  for (const [pathname, relativePath] of SEARCH_PAGE_FILES) {
    if (!read(relativePath).includes(`searchRouteMetadata('${pathname}')`)) {
      fail('SEARCH_PAGE_METADATA', `${relativePath} does not use the ${pathname} contract`)
    }
  }
  for (const [pathname, relativePath] of NOINDEX_PAGE_FILES) {
    if (!read(relativePath).includes(`publicNoindexMetadata('${pathname}'`)) {
      fail('NOINDEX_PAGE_METADATA', `${relativePath} does not use the ${pathname} contract`)
    }
  }
  const appLinkLanding = read('mingla-marketing/components/marketing/app-link-landing.tsx')
  for (const family of PUBLIC_NOINDEX_FAMILIES) {
    if (!appLinkLanding.includes(`'${family}'`)) fail('NOINDEX_FAMILY_METADATA', `${family} is absent from app-link metadata`)
  }

  const sitemap = read('mingla-marketing/app/sitemap.ts')
  if (!/searchReadyRoutes\(\)\.map/.test(sitemap) || !/canonicalUrlForSearchRoute/.test(sitemap)) {
    fail('SITEMAP_DERIVATION', 'sitemap must map only the registry search-ready projection')
  }
  if (/["']\/(?:links|download|orders|chat|board|invite|tools\/events\/report)["']/.test(sitemap)) {
    fail('SITEMAP_LEAK', 'a noindex route was added to sitemap source')
  }

  const middleware = read('mingla-marketing/middleware.ts')
  const careersIndex = middleware.indexOf('if (isCareersHost(host))')
  const shareIndex = middleware.indexOf('if (PUBLIC_SHARE_PATH.test(pathname))')
  const wwwIndex = middleware.indexOf('if (isWwwMarketingHost(host)')
  if (!(careersIndex >= 0 && shareIndex > careersIndex && wwwIndex > shareIndex)) {
    fail('HOST_PRECEDENCE', 'careers and share owners must run before the exact www redirect')
  }
  for (const token of [
    "url.protocol = 'https:'",
    'url.hostname = SITE_HOST',
    'url.pathname = pathname',
    'url.search = search',
    'NextResponse.redirect(url, 308)',
    '!isShareOwnerPath(pathname)',
    'routeContractForPath(pathname)?.lifecycle === \'gone\'',
    "status: 410",
  ]) {
    if (!middleware.includes(token)) fail('HOST_LIFECYCLE_RUNTIME', `missing ${token}`)
  }
  if (!middleware.includes('.well-known/') || !middleware.includes('api/internal-share-proxy/')) {
    fail('HOST_EXCLUSIONS', 'association and internal share paths are not excluded')
  }

  const nextConfig = read('mingla-marketing/next.config.ts')
  if (!/nextRedirectsFromRegistry\(\)/.test(nextConfig)) {
    fail('REDIRECT_DERIVATION', 'Next redirects do not derive from the lifecycle registry')
  }
  const apexRouteModel = read('scripts/apex-route-model/apex-route-resolver.mjs')
  if (!apexRouteModel.includes("'search', 'route-registry.ts'") || !apexRouteModel.includes('REDIRECTED_ROUTES')) {
    fail('APEX_ROUTE_MODEL', 'the shared apex-route model does not read the lifecycle redirect owner')
  }

  const robots = read('mingla-marketing/app/robots.ts')
  for (const agent of ['Googlebot', 'Bingbot', 'OAI-SearchBot', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot']) {
    if (!robots.includes(`'${agent}'`)) fail('SEARCH_CRAWLER_POLICY', `${agent} is not named`)
  }
  for (const agent of ['GPTBot', 'ClaudeBot', 'Google-Extended']) {
    if (!robots.includes(`'${agent}'`)) fail('TRAINING_CRAWLER_POLICY', `${agent} is not blocked`)
  }
  if (!/sitemap:\s*canonicalMarketingUrl\('\/sitemap\.xml'\)/.test(robots)) {
    fail('ROBOTS_SITEMAP', 'robots does not advertise the apex sitemap')
  }

  const entityGraph = read('mingla-marketing/lib/search/entity-graph.ts')
  for (const token of [
    "'@type': 'Organization'",
    "'@type': 'WebSite'",
    "'@type': 'MobileApplication'",
    'APP_STORE_URL',
    'PLAY_STORE_URL',
    'BUSINESS_APP_STORE_URL',
    'BUSINESS_PLAY_STORE_URL',
    'mingla-logo-white-on-orange.png',
    'mingla-business-logo.png',
  ]) {
    if (!entityGraph.includes(token)) fail('ENTITY_GRAPH_FACTS', `missing ${token}`)
  }
  if (/aggregateRating|reviewCount|ratingValue|downloadCount|interactionStatistic|userInteractionCount|illustrative/i.test(entityGraph)) {
    fail('ENTITY_GRAPH_CLAIMS', 'structured data contains a forbidden illustrative or social-proof field')
  }
  const rootPage = read('mingla-marketing/app/(explorer)/page.tsx')
  if ((rootPage.match(/<MinglaEntityGraph\s*\/>/g) ?? []).length !== 1) {
    fail('ENTITY_GRAPH_MOUNT', 'the apex must mount exactly one entity graph')
  }

  const manifest = read('mingla-marketing/app/manifest.ts')
  const layout = read('mingla-marketing/app/layout.tsx')
  for (const [asset, width, height] of BRAND_ASSETS) {
    if (!io.exists(asset)) {
      fail('BRAND_ASSET_MISSING', asset)
      continue
    }
    const dimensions = pngDimensions(io.buffer(asset))
    if (!dimensions || dimensions[0] !== width || dimensions[1] !== height) {
      fail('BRAND_ASSET_DIMENSIONS', `${asset} must be ${width}x${height}`)
    }
  }
  if (!io.exists(FAVICON_ASSET)) {
    fail('BRAND_ASSET_MISSING', FAVICON_ASSET)
  } else {
    const dimensions = icoDimensions(io.buffer(FAVICON_ASSET))
    if (!dimensions || dimensions[0] !== 32 || dimensions[1] !== 32) {
      fail('BRAND_ASSET_DIMENSIONS', `${FAVICON_ASSET} must be a 32x32 ICO`)
    }
  }
  for (const token of [
    "src: '/brand/mingla-icon-192.png'",
    "sizes: '192x192'",
    "src: '/brand/mingla-icon-512.png'",
    "sizes: '512x512'",
  ]) {
    if (!manifest.includes(token)) fail('MANIFEST_BRAND', `manifest is missing ${token}`)
  }
  for (const token of ["manifest: '/manifest.webmanifest'", "url: '/favicon.ico'", "url: '/icon.png'", "url: '/apple-icon.png'"]) {
    if (!layout.includes(token)) fail('LAYOUT_BRAND', `root metadata is missing ${token}`)
  }

  const packageJson = read('mingla-marketing/package.json')
  if (!packageJson.includes('"test:search-foundation": "node scripts/verify-search-foundation.mjs"')) {
    fail('RUNTIME_TEST_REGISTRATION', 'package script is missing')
  }
  const runtimeTest = read('mingla-marketing/scripts/verify-search-foundation.mjs')
  for (const token of ['BROWSER_AGENT', 'CRAWLER_AGENT', "host: 'www.usemingla.com'", 'manifest.webmanifest', 'apple-app-site-association', "'/favicon.ico'", "'/apple-icon.png'", 'mingla-icon-192.png', 'mingla-icon-512.png']) {
    if (!runtimeTest.includes(token)) fail('RUNTIME_TEST_COVERAGE', `missing ${token}`)
  }

  const workflowPath = ['.github', 'workflows', ['web-build-check', 'yml'].join('.')].join('/')
  const workflow = read(workflowPath)
  if (!workflow.includes('#2981 marketing search foundation') || !workflow.includes('npm run test:search-foundation')) {
    fail('CI_REGISTRATION', 'web build CI does not run the #2981 production-server proof')
  }

  const marketing = read('MARKETING.md')
  for (const token of ['`usemingla.com`', '`host.usemingla.com`', '`career.usemingla.com`', '`public_noindex`', '`search_ready`', 'Fort Lauderdale', 'Brussels', 'Paris']) {
    if (!marketing.includes(token)) fail('CANONICAL_MARKETING_DOC', `MARKETING.md is missing ${token}`)
  }
  if (/North Carolina Triangle|Triangle \(Raleigh/.test(marketing)) {
    fail('CANONICAL_MARKETING_DOC', 'the committed city scope must name cities individually')
  }
  const invariants = read('docs/INVARIANT_REGISTRY.md')
  for (const id of [
    'I-PROPOSED-2981-MARKETING-ORIGIN-ONE-OWNER',
    'I-PROPOSED-2981-SEARCH-LIFECYCLE-ONE-OWNER',
    'I-PROPOSED-2981-ENTITY-GRAPH-FACTUAL',
  ]) {
    if (!invariants.includes(id)) fail('INVARIANT_REGISTRY', `${id} is absent`)
  }

  return errors
}

function assertClean(io, label) {
  const errors = validate(io)
  if (errors.length > 0) throw new Error(`${label}\n${errors.map((error) => `- ${error}`).join('\n')}`)
}

function virtualIo() {
  const base = actualIo()
  const overlay = new Map()
  for (const relativePath of REQUIRED_FILES) overlay.set(relativePath, base.read(relativePath))
  for (const [asset] of BRAND_ASSETS) overlay.set(asset, base.buffer(asset))
  overlay.set(FAVICON_ASSET, base.buffer(FAVICON_ASSET))
  const missing = new Set()
  return {
    overlay,
    missing,
    read(relativePath) {
      if (missing.has(relativePath) || !overlay.has(relativePath)) throw new Error('missing')
      const value = overlay.get(relativePath)
      if (Buffer.isBuffer(value)) return value.toString('utf8')
      return value
    },
    buffer(relativePath) {
      if (missing.has(relativePath) || !overlay.has(relativePath)) throw new Error('missing')
      const value = overlay.get(relativePath)
      return Buffer.isBuffer(value) ? value : Buffer.from(value)
    },
    exists(relativePath) {
      return overlay.has(relativePath) && !missing.has(relativePath)
    },
  }
}

function expectMutation(label, expectedCode, mutate) {
  const io = virtualIo()
  mutate(io)
  const errors = validate(io)
  assert(errors.some((error) => error.startsWith(`${expectedCode}:`)), `${label} was not rejected:\n${errors.join('\n')}`)
  process.stdout.write(`SELF-TEST PASS ${label}\n`)
}

function selfTest() {
  assertClean(virtualIo(), 'virtual baseline')
  expectMutation('apex becomes www', 'APEX_ORIGIN', (io) => {
    const key = 'mingla-marketing/lib/site.ts'
    io.overlay.set(key, io.read(key).replace("https://usemingla.com' as const", "https://www.usemingla.com' as const"))
  })
  expectMutation('canonical removed', 'CANONICAL_METADATA', (io) => {
    const key = 'mingla-marketing/lib/search/metadata.ts'
    io.overlay.set(key, io.read(key).replace('    alternates: { canonical },\n', ''))
  })
  expectMutation('noindex route leaked into sitemap', 'SITEMAP_LEAK', (io) => {
    const key = 'mingla-marketing/app/sitemap.ts'
    io.overlay.set(key, `${io.read(key)}\nconst leakedNoindexRoute = '/links'\n`)
  })
  expectMutation('lifecycle route deleted', 'SEARCH_ROUTE_SET', (io) => {
    const key = 'mingla-marketing/lib/search/route-registry.ts'
    io.overlay.set(key, io.read(key).replace("pathname: '/support'", "pathname: '/support-deleted'"))
  })
  expectMutation('brand asset missing', 'BRAND_ASSET_MISSING', (io) => {
    io.missing.add('mingla-marketing/public/brand/mingla-logo-white-on-orange.png')
  })
  expectMutation('illustrative rating injected into JSON-LD', 'ENTITY_GRAPH_CLAIMS', (io) => {
    const key = 'mingla-marketing/lib/search/entity-graph.ts'
    io.overlay.set(key, `${io.read(key)}\nconst forbiddenClaim = { aggregateRating: 4.9, downloadCount: 10000 }\n`)
  })
  process.stdout.write('#2981 strict-grep self-test PASS: 6 adversarial mutations rejected\n')
}

if (process.argv.includes('--self-test')) {
  selfTest()
} else {
  assertClean(actualIo(), '#2981 marketing search foundation FAIL')
  process.stdout.write('#2981 marketing search foundation PASS\n')
}
