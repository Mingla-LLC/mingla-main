#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
const decode = (value) => value.replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#x27;|&#39;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
const visibleText = (html) => decode(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
const mainHtml = (html) => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? ''
const cardTags = (html, kind) => [...html.matchAll(new RegExp(`<article\\b(?=[^>]*class=["'][^"']*ps-catalogue-card[^"']*["'])(?=[^>]*data-kind=["']${kind}["'])[^>]*>`, 'gi'))]

function sourceContract() {
  const page = read('app/internal/page-system/city-lagos/page.tsx')
  const catalogue = read('components/page-system/city-catalogue.tsx')
  const card = read('components/page-system/explorer-catalogue-card.tsx')
  const detail = read('components/page-system/catalogue-detail.tsx')
  const hostBar = read('components/page-system/city-host-acquisition-bar.tsx')
  const explorerGuide = read('components/page-system/city-editorial-guide.tsx')
  const hostGuide = read('components/page-system/host-selling-guide.tsx')
  const deviceCta = read('components/cutout/device-cta.tsx')
  const qrPanel = read('components/marketing/app-qr-panel.tsx')
  const hostFamily = read('content/page-system/host-guide-family.ts')
  const hostHeroMedia = read('components/page-system/host-hero-media.tsx')
  const provenanceChip = read('components/design-preview/system/provenance-chip.tsx')
  const planLab = read('components/design-preview/explorer/lagos-plan-lab.tsx')
  const truthfulCards = read('components/design-preview/explorer/truthful-cards.tsx')
  const eventPreview = read('components/design-preview/host/event-page-preview.tsx')
  const hostWorkflow = read('components/design-preview/host/host-workflow-lab.tsx')
  const contentBlocks = read('components/page-system/content-blocks.tsx')
  const css = read('components/page-system/page-system.css')
  const packageJson = JSON.parse(read('package.json'))

  assert.match(page, /requestedCategories\.filter\([\s\S]*EXPLORER_CATEGORIES\.some/,
    'unknown category query values must be allow-listed before reaching the catalogue')
  assert.match(page, /detail\?\.startsWith\('plan:'\)/,
    'a direct plan detail URL must select the plan catalogue without JavaScript')
  assert.match(catalogue, /That pick is no longer available\./,
    'stale or malformed detail URLs must fail closed with a useful message')
  assert.match(catalogue, /role="alert"/)
  assert.doesNotMatch(page, /Private Explorer snapshot|The city system scales|Next launch cities/)
  assert.match(card, /<article/)
  assert.match(card, /<DeviceCta[\s\S]*label="Get the app"/)
  assert.match(detail, /page_system_catalogue_detail_place/)
  assert.match(detail, /page_system_catalogue_detail_plan/)
  assert.match(detail, /childDialogOpenRef\.current/)
  assert.match(qrPanel, /import \{ createPortal \} from 'react-dom'/)
  assert.match(qrPanel, /setPortalHost\(document\.body\)/)
  assert.match(qrPanel, /return createPortal\([\s\S]*portalHost/)
  assert.match(explorerGuide, /Explore more of Lagos/)
  assert.match(explorerGuide, /surface="explorer"/)
  assert.match(explorerGuide, /label="Download the Explorer app"/)
  assert.match(explorerGuide, /variant="quiet"/)
  assert.doesNotMatch(explorerGuide, /private city catalogue|checked \{fact\.checkedAt\}/i)
  assert.match(hostGuide, /className="ps-host-guide-actions"/)
  assert.match(hostGuide, /surface="host"/)
  assert.match(hostGuide, /phoneLabel="Download the Host app"/)
  assert.match(hostGuide, /desktopLabel="Use Mingla Host on web"/)
  assert.match(hostGuide, /variant="ink"/)
  assert.doesNotMatch(hostGuide, /<figcaption|heroMedia\.caption/)
  assert.match(deviceCta, /label \?\? \(onPhone \? phoneLabel : desktopLabel\) \?\? defaultText/)
  assert.doesNotMatch(hostFamily, /caption:|illustrative concept image|not a real/i)
  assert.match(hostHeroMedia, /Loading the Mingla Host preview image\./)
  assert.doesNotMatch(hostHeroMedia, /<figcaption|Loading the illustrative|fictional event-hall|not a real/i)
  assert.match(provenanceChip, /if \(kind === 'illustrative'\) return null/)
  assert.doesNotMatch(planLab, /example, not a quote or a booking|<ProvenanceChip kind="illustrative"/i)
  assert.doesNotMatch(truthfulCards, /both figures are illustrative/i)
  assert.doesNotMatch(eventPreview, /fictional sample|Production needs|sample venue|kind="missing-asset"/i)
  assert.doesNotMatch(hostWorkflow, /demonstration of range|invented for the demonstration/i)
  assert.doesNotMatch(contentBlocks, /export function DemoDisclosure|Illustrative product demo|mistaking fiction for fact/i)
  assert.doesNotMatch(hostGuide, /ps-host-tips|Three things that make|Clear beats complicated/)
  assert.doesNotMatch(hostGuide, /Live Mingla growth tool|Pressure-test the plan/)
  assert.match(hostGuide, /GrowthToolEmbed/)
  assert.match(css, /--page-host-bar-height: calc\(48px \+ env\(safe-area-inset-top\)\)/)
  assert.match(css, /--page-host-bar-height: calc\(52px \+ env\(safe-area-inset-top\)\)/)
  assert.match(css, /\.page-system-root\[data-host-acquisition='true'\] \.ps-catalogue-controls \{ top: var\(--page-host-bar-height\); \}/)
  for (const selector of ['.ps-catalogue-card', '.ps-catalogue-photo', '.ps-catalogue-plate', '.ps-catalogue-facts']) {
    assert.doesNotMatch(cssRule(css, selector), /min-height|flex:/, `${selector} must remain content-driven rather than fixed or stretched`)
  }
  assert.match(cssRule(css, '.ps-catalogue-photo'), /aspect-ratio: 4 \/ 3/)
  assert.match(cssRule(css, '.ps-growth-tool-frame'), /padding: clamp\(72px,8vw,96px\)/)
  assert.match(cssRule(css, '.ps-host-guide-actions'), /flex-direction: column/)
  assert.match(cssRule(css, '.page-system-root .ps-guide-conversion-cta'), /margin-top: 30px/)

  const exactDestinations = [...hostBar.matchAll(/href: '(https:\/\/host\.usemingla\.com\/[^']+)'/g)].map((match) => match[1])
  assert.deepEqual(exactDestinations, [
    'https://host.usemingla.com/event/create',
    'https://host.usemingla.com/trip/create',
    'https://host.usemingla.com/experience/create',
    'https://host.usemingla.com/venue/create',
  ], 'the city Host affordance must expose exactly the four approved creation destinations')
  for (const [kind, route] of Object.entries({ event: 'event/create', trip: 'trip/create', venue: 'venue/create', experience: 'experience/create' })) {
    const record = hostFamily.slice(hostFamily.indexOf(`  ${kind}: {`), hostFamily.indexOf(`\n  ${kind === 'event' ? 'trip' : kind === 'trip' ? 'venue' : kind === 'venue' ? 'experience' : '__end__'}: {`) || undefined)
    assert(record.includes(`hostUrl: 'https://host.usemingla.com/${route}'`), `${kind} guide must keep its type-correct Host route`)
  }

  const implementor = 'node scripts/issue-2990-restructured-page-system.implementor.happy.test.mjs'
  const tester = 'node scripts/issue-2990-restructured-page-system.tester.adversarial.test.mjs'
  assert.equal(packageJson.scripts.postbuild, `${implementor} --built-only && ${tester}`)
  assert.equal(packageJson.scripts['test:page-system'], `${implementor} && ${tester}`)
  process.stdout.write('PASS adversarial source query, stale-link, Host-route and guard-wiring contracts\n')
}

function cssRule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'm'))?.[1] ?? ''
}

