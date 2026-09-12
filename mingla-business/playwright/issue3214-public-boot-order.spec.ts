import { expect, test, type Page, type Request, type Route } from '@playwright/test'

// #3214 — public Host pages are a server document that hands off to the Expo
// app. Two defects made that handoff fail on real visits:
//   1. ORDER. The three entry chunks were injected as script-created scripts,
//      which are async by default (defer is ignored), so a cold load ran
//      `index` before `__common` and died with "Requiring unknown module".
//   2. LAYOUT. When the race was won, index.html's `expo-reset` styles never
//      came across, so html/body/#root were 0px tall and the app showed only
//      its cover with black below, unable to scroll.
// Every earlier test ran with a warm cache and read DOM markers. This one loses
// the download race ON PURPOSE (index completes before __common) and asserts
// the page is USABLE — full-viewport root, a scroll container with height,
// content below the cover reachable by scrolling — with a screenshot attached.
//
// It runs against the REAL production-mode web export (`dist`, served by the
// web-build lane's #2771 config, or by playwright.issue3214.config.ts locally)
// and the REAL server document from server/publicSearchDocument.js, fulfilled
// for the public URL with its real headers (including its CSP).

// eslint-disable-next-line @typescript-eslint/no-require-imports
const publicSearch = require('../server/publicSearchDocument') as {
  handlePublicSearchDocument: (input: { req: unknown; res: unknown; kind: string; slugs: string[] }) => Promise<void>
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bootRuntime = require('../server/publicSearchBrowserRuntime') as { BOOT_MOUNT_DEADLINE_MS: number }

const BUSINESS = process.env.ISSUE_3214_BASE_URL ?? 'http://127.0.0.1:43172'
const FAILURE_COPY = 'Interactive features could not load. This page and its links still work.'
const CONSENT = JSON.stringify({ choice: 'granted', ts: 1 })
const COMMON_DELAY_MS = 4000
// The brand story renders below the cover, under the fold of a 390x640 phone.
const STORY_OPENING = 'Issue 3214 Host runs long supper clubs, listening sessions and late markets.'
const LONG_STORY = [
  STORY_OPENING,
  ...Array.from({ length: 14 }, (_, index) => `Paragraph ${index + 1}: evenings built around slow food, live records, and the people who keep showing up.`),
].join(' ')

type PageKind = 'brand' | 'venue' | 'event' | 'trip' | 'experience'
const KINDS: Array<{ kind: PageKind; slugs: string[]; path: string }> = [
  { kind: 'brand', slugs: ['issue3214-host'], path: '/b/issue3214-host' },
  { kind: 'venue', slugs: ['issue3214-host', 'issue3214-room'], path: '/b/issue3214-host/v/issue3214-room' },
  { kind: 'event', slugs: ['issue3214-host', 'issue3214-night'], path: '/e/issue3214-host/issue3214-night' },
  { kind: 'trip', slugs: ['issue3214-host', 'issue3214-coast'], path: '/t/issue3214-host/issue3214-coast' },
  { kind: 'experience', slugs: ['issue3214-host', 'issue3214-class'], path: '/exp/issue3214-host/issue3214-class' },
]

const factsFor = (kind: PageKind, slugs: string[]) => ({
  kind,
  id: `issue3214-${kind}`,
  title: kind === 'brand' ? 'Issue 3214 Host' : `Issue 3214 ${kind}`,
  brandName: 'Issue 3214 Host',
  brandSlug: slugs[0],
  description: 'A public page used to prove the #3214 handoff.',
  city: 'Lagos',
  ...(kind === 'brand' ? { eventCount: 0 } : {}),
  ...(kind === 'event' ? { startAt: '2030-01-01T19:00:00Z', timezone: 'UTC' } : {}),
})

// The real server handler, with only its Supabase resolver call answered.
async function serverDocument(kind: PageKind, slugs: string[], path: string) {
  const realFetch = globalThis.fetch
  const response = { statusCode: 0, headers: {} as Record<string, string>, body: '' }
  const res = {
    get statusCode() { return response.statusCode },
    set statusCode(value: number) { response.statusCode = value },
    setHeader(key: string, value: string) { response.headers[key.toLowerCase()] = String(value) },
    end(value = '') { response.body = String(value) },
  }
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ valid: true, kind, integrityOk: true, state: 'search_ready', facts: factsFor(kind, slugs) }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )) as typeof fetch
  try {
    await publicSearch.handlePublicSearchDocument({ req: { method: 'GET', url: path }, res, kind, slugs })
  } finally {
    globalThis.fetch = realFetch
  }
  expect(response.statusCode).toBe(200)
  expect(response.body).toContain('<main class="shell">')
  return response
}

