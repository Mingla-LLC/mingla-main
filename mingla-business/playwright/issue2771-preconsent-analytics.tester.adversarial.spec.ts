import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { execFileSync, spawn } from 'node:child_process'

const BUSINESS = 'http://127.0.0.1:43172'
const BUSINESS_ALIAS = 'http://localhost:43172'
const MARKETING = 'http://127.0.0.1:43171'
const CONSENT_KEY = 'mingla_consent_v1'
const SIGNALS = '?gclid=test-gclid&fbclid=test-fbclid&utm_source=test-source&utm_campaign=test-campaign'

const FORBIDDEN_REQUEST = /posthog|us\.i\.posthog\.com|us-assets\.i\.posthog\.com|googletagmanager\.com|google-analytics\.com|doubleclick|connect\.facebook\.net|analytics\.tiktok\.com|sc-static\.net|redditstatic\.com|attribution-capture/i
const FORBIDDEN_STORAGE = /^(ph_|_ga|_gcl|_fbp|_ttp|_scid|rdt_|mingla_ad_click_v1)/i

type ConsentSeed = 'fresh' | 'malformed' | 'denied' | 'granted' | 'unreadable'

interface RequestOracle {
  urls: string[]
  bodies: string[]
  consentAtRequest: Array<string | null>
}

