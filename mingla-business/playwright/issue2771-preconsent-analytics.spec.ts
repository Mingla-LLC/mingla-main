import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const BUSINESS = 'http://127.0.0.1:43172'
const MARKETING = 'http://127.0.0.1:43171'
const CONSENT_KEY = 'mingla_consent_v1'

const ANALYTICS_REQUEST = /posthog|us\.i\.posthog\.com|us-assets\.i\.posthog\.com|googletagmanager\.com|google-analytics\.com|doubleclick/i
const AD_REQUEST = /connect\.facebook\.net|analytics\.tiktok\.com|sc-static\.net|redditstatic\.com|attribution-capture/i
const ANALYTICS_STORAGE = /^(ph_|_ga|_gcl)/i
const AD_STORAGE = /^(_fbp|_fbc|_ttp|_scid|rdt_|mingla_ad_click_v1)/i

interface TrackingRequests {
  analytics: string[]
  ads: string[]
}

async function observe(page: Page): Promise<TrackingRequests> {
  const requests: TrackingRequests = { analytics: [], ads: [] }
  await page.route('**/*', async (route) => {
    const url = route.request().url()
    if (ANALYTICS_REQUEST.test(url) || AD_REQUEST.test(url)) {
      if (ANALYTICS_REQUEST.test(url)) requests.analytics.push(url)
      if (AD_REQUEST.test(url)) requests.ads.push(url)
      await route.abort()
      return
    }
    await route.continue()
  })
  return requests
}

async function trackingStorage(
  context: BrowserContext,
  page: Page,
  pattern: RegExp,
): Promise<string[]> {
  const cookies = (await context.cookies()).map((cookie) => cookie.name)
  const storage = await page.evaluate(() => [
    ...Object.keys(window.localStorage),
    ...Object.keys(window.sessionStorage),
  ])
  return [...cookies, ...storage].filter((key) => pattern.test(key))
}

async function trackingScripts(page: Page, pattern: RegExp): Promise<string[]> {
  return page.locator('script[src]').evaluateAll((nodes, pattern) => {
    const forbidden = new RegExp(pattern, 'i')
    return nodes
      .map((node) => (node as HTMLScriptElement).src)
      .filter((src) => forbidden.test(src))
  }, pattern.source)
}

test.describe('#2771 actual network and storage boundary', () => {
  for (const surface of [
    { name: 'Business/Buyer', url: BUSINESS, accept: 'OK', reject: 'Opt out of ad tracking', arrivalAds: true, waitsForNetworkIdle: false },
    { name: 'Marketing', url: MARKETING, accept: 'Accept all', reject: 'Reject', arrivalAds: false, waitsForNetworkIdle: true },
  ]) {
    test(`${surface.name}: arrival policy preserves the analytics boundary`, async ({ browser }) => {
      const pendingContext = await browser.newContext()
      const pendingPage = await pendingContext.newPage()
      const pendingRequests = await observe(pendingPage)
      await pendingPage.goto(surface.url, { waitUntil: 'domcontentloaded' })
      if (surface.waitsForNetworkIdle) await pendingPage.waitForLoadState('networkidle')
      await expect(pendingPage.getByRole('button', { name: surface.reject, exact: true })).toBeVisible()
      expect(pendingRequests.analytics).toEqual([])
      expect(await trackingScripts(pendingPage, ANALYTICS_REQUEST)).toEqual([])
      expect(await trackingStorage(pendingContext, pendingPage, ANALYTICS_STORAGE)).toEqual([])
      if (surface.arrivalAds) {
        await expect.poll(() => pendingRequests.ads.length).toBeGreaterThan(0)
      } else {
        expect(pendingRequests.ads).toEqual([])
        expect(await trackingScripts(pendingPage, AD_REQUEST)).toEqual([])
        expect(await trackingStorage(pendingContext, pendingPage, AD_STORAGE)).toEqual([])
      }
      await pendingContext.close()
    })

    test(`${surface.name}: Reject stays dark and persists after reload`, async ({ browser }) => {
      const rejectContext = await browser.newContext()
      const rejectPage = await rejectContext.newPage()
      const rejectRequests = await observe(rejectPage)
      await rejectPage.goto(surface.url, { waitUntil: 'domcontentloaded' })
      if (surface.waitsForNetworkIdle) await rejectPage.waitForLoadState('networkidle')
      if (surface.arrivalAds) await expect.poll(() => rejectRequests.ads.length).toBeGreaterThan(0)
      const arrivalRequestCount = rejectRequests.ads.length
      const rejectButton = rejectPage.getByRole('button', { name: surface.reject, exact: true })
      await expect(rejectButton).toBeVisible()
      await rejectButton.dispatchEvent('click')
      await expect.poll(() => rejectPage.evaluate((key) => window.localStorage.getItem(key), CONSENT_KEY)).toContain('denied')
      await rejectPage.reload({ waitUntil: 'domcontentloaded' })
      await rejectPage.waitForTimeout(500)
      expect(rejectRequests.analytics).toEqual([])
      expect(rejectRequests.ads).toHaveLength(arrivalRequestCount)
      expect(await trackingScripts(rejectPage, ANALYTICS_REQUEST)).toEqual([])
      expect(await trackingStorage(rejectContext, rejectPage, ANALYTICS_STORAGE)).toEqual([])
      expect(await trackingStorage(rejectContext, rejectPage, AD_STORAGE)).toEqual([])
      await rejectContext.close()
    })

    test(`${surface.name}: Accept begins analytics after stored grant`, async ({ browser }) => {
      const acceptContext = await browser.newContext()
      const acceptPage = await acceptContext.newPage()
      const acceptedRequests = await observe(acceptPage)
      await acceptPage.goto(surface.url, { waitUntil: 'domcontentloaded' })
      if (surface.waitsForNetworkIdle) await acceptPage.waitForLoadState('networkidle')
      const acceptButton = acceptPage.getByRole('button', { name: surface.accept, exact: true })
      await expect(acceptButton).toBeVisible()
      await acceptButton.dispatchEvent('click')
      await expect.poll(() => acceptedRequests.analytics.length).toBeGreaterThan(0)
      const stored = await acceptPage.evaluate((key) => window.localStorage.getItem(key), CONSENT_KEY)
      expect(stored).toContain('granted')
      await acceptContext.close()
    })
  }

  test('Marketing /links pending and unreadable storage remain banner-free and analytics-dark', async ({ browser }) => {
    const context = await browser.newContext()
    await context.addInitScript(() => {
      const original = Storage.prototype.getItem
      Storage.prototype.getItem = function guardedGetItem(key: string): string | null {
        if (key === 'mingla_consent_v1') throw new Error('storage unavailable')
        return original.call(this, key)
      }
    })
    const page = await context.newPage()
    const forbidden = await observe(page)
    await page.goto(`${MARKETING}/links`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('dialog', { name: 'Cookie consent' })).toHaveCount(0)
    expect(forbidden).toEqual({ analytics: [], ads: [] })
    expect(await trackingScripts(page, ANALYTICS_REQUEST)).toEqual([])
    expect(await trackingScripts(page, AD_REQUEST)).toEqual([])
    expect(await trackingStorage(context, page, ANALYTICS_STORAGE)).toEqual([])
    expect(await trackingStorage(context, page, AD_STORAGE)).toEqual([])
    await context.close()
  })
})