const BRAND_ROW = {
  id: '00000000-0000-4000-8000-000000003214',
  slug: 'issue3214-host',
  name: 'Issue 3214 Host',
  description: LONG_STORY,
  profile_photo_url: null,
  contact_email: null,
  contact_phone: null,
  social_links: {},
  custom_links: [],
  display_attendee_count: true,
  claim_status: 'none',
  address: null,
  cover_hue: 25,
  cover_media_url: null,
  cover_media_type: 'image',
  profile_photo_type: 'image',
  theme_color: '#eb7825',
  theme_font: 'poppins',
  theme_animation: 'none',
  created_at: '2026-06-27T01:27:37.046354+00:00',
  updated_at: '2026-08-14T22:16:02.834168+00:00',
}

type Harness = {
  pageErrors: string[]
  cspConsole: string[]
  beacons: Array<Record<string, unknown>>
  chunkFinishedAt: Map<string, number>
}

async function openPublicPage(page: Page, target: { kind: PageKind; slugs: string[]; path: string }, options: {
  consent?: boolean
  common?: (route: Route) => Promise<void>
  entry?: (route: Route) => Promise<void>
} = {}): Promise<Harness> {
  const harness: Harness = { pageErrors: [], cspConsole: [], beacons: [], chunkFinishedAt: new Map() }
  const chunks = await entryChunks()
  const served = await serverDocument(target.kind, target.slugs, target.path)
  if (options.consent) await page.addInitScript((value) => window.localStorage.setItem('mingla_consent_v1', value), CONSENT)
  await page.addInitScript(() => {
    const violations: Array<{ directive: string; blocked: string }> = []
    ;(window as unknown as { __issue3214Csp: typeof violations }).__issue3214Csp = violations
    document.addEventListener('securitypolicyviolation', (event) => {
      violations.push({ directive: event.effectiveDirective, blocked: event.blockedURI })
    })
    const writes: string[] = []
    ;(window as unknown as { __issue3214StatusWrites: string[] }).__issue3214StatusWrites = writes
    document.addEventListener('DOMContentLoaded', () => {
      const status = document.getElementById('mingla-runtime-status')
      if (!status) return
      new MutationObserver(() => { if (status.textContent) writes.push(status.textContent) })
        .observe(status, { childList: true, characterData: true, subtree: true })
    })
  })
  page.on('pageerror', (error) => harness.pageErrors.push(error.message))
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) harness.cspConsole.push(message.text())
  })
  page.on('request', (request: Request) => {
    if (new URL(request.url()).pathname !== '/api/public-boot-outcome') return
    harness.beacons.push(JSON.parse(request.postData() ?? 'null') as Record<string, unknown>)
  })
  page.on('requestfinished', (request: Request) => {
    const pathname = new URL(request.url()).pathname
    for (const [name, chunk] of Object.entries(chunks)) {
      if (pathname === chunk && !harness.chunkFinishedAt.has(name)) harness.chunkFinishedAt.set(name, Date.now())
    }
  })
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin === BUSINESS) {
      if (url.pathname === target.path) {
        await route.fulfill({ status: 200, headers: served.headers, body: served.body })
        return
      }
      if (options.common && url.pathname === chunks.common) return options.common(route)
      if (options.entry && url.pathname === chunks.index) return options.entry(route)
      await route.continue()
      return
    }
    // Hermetic: the bundle's Supabase calls get fixtures, everything else is cut.
    if (/\.supabase\.co$/.test(url.hostname)) {
      if (url.pathname.endsWith('/functions/v1/stripe-mode')) {
        // Answer as a correctly configured backend for THIS export: the app's
        // boot handshake throws (and the ErrorBoundary replaces the page) when
        // the backend's mode disagrees with the bundled key. CI's export bakes
        // app.config's pk_test_ default; a local .env usually supplies pk_live_.
        // A fixed "live" answer passed locally and crashed the app in CI.
        if (!chunks.stripePrefix) { await route.abort(); return }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ mode: chunks.stripePrefix === 'pk_live_' ? 'live' : 'test', publishablePrefix: chunks.stripePrefix }),
        })
        return
      }
      if (url.pathname.endsWith('/rest/v1/business_public_brands_view') && url.searchParams.get('slug') === 'eq.issue3214-host') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([BRAND_ROW]) })
        return
      }
      if (url.pathname.startsWith('/rest/v1/')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
        return
      }
    }
    await route.abort()
  })
  await page.goto(`${BUSINESS}${target.path}`, { waitUntil: 'domcontentloaded' })
  return harness
}

