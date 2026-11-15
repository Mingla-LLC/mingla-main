// MINGLA-INVARIANT: I-4238-MARKETING-PIXEL-CONSENT-GATED | issue #4238 | no vendor pixel script exists in the usemingla.com document while ads are off for this visitor (GPC starts them off), no pixel loads on a page whose URL carries a private token, and a turn-off removes every pixel script and expires the pixel cookies.
//
// #4238 W3-1 (D8) — implementor regression test for the usemingla.com pixels.
// Runs the real lib/marketing-pixels.ts (through the round B type-strip
// loader) in a fake browser (issue-4238-fake-browser.mjs):
//   a. the CSP next.config.ts serves allows the four pixel script origins and
//      their beacon hosts (report-only connect-src);
//   b. ads on: bootMarketingPixels injects the four markers, inits each pixel
//      with its id, sends PageView once per path and ViewContent on /host/*;
//   c. ads off, or GPC on with no saved choice: no marker is injected;
//   d. a turn-off removes every marker, revokes, and expires the five cookies;
//   e. a private page (#4273 paths, tool reports with a token) loads nothing;
//   f. the host lead fires the catalogue's names with the server's event id;
//   g. the root analytics owner loads the module lazily and stops it on a turn-off.
//
// Run from mingla-marketing/ (Node 22.13+):
//   node --test lib/__tests__/issue-4238-marketing-pixels.implementor.test.mjs

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, beforeEach, test } from 'node:test'
import { MARKETING, makeLoader } from './issue-4339-round-b-load.mjs'
import { installFakeBrowser, savePrivacy, vendorCalls } from './issue-4238-fake-browser.mjs'

const loader = makeLoader()
after(() => loader.cleanup())

const IDS = { meta: '1949011972638955', tiktok: 'TTCODE4238', snap: 'snap-4238', reddit: 'a2_4238' }

let browser
let pixels
let capture
beforeEach(async () => {
  browser = installFakeBrowser({ url: 'https://usemingla.com/host/events' })
  pixels ??= await loader.load('lib/marketing-pixels.ts')
  capture ??= await loader.load('components/marketing/marketing-capture.ts')
  // The privacy owner caches the page's choice; re-read storage each case.
  capture.setMarketingPageChoice(undefined)
})

test('a. the served CSP allows the four pixel scripts and their beacons', async () => {
  // next.config.ts is CommonJS-flavoured (it reads __dirname); give the ESM copy one.
  globalThis.__dirname = MARKETING
  const config = (await loader.load('next.config.ts')).default
  delete globalThis.__dirname
  const [{ headers }] = await config.headers()
  const enforced = headers.find((h) => h.key === 'Content-Security-Policy').value
  const reportOnly = headers.find((h) => h.key === 'Content-Security-Policy-Report-Only').value
  const scriptSrc = /script-src ([^;]+)/.exec(enforced)[1].split(' ')
  for (const origin of ['https://connect.facebook.net', 'https://analytics.tiktok.com', 'https://sc-static.net', 'https://www.redditstatic.com']) {
    assert.ok(scriptSrc.includes(origin), `script-src has ${origin}`)
  }
  const connect = /connect-src ([^;]+)/.exec(reportOnly)[1].split(' ')
  for (const origin of ['https://www.facebook.com', 'https://*.facebook.com', 'https://analytics.tiktok.com', 'https://*.tiktok.com', 'https://tr.snapchat.com', 'https://*.snapchat.com', 'https://*.reddit.com']) {
    assert.ok(connect.includes(origin), `connect-src has ${origin}`)
  }
  assert.match(reportOnly, /img-src 'self' data: blob: https:/)
  // Every loader URL the module injects is covered by script-src.
  for (const src of Object.values(pixels.MARKETING_PIXEL_SCRIPTS)) assert.ok(scriptSrc.includes(new URL(src).origin), src)
})

