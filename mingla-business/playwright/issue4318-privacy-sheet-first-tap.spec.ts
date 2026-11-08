import { expect, test, type Page, type Route } from '@playwright/test'

// #4318 follow-up — on the live event page at 390x844 the first tap on the
// "Privacy & ad choices" strip dimmed the page at once and the choices sheet
// came up 1-3s later, or never. Measured cause, on the server document that
// hands off to the Expo app (#3214):
//   1. the server sheet faded in from opacity 0 on a clock the page's boot work
//      stalls, so the scrim showed while the sheet was still invisible;
//   2. the boot hand-off dropped the page's stylesheet, which held the bar's
//      rules, so an open sheet lost its layout;
//   3. the app removed the server sheet and strip but left the scrim and opened
//      nothing: a dimmed page with no sheet.
// This proof taps the strip BEFORE the app can boot (its __common chunk is held)
// and asserts the sheet is fully visible in the very frame the scrim first is,
// within 100ms of the tap; then lets the app take over and asserts the same
// sheet is still open (the visitor's switch kept), with one scrim, which goes
// when the sheet closes.
//
// It runs against the REAL production-mode web export (`dist`, served by the
// web-build lane's #2771 config, or by playwright.issue3214.config.ts locally)
// and the REAL server document from server/publicSearchDocument.js.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const publicSearch = require('../server/publicSearchDocument') as {
  handlePublicSearchDocument: (input: { req: unknown; res: unknown; kind: string; slugs: string[] }) => Promise<void>
}

const BUSINESS = process.env.ISSUE_3214_BASE_URL ?? 'http://127.0.0.1:43172'
const PATH = '/e/issue4318-host/issue4318-night'
const SLUGS = ['issue4318-host', 'issue4318-night']
const VIEWPORT = { width: 390, height: 844 }

const FACTS = {
  kind: 'event',
  id: 'issue4318-event',
  title: 'Issue 4318 night',
  brandName: 'Issue 4318 Host',
  brandSlug: SLUGS[0],
  description: 'A public page used to prove the #4318 first tap.',
  city: 'Lagos',
  startAt: '2030-01-01T19:00:00Z',
  timezone: 'UTC',
}

type FirstFrame = {
  sinceTapMs: number
  scrimVisible: boolean
  sheetOpacity: string
  sheetTop: number
  sheetBottom: number
  serverCopy: boolean
}

// The real server handler, with only its Supabase resolver call answered.
async function serverDocument() {
  const realFetch = globalThis.fetch
  const response = { statusCode: 0, headers: {} as Record<string, string>, body: '' }
  const res = {
    get statusCode() { return response.statusCode },
    set statusCode(value: number) { response.statusCode = value },
    setHeader(key: string, value: string) { response.headers[key.toLowerCase()] = String(value) },
    end(value = '') { response.body = String(value) },
  }
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ valid: true, kind: 'event', integrityOk: true, state: 'search_ready', facts: FACTS }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )) as typeof fetch
  try {
    await publicSearch.handlePublicSearchDocument({ req: { method: 'GET', url: PATH }, res, kind: 'event', slugs: SLUGS })
  } finally {
    globalThis.fetch = realFetch
  }
  expect(response.statusCode).toBe(200)
  expect(response.body).toContain('data-mingla-ssr-privacy-strip')
  return response
}

async function entryChunks(): Promise<{ common: string; stripePrefix: string | null }> {
  const html = await (await fetch(`${BUSINESS}/index.html`)).text()
  const sources = [...html.matchAll(/<script[^>]+src="([^"?]+)[^"]*"/g)].map((match) => match[1])
  const common = sources.find((source) => /\/__common-[0-9a-f]+\.js$/.test(source)) ?? ''
  const index = sources.find((source) => /\/index-[0-9a-f]+\.js$/.test(source)) ?? ''
  expect(common, `index.html lists __common: ${JSON.stringify(sources)}`).not.toBe('')
  let stripePrefix: string | null = null
  for (const chunk of [index, common]) {
    const match = /\bpk_(live|test)_[A-Za-z0-9]{8,}/.exec(await (await fetch(`${BUSINESS}${chunk}`)).text())
    if (match) { stripePrefix = `pk_${match[1]}_`; break }
  }
  return { common, stripePrefix }
}

/**
 * Open the public page with the app's __common chunk held until `release()`.
 * Every tap on the strip records the first animation frame after it.
 */
