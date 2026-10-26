// #2331 rewrite of the #2771 real-network boundary (file kept, rewritten in
// place). The retired opt-in rule ("nothing until Accept") is replaced by
// I-PRIVACY-ON-UNLESS-VISITOR-TURNED-OFF: analytics and ads are each ON unless
// this visitor turned it off, on both surfaces. What this proves, on the real
// Business/Buyer export and the real Marketing build, by watching the network:
//   - arrival loads analytics (and, on Business, the ad pixels) and the
//     privacy bar's switches both read on;
//   - turning analytics off stops PostHog/GA and stays off after a reload;
//   - Turn off all silences every vendor, across a reload;
//   - /links shows the bar.
import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const BUSINESS = 'http://127.0.0.1:43172'
const MARKETING = 'http://127.0.0.1:43171'
const PRIVACY_KEY = 'mingla_privacy_v2'

const ANALYTICS_REQUEST = /posthog|us\.i\.posthog\.com|us-assets\.i\.posthog\.com|googletagmanager\.com|google-analytics\.com|doubleclick/i
const AD_REQUEST = /connect\.facebook\.net|analytics\.tiktok\.com|sc-static\.net|redditstatic\.com|attribution-capture/i
const STRIPE_MODE_REQUEST = /\/functions\/v1\/stripe-mode(?:[/?#]|$)/
const ANALYTICS_STORAGE = /^(ph_|_ga|_gcl)/i

interface TrackingRequests {
  analytics: string[]
  ads: string[]
}

async function observe(page: Page): Promise<TrackingRequests> {
  const requests: TrackingRequests = { analytics: [], ads: [] }
  await page.route('**/*', async (route) => {
    const url = route.request().url()
    // This analytics oracle must not inherit the live backend's Stripe mode
    // (#3988): the boot handshake is fail-soft when this transport aborts.
    if (STRIPE_MODE_REQUEST.test(url)) {
      await route.abort()
      return
    }
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

async function trackingStorage(context: BrowserContext, page: Page, pattern: RegExp): Promise<string[]> {
  const cookies = (await context.cookies()).map((cookie) => cookie.name)
  const storage = await page.evaluate(() => [...Object.keys(window.localStorage), ...Object.keys(window.sessionStorage)])
  return [...cookies, ...storage].filter((key) => pattern.test(key))
}

async function storedChoice(page: Page): Promise<{ analytics: boolean; ads: boolean } | null> {
  return page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? 'null'), PRIVACY_KEY)
}

async function openChoices(page: Page): Promise<void> {
  await page.getByTestId('privacy-bar-options').click()
  await expect(page.getByTestId('privacy-panel')).toBeVisible()
}

const SURFACES = [
  { name: 'Business/Buyer', url: BUSINESS, arrivalAds: true, waitsForNetworkIdle: false },
  { name: 'Marketing', url: MARKETING, arrivalAds: false, waitsForNetworkIdle: true },
] as const

test.describe('#2771 → #2331 actual network and storage boundary (on unless turned off)', () => {
  for (const surface of SURFACES) {
    test(`${surface.name}: arrival starts analytics with both switches on`, async ({ browser }) => {
      const context = await browser.newContext()
      const page = await context.newPage()
      const requests = await observe(page)
      await page.goto(surface.url, { waitUntil: 'domcontentloaded' })
      if (surface.waitsForNetworkIdle) await page.waitForLoadState('networkidle')
      await expect(page.getByTestId('privacy-bar')).toBeVisible()
      await expect.poll(() => requests.analytics.length).toBeGreaterThan(0)
      if (surface.arrivalAds) await expect.poll(() => requests.ads.length).toBeGreaterThan(0)
      await openChoices(page)
      await expect(page.getByTestId('privacy-switch-analytics')).toBeChecked()
      await expect(page.getByTestId('privacy-switch-ads')).toBeChecked()
      expect(await storedChoice(page)).toBeNull()
      await context.close()
    })

    test(`${surface.name}: turning analytics off stops it and it stays off after a reload`, async ({ browser }) => {
      const context = await browser.newContext()
      const page = await context.newPage()
      const requests = await observe(page)
      await page.goto(surface.url, { waitUntil: 'domcontentloaded' })
      if (surface.waitsForNetworkIdle) await page.waitForLoadState('networkidle')
      await expect.poll(() => requests.analytics.length).toBeGreaterThan(0)
      await openChoices(page)
      await page.getByTestId('privacy-switch-analytics').uncheck()
      await page.getByTestId('privacy-bar-save').click()
      await expect(page.getByTestId('privacy-toast')).toHaveText('Analytics is off')
      await expect.poll(() => storedChoice(page)).toMatchObject({ analytics: false, ads: true })
      const analyticsBeforeReload = requests.analytics.length
      await page.reload({ waitUntil: 'domcontentloaded' })
      if (surface.waitsForNetworkIdle) await page.waitForLoadState('networkidle')
      await page.waitForTimeout(1_500)
      expect(requests.analytics.slice(analyticsBeforeReload)).toEqual([])
      expect(await trackingStorage(context, page, ANALYTICS_STORAGE)).toEqual([])
      await expect(page.getByTestId('privacy-bar')).toHaveCount(0)
      expect(await storedChoice(page)).toMatchObject({ analytics: false, ads: true })
      await context.close()
    })

    test(`${surface.name}: Turn off all silences every vendor across a reload`, async ({ browser }) => {
      const context = await browser.newContext()
      const page = await context.newPage()
      const requests = await observe(page)
      await page.goto(surface.url, { waitUntil: 'domcontentloaded' })
      if (surface.waitsForNetworkIdle) await page.waitForLoadState('networkidle')
      await expect.poll(() => requests.analytics.length).toBeGreaterThan(0)
      await openChoices(page)
      await page.getByTestId('privacy-bar-off-all').click()
      await expect(page.getByTestId('privacy-toast')).toHaveText('Analytics and ads are off')
      await expect.poll(() => storedChoice(page)).toMatchObject({ analytics: false, ads: false })
      const marker = { analytics: requests.analytics.length, ads: requests.ads.length }
      await page.reload({ waitUntil: 'domcontentloaded' })
      if (surface.waitsForNetworkIdle) await page.waitForLoadState('networkidle')
      await page.waitForTimeout(1_500)
      expect(requests.analytics.slice(marker.analytics)).toEqual([])
      expect(requests.ads.slice(marker.ads)).toEqual([])
      await context.close()
    })
  }

  test('Marketing /links shows the privacy bar and starts analytics on arrival', async ({ browser }) => {
    const context = await browser.newContext()
    const page = await context.newPage()
    const requests = await observe(page)
    await page.goto(`${MARKETING}/links`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('privacy-bar')).toBeVisible()
    await expect.poll(() => requests.analytics.length).toBeGreaterThan(0)
    expect(requests.ads).toEqual([])
    await context.close()
  })
})
