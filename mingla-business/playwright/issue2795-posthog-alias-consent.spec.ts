import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const ROOT = path.resolve(__dirname, '../..')
const POSTHOG_BROWSER_SDK = path.join(
  ROOT,
  'mingla-business/node_modules/posthog-js/dist/array.js',
)
const CONSENT_KEY = 'mingla_consent_v1'

interface BrowserPostHog {
  init(token: string, config: Record<string, unknown>): void
  opt_in_capturing(): void
  capture(event: string): void
}

interface AliasCase {
  name: string
  sourcePath: string
  grantedOrigin: string
  freshSiblingOrigin: string
  token: string
}

const ALIAS_CASES: AliasCase[] = [
  {
    name: 'Business',
    sourcePath: 'mingla-business/src/analytics/webAnalytics.web.ts',
    grantedOrigin: 'https://business.usemingla.com',
    freshSiblingOrigin: 'https://host.usemingla.com',
    token: 'phc_issue2795_business',
  },
  {
    name: 'Marketing',
    sourcePath: 'mingla-marketing/components/marketing/posthog-provider.tsx',
    grantedOrigin: 'https://usemingla.com',
    freshSiblingOrigin: 'https://www.usemingla.com',
    token: 'phc_issue2795_marketing',
  },
]

function readCrossSubdomainSetting(relative: string): boolean | undefined {
  const source = readFileSync(path.join(ROOT, relative), 'utf8')
  if (/^[ \t]*cross_subdomain_cookie\s*:\s*false\s*,?\s*$/m.test(source)) return false
  if (/^[ \t]*cross_subdomain_cookie\s*:\s*true\s*,?\s*$/m.test(source)) return true
  return undefined
}

async function openVirtualOrigin(
  context: BrowserContext,
  origin: string,
): Promise<Page> {
  const page = await context.newPage()
  await page.route('**/*', async (route) => {
    if (route.request().isNavigationRequest()) {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><html><head></head><body>alias oracle</body></html>',
      })
      return
    }
    // The real SDK owns cookie semantics in this oracle, but it may not send
    // any telemetry or load any remote extension while exercising them.
    await route.abort()
  })
  await page.goto(origin, { waitUntil: 'domcontentloaded' })
  return page
}

async function grantWithRealPostHog(
  page: Page,
  token: string,
  crossSubdomainCookie: boolean | undefined,
): Promise<void> {
  await page.addScriptTag({ path: POSTHOG_BROWSER_SDK })
  await page.evaluate(({ key, configuredValue }) => {
    const posthog = (window as unknown as { posthog?: BrowserPostHog }).posthog
    if (posthog === undefined) throw new Error('PostHog browser SDK did not initialize')
    const config: Record<string, unknown> = {
      api_host: 'https://us.i.posthog.com',
      persistence: 'cookie',
      capture_pageview: false,
      capture_pageleave: false,
      autocapture: false,
      capture_exceptions: false,
      disable_session_recording: true,
      session_recording: { maskAllInputs: true },
      disable_external_dependency_loading: true,
      advanced_disable_feature_flags: true,
      opt_out_capturing_by_default: true,
    }
    if (configuredValue !== undefined) {
      config.cross_subdomain_cookie = configuredValue
    }
    posthog.init(key, config)
    posthog.opt_in_capturing()
    posthog.capture('$pageview')
  }, { key: token, configuredValue: crossSubdomainCookie })
}

function posthogCookiesFor(
  context: BrowserContext,
  origin: string,
  token: string,
): Promise<string[]> {
  return context.cookies(origin).then((cookies) => cookies
    .filter((cookie) => cookie.name.includes(token))
    .map((cookie) => `${cookie.name}@${cookie.domain}`))
}

test('#2795 both PostHog init sites explicitly disable cross-subdomain cookies', () => {
  for (const aliasCase of ALIAS_CASES) {
    expect(
      readCrossSubdomainSetting(aliasCase.sourcePath),
      `${aliasCase.name} must keep PostHog persistence origin-local`,
    ).toBe(false)
  }
})

for (const aliasCase of ALIAS_CASES) {
  test(`#2795 ${aliasCase.name} grant cannot leak PostHog state to a fresh sibling alias`, async ({ browser }) => {
    const context = await browser.newContext()
    const granted = await openVirtualOrigin(context, aliasCase.grantedOrigin)
    await granted.evaluate((key) => {
      localStorage.setItem(key, JSON.stringify({ choice: 'granted', ts: Date.now() }))
    }, CONSENT_KEY)
    await grantWithRealPostHog(
      granted,
      aliasCase.token,
      readCrossSubdomainSetting(aliasCase.sourcePath),
    )

    await expect.poll(
      () => posthogCookiesFor(context, aliasCase.grantedOrigin, aliasCase.token),
      { message: 'the explicitly granted origin must receive its own PostHog persistence' },
    ).not.toHaveLength(0)

    const sibling = await openVirtualOrigin(context, aliasCase.freshSiblingOrigin)
    expect(await sibling.evaluate((key) => localStorage.getItem(key), CONSENT_KEY)).toBeNull()
    expect(await sibling.evaluate((token) => document.cookie
      .split(';')
      .map((cookie) => cookie.trim().split('=')[0])
      .filter((name) => name.includes(token)), aliasCase.token)).toEqual([])
    expect(await sibling.evaluate(() => ({
      local: Object.keys(localStorage).filter((key) => key.startsWith('ph_')),
      session: Object.keys(sessionStorage).filter((key) => key.startsWith('ph_')),
      posthogGlobal: 'posthog' in window,
    }))).toEqual({ local: [], session: [], posthogGlobal: false })
    await context.close()
  })
}