test('b. ads on: four markers, each pixel inited with its id, PageView once per path, ViewContent on /host/*', () => {
  pixels.bootMarketingPixels('/host/events', '', IDS)
  assert.deepEqual(browser.markers().sort(), ['meta', 'reddit', 'snap', 'tiktok'])
  assert.ok(browser.scripts().includes(`https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=${IDS.tiktok}&lib=ttq`))
  const calls = vendorCalls(browser.window)
  assert.deepEqual(calls.fbq[0], ['init', IDS.meta])
  assert.equal(browser.window.fbq.disablePushState, true, 'Meta sends no automatic SPA PageView')
  assert.deepEqual(calls.fbq.slice(1), [['track', 'PageView'], ['track', 'ViewContent', { content_category: 'host', content_name: '/host/events' }]])
  assert.deepEqual(calls.snaptr, [['init', IDS.snap], ['track', 'PAGE_VIEW'], ['track', 'VIEW_CONTENT', { item_category: 'host' }]])
  assert.deepEqual(calls.rdt, [['init', IDS.reddit], ['track', 'PageVisit'], ['track', 'ViewContent']])
  assert.deepEqual(calls.ttq, [['page'], ['track', 'ViewContent', { content_category: 'host', content_name: '/host/events' }]])
  assert.ok(browser.window.ttq._i[IDS.tiktok], 'TikTok pixel code recorded for the SDK')

  // The same path again (a re-render) sends nothing; a new path sends one PageView and no ViewContent.
  pixels.bootMarketingPixels('/host/events', '', IDS)
  pixels.bootMarketingPixels('/blog', '', IDS)
  const again = vendorCalls(browser.window)
  assert.deepEqual(again.fbq.slice(3), [['track', 'PageView']])
  assert.equal(browser.markers().length, 4, 'scripts are injected once')
})

test('b2. ids come from the NEXT_PUBLIC_* names; a missing id leaves that pixel off', () => {
  const saved = { ...process.env }
  try {
    process.env.NEXT_PUBLIC_META_PIXEL_ID = IDS.meta
    process.env.NEXT_PUBLIC_TIKTOK_PIXEL_CODE = ''
    delete process.env.NEXT_PUBLIC_SNAP_PIXEL_ID
    process.env.NEXT_PUBLIC_REDDIT_PIXEL_ID = ` ${IDS.reddit} `
    assert.deepEqual(pixels.marketingPixelIds(), { meta: IDS.meta, tiktok: null, snap: null, reddit: IDS.reddit })
    pixels.bootMarketingPixels('/', '')
    assert.deepEqual(browser.markers().sort(), ['meta', 'reddit'])
  } finally {
    for (const k of ['NEXT_PUBLIC_META_PIXEL_ID', 'NEXT_PUBLIC_TIKTOK_PIXEL_CODE', 'NEXT_PUBLIC_SNAP_PIXEL_ID', 'NEXT_PUBLIC_REDDIT_PIXEL_ID']) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  }
})

test('c. ads off, or GPC on with no saved choice: no pixel script, no vendor global', async () => {
  savePrivacy(browser.window, { ads: false })
  pixels.bootMarketingPixels('/host/events', '', IDS)
  pixels.fireMarketingHostLead('lead:abc', IDS)
  assert.deepEqual(browser.markers(), [])
  assert.equal(browser.window.fbq, undefined)

  browser = installFakeBrowser({ url: 'https://usemingla.com/', gpc: true })
  capture.setMarketingPageChoice(undefined)
  pixels.bootMarketingPixels('/', '', IDS)
  assert.deepEqual(browser.markers(), [], 'GPC starts ads off')

  // GPC on but the visitor saved ads on: their choice wins.
  savePrivacy(browser.window, { ads: true })
  capture.setMarketingPageChoice(undefined)
  pixels.bootMarketingPixels('/', '', IDS)
  assert.equal(browser.markers().length, 4)
})