async function openHeld(page: Page): Promise<{ release: () => void; pageErrors: string[] }> {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  const chunks = await entryChunks()
  const served = await serverDocument()
  let release = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  await page.addInitScript(() => {
    const frames: FirstFrame[] = []
    ;(window as unknown as { __issue4318Frames: FirstFrame[] }).__issue4318Frames = frames
    // Bubble phase on window: after the strip's own handler has run.
    window.addEventListener('click', (event) => {
      const target = event.target as Element | null
      if (!target || !target.closest('[data-testid="privacy-strip"]')) return
      const tappedAt = performance.now()
      requestAnimationFrame(() => {
        const visible = (node: Element | null): node is HTMLElement =>
          node instanceof HTMLElement && node.isConnected && !node.hidden && getComputedStyle(node).display !== 'none'
        const scrim = Array.from(document.querySelectorAll('[data-testid="privacy-scrim"]')).find(visible) ?? null
        const sheet = Array.from(document.querySelectorAll('[data-testid="privacy-sheet"]')).find(visible) ?? null
        const rect = sheet ? sheet.getBoundingClientRect() : null
        frames.push({
          sinceTapMs: Math.round(performance.now() - tappedAt),
          scrimVisible: scrim !== null,
          sheetOpacity: sheet ? getComputedStyle(sheet).opacity : 'none',
          sheetTop: rect ? Math.round(rect.top) : -1,
          sheetBottom: rect ? Math.round(rect.bottom) : -1,
          serverCopy: sheet ? sheet.hasAttribute('data-mingla-ssr-privacy-bar') : false,
        })
      })
    })
  })
  await page.route('**/*', async (route: Route) => {
    const url = new URL(route.request().url())
    if (url.origin === BUSINESS) {
      if (url.pathname === PATH) {
        await route.fulfill({ status: 200, headers: served.headers, body: served.body })
        return
      }
      if (url.pathname === chunks.common) {
        await gate
        await route.continue()
        return
      }
      await route.continue()
      return
    }
    // Hermetic: the bundle's Supabase calls get fixtures, everything else is cut.
    if (/\.supabase\.co$/.test(url.hostname)) {
      if (url.pathname.endsWith('/functions/v1/stripe-mode')) {
        if (!chunks.stripePrefix) { await route.abort(); return }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ mode: chunks.stripePrefix === 'pk_live_' ? 'live' : 'test', publishablePrefix: chunks.stripePrefix }),
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
  await page.goto(`${BUSINESS}${PATH}`, { waitUntil: 'domcontentloaded' })
  return { release, pageErrors }
}

async function tapStrip(page: Page): Promise<FirstFrame> {
  const before = await page.evaluate(() => (window as unknown as { __issue4318Frames: FirstFrame[] }).__issue4318Frames.length)
  // A real pointer tap at the strip's centre (the 28px strip at the very bottom).
  await page.mouse.click(VIEWPORT.width / 2, VIEWPORT.height - 14)
  await expect.poll(() => page.evaluate(() => (window as unknown as { __issue4318Frames: FirstFrame[] }).__issue4318Frames.length), { timeout: 2_000 }).toBe(before + 1)
  return page.evaluate((index) => (window as unknown as { __issue4318Frames: FirstFrame[] }).__issue4318Frames[index], before)
}

function expectSheetShownWithScrim(frame: FirstFrame) {
  expect(frame.sinceTapMs).toBeLessThanOrEqual(100)
  expect(frame.scrimVisible).toBe(true)
  // The very first frame the scrim dims the page, the sheet is fully opaque…
  expect(frame.sheetOpacity).toBe('1')
  // …and on screen, above the 28px strip.
  expect(frame.sheetTop).toBeGreaterThanOrEqual(0)
  expect(frame.sheetTop).toBeLessThan(frame.sheetBottom)
  expect(frame.sheetBottom).toBeLessThanOrEqual(VIEWPORT.height - 28 + 12)
}

test.use({ viewport: VIEWPORT })

test('#4318 first tap before the app boots shows the sheet with the scrim, and the app keeps it open', async ({ page }) => {
  const { release, pageErrors } = await openHeld(page)
  await expect(page.locator('[data-mingla-ssr-privacy-strip]')).toBeVisible()
  // The app cannot have booted: its __common chunk is held.
  await expect(page.locator('#root > main.shell')).toHaveCount(1)

  const first = await tapStrip(page)
  expect(first.serverCopy).toBe(true)
  expectSheetShownWithScrim(first)
  await expect(page.getByRole('dialog', { name: 'Privacy & ad choices' })).toBeVisible()
  await expect(page.getByTestId('privacy-switch-analytics')).toBeFocused()

  // The visitor turns ads measurement off, then the app arrives.
  await page.getByTestId('privacy-switch-ads').uncheck()
  release()
  await expect(page.locator('#root > main.shell')).toHaveCount(0, { timeout: 30_000 })

  // The app's own sheet is open, with the visitor's switches, over one scrim.
  await expect(page.locator('[data-mingla-ssr-privacy-bar],[data-mingla-ssr-privacy-strip],[data-mingla-ssr-privacy-scrim]')).toHaveCount(0, { timeout: 30_000 })
  await expect(page.getByTestId('privacy-sheet')).toHaveCount(1)
  await expect(page.getByTestId('privacy-sheet')).toBeVisible()
  await expect(page.getByTestId('privacy-scrim')).toHaveCount(1)
  await expect(page.getByTestId('privacy-strip')).toHaveCount(1)
  await expect(page.getByTestId('privacy-switch-analytics')).toBeChecked()
  await expect(page.getByTestId('privacy-switch-ads')).not.toBeChecked()
  await expect(page.locator('style#mingla-privacy-bar-style')).toHaveCount(1)
  await expect(page.getByTestId('privacy-switch-analytics')).toBeFocused()

  // Escape closes it: no scrim is left dimming the page, focus is back on the strip.
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('privacy-sheet')).toHaveCount(0)
  await expect(page.getByTestId('privacy-scrim')).toHaveCount(0)
  await expect(page.getByTestId('privacy-strip')).toBeFocused()

  // And the app's strip opens it the same way.
  const again = await tapStrip(page)
  expect(again.serverCopy).toBe(false)
  expectSheetShownWithScrim(again)
  expect(pageErrors).toEqual([])
})
