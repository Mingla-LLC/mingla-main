// #2331 rewrite of the #2771 independent browser boundary (file kept,
// rewritten in place). Different angles from the happy path, on the real
// Business/Buyer export and the real Marketing build:
//   - malformed or unreadable storage falls back to the on-default, no crash;
//   - Global Privacy Control turns ads off (no pixel), analytics unaffected;
//   - a turn-off is isolated to its exact origin alias;
//   - turning analytics back on, even with concurrent saves, gives one boot
//     and at most one pageview;
//   - /links shows the bar for every unsaved state and stays dark for a
//     saved turn-off;
//   - the real public-venue reservation action stays usable with the bar shown.
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { execFileSync, spawn } from 'node:child_process'

const BUSINESS = 'http://127.0.0.1:43172'
const BUSINESS_ALIAS = 'http://localhost:43172'
const MARKETING = 'http://127.0.0.1:43171'
const PRIVACY_KEY = 'mingla_privacy_v2'
const LEGACY_KEY = 'mingla_consent_v1'
const SIGNALS = '?gclid=test-gclid&fbclid=test-fbclid&utm_source=test-source&utm_campaign=test-campaign'

const ANALYTICS_REQUEST = /posthog|us\.i\.posthog\.com|us-assets\.i\.posthog\.com|googletagmanager\.com|google-analytics\.com|doubleclick/i
const PIXEL_REQUEST = /connect\.facebook\.net|analytics\.tiktok\.com|sc-static\.net|redditstatic\.com/i
const AD_REQUEST = /connect\.facebook\.net|analytics\.tiktok\.com|sc-static\.net|redditstatic\.com|attribution-capture/i
const ANALYTICS_STORAGE = /^(ph_|_ga|_gcl)/i

type PrivacySeed = 'fresh' | 'malformed' | 'unreadable' | 'analytics-off' | 'all-off'

interface RequestOracle {
  urls: string[]
  bodies: string[]
}

async function installOracle(page: Page): Promise<RequestOracle> {
  const oracle: RequestOracle = { urls: [], bodies: [] }
  await page.route('**/*', async (route) => {
    const request = route.request()
    if (/\/functions\/v1\/stripe-mode(?:[/?#]|$)/.test(request.url())) {
      await route.abort()
      return
    }
    if (ANALYTICS_REQUEST.test(request.url()) || AD_REQUEST.test(request.url())) {
      const index = oracle.urls.push(request.url()) - 1
      oracle.bodies[index] = request.postData() ?? ''
      await route.abort()
      return
    }
    await route.continue()
  })
  return oracle
}

async function newSeededPage(
  browser: Browser,
  seed: PrivacySeed,
  options: { gpc?: boolean } = {},
): Promise<{ context: BrowserContext; page: Page; oracle: RequestOracle; errors: string[] }> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  if (options.gpc === true) {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, get: () => true })
    })
  }
  if (seed === 'unreadable') {
    await context.addInitScript(([privacy, legacy]) => {
      const original = Storage.prototype.getItem
      Storage.prototype.getItem = function guardedGetItem(candidate: string): string | null {
        if (candidate === privacy || candidate === legacy) throw new Error('privacy store unavailable')
        return original.call(this, candidate)
      }
    }, [PRIVACY_KEY, LEGACY_KEY])
  } else if (seed !== 'fresh') {
    await context.addInitScript(([key, value]) => {
      if (window.sessionStorage.getItem('issue2771-seeded') !== null) return
      window.sessionStorage.setItem('issue2771-seeded', '1')
      localStorage.setItem(key, value)
    }, [
      PRIVACY_KEY,
      seed === 'malformed'
        ? '{not-valid-json'
        : JSON.stringify({ analytics: false, ads: seed !== 'all-off', ts: 1 }),
    ])
  }
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(String(error)))
  const oracle = await installOracle(page)
  return { context, page, oracle, errors }
}

function requestIndexes(oracle: RequestOracle, pattern: RegExp, since = 0): number[] {
  return oracle.urls.flatMap((url, index) => index >= since && pattern.test(url) ? [index] : [])
}

async function forbiddenStorage(context: BrowserContext, page: Page, pattern: RegExp): Promise<string[]> {
  const cookies = (await context.cookies(page.url())).map(({ name }) => name)
  const storage = await page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)])
  return [...cookies, ...storage].filter((key) => pattern.test(key))
}

async function forbiddenScripts(page: Page, pattern: RegExp): Promise<string[]> {
  return page.locator('script[src]').evaluateAll((nodes, source) => {
    const matcher = new RegExp(source, 'i')
    return nodes.map((node) => (node as HTMLScriptElement).src).filter((url) => matcher.test(url))
  }, pattern.source)
}

