'use client'
// #4339 speed budget — the capture half of the marketing analytics owner.
//
// Pages import their capture calls from here, so a page's first load carries
// only the privacy read and the two capture facades. The boot, the turn-off,
// the GA tag and the provider component stay in posthog-provider.tsx, which
// the root layout mounts on every page and which re-exports everything below
// for its existing importers. Behaviour is unchanged: the same privacy choice,
// the same #4273 private-route drop, the same city-hub sanitizer and allowlist.

import type { PostHog } from 'posthog-js'
import { SITE_ORIGIN } from '@/lib/site'
import { isAnalyticsPrivatePathname } from '@/lib/analytics-private-routes'
import {
  cleanCityHubPathname,
  isCityHubPathname,
  sanitizeCityHubAnalytics,
} from '@/lib/city-hub-analytics'
import {
  attributedPageLocation,
  cleanReferrerOrigin,
  sanitizeSearchMeasurement,
  type SearchEventName,
  type SearchMeasurementProperties,
} from '@mingla/search-measurement'
import { isMarketingEventName } from '@/lib/marketing-events'
import { TOOL_ICP } from '@/lib/page-measurement'

// Shared in shape with buyer web: { analytics, ads, ts }.
export const MARKETING_PRIVACY_STORAGE_KEY = 'mingla_privacy_v2'
// Legacy key: read once, carried over (denied → both off, granted → both on), removed.
export const MARKETING_LEGACY_CONSENT_STORAGE_KEY = 'mingla_consent_v1'
export const MARKETING_PRIVACY_EVENT = 'mingla:marketing-privacy'

export interface MarketingPrivacyChoice {
  analytics: boolean
  ads: boolean
  ts: number
}

interface GtagTarget {
  gtag?: (...args: unknown[]) => void
}

let pageChoice: MarketingPrivacyChoice | null | undefined
let posthogClient: PostHog | null = null
let posthogOptedOut = false
let startAnalytics: (() => Promise<void>) | null = null
const waitingForStart: Array<() => void> = []

/** The provider's view of the one PostHog client (posthog-provider.tsx owns boot and turn-off). */
export function marketingPostHogState(): { client: PostHog | null; optedOut: boolean } {
  return { client: posthogClient, optedOut: posthogOptedOut }
}

export function setMarketingPostHogState(client: PostHog | null, optedOut: boolean): void {
  posthogClient = client
  posthogOptedOut = optedOut
}

/** The saved choice for this page; undefined re-reads storage (another tab changed it). */
export function setMarketingPageChoice(choice: MarketingPrivacyChoice | null | undefined): void {
  pageChoice = choice
}

/** posthog-provider.tsx registers its single-flight boot when the root layout loads it. */
export function registerMarketingAnalyticsStart(start: () => Promise<void>): void {
  startAnalytics = start
  for (const resume of waitingForStart.splice(0)) resume()
}

function isChoice(value: unknown): value is MarketingPrivacyChoice {
  if (value === null || typeof value !== 'object') return false
  const record = value as Partial<MarketingPrivacyChoice>
  return typeof record.analytics === 'boolean' && typeof record.ads === 'boolean'
}

function parseChoice(raw: string | null): MarketingPrivacyChoice | null {
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isChoice(parsed)) return null
    return { analytics: parsed.analytics, ads: parsed.ads, ts: typeof parsed.ts === 'number' ? parsed.ts : 0 }
  } catch {
    return null
  }
}

/** v1 carried over: usemingla.com wrote `value`, buyer web wrote `choice`. */
export function parseLegacyMarketingConsent(raw: string | null): MarketingPrivacyChoice | null {
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw) as { value?: unknown; choice?: unknown; ts?: unknown }
    const value = parsed?.value ?? parsed?.choice
    if (value !== 'granted' && value !== 'denied') return null
    const on = value === 'granted'
    return { analytics: on, ads: on, ts: typeof parsed.ts === 'number' ? parsed.ts : 0 }
  } catch {
    return null
  }
}

export function persistMarketingPrivacyChoice(choice: MarketingPrivacyChoice): void {
  try {
    window.localStorage.setItem(MARKETING_PRIVACY_STORAGE_KEY, JSON.stringify(choice))
    window.localStorage.removeItem(MARKETING_LEGACY_CONSENT_STORAGE_KEY)
  } catch (error) {
    // The choice still applies to this page through pageChoice.
    console.warn('[marketing privacy] choice not persisted:', error)
  }
}

/** The visitor's saved choice, or null while they have not chosen. */
export function readMarketingPrivacy(): MarketingPrivacyChoice | null {
  if (typeof window === 'undefined') return null
  if (pageChoice !== undefined) return pageChoice
  try {
    const current = parseChoice(window.localStorage.getItem(MARKETING_PRIVACY_STORAGE_KEY))
    if (current !== null) {
      pageChoice = current
    } else {
      const legacy = parseLegacyMarketingConsent(
        window.localStorage.getItem(MARKETING_LEGACY_CONSENT_STORAGE_KEY),
      )
      if (legacy !== null) persistMarketingPrivacyChoice(legacy)
      pageChoice = legacy
    }
  } catch {
    pageChoice = null
  }
  return pageChoice
}