// The three entry chunks, by the exact paths the export's index.html lists,
// and the Stripe key prefix this export baked in (null when it has none).
async function entryChunks(): Promise<{ runtime: string; common: string; index: string; stripePrefix: string | null }> {
  const html = await (await fetch(`${BUSINESS}/index.html`)).text()
  const sources = [...html.matchAll(/<script[^>]+src="([^"?]+)[^"]*"/g)].map((match) => match[1])
  const find = (pattern: RegExp) => {
    const found = sources.find((source) => pattern.test(source))
    expect(found, `index.html lists ${pattern}: ${JSON.stringify(sources)}`).toBeDefined()
    return found ?? ''
  }
  const chunks = {
    runtime: find(/\/__expo-metro-runtime-[0-9a-f]+\.js$/),
    common: find(/\/__common-[0-9a-f]+\.js$/),
    index: find(/\/index-[0-9a-f]+\.js$/),
  }
  expect(sources.slice(0, 3)).toEqual([chunks.runtime, chunks.common, chunks.index])
  let stripePrefix: string | null = null
  for (const chunk of [chunks.index, chunks.common]) {
    const match = /\bpk_(live|test)_[A-Za-z0-9]{8,}/.exec(await (await fetch(`${BUSINESS}${chunk}`)).text())
    if (match) { stripePrefix = `pk_${match[1]}_`; break }
  }
  return { ...chunks, stripePrefix }
}

async function loadedFontFaces(page: Page): Promise<number> {
  return page.evaluate(() => {
    let loaded = 0
    document.fonts.forEach((face) => { if (face.status === 'loaded') loaded += 1 })
    return loaded
  })
}

async function cspViolations(page: Page): Promise<Array<{ directive: string; blocked: string }>> {
  return page.evaluate(() => (window as unknown as { __issue3214Csp: Array<{ directive: string; blocked: string }> }).__issue3214Csp)
}

const delayed = (ms: number) => async (route: Route) => {
  await new Promise((resolve) => setTimeout(resolve, ms))
  await route.continue()
}

async function expectTakenOver(page: Page) {
  await expect(page.locator('#root > main.shell')).toHaveCount(0, { timeout: 30_000 })
  await expect(page.locator('.hero')).toHaveCount(0)
  await expect(page.locator('#root > *').first()).toBeAttached()
  await expectAppNotCrashed(page)
}