async function assertAnalyticsDark(context: BrowserContext, page: Page, oracle: RequestOracle, since = 0): Promise<void> {
  // Give both React roots time to hydrate and run their mount effects.
  await page.waitForTimeout(1_500)
  expect(requestIndexes(oracle, ANALYTICS_REQUEST, since), 'PostHog/GA network must stay dark after a turn-off').toEqual([])
  expect(await forbiddenScripts(page, ANALYTICS_REQUEST), 'analytics scripts must stay absent').toEqual([])
  expect(await forbiddenStorage(context, page, ANALYTICS_STORAGE), 'analytics storage must stay absent').toEqual([])
}

async function dataLayerCommands(page: Page): Promise<unknown[][]> {
  return page.evaluate(() => {
    const layer = (window as Window & { dataLayer?: unknown[] }).dataLayer ?? []
    return layer.map((entry) => Array.from(entry as ArrayLike<unknown>))
  })
}

function commandCount(commands: unknown[][], first: string, second: string): number {
  return commands.filter((entry) => entry[0] === first && entry[1] === second).length
}

function pageviewOccurrences(bodies: string[]): number {
  return bodies.reduce((total, body) => {
    const candidates = [body]
    try { candidates.push(decodeURIComponent(body)) } catch { /* hostile payload: keep raw */ }
    for (const candidate of [...candidates]) {
      const encoded = /(?:^|&)data=([^&]+)/.exec(candidate)?.[1]
      if (encoded) {
        try { candidates.push(Buffer.from(encoded, 'base64').toString('utf8')) } catch { /* not base64 */ }
      }
    }
    return total + candidates.reduce((count, candidate) => count + (candidate.match(/\$pageview/g)?.length ?? 0), 0)
  }, 0)
}

const SURFACES = [
  { name: 'Business', url: BUSINESS, arrivalPixels: true, waitsForNetworkIdle: false },
  { name: 'Marketing', url: MARKETING, arrivalPixels: false, waitsForNetworkIdle: true },
] as const

