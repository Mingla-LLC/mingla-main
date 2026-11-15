import { expect, test, type Page, type Route } from '@playwright/test'

// #4238 P1-5 (I-4238-NO-PRIVATE-TOKEN-TO-PIXELS), real browser, real export.
// A public event page whose address carries a buyer return page's private key
// (`?bst=…`, `#csi=…`) must start no third-party ad pixel at all: no request to
// Meta, TikTok, Snap or Reddit. GA4 may load, but nothing it is handed may
// carry the key. Production served this page as the server document from
// server/publicSearchDocument.js, whose inline boot started all four pixels
// before the app (and its own guard) loaded; that leg is the regression. The
// same address served as the export's index.html (how the #2771 suite serves a
// cold SPA visit) proves the app's own guard. The control (no private key)
// proves the oracle sees pixels when they do start.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const publicSearch = require('../server/publicSearchDocument') as {
  handlePublicSearchDocument: (input: { req: unknown; res: unknown; kind: string; slugs: string[] }) => Promise<void>
}

const BUSINESS = 'http://127.0.0.1:43172'
const PATH = '/e/issue4238-host/issue4238-night'
const TOKEN = 'issue4238privatetoken'
const PIXEL_HOSTS: [string, RegExp][] = [
  ['meta', /(?:^|\.)facebook\.(?:net|com)$/],
  ['tiktok', /(?:^|\.)tiktok(?:w)?\.(?:com|us)$/],
  ['snap', /(?:^|\.)(?:sc-static\.net|snapchat\.com)$/],
  ['reddit', /(?:^|\.)(?:redditstatic\.com|reddit\.com)$/],
]
const GA_HOST = /(?:^|\.)(?:googletagmanager\.com|google-analytics\.com|doubleclick\.net)$/
const PIXEL_ENV: Record<string, string> = {
  EXPO_PUBLIC_META_PIXEL_ID: 'issue4238meta',
  EXPO_PUBLIC_TIKTOK_PIXEL_CODE: 'issue4238tiktok',
  EXPO_PUBLIC_SNAP_PIXEL_ID: 'issue4238snap',
  EXPO_PUBLIC_REDDIT_PIXEL_ID: 'issue4238reddit',
}

const facts = {
  kind: 'event',
  id: 'issue4238-event',
  title: 'Issue 4238 night',
  brandName: 'Issue 4238 Host',
  brandSlug: 'issue4238-host',
  brandId: '00000000-0000-4000-8000-000000004238',
  description: 'A public page used to prove the #4238 private-key pixel guard.',
  city: 'Lagos',
  startAt: '2030-01-01T19:00:00Z',
  timezone: 'UTC',
}

// The real server handler, with only its Supabase resolver call answered.
async function serverDocument(url: string) {
  const realFetch = globalThis.fetch
  const saved: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(PIXEL_ENV)) {
    saved[key] = process.env[key]
    process.env[key] = value
  }
  const response = { statusCode: 0, headers: {} as Record<string, string>, body: '' }
  const res = {
    get statusCode() { return response.statusCode },
    set statusCode(value: number) { response.statusCode = value },
    setHeader(key: string, value: string) { response.headers[key.toLowerCase()] = String(value) },
    end(value = '') { response.body = String(value) },
  }
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ valid: true, kind: 'event', integrityOk: true, state: 'search_ready', facts }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )) as typeof fetch
  try {
    await publicSearch.handlePublicSearchDocument({
      req: { method: 'GET', url },
      res,
      kind: 'event',
      slugs: ['issue4238-host', 'issue4238-night'],
    })
  } finally {
    globalThis.fetch = realFetch
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
  expect(response.statusCode).toBe(200)
  expect(response.body).toContain('<main class="shell">')
  return response
}

async function stripePrefix(): Promise<string | null> {
  const html = await (await fetch(`${BUSINESS}/index.html`)).text()
  const sources = [...html.matchAll(/<script[^>]+src="([^"?]+)[^"]*"/g)].map((match) => match[1])
  for (const chunk of sources) {
    const match = /\bpk_(live|test)_[A-Za-z0-9]{8,}/.exec(await (await fetch(`${BUSINESS}${chunk}`)).text())
    if (match) return `pk_${match[1]}_`
  }
  return null
}

interface Seen {
  pixels: Record<string, string[]>
  ga: string[]
  thirdParty: string[]
}