// The app's ErrorBoundary is also a full-viewport tree in #root: every layout
// measurement passes on it. That is how CI's first red went unexplained by the
// takeover checks, so a crashed app is asserted against by name.
async function expectAppNotCrashed(page: Page) {
  await page.waitForTimeout(500)
  await expect(page.getByText('Something broke.', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Try again', { exact: true })).toHaveCount(0)
}

// Every <style> index.html carries in its head (expo-reset everywhere; the
// mobile no-blur rule where Vercel's post-export step injected it) is on the
// page once, and the server document's own style is gone.
async function expectAppStylesSwapped(page: Page) {
  const html = await (await fetch(`${BUSINESS}/index.html`)).text()
  const ids = [...html.matchAll(/<style id="([^"]+)"/g)].map((match) => match[1])
  expect(ids).toContain('expo-reset')
  for (const id of ids) await expect(page.locator(`style#${id}`)).toHaveCount(1)
  await expect(page.locator('style#mingla-public-document-style')).toHaveCount(0)
}

async function layout(page: Page) {
  return page.evaluate(() => {
    const root = document.getElementById('root')
    const scrollers = Array.from(document.querySelectorAll('#root *'))
      .filter((element) => /(auto|scroll)/.test(getComputedStyle(element).overflowY))
      .map((element) => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }))
    return {
      viewport: window.innerHeight,
      html: document.documentElement.getBoundingClientRect().height,
      body: document.body.getBoundingClientRect().height,
      root: root ? root.getBoundingClientRect().height : -1,
      scrollers,
    }
  })
}

async function attachScreenshot(page: Page, name: string) {
  const file = test.info().outputPath(`${name}.png`)
  await page.screenshot({ path: file })
  await test.info().attach(name, { path: file, contentType: 'image/png' })
}

test.use({ viewport: { width: 390, height: 640 } })