test.describe('#2771 → #2331 independent browser privacy boundary', () => {
  test('malformed or unreadable storage falls back to the on-default without crashing', async ({ browser }) => {
    for (const surface of SURFACES) {
      for (const seed of ['malformed', 'unreadable'] as const) {
        const { context, page, oracle, errors } = await newSeededPage(browser, seed)
        await page.goto(`${surface.url}/${SIGNALS}`, { waitUntil: 'domcontentloaded' })
        if (surface.waitsForNetworkIdle) await page.waitForLoadState('networkidle')
        await expect(page.getByTestId('privacy-bar'), `${surface.name} ${seed}`).toBeVisible()
        await expect.poll(() => requestIndexes(oracle, ANALYTICS_REQUEST).length, `${surface.name} ${seed}`).toBeGreaterThan(0)
        if (surface.arrivalPixels) await expect.poll(() => requestIndexes(oracle, PIXEL_REQUEST).length).toBeGreaterThan(0)
        await page.getByTestId('privacy-bar-options').click()
        await expect(page.getByTestId('privacy-switch-analytics')).toBeChecked()
        await expect(page.getByTestId('privacy-switch-ads')).toBeChecked()
        expect(errors.filter((message) => /privacy store unavailable|JSON/i.test(message)), `${surface.name} ${seed}`).toEqual([])
        await context.close()
        test.info().annotations.push({ type: 'coverage', description: `${surface.name} ${seed}` })
      }
    }
  })

  test('Global Privacy Control turns ads off: no pixel, Ads switch off, analytics unaffected', async ({ browser }) => {
    for (const surface of SURFACES) {
      const { context, page, oracle } = await newSeededPage(browser, 'fresh', { gpc: true })
      await page.goto(`${surface.url}/${SIGNALS}`, { waitUntil: 'domcontentloaded' })
      if (surface.waitsForNetworkIdle) await page.waitForLoadState('networkidle')
      await expect.poll(() => requestIndexes(oracle, ANALYTICS_REQUEST).length, surface.name).toBeGreaterThan(0)
      await page.waitForTimeout(1_500)
      expect(requestIndexes(oracle, PIXEL_REQUEST), `${surface.name} pixels under GPC`).toEqual([])
      expect(await forbiddenScripts(page, PIXEL_REQUEST)).toEqual([])
      await page.getByTestId('privacy-bar-options').click()
      await expect(page.getByTestId('privacy-switch-ads')).not.toBeChecked()
      await expect(page.getByTestId('privacy-switch-analytics')).toBeChecked()
      await context.close()
    }
  })

  test('a Business turn-off is isolated to its exact origin alias', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const off = await context.newPage()
    await installOracle(off)
    await off.goto(BUSINESS, { waitUntil: 'domcontentloaded' })
    await off.getByTestId('privacy-bar-options').click()
    await off.getByTestId('privacy-bar-off-all').click()
    await expect.poll(() => off.evaluate((key) => localStorage.getItem(key), PRIVACY_KEY)).toContain('"analytics":false')

    const isolated = await context.newPage()
    const isolatedOracle = await installOracle(isolated)
    await isolated.goto(`${BUSINESS_ALIAS}/${SIGNALS}`, { waitUntil: 'domcontentloaded' })
    await expect(isolated.getByTestId('privacy-bar')).toBeVisible()
    expect(await isolated.evaluate((key) => localStorage.getItem(key), PRIVACY_KEY)).toBeNull()
    await expect.poll(() => requestIndexes(isolatedOracle, ANALYTICS_REQUEST).length).toBeGreaterThan(0)
    await expect.poll(() => requestIndexes(isolatedOracle, PIXEL_REQUEST).length).toBeGreaterThan(0)
    await context.close()
  })

  for (const surface of SURFACES) {
    test(`${surface.name}: turning analytics back on with concurrent saves gives one boot and at most one pageview`, async ({ browser }) => {
      const { context, page, oracle } = await newSeededPage(browser, 'analytics-off')
      await page.goto(surface.url, { waitUntil: 'domcontentloaded' })
      if (surface.waitsForNetworkIdle) await page.waitForLoadState('networkidle')
      await assertAnalyticsDark(context, page, oracle)
      await page.evaluate(() => window.dispatchEvent(new Event('mingla:privacy-choices')))
      await expect(page.getByTestId('privacy-panel')).toBeVisible()
      await expect(page.getByTestId('privacy-switch-analytics')).not.toBeChecked()
      await page.getByTestId('privacy-switch-analytics').check()
      await page.getByTestId('privacy-bar-save').evaluate((button) => {
        ;(button as HTMLButtonElement).click()
        ;(button as HTMLButtonElement).click()
      })
      await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), PRIVACY_KEY)).toContain('"analytics":true')
      await expect.poll(() => requestIndexes(oracle, ANALYTICS_REQUEST).length).toBeGreaterThan(0)
      await page.waitForTimeout(1_500)
      const commands = await dataLayerCommands(page)
      expect(commandCount(commands, 'config', 'G-ISSUE2771')).toBeLessThanOrEqual(1)
      expect(pageviewOccurrences(oracle.bodies)).toBeLessThanOrEqual(1)
      expect((await forbiddenScripts(page, ANALYTICS_REQUEST)).filter((url) => /googletagmanager/.test(url)).length).toBeLessThanOrEqual(1)
      await context.close()
    })
  }

  test('Marketing /links shows the bar for every unsaved state and stays dark for a saved turn-off', async ({ browser }) => {
    for (const seed of ['fresh', 'malformed', 'unreadable', 'all-off'] as const) {
      const { context, page, oracle } = await newSeededPage(browser, seed)
      await page.goto(`${MARKETING}/links${SIGNALS}`, { waitUntil: 'domcontentloaded' })
      await page.waitForLoadState('networkidle')
      if (seed === 'all-off') {
        await expect(page.getByTestId('privacy-bar'), seed).toHaveCount(0)
        await assertAnalyticsDark(context, page, oracle)
        expect(requestIndexes(oracle, AD_REQUEST)).toEqual([])
      } else {
        await expect(page.getByTestId('privacy-bar'), seed).toBeVisible()
        await expect.poll(() => requestIndexes(oracle, ANALYTICS_REQUEST).length, seed).toBeGreaterThan(0)
        const commands = await dataLayerCommands(page)
        expect(commandCount(commands, 'config', 'G-ISSUE2771')).toBeLessThanOrEqual(1)
        expect(pageviewOccurrences(oracle.bodies)).toBeLessThanOrEqual(1)
      }
      await context.close()
    }
  })

  test('the production public-venue reservation action stays usable with the bar shown, and Turn off all silences it', async ({ browser }) => {
    // The fixture compiles the real PublicVenueScreen, real ConsentBanner and
    // real reservation-action composition.
    execFileSync(process.execPath, ['playwright/issue2769/bundle.mjs'], { cwd: process.cwd() })
    const server = spawn(process.execPath, ['playwright/issue2769/server.mjs'], { cwd: process.cwd(), stdio: 'ignore' })
    try {
      await expect.poll(async () => {
        try { return (await fetch('http://127.0.0.1:42769')).ok } catch { return false }
      }).toBe(true)
      const { context, page, oracle } = await newSeededPage(browser, 'fresh')
      await page.goto(`http://127.0.0.1:42769/${SIGNALS}`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByTestId('privacy-bar')).toBeVisible()
      const reserve = page.getByRole('button', { name: 'Reserve a table', exact: true })
      await expect(reserve).toBeVisible()
      await reserve.click()
      await expect(page.getByTestId('issue-2769-sheet')).toBeVisible()
      await page.getByTestId('privacy-bar-options').click()
      await page.getByTestId('privacy-bar-off-all').click()
      await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), PRIVACY_KEY)).toContain('"ads":false')
      const marker = oracle.urls.length
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('button', { name: 'Reserve a table', exact: true })).toBeVisible()
      await assertAnalyticsDark(context, page, oracle, marker)
      expect(requestIndexes(oracle, AD_REQUEST, marker)).toEqual([])
      await context.close()
    } finally {
      server.kill('SIGTERM')
    }
  })
})