async function open(page: Page, address: string, serving: 'server-document' | 'spa-index'): Promise<Seen> {
  const seen: Seen = { pixels: { meta: [], tiktok: [], snap: [], reddit: [] }, ga: [], thirdParty: [] }
  const target = new URL(address, BUSINESS)
  const served = serving === 'server-document' ? await serverDocument(`${target.pathname}${target.search}`) : null
  const prefix = await stripePrefix()
  await page.route('**/*', async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin === BUSINESS) {
      if (request.resourceType() === 'document' && url.pathname === PATH) {
        if (served) await route.fulfill({ status: 200, headers: served.headers, body: served.body })
        else await route.fulfill({ response: await route.fetch({ url: `${url.origin}/` }) })
        return
      }
      await route.continue()
      return
    }
    seen.thirdParty.push(request.url())
    for (const [name, host] of PIXEL_HOSTS) {
      if (host.test(url.hostname)) seen.pixels[name].push(request.url())
    }
    if (GA_HOST.test(url.hostname)) seen.ga.push(request.url())
    if (/\.supabase\.co$/.test(url.hostname)) {
      if (url.pathname.endsWith('/functions/v1/stripe-mode') && prefix) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ mode: prefix === 'pk_live_' ? 'live' : 'test', publishablePrefix: prefix }),
        })
        return
      }
      if (url.pathname.startsWith('/rest/v1/')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
        return
      }
    }
    await route.abort()
  })
  await page.goto(target.toString(), { waitUntil: 'domcontentloaded' })
  return seen
}

async function appTookOver(page: Page): Promise<void> {
  await expect(page.locator('#root > main.shell')).toHaveCount(0, { timeout: 30_000 })
  await expect(page.locator('#root > *').first()).toBeAttached({ timeout: 30_000 })
}

async function expectNoPixelAndSanitizedGa(page: Page, seen: Seen): Promise<void> {
  // Give an async vendor boot every chance to show up.
  await page.waitForTimeout(3_000)
  expect(seen.pixels).toEqual({ meta: [], tiktok: [], snap: [], reddit: [] })
  const globals = await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>
    return {
      fbq: typeof w.fbq,
      ttq: typeof w.ttq,
      snaptr: typeof w.snaptr,
      rdt: typeof w.rdt,
      booted: w.__minglaAdPixelsBootstrapped === true,
      pixelScripts: document.querySelectorAll('script[data-mingla-pixel]').length,
      dataLayer: JSON.stringify((w.dataLayer as unknown[] | undefined) ?? []),
    }
  })
  expect(globals).toMatchObject({ fbq: 'undefined', ttq: 'undefined', snaptr: 'undefined', rdt: 'undefined', booted: false, pixelScripts: 0 })
  // GA4 may load, but neither its requests nor anything queued for it carries the key.
  expect(seen.ga.filter((url) => url.includes(TOKEN))).toEqual([])
  expect(globals.dataLayer.includes(TOKEN)).toBe(false)
  expect(seen.thirdParty.filter((url) => url.includes(TOKEN) && !/\.supabase\.co\//.test(url))).toEqual([])
}

test.describe('#4238 no ad pixel in a document whose address carries a private key', () => {
  test('control: the public event page without a private key starts all four pixels', async ({ page }) => {
    const seen = await open(page, `${PATH}?utm_source=issue4238`, 'server-document')
    for (const name of Object.keys(seen.pixels)) {
      await expect.poll(() => seen.pixels[name].length, { message: `${name} pixel requested` }).toBeGreaterThan(0)
    }
  })

  test("control: the app's own boot without a private key still starts the pixel this export carries", async ({ page }) => {
    // CI's export bakes only the Meta id (EXPO_PUBLIC_META_PIXEL_ID=issue2771).
    const seen = await open(page, `${PATH}?utm_source=issue4238`, 'spa-index')
    await expect.poll(() => seen.pixels.meta.length, { timeout: 30_000, message: 'meta pixel requested' }).toBeGreaterThan(0)
    await expect.poll(() => seen.ga.length, { timeout: 30_000, message: 'GA4 requested' }).toBeGreaterThan(0)
  })

  for (const address of [`${PATH}?bst=${TOKEN}`, `${PATH}#csi=${TOKEN}`]) {
    test(`server document ${address.slice(PATH.length)}: no pixel before or after the app takes over`, async ({ page }) => {
      const seen = await open(page, address, 'server-document')
      await appTookOver(page)
      await expectNoPixelAndSanitizedGa(page, seen)
    })

    test(`app document ${address.slice(PATH.length)}: no pixel from the app's own boot`, async ({ page }) => {
      const seen = await open(page, address, 'spa-index')
      await expect(page.locator('#root > *').first()).toBeAttached({ timeout: 30_000 })
      await expectNoPixelAndSanitizedGa(page, seen)
    })
  }
})