async function installOracle(page: Page): Promise<RequestOracle> {
  const oracle: RequestOracle = { urls: [], bodies: [], consentAtRequest: [] }
  await page.route('**/*', async (route) => {
    const request = route.request()
    if (/\/functions\/v1\/stripe-mode(?:[/?#]|$)/.test(request.url())) {
      await route.abort()
      return
    }
    if (FORBIDDEN_REQUEST.test(request.url())) {
      oracle.urls.push(request.url())
      oracle.bodies.push(request.postData() ?? '')
      oracle.consentAtRequest.push(await page.evaluate((key) => localStorage.getItem(key), CONSENT_KEY))
      await route.abort()
      return
    }
    await route.continue()
  })
  return oracle
}

async function newSeededPage(
  browser: Browser,
  seed: ConsentSeed,
  shape: 'business' | 'marketing',
): Promise<{ context: BrowserContext; page: Page; oracle: RequestOracle }> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  if (seed === 'unreadable') {
    await context.addInitScript((key) => {
      const original = Storage.prototype.getItem
      Storage.prototype.getItem = function guardedGetItem(candidate: string): string | null {
        if (candidate === key) throw new Error('consent store unavailable')
        return original.call(this, candidate)
      }
    }, CONSENT_KEY)
  } else if (seed !== 'fresh') {
    await context.addInitScript(([key, value]) => localStorage.setItem(key, value), [
      CONSENT_KEY,
      seed === 'malformed'
        ? '{not-valid-json'
        : JSON.stringify(shape === 'business'
          ? { choice: seed, ts: 1 }
          : { value: seed, ts: 1 }),
    ])
  }
  const page = await context.newPage()
  const oracle = await installOracle(page)
  return { context, page, oracle }
}

async function forbiddenStorage(context: BrowserContext, page: Page): Promise<string[]> {
  const cookies = (await context.cookies(page.url())).map(({ name }) => name)
  const storage = await page.evaluate(() => [
    ...Object.keys(localStorage),
    ...Object.keys(sessionStorage),
  ])
  return [...cookies, ...storage].filter((key) => FORBIDDEN_STORAGE.test(key))
}

async function forbiddenScripts(page: Page): Promise<string[]> {
  return page.locator('script[src]').evaluateAll((nodes, source) => {
    const pattern = new RegExp(source, 'i')
    return nodes
      .map((node) => (node as HTMLScriptElement).src)
      .filter((url) => pattern.test(url))
  }, FORBIDDEN_REQUEST.source)
}

async function assertDark(
  context: BrowserContext,
  page: Page,
  oracle: RequestOracle,
): Promise<void> {
  // Give both React roots enough time to hydrate and run their mount effects;
  // a pre-consent loader regression otherwise hides behind a too-early oracle.
  await page.waitForTimeout(1_500)
  expect(oracle.urls, 'analytics/attribution network must remain dark').toEqual([])
  expect(await forbiddenScripts(page), 'vendor scripts must remain absent').toEqual([])
  expect(await forbiddenStorage(context, page), 'analytics/attribution storage must remain absent').toEqual([])
  expect(await page.evaluate(() => ({
    dataLayer: 'dataLayer' in window,
    gtag: 'gtag' in window,
    fbq: 'fbq' in window,
    ttq: 'ttq' in window,
    snaptr: 'snaptr' in window,
    rdt: 'rdt' in window,
  }))).toEqual({ dataLayer: false, gtag: false, fbq: false, ttq: false, snaptr: false, rdt: false })
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

test.describe('#2771 independent browser privacy boundary', () => {
  test('Business and Marketing malformed or unreadable consent stay fully dark, including attribution signals', async ({ browser }) => {
    for (const [name, url, shape] of [
      ['Business', BUSINESS, 'business'],
      ['Marketing', MARKETING, 'marketing'],
    ] as const) {
      for (const seed of ['malformed', 'unreadable'] as const) {
        const { context, page, oracle } = await newSeededPage(browser, seed, shape)
        await page.goto(`${url}/${SIGNALS}`, { waitUntil: 'domcontentloaded' })
        await assertDark(context, page, oracle)
        await context.close()
        test.info().annotations.push({ type: 'coverage', description: `${name} ${seed}` })
      }
    }
  })

  test('Marketing /links suppresses its banner for every state and boots only a prior grant, once', async ({ browser }) => {
    for (const seed of ['fresh', 'denied', 'malformed', 'unreadable', 'granted'] as const) {
      const { context, page, oracle } = await newSeededPage(browser, seed, 'marketing')
      await page.goto(`${MARKETING}/links${SIGNALS}`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('dialog', { name: 'Cookie consent' })).toHaveCount(0)
      if (seed !== 'granted') {
        await assertDark(context, page, oracle)
      } else {
        await expect.poll(() => oracle.urls.length).toBeGreaterThan(0)
        const commands = await dataLayerCommands(page)
        expect(commandCount(commands, 'config', 'G-ISSUE2771')).toBeLessThanOrEqual(1)
        expect(pageviewOccurrences(oracle.bodies)).toBeLessThanOrEqual(1)
      }
      await context.close()
    }
  })

  test('Business grant is isolated to its exact origin alias', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const granted = await context.newPage()
    const grantedOracle = await installOracle(granted)
    await granted.goto(BUSINESS, { waitUntil: 'domcontentloaded' })
    const grantedAccept = granted.getByTestId('issue-2769-consent-accept')
    await expect(grantedAccept).toBeVisible()
    await grantedAccept.evaluate((button) => (button as HTMLButtonElement).click())
    await expect.poll(() => grantedOracle.urls.length).toBeGreaterThan(0)

    const isolated = await context.newPage()
    const isolatedOracle = await installOracle(isolated)
    await isolated.goto(`${BUSINESS_ALIAS}/${SIGNALS}`, { waitUntil: 'domcontentloaded' })
    await expect(isolated.getByRole('button', { name: 'Accept cookies and analytics', exact: true })).toBeVisible()
    expect(await isolated.evaluate((key) => localStorage.getItem(key), CONSENT_KEY)).toBeNull()
    await assertDark(context, isolated, isolatedOracle)
    await context.close()
  })

  for (const surface of [
    { name: 'Business', url: BUSINESS, accept: 'Accept cookies and analytics' },
    { name: 'Marketing', url: MARKETING, accept: 'Accept all' },
  ]) {
    test(`${surface.name} concurrent grants produce one boot, one pageview, and one consent event`, async ({ browser }) => {
      const context = await browser.newContext()
      const page = await context.newPage()
      const oracle = await installOracle(page)
      await page.goto(surface.url, { waitUntil: 'domcontentloaded' })
      if (surface.name === 'Marketing') await page.waitForLoadState('networkidle')
      const accept = surface.name === 'Business'
        ? page.getByTestId('issue-2769-consent-accept')
        : page.getByRole('button', { name: surface.accept, exact: true })
      await expect(accept).toBeVisible()
      if (surface.name === 'Marketing') {
        await accept.dispatchEvent('click')
        await page.evaluate(() => {
          window.dispatchEvent(new Event('mingla:marketing-consent'))
          window.dispatchEvent(new Event('mingla:marketing-consent'))
        })
      } else {
        await accept.evaluate((button) => {
          ;(button as HTMLButtonElement).click()
          ;(button as HTMLButtonElement).click()
        })
      }
      await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), CONSENT_KEY)).toMatch(/granted/)
      await expect.poll(async () =>
        commandCount(await dataLayerCommands(page), 'event', 'consent_granted'),
      ).toBe(1)
      expect(oracle.consentAtRequest.every((value) => value?.includes('granted'))).toBe(true)
      const commands = await dataLayerCommands(page)
      expect(commandCount(commands, 'config', 'G-ISSUE2771')).toBeLessThanOrEqual(1)
      expect(commandCount(commands, 'event', 'consent_granted')).toBe(1)
      expect(pageviewOccurrences(oracle.bodies)).toBeLessThanOrEqual(1)
      expect((await forbiddenScripts(page)).filter((url) => /googletagmanager/.test(url))).toHaveLength(1)
      await context.close()
    })
  }

  test('Reject keeps the production public-venue reservation action usable while analytics stays dark', async ({ browser }) => {
    // The fixture compiles the real PublicVenueScreen, real ConsentBanner and
    // real reservation-action composition. It avoids depending on mutable live
    // venue data while preserving the production component boundary.
    execFileSync(process.execPath, ['playwright/issue2769/bundle.mjs'], { cwd: process.cwd() })
    const server = spawn(process.execPath, ['playwright/issue2769/server.mjs'], {
      cwd: process.cwd(),
      stdio: 'ignore',
    })
    try {
      await expect.poll(async () => {
        try { return (await fetch('http://127.0.0.1:42769')).ok } catch { return false }
      }).toBe(true)
      const { context, page, oracle } = await newSeededPage(browser, 'fresh', 'business')
      await page.goto(`http://127.0.0.1:42769/${SIGNALS}`, { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: 'Reject cookies and analytics', exact: true }).click()
      const reserve = page.getByRole('button', { name: 'Reserve a table', exact: true })
      await expect(reserve).toBeVisible()
      await reserve.click()
      await expect(page.getByTestId('issue-2769-sheet')).toBeVisible()
      await assertDark(context, page, oracle)
      await context.close()
    } finally {
      server.kill('SIGTERM')
    }
  })
})