function layoutContractIssues({ cityPage, css }) {
  const issues = []
  const catalogueIndex = cityPage.indexOf('<CityCatalogue')
  const auxiliaryHeroIndexes = [cityPage.indexOf('className="ps-city-proof"'), cityPage.indexOf('className="ps-source-note"')]
    .filter((index) => index >= 0)
  if (auxiliaryHeroIndexes.some((index) => index < catalogueIndex)) {
    issues.push('auxiliary proof/source content still precedes the catalogue in the opening viewport')
  }
  if (/position:\s*fixed/.test(cssRule(css, '.ps-nav'))) {
    issues.push('the city navigation is still fixed instead of scrolling away below the Host bar')
  }
  if (/position:\s*fixed/.test(cssRule(css, '.ps-review-dock'))) {
    issues.push('the private review dock is still a fixed overlay that can cover controls, cards, dialogs and sheets')
  }
  return issues
}

function layoutContract() {
  const knownBad = layoutContractIssues({
    cityPage: '<header><div className="ps-city-proof"/><p className="ps-source-note"/></header><CityCatalogue/>',
    css: '.ps-nav { position: fixed; } .ps-review-dock { position: fixed; }',
  })
  assert.equal(knownBad.length, 3, 'layout oracle must reject the measured pre-fix opening and overlay structure')
  assert.deepEqual(layoutContractIssues({
    cityPage: '<header><h1>Lagos</h1></header><CityCatalogue/><div className="ps-city-proof"/>',
    css: '.ps-nav { position: static; } .ps-review-dock { position: relative; }',
  }), [], 'layout oracle must accept catalogue-first flow with non-overlaying review chrome')

  const issues = layoutContractIssues({
    cityPage: read('app/internal/page-system/city-lagos/page.tsx'),
    css: read('components/page-system/page-system.css'),
  })
  assert.deepEqual(issues, [], `catalogue-first and unobstructed-review layout contract failed:\n- ${issues.join('\n- ')}`)
  process.stdout.write('PASS catalogue-first opening viewport and non-obstructing review-dock contract\n')
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

async function waitReady(port, child) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`next start exited with ${child.exitCode}`)
    try { if ((await request(port, '/robots.txt')).status === 200) return } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('next start did not become ready')
}