export function marketingGlobalPrivacyControlOn(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true
  )
}

/** I-PRIVACY-ON-UNLESS-VISITOR-TURNED-OFF — analytics half. */
export function isMarketingAnalyticsOn(): boolean {
  if (typeof window === 'undefined') return false
  const choice = readMarketingPrivacy()
  return choice === null ? true : choice.analytics
}

/** I-PRIVACY-ON-UNLESS-VISITOR-TURNED-OFF — ads half (GPC starts it off). */
export function isMarketingAdsOn(): boolean {
  if (typeof window === 'undefined') return false
  const choice = readMarketingPrivacy()
  return choice === null ? !marketingGlobalPrivacyControlOn() : choice.ads
}

/** Subscribe to privacy changes from this tab and from other tabs. */
export function subscribeMarketingConsent(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  window.addEventListener(MARKETING_PRIVACY_EVENT, listener)
  return () => window.removeEventListener(MARKETING_PRIVACY_EVENT, listener)
}

/** Start (or resume) analytics while it is on. Single flight (posthog-provider.tsx). */
export function posthogOptIn(): Promise<void> {
  if (!isMarketingAnalyticsOn()) return Promise.resolve()
  if (startAnalytics !== null) return startAnalytics()
  // The root layout's provider has not evaluated yet: start once it registers.
  return new Promise<void>((resolve) => {
    waitingForStart.push(resolve)
  }).then(posthogOptIn)
}

export function isPostHogReady(): boolean {
  return isMarketingAnalyticsOn() && posthogClient !== null && !posthogOptedOut
}

/**
 * #4339 round B — GA4 attribution. page_location is the canonical URL plus
 * ONLY the campaign parameters GA4 reads for session source (utm_*, and the
 * Google click ids gclid/gbraid/wbraid while ads are on); page_referrer is the
 * referrer's origin, never its path or query. Before this every GA4 session
 * landed in Direct.
 */
export function gaPageLocation(canonical: string): string {
  if (typeof window === 'undefined') return canonical
  const withQuery = `${canonical}${window.location.search}`
  return attributedPageLocation(withQuery, { clickIds: isMarketingAdsOn() }) ?? canonical
}

export function gaReferrerOrigin(): string {
  if (typeof document === 'undefined') return ''
  const origin = cleanReferrerOrigin(document.referrer)
  return origin ?? ''
}

function cityHubGaLocation(pathname: string): string | null {
  const cleanPathname = cleanCityHubPathname(pathname)
  if (cleanPathname === null) return null
  return gaPageLocation(new URL(cleanPathname, SITE_ORIGIN).toString())
}

export function captureMarketing(
  event: string,
  properties?: Record<string, unknown>,
): void {
  if (!isMarketingAnalyticsOn()) return
  try {
    // #4273 — never measured: the URL carries a private token.
    if (isAnalyticsPrivatePathname(window.location.pathname)) return
    if (isCityHubPathname(window.location.pathname)) {
      const sanitized = sanitizeCityHubAnalytics(event, properties)
      if (sanitized === null) return
      posthogClient?.capture(sanitized.event, sanitized.properties, {
        send_instantly: true,
        transport: 'XHR',
      })
      const pageLocation = cityHubGaLocation(window.location.pathname)
      if (pageLocation !== null) {
        ;(window as unknown as GtagTarget).gtag?.('event', sanitized.event, {
          ...sanitized.properties,
          page_location: pageLocation,
          page_referrer: gaReferrerOrigin(),
        })
      }
      return
    }
    if (!isMarketingEventName(event)) {
      // #4339 round B: only allowlisted events reach PostHog (lib/marketing-events.ts).
      console.warn(`[marketing analytics] dropped unlisted event ${event}`)
      return
    }
    // #4339 round B: a finished free-tool report is the governed
    // `tool_interaction` outcome (PostHog and GA4), by the ICP the tool serves.
    if (event === 'tool_report_ready') {
      const icp = typeof properties?.tool === 'string' ? TOOL_ICP[properties.tool] : undefined
      if (icp) captureSearchMeasurement('tool_interaction', { audience: 'host', page_family: 'tools', icp, action_state: 'succeeded' })
    }
    if (posthogClient === null || posthogOptedOut) return
    posthogClient.capture(event, properties)
  } catch (error) {
    console.warn('[marketing analytics] capture failed (non-fatal):', error)
  }
}

/** The only search/outcome measurement entry point. Unknown or unsafe payloads
 * fail closed before either web sink is called. */
export function captureSearchMeasurement(
  event: SearchEventName,
  properties: SearchMeasurementProperties,
): void {
  if (!isMarketingAnalyticsOn()) return
  // #4273 — never measured: the URL carries a private token.
  if (typeof window !== 'undefined' && isAnalyticsPrivatePathname(window.location.pathname)) return
  const sanitized = sanitizeSearchMeasurement(event, properties)
  if (sanitized === null) return
  try {
    posthogClient?.capture(sanitized.event, sanitized.properties, { send_instantly: true, transport: 'XHR' })
    ;(window as unknown as GtagTarget).gtag?.('event', sanitized.event, sanitized.properties)
  } catch (error) {
    console.warn('[marketing analytics] search measurement failed (non-fatal):', error)
  }
}