test('d. a turn-off removes every marker, revokes, and expires the five pixel cookies', () => {
  pixels.bootMarketingPixels('/host/events', '', IDS)
  const fbq = browser.window.fbq
  pixels.stopMarketingPixels()
  assert.deepEqual(browser.markers(), [])
  assert.deepEqual(fbq.queue.at(-1), ['consent', 'revoke'])
  for (const g of ['fbq', '_fbq', 'ttq', 'snaptr', 'rdt']) assert.equal(browser.window[g], undefined, g)
  for (const name of ['_fbp', '_fbc', '_ttp', '_scid', '_rdt_uuid']) {
    assert.ok(browser.cookieWrites.some((c) => c.startsWith(`${name}=;`) && c.includes('1970') && c.includes('domain=.usemingla.com')), `${name} expired on .usemingla.com`)
  }
  // After a turn-off a later boot (ads back on) sends a fresh PageView.
  pixels.bootMarketingPixels('/host/events', '', IDS)
  assert.equal(browser.markers().length, 4)
})

test('e. a page whose URL carries a private token never loads a pixel', () => {
  for (const [p, q] of [['/unsubscribe/sms/abc.def', ''], ['/tools/venues/report', '?id=1&t=tok'], ['/tools/events/report/', ''], ['/anything', '?t=tok']]) {
    assert.equal(pixels.isPixelPrivatePage(p, q), true, `${p}${q}`)
    pixels.bootMarketingPixels(p, q, IDS)
  }
  assert.deepEqual(browser.markers(), [])
  assert.equal(pixels.isPixelPrivatePage('/tools/venues', ''), false)
  assert.equal(pixels.isPixelPrivatePage('/schedule', '?icp=venue'), false)
})

test('f. the host lead fires the catalogue names with the server event id on all four pixels', async () => {
  const catalog = await loader.load('lib/ad-event-catalog.ts')
  assert.deepEqual(catalog.MARKETING_HOST_LEAD_EVENT, { meta: 'Lead', tiktok: 'Lead', snap: 'SIGN_UP', reddit: 'Lead' })
  browser = installFakeBrowser({ url: 'https://usemingla.com/schedule' })
  capture.setMarketingPageChoice(undefined)
  pixels.fireMarketingHostLead('lead:11111111-2222-4333-8444-555555555555', IDS)
  const calls = vendorCalls(browser.window)
  const id = 'lead:11111111-2222-4333-8444-555555555555'
  assert.deepEqual(calls.fbq.at(-1), ['track', 'Lead', {}, { eventID: id }])
  assert.deepEqual(calls.ttq.at(-1), ['track', 'Lead', {}, { event_id: id }])
  assert.deepEqual(calls.snaptr.at(-1), ['track', 'SIGN_UP', { client_dedup_id: id }])
  assert.deepEqual(calls.rdt.at(-1), ['track', 'Lead', { conversionId: id }])
  // No PageView rides along with a lead fired before the strip booted the page.
  assert.ok(!calls.fbq.some((c) => c[1] === 'PageView'))
})

test('g. the root analytics owner loads the pixels lazily, per route, and stops them on a turn-off', () => {
  const provider = fs.readFileSync(path.join(MARKETING, 'components/marketing/posthog-provider.tsx'), 'utf8')
  assert.doesNotMatch(provider, /^import[^\n]*marketing-pixels/m, 'never a static import (first-load budget)')
  assert.match(provider, /import\('@\/lib\/marketing-pixels'\)\s*\.then\(\(pixels\) => pixels\.bootMarketingPixels\(pathname, search\)\)/)
  assert.match(provider, /import\('@\/lib\/marketing-pixels'\)\s*\.then\(\(pixels\) => pixels\.stopMarketingPixels\(\)\)/)
  assert.match(provider, /syncMarketingPixels\(\)\s*window\.addEventListener\(MARKETING_PRIVACY_EVENT, syncMarketingPixels\)/)
  assert.match(provider, /\}, \[pathname\]\)/)
  for (const file of ['app/layout.tsx', 'components/marketing/consent-banner.tsx']) {
    assert.doesNotMatch(fs.readFileSync(path.join(MARKETING, file), 'utf8'), /marketing-pixels/, `${file} does not load the pixels`)
  }
})
