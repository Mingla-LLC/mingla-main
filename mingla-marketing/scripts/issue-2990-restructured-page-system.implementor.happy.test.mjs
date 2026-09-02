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
const CATEGORIES = ['nature', 'icebreakers', 'drinks', 'brunch', 'casual_food', 'fine_dining', 'movies', 'theatre', 'creative_arts', 'play']
const ROUTES = [
  ['/internal/page-system/city-lagos', 'Things to do in Lagos, ranked by Mingla'],
  ['/internal/page-system/explorer-event-guide', 'Things to do in Lagos for parties, dates, hangouts and culture'],
  ['/internal/page-system/host-event-promoter-guide', 'Promote your event with one clear reason to go'],
]

let passed = 0
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
const pass = (label) => { passed += 1; process.stdout.write(`PASS ${label}\n`) }
const decode = (value) => value.replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#x27;|&#39;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
const text = (html) => decode(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()

function sourceContract() {
  const data = read('lib/page-system/city-catalogue.server.ts')
  const rows = data.split('\n').filter((line) => /^\s*\['[0-9a-f-]{36}'/.test(line))
  const ids = rows.map((line) => line.match(/\['([0-9a-f-]{36})'/)?.[1])
  assert.equal(rows.length, 50, 'Lagos snapshot must contain exactly 50 places')
  assert.equal(new Set(ids).size, 50, 'Lagos snapshot IDs must be unique')
  for (const category of CATEGORIES) {
    assert.equal(rows.filter((line) => line.includes(`, '${category}',`)).length, 5, `${category} must contain exactly five places`)
  }
  assert.equal(rows.filter((line) => /, true,/.test(line)).length, 48, 'AI-informed marker must follow the captured score receipts')
  assert(rows.every((line) => /, '[^']+\/0\.jpg',/.test(line)), 'every place must use its stored Mingla photo path')
  assert.match(data, /The pool follows Mingla’s Lagos city assignment|same eligibility and per-signal/)
  const planAdapter = data.slice(data.indexOf('export function getLagosCuratedPlans'))
  assert.doesNotMatch(planAdapter, /plan(?:Match|Score)|signalScore|aiBlended|recommendationCount/i)
  assert.match(planAdapter, /duration: null/)
  assert.match(planAdapter, /price: null/)
  pass('exact balanced production snapshot and score truth')

  const cityPage = read('app/internal/page-system/city-lagos/page.tsx')
  const catalogue = read('components/page-system/city-catalogue.tsx')
  const card = read('components/page-system/explorer-catalogue-card.tsx')
  const detail = read('components/page-system/catalogue-detail.tsx')
  const hostBar = read('components/page-system/city-host-acquisition-bar.tsx')
  assert.match(cityPage, /<CityCatalogue/)
  assert.match(cityPage, /publicNoindexMetadata\('\/internal\/page-system\/city-lagos'/)
  assert.match(cityPage, /hostAcquisition/)
  assert.match(catalogue, /categories/)
  assert.match(catalogue, /intents/)
  assert.match(catalogue, /window\.history\.pushState/)
  assert.match(detail, /role="dialog"/)
  assert.match(detail, /Back to Lagos picks/)
  assert.match(card, /aria-describedby=\{aiDescriptionId\}/)
  assert.match(card, /AI-informed means an AI signal was blended into this stored Mingla category score/)
  assert.match(card, /Mingla score/)
  assert.match(card, /View place/)
  assert.match(card, /View plan/)
  for (const suffix of ['event/create', 'trip/create', 'experience/create', 'venue/create']) {
    assert(hostBar.includes(`https://host.usemingla.com/${suffix}`), `missing exact Host route ${suffix}`)
  }
  pass('filterable catalogue, URL-backed details, AI meaning and exact Host actions')

  const explorerPage = read('app/internal/page-system/explorer-event-guide/page.tsx')
  const explorerGuide = read('components/page-system/city-editorial-guide.tsx')
  const editorial = read('content/page-system/lagos-editorial.ts')
  assert.match(explorerPage, /<CityEditorialGuide/)
  assert.match(explorerPage, /publicNoindexMetadata\('\/internal\/page-system\/explorer-event-guide'/)
  assert.doesNotMatch(explorerPage, /PlanFitCheck|DemoDisclosure|MotionAwareMontage/)
  assert.equal((editorial.match(/id: '(?:party|date|hangout|culture)'/g) ?? []).length, 4)
  assert.equal((editorial.match(/categorySlugs: \[/g) ?? []).length, 4)
  assert.equal((editorial.match(/source: /g) ?? []).length, 3)
  assert.match(explorerGuide, /const used = new Set<string>\(\)/)
  assert.match(explorerGuide, /!used\.has\(place\.placePoolId\)/)
  assert.doesNotMatch(explorerGuide, /<main\b|id="main"/)
  pass('short picture-led four-mood guide with twelve non-duplicated real picks')

  const hostPage = read('app/internal/page-system/host-event-promoter-guide/page.tsx')
  const hostFamily = read('content/page-system/host-guide-family.ts')
  const hostGuide = read('components/page-system/host-selling-guide.tsx')
  const toolEmbed = read('components/page-system/growth-tool-embed.tsx')
  assert.match(hostPage, /HOST_GUIDE_FAMILY\.event/)
  assert.match(hostPage, /publicNoindexMetadata\('\/internal\/page-system\/host-event-promoter-guide'/)
  assert.doesNotMatch(hostPage, /LaunchToDoorTimeline|DemoDisclosure|BeforeAfter/)
  for (const kind of ['event', 'trip', 'venue', 'experience']) {
    const segment = hostFamily.slice(hostFamily.indexOf(`  ${kind}: {`), kind === 'experience' ? undefined : hostFamily.indexOf(`  ${['trip', 'venue', 'experience'][['event', 'trip', 'venue'].indexOf(kind)]}: {`))
    assert.equal((segment.match(/\{ title: /g) ?? []).length, 3, `${kind} must have exactly three tips`)
    assert(toolEmbed.includes(`tool === '${kind}'`) || kind === 'experience', `${kind} must map to a real tool`)
  }
  assert.match(hostGuide, /guide\.heroMedia\.src/)
  assert.match(hostGuide, /guide\.creationNoun/)
  assert.match(hostGuide, /GrowthToolEmbed/)
  for (const file of [
    'app/tools/events/EventPredictorExperience.tsx',
    'app/tools/trips/TripQuoterExperience.tsx',
    'app/tools/venues/GraderExperience.tsx',
    'app/tools/pricing/PricingAuditExperience.tsx',
  ]) {
    const experience = read(file)
    assert.match(experience, /\{ embedded = false \}/)
    assert.match(experience, /embedded \? \(/)
  }
  pass('reusable four-ICP Host guide family embeds the four working tools')

  const packageJson = JSON.parse(read('package.json'))
  const shell = read('components/page-system/page-system-shell.tsx')
  const css = read('components/page-system/page-system.css')
  const allRenderedSources = [cityPage, explorerPage, hostPage, catalogue, card, detail, explorerGuide, hostGuide].join('\n')
  assert.equal(packageJson.scripts['test:page-system'], 'node scripts/issue-2990-restructured-page-system.implementor.happy.test.mjs')
  assert(packageJson.scripts.build.startsWith('node scripts/issue-2990-restructured-page-system.implementor.happy.test.mjs --source-only && '))
  assert.equal(packageJson.scripts.postbuild, 'node scripts/issue-2990-restructured-page-system.implementor.happy.test.mjs --built-only')
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/)
  assert.match(css, /@media \(max-width: 639px\)[\s\S]*grid-template-columns: 1fr/)
  assert.match(css, /@media \(max-width: 899px\)[\s\S]*repeat\(2/)
  assert.match(css, /@media \(max-width: 1199px\)[\s\S]*repeat\(3/)
  assert.match(css, /min-height: 420px/)
  assert.doesNotMatch(allRenderedSources, /PlanFitCheck|LaunchToDoorTimeline|AudienceFork|fictional choices/i)
  for (const city of ['Lagos', 'Durham', 'Cary', 'Raleigh', 'New York City', 'Brussels', 'Paris', 'London', 'Fort Lauderdale', 'Washington DC']) {
    assert(shell.includes('LAUNCH_CITIES') || cityPage.includes(city), `city system must retain ${city}`)
  }
  pass('responsive private template replaces the rejected rendered fixtures')
}

async function availablePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  assert(address && typeof address === 'object')
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return address.port
}

function request(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, headers: { 'Accept-Encoding': 'identity' } }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.once('error', reject)
    req.end()
  })
}

function tagCount(html, tag) {
  return (html.match(new RegExp(`<${tag}\\b`, 'gi')) ?? []).length
}

function pageFacts(html) {
  const visible = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  const h1 = [...visible.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)]
  const main = visible.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? ''
  const robots = visible.match(/<meta[^>]+name=["']robots["'][^>]+content=["']([^"']+)/i)?.[1] ?? ''
  return { visible, main, h1Count: h1.length, h1: text(h1[0]?.[1] ?? ''), robots }
}

async function waitReady(port, child) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`next start exited with ${child.exitCode}`)
    try { if ((await request(port, '/robots.txt')).status === 200) return } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('next start did not become ready')
}

async function builtContract() {
  assert(fs.existsSync(path.join(ROOT, '.next', 'BUILD_ID')), 'run next build before the built contract')
  const port = await availablePort()
  const child = spawn(process.execPath, [path.join(ROOT, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk })
  child.stderr.on('data', (chunk) => { output += chunk })
  try {
    await waitReady(port, child)
    for (const [pathname, expectedH1] of ROUTES) {
      const response = await request(port, pathname)
      assert.equal(response.status, 200, `${pathname} must return 200`)
      const facts = pageFacts(response.body)
      assert.equal(facts.h1Count, 1, `${pathname} must contain exactly one visible H1`)
      assert.equal(facts.h1, expectedH1)
      assert.match(facts.robots, /noindex/i)
      assert.match(facts.robots, /nofollow/i)
      assert.doesNotMatch(facts.visible, /rel=["']canonical["']/i)
      assert.equal(tagCount(facts.visible, 'main'), 1, `${pathname} must contain one main landmark`)
    }

    const city = pageFacts((await request(port, ROUTES[0][0])).body)
    const placeCards = [...city.main.matchAll(/<a\b[^>]*class=["'][^"']*ps-catalogue-card[^"']*["'][^>]*data-kind=["']place["'][^>]*>/gi)]
    assert.equal(placeCards.length, 50, 'default city response must render exactly 50 place cards')
    assert.match(text(city.main), /50 Lagos places/)
    assert.match(city.main, /aria-describedby=["']ai-meaning-/)

    const detailPath = '/internal/page-system/city-lagos?type=places&detail=place%3Aba952a16-1b52-4f23-ba4c-3aa8741d8a33'
    const directDetail = pageFacts((await request(port, detailPath)).body)
    assert.match(directDetail.main, /data-catalogue-detail/)
    assert.match(text(directDetail.main), /Lekki Conservation Centre/)
    assert.match(text(directDetail.main), /Back to Lagos picks/)
    assert.match(directDetail.main, /href=["']\/internal\/page-system\/city-lagos\?type=places["']/)

    const plans = pageFacts((await request(port, '/internal/page-system/city-lagos?type=plans')).body)
    const planCards = [...plans.main.matchAll(/<a\b[^>]*class=["'][^"']*ps-catalogue-card[^"']*["'][^>]*data-kind=["']plan["'][^>]*>/gi)]
    assert.equal(planCards.length, 6, 'plan view must render the six captured editorial plans')
    assert.doesNotMatch(text(plans.main), /Plan match|plan score/i)

    const guide = pageFacts((await request(port, ROUTES[1][0])).body)
    const guideCards = [...guide.main.matchAll(/<a\b[^>]*class=["'][^"']*ps-catalogue-card[^"']*["'][^>]*data-kind=["']place["'][^>]*>/gi)]
    const guideHrefs = guideCards.map((match) => match[0].match(/href=["']([^"']+)/i)?.[1])
    assert.equal(guideCards.length, 12, 'Explorer guide must render three picks per section')
    assert.equal(new Set(guideHrefs).size, 12, 'Explorer guide picks must not repeat')
    for (const id of ['party', 'date', 'hangout', 'culture']) assert.match(guide.main, new RegExp(`id=["']${id}["']`))

    const host = pageFacts((await request(port, ROUTES[2][0])).body)
    assert.equal((host.main.match(/<li\b/g) ?? []).length, 3, 'Host guide must render exactly three selling tips')
    assert.match(text(host.main), /Event Turnout Predictor/)
    assert.match(text(host.main), /A forecast or audit is guidance, not a guarantee/)
    pass('built SSR, noindex, balanced cards, no-JS details and guide contracts')
  } finally {
    child.kill('SIGTERM')
    await new Promise((resolve) => { child.once('exit', resolve); setTimeout(resolve, 2_000) })
    if (child.exitCode && child.exitCode !== 0 && child.signalCode !== 'SIGTERM') process.stderr.write(output)
  }
}

if (!BUILT_ONLY) sourceContract()
if (!SOURCE_ONLY) await builtContract()
process.stdout.write(`PASS issue #2990 restructured page-system happy path (${passed} groups)\n`)