test.describe('#3214 public page handoff to the Expo app', () => {
  test('loses the download race on purpose and still boots into a usable, scrollable page', async ({ page }) => {
    test.setTimeout(90_000)
    const harness = await openPublicPage(page, KINDS[0], { consent: true, common: delayed(COMMON_DELAY_MS) })

    // The race really was lost: index finished downloading well before __common.
    await expect.poll(() => harness.chunkFinishedAt.has('common'), { timeout: 30_000 }).toBe(true)
    const indexAt = harness.chunkFinishedAt.get('index')
    const commonAt = harness.chunkFinishedAt.get('common')
    expect(indexAt, 'index chunk finished').toBeDefined()
    expect((commonAt ?? 0) - (indexAt ?? 0)).toBeGreaterThan(COMMON_DELAY_MS / 2)
    await page.waitForTimeout(1500)
    expect(harness.pageErrors.filter((message) => /Requiring unknown module/.test(message))).toEqual([])

    await expectTakenOver(page)

    const story = page.getByText(STORY_OPENING, { exact: false })
    await expect(story).toBeAttached({ timeout: 30_000 })
    const measured = await layout(page)
    expect(measured.html).toBe(measured.viewport)
    expect(measured.root).toBe(measured.viewport)
    const scroller = measured.scrollers.find((candidate) => candidate.scrollHeight > candidate.clientHeight)
    expect(scroller, `a scroll container with overflow: ${JSON.stringify(measured.scrollers)}`).toBeDefined()
    expect(scroller?.clientHeight ?? 0).toBeGreaterThan(measured.viewport / 2)
    await attachScreenshot(page, 'issue3214-race-lost-top')

    // Content below the cover is reachable by real wheel scrolling, and is then
    // actually visible: IntersectionObserver clips by every ancestor, so a
    // 0px-tall scroll container (the collapsed layout) reads as ratio 0.
    await expect(story).not.toBeInViewport()
    await page.mouse.move(195, 400)
    for (let step = 0; step < 12 && !(await story.evaluate((element) => {
      const box = element.getBoundingClientRect()
      return box.top >= 0 && box.bottom <= window.innerHeight
    })); step += 1) {
      await page.mouse.wheel(0, 300)
      await page.waitForTimeout(150)
    }
    await expect(story).toBeInViewport({ ratio: 0.9 })
    await attachScreenshot(page, 'issue3214-race-lost-scrolled')

    expect(harness.pageErrors.filter((message) => /Requiring unknown module/.test(message))).toEqual([])
    expect(await page.evaluate(() => (window as unknown as { __issue3214StatusWrites: string[] }).__issue3214StatusWrites)).toEqual([])
    await expect(page.getByText(FAILURE_COPY)).toHaveCount(0)
    await expectAppStylesSwapped(page)
    await expect.poll(() => harness.beacons.map((beacon) => `${beacon.outcome}:${beacon.reason}`)).toEqual(['success:mounted'])
    expect(harness.beacons[0]).toMatchObject({ path: '/b/issue3214-host' })
  })

  for (const target of KINDS) {
    test(`${target.kind}: takeover fills the viewport and swaps the plain page's styles for the app's`, async ({ page }) => {
      test.setTimeout(60_000)
      const harness = await openPublicPage(page, target)
      await expectTakenOver(page)
      await expect.poll(async () => (await layout(page)).root).toBe(640)
      const measured = await layout(page)
      expect(measured.html).toBe(measured.viewport)
      expect(measured.body).toBe(measured.viewport)
      await page.waitForTimeout(1500)
      await attachScreenshot(page, `issue3214-${target.kind}`)
      await expectAppStylesSwapped(page)
      await expectAppNotCrashed(page)
      // #3214 CSP: nothing the booted app did on this page kind was refused.
      expect(await cspViolations(page)).toEqual([])
      expect(harness.cspConsole).toEqual([])
      expect(harness.pageErrors.filter((message) => /Requiring unknown module/.test(message))).toEqual([])
      await expect(page.getByText(FAILURE_COPY)).toHaveCount(0)
      // No stored grant, so the boot outcome is never sent.
      expect(harness.beacons).toEqual([])
    })
  }

  test('a chunk that fails to load shows the failure message and leaves the plain page intact and scrollable', async ({ page }) => {
    test.setTimeout(60_000)
    const harness = await openPublicPage(page, KINDS[0], { consent: true, common: (route) => route.abort('failed') })
    // The entry chunk still runs after __common fails, throws "Requiring unknown
    // module", and the app's own chunkReloadGuard reloads the page once (10 s
    // cooldown). Wait for the state that remains after that single retry.
    let navigations = 0
    page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) navigations += 1 })
    for (let attempt = 0; ; attempt += 1) {
      const before = navigations
      await expect(page.locator('#mingla-runtime-status')).toHaveText(FAILURE_COPY, { timeout: 30_000 })
      await page.waitForTimeout(2000)
      if (navigations === before) break
      expect(attempt, 'the failure state settles after at most one reload').toBeLessThan(2)
    }
    await expect(page.locator('#root > main.shell')).toHaveCount(1)
    await expect(page.locator('.hero')).toHaveCount(1)
    await expect(page.locator('style#mingla-public-document-style')).toHaveCount(1)
    await expect(page.locator('style#expo-reset')).toHaveCount(0)
    const scrolled = await page.evaluate(() => {
      const scroller = document.scrollingElement ?? document.documentElement
      const before = scroller.scrollHeight > window.innerHeight
      window.scrollTo(0, scroller.scrollHeight)
      return { overflows: before, scrollY: window.scrollY }
    })
    expect(scrolled.overflows).toBe(true)
    expect(scrolled.scrollY).toBeGreaterThan(0)
    await expect(page.locator('#mingla-runtime-status')).toBeInViewport()
    await attachScreenshot(page, 'issue3214-chunk-load-failure')
    // Per page load: the chunk failure is reported first, and whatever the app
    // then did (a late commit, then unmounting), the load ends as a failure.
    const loads = new Map<string, string[]>()
    for (const beacon of harness.beacons) {
      const id = String(beacon.load_id)
      loads.set(id, [...(loads.get(id) ?? []), `${beacon.outcome}:${beacon.reason}`])
    }
    expect(loads.size).toBeGreaterThanOrEqual(1)
    for (const outcomes of loads.values()) expect(outcomes[0]).toBe('failure:chunk_load_error')
    const finalLoad = [...loads.values()].at(-1) ?? []
    expect(finalLoad.at(-1)).toMatch(/^failure:/)
  })

  test('a slow-but-successful download never trips the deadline, because its clock starts after the last chunk runs', async ({ page }) => {
    const slow = bootRuntime.BOOT_MOUNT_DEADLINE_MS + 3000
    test.setTimeout(slow + 60_000)
    const harness = await openPublicPage(page, KINDS[0], { consent: true, common: delayed(slow) })
    await expectTakenOver(page)
    await expectAppStylesSwapped(page)
    expect(await page.evaluate(() => (window as unknown as { __issue3214StatusWrites: string[] }).__issue3214StatusWrites)).toEqual([])
    await expect.poll(() => harness.beacons.map((beacon) => `${beacon.outcome}:${beacon.reason}`)).toEqual(['success:mounted'])
    expect(Number(harness.beacons[0].elapsed_ms)).toBeGreaterThan(slow)
  })

  test('an app that never takes over is reported after the deadline instead of leaving the page silent', async ({ page }) => {
    test.setTimeout(bootRuntime.BOOT_MOUNT_DEADLINE_MS + 60_000)
    const harness = await openPublicPage(page, KINDS[0], {
      consent: true,
      entry: (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: '/* #3214: an entry chunk that never starts the app */' }),
    })
    await expect(page.locator('#mingla-runtime-status')).toHaveText(FAILURE_COPY, { timeout: bootRuntime.BOOT_MOUNT_DEADLINE_MS + 30_000 })
    await expect(page.locator('#root > main.shell')).toHaveCount(1)
    await expect(page.locator('style#expo-reset')).toHaveCount(0)
    await expect.poll(() => harness.beacons.map((beacon) => `${beacon.outcome}:${beacon.reason}`)).toEqual(['failure:mount_timeout'])
    expect(Number(harness.beacons[0].elapsed_ms)).toBeGreaterThanOrEqual(bootRuntime.BOOT_MOUNT_DEADLINE_MS)
  })
})