async function runtimeContract() {
  assert(fs.existsSync(path.join(ROOT, '.next', 'BUILD_ID')), 'run next build before the adversarial runtime contract')
  const port = await availablePort()
  const child = spawn(process.execPath, [path.join(ROOT, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk })
  child.stderr.on('data', (chunk) => { output += chunk })
  try {
    await waitReady(port, child)

    const filteredResponse = await request(port, '/internal/page-system/city-lagos?type=garbage&categories=nature%2Cbogus')
    assert.equal(filteredResponse.status, 200)
    const filteredMain = mainHtml(filteredResponse.body)
    assert.equal(cardTags(filteredMain, 'place').length, 5, 'an invalid category must be discarded while the valid Nature filter remains')
    assert.match(visibleText(filteredMain), /5 Lagos places/)
    assert.doesNotMatch(visibleText(filteredMain), /bogus/i)

    const staleResponse = await request(port, '/internal/page-system/city-lagos?type=places&detail=place%3Anot-real')
    assert.equal(staleResponse.status, 200)
    const staleMain = mainHtml(staleResponse.body)
    assert.match(staleMain, /role=["']alert["']/)
    assert.match(visibleText(staleMain), /That pick is no longer available\./)
    assert.match(staleMain, /href=["']\/internal\/page-system\/city-lagos\?type=places["']/)

    const planResponse = await request(port, '/internal/page-system/city-lagos?detail=plan%3Alagos-editorial-romantic')
    assert.equal(planResponse.status, 200)
    const planMain = mainHtml(planResponse.body)
    assert.equal(cardTags(planMain, 'plan').length, 6, 'direct plan URLs must retain the six-plan catalogue behind the detail')
    assert.match(planMain, /data-catalogue-detail/)
    assert.match(visibleText(planMain), /Romantic/)
    assert.doesNotMatch(visibleText(planMain), /plan (?:rank|score)|match score/i)
    assert.equal((planMain.match(/>Get the app</g) ?? []).length, 1, 'expanded plans must expose the device-aware Explorer CTA')

    const injectedResponse = await request(port, '/internal/page-system/city-lagos?detail=place%3A%3Cscript%3Ealert(1)%3C%2Fscript%3E')
    assert.equal(injectedResponse.status, 200)
    const injectedMain = mainHtml(injectedResponse.body)
    assert.match(visibleText(injectedMain), /That pick is no longer available\./)
    assert.doesNotMatch(injectedMain, /<script>\s*alert\(1\)/i)

    const guideResponse = await request(port, '/internal/page-system/explorer-event-guide')
    assert.equal(guideResponse.status, 200)
    const guideMain = mainHtml(guideResponse.body)
    assert.match(visibleText(guideMain), /Explore more of Lagos/)
    assert.match(visibleText(guideMain), /Download the Explorer app/)
    assert.doesNotMatch(visibleText(guideMain), /private city catalogue|checked 2 September 2026/i)

    const hostResponse = await request(port, '/internal/page-system/host-event-promoter-guide')
    assert.equal(hostResponse.status, 200)
    const hostMain = mainHtml(hostResponse.body)
    assert.match(visibleText(hostMain), /Try the Event Turnout Predictor/)
    assert.match(visibleText(hostMain), /Use Mingla Host on web/)
    assert.match(hostMain, /href=["']https:\/\/host\.usemingla\.com[\/'"]/)
    assert.doesNotMatch(visibleText(hostMain), /illustrative|concept image|fictional sample|not a real/i)
    process.stdout.write('PASS adversarial SSR invalid filters, stale details, direct plans and injected detail values\n')
  } finally {
    child.kill('SIGTERM')
    await new Promise((resolve) => { child.once('exit', resolve); setTimeout(resolve, 2_000) })
    if (child.exitCode && child.exitCode !== 0 && child.signalCode !== 'SIGTERM') process.stderr.write(output)
  }
}

sourceContract()
layoutContract()
await runtimeContract()
process.stdout.write('PASS issue #2990 tester adversarial regression guard\n')