// #3214 — the public document's CSP governs the booted app for the whole visit.
// OBSERVED_SOURCES is the record of what the app used on public flows, taken on
// a normal app route (no CSP) against the production bundle; see #3214. It is
// deliberately NOT read from the server module: dropping an origin from the
// policy must turn this red, not shrink the list of things it checks.
const SENTRY_DSN_FOR_TEST = 'https://issue3214@o4511136062701568.ingest.us.sentry.io/1'
const OBSERVED_SOURCES: Array<[directive: 'script-src' | 'connect-src' | 'frame-src' | 'media-src' | 'img-src', origin: string]> = [
  ['script-src', 'https://www.googletagmanager.com'],
  ['script-src', 'https://us-assets.i.posthog.com'],
  ['script-src', 'https://js.stripe.com'],
  ['script-src', 'https://connect.facebook.net'],
  ['script-src', 'https://analytics.tiktok.com'],
  ['script-src', 'https://sc-static.net'],
  ['script-src', 'https://tr.snapchat.com'],
  ['script-src', 'https://www.redditstatic.com'],
  ['connect-src', 'https://gqnoajqerqhnvulmnyvv.supabase.co'],
  // #3251 — Supabase Realtime over WebSocket. CSP matches scheme-for-scheme,
  // so the https row above does NOT cover this one.
  ['connect-src', 'wss://gqnoajqerqhnvulmnyvv.supabase.co'],
  ['connect-src', 'https://api.stripe.com'],
  ['connect-src', 'https://us.i.posthog.com'],
  ['connect-src', 'https://us-assets.i.posthog.com'],
  ['connect-src', 'https://www.google-analytics.com'],
  ['connect-src', 'https://region1.google-analytics.com'],
  ['connect-src', 'https://analytics.google.com'],
  ['connect-src', 'https://www.google.com'],
  ['connect-src', 'https://stats.g.doubleclick.net'],
  ['connect-src', 'https://www.facebook.com'],
  ['connect-src', 'https://analytics.tiktok.com'],
  ['connect-src', 'https://analytics-ipv6.tiktokw.us'],
  ['connect-src', 'https://pixel-config.reddit.com'],
  ['connect-src', 'https://tr.snapchat.com'],
  ['connect-src', 'https://tr6.snapchat.com'],
  ['connect-src', new URL(SENTRY_DSN_FOR_TEST).origin],
  ['frame-src', 'https://js.stripe.com'],
  ['frame-src', 'https://hooks.stripe.com'],
  ['frame-src', 'https://tr.snapchat.com'],
  ['media-src', 'https://vz-a16fce08-6c6.b-cdn.net'],
  ['img-src', 'https://gqnoajqerqhnvulmnyvv.supabase.co'],
]
const NOT_ALLOWED = 'https://issue3214-not-allowed.invalid'

test.describe('#3214 the public document policy lets the booted app work', () => {
  test('zero CSP violations across the app\'s own flows and every observed source, with a working detector', async ({ page }) => {
    test.setTimeout(90_000)
    process.env.EXPO_PUBLIC_SENTRY_DSN = SENTRY_DSN_FOR_TEST
    const harness = await openPublicPage(page, KINDS[0], { consent: true })
    await expectTakenOver(page)

    // The app's own flows: granted analytics boots its vendors (PostHog, GA,
    // Meta in this export), its theme fonts load, and it navigates in-app to a
    // checkout route without leaving this document (so this policy still rules).
    await expect.poll(() => loadedFontFaces(page)).toBeGreaterThan(0)
    await expect.poll(() => page.evaluate(() => Array.from(document.querySelectorAll('script[src]'))
      .some((script) => (script as HTMLScriptElement).src.startsWith('https://www.googletagmanager.com/')))).toBe(true)
    await page.evaluate(() => {
      window.history.pushState({}, '', '/checkout/issue3214-event')
      window.dispatchEvent(new PopStateEvent('popstate', { state: {} }))
    })
    await expect.poll(() => page.evaluate(() => location.pathname)).toBe('/checkout/issue3214-event')
    expect(await page.evaluate(() => performance.getEntriesByType('navigation').length)).toBe(1)
    await page.waitForTimeout(1500)
    await attachScreenshot(page, 'issue3214-csp-in-app-checkout')

    // Every observed source, driven through the directive it is used under.
    // Network is cut by the route handler AFTER the browser's CSP check, so a
    // refused source reports a violation and an allowed one simply fails to load.
    await page.evaluate(async ({ sources, notAllowed }) => {
      const settle = (element: HTMLElement) => new Promise<void>((resolve) => {
        element.addEventListener('error', () => resolve(), { once: true })
        element.addEventListener('load', () => resolve(), { once: true })
        setTimeout(resolve, 1500)
      })
      const work: Promise<unknown>[] = []
      for (const [directive, origin] of sources) {
        const url = `${origin}/issue3214-csp-probe`
        if (directive === 'script-src') {
          const script = document.createElement('script')
          script.src = `${url}.js`
          work.push(settle(script))
          document.head.appendChild(script)
        } else if (directive === 'connect-src') {
          work.push(fetch(url, { mode: 'no-cors' }).catch(() => undefined))
        } else if (directive === 'frame-src') {
          const frame = document.createElement('iframe')
          frame.src = url
          frame.style.display = 'none'
          work.push(settle(frame))
          document.body.appendChild(frame)
        } else if (directive === 'media-src') {
          const video = document.createElement('video')
          video.muted = true
          video.src = `${url}.mp4`
          work.push(settle(video))
          document.body.appendChild(video)
        } else {
          const image = new Image()
          image.src = `${url}.png`
          work.push(settle(image))
        }
      }
      // Same-origin analytics: this page's boot beacon and #3187's page analytics.
      navigator.sendBeacon('/api/content-share-analytics', '{}')
      work.push(fetch('/api/public-boot-outcome', { method: 'POST', body: '{}' }).catch(() => undefined))
      // The detector must be able to see a refusal, or zero proves nothing.
      work.push(fetch(`${notAllowed}/`, { mode: 'no-cors' }).catch(() => undefined))
      await Promise.all(work)
    }, { sources: OBSERVED_SOURCES, notAllowed: NOT_ALLOWED })
    await page.waitForTimeout(1000)

    const violations = await cspViolations(page)
    expect(violations.filter((violation) => violation.blocked.startsWith(NOT_ALLOWED)), 'the detector sees a refusal')
      .toEqual([{ directive: 'connect-src', blocked: `${NOT_ALLOWED}/` }])
    expect(violations.filter((violation) => !violation.blocked.startsWith(NOT_ALLOWED))).toEqual([])
    expect(harness.cspConsole.filter((message) => !message.includes(NOT_ALLOWED))).toEqual([])
    expect(harness.pageErrors.filter((message) => /EvalError|unsafe-eval/i.test(message))).toEqual([])
  })
})

