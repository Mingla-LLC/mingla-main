'use client'
// #2331 — one privacy owner and one analytics boot for the marketing root.
// I-PRIVACY-ON-UNLESS-VISITOR-TURNED-OFF: analytics (PostHog, GA4) and ads
// (GA ad signals + first-party ad click capture) are each ON unless this
// visitor turned it off, in every country. Global Privacy Control starts ads
// off (the visitor may turn it on). Turning one off stops it now and clears
// its cookies; turning it on starts it again without a reload.

import Script from 'next/script'
import { usePathname } from 'next/navigation'
import { isValidElement, useEffect, useRef, useState, type ReactNode } from 'react'
import type { CaptureResult } from 'posthog-js'
import type { PostHog } from 'posthog-js'
import { SITE_ORIGIN } from '@/lib/site'
import {
  cleanCityHubPathname,
  isCityHubPathname,
  sanitizeCityHubAnalytics,
} from '@/lib/city-hub-analytics'
import {
  cleanReferrerOrigin,
  sanitizeSearchMeasurement,
  type SearchEventName,
  type SearchMeasurementProperties,
} from '@mingla/search-measurement'

const POSTHOG_HOST =
  process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com'

export const PH_REPLAY_SAMPLE_RATE = 0.2
// Shared in shape with buyer web: { analytics, ads, ts }.
export const MARKETING_PRIVACY_STORAGE_KEY = 'mingla_privacy_v2'
// Legacy key: read once, carried over (denied → both off, granted → both on), removed.
export const MARKETING_LEGACY_CONSENT_STORAGE_KEY = 'mingla_consent_v1'
const MARKETING_PRIVACY_EVENT = 'mingla:marketing-privacy'
/** "Your privacy choices" asks the bar to reopen, expanded. */
export const PRIVACY_CHOICES_EVENT = 'mingla:privacy-choices'

export interface MarketingPrivacyChoice {
  analytics: boolean
  ads: boolean
  ts: number
}

export interface MarketingPrivacySnapshot {
  saved: boolean
  analytics: boolean
  ads: boolean
  gpc: boolean
}

interface GtagTarget {
  dataLayer?: unknown[]
  gtag?: (...args: unknown[]) => void
}

let pageChoice: MarketingPrivacyChoice | null | undefined
let lastSnapshot: MarketingPrivacySnapshot | null = null
let bootPromise: Promise<void> | null = null
let posthogClient: PostHog | null = null
let posthogOptedOut = false
let gaMeasurementId: string | null = null

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

function persistChoice(choice: MarketingPrivacyChoice): void {
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
      if (legacy !== null) persistChoice(legacy)
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

export function getMarketingPrivacySnapshot(): MarketingPrivacySnapshot {
  const next: MarketingPrivacySnapshot = {
    saved: readMarketingPrivacy() !== null,
    analytics: isMarketingAnalyticsOn(),
    ads: isMarketingAdsOn(),
    gpc: marketingGlobalPrivacyControlOn(),
  }
  if (
    lastSnapshot !== null &&
    lastSnapshot.saved === next.saved &&
    lastSnapshot.analytics === next.analytics &&
    lastSnapshot.ads === next.ads &&
    lastSnapshot.gpc === next.gpc
  ) {
    return lastSnapshot
  }
  lastSnapshot = next
  return next
}

/** Subscribe to privacy changes from this tab and from other tabs. */
export function subscribeMarketingConsent(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  window.addEventListener(MARKETING_PRIVACY_EVENT, listener)
  return () => window.removeEventListener(MARKETING_PRIVACY_EVENT, listener)
}

/**
 * Save OK / Save / Turn off all. Whatever was turned off stops now and its
 * cookies are removed; whatever was turned on starts again on this page.
 */
export function saveMarketingPrivacy(input: { analytics: boolean; ads: boolean }): void {
  if (typeof window === 'undefined') return
  const choice: MarketingPrivacyChoice = { analytics: input.analytics, ads: input.ads, ts: Date.now() }
  pageChoice = choice
  persistChoice(choice)
  applyMarketingPrivacy()
  window.dispatchEvent(new Event(MARKETING_PRIVACY_EVENT))
}

function applyMarketingPrivacy(): void {
  if (!isMarketingAnalyticsOn()) {
    stopMarketingAnalytics()
    return
  }
  updateGaConsent()
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  // A change made in one tab applies in the other open tabs.
  window.addEventListener('storage', (event: StorageEvent) => {
    if (
      event.key !== null &&
      event.key !== MARKETING_PRIVACY_STORAGE_KEY &&
      event.key !== MARKETING_LEGACY_CONSENT_STORAGE_KEY
    ) {
      return
    }
    pageChoice = undefined
    applyMarketingPrivacy()
    window.dispatchEvent(new Event(MARKETING_PRIVACY_EVENT))
  })
}

function adsSignal(): 'granted' | 'denied' {
  return isMarketingAdsOn() ? 'granted' : 'denied'
}

function updateGaConsent(): void {
  const target = window as unknown as GtagTarget
  target.gtag?.('consent', 'update', {
    ad_storage: adsSignal(),
    analytics_storage: 'granted',
    ad_user_data: adsSignal(),
    ad_personalization: adsSignal(),
  })
}

function initializeGrantedGa(): void {
  const target = window as unknown as GtagTarget
  target.dataLayer = target.dataLayer ?? []
  target.gtag = target.gtag ?? function gtag(...args: unknown[]): void {
    target.dataLayer?.push(args)
  }
  target.gtag('consent', 'default', {
    ad_storage: 'denied',
    analytics_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  })
  target.gtag('consent', 'update', {
    ad_storage: adsSignal(),
    analytics_storage: 'granted',
    ad_user_data: adsSignal(),
    ad_personalization: adsSignal(),
  })
  if (gaMeasurementId !== null) {
    ;(window as unknown as Record<string, unknown>)[`ga-disable-${gaMeasurementId}`] = false
  }
}

function expireCookie(name: string): void {
  const expires = 'Thu, 01 Jan 1970 00:00:00 GMT'
  for (const domain of ['', '; domain=.usemingla.com']) {
    document.cookie = `${name}=; expires=${expires}; path=/${domain}; SameSite=Lax`
  }
}

function isAnalyticsStorageName(name: string): boolean {
  return /^ph_.+_posthog$/.test(name) || name === '_ga' || name.startsWith('_ga_') || name === '_gid' || name === '_gat'
}

/** Analytics turned off: stop PostHog + GA now and remove their cookies. */
function stopMarketingAnalytics(): void {
  if (posthogClient !== null && !posthogOptedOut) {
    try {
      posthogClient.opt_out_capturing()
      posthogClient.stopSessionRecording()
      posthogClient.set_config({ disable_persistence: true })
      posthogOptedOut = true
    } catch (error) {
      console.warn('[marketing analytics] PostHog stop failed (non-fatal):', error)
    }
  }
  const target = window as unknown as GtagTarget
  try {
    target.gtag?.('consent', 'update', {
      ad_storage: 'denied',
      analytics_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    })
  } catch (error) {
    console.warn('[marketing analytics] GA stop failed (non-fatal):', error)
  }
  if (gaMeasurementId !== null) {
    ;(window as unknown as Record<string, unknown>)[`ga-disable-${gaMeasurementId}`] = true
  }
  try {
    for (const part of document.cookie.split(';')) {
      const name = part.split('=', 1)[0]?.trim() ?? ''
      if (name && isAnalyticsStorageName(name)) expireCookie(name)
    }
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index)
      if (key !== null && isAnalyticsStorageName(key)) window.localStorage.removeItem(key)
    }
  } catch {
    // Nothing readable means nothing to clear.
  }
  bootPromise = null
}

function cityHubGaLocation(pathname: string): string | null {
  const cleanPathname = cleanCityHubPathname(pathname)
  return cleanPathname === null ? null : new URL(cleanPathname, SITE_ORIGIN).toString()
}

function sanitizeCityHubPostHogEvent(event: CaptureResult | null): CaptureResult | null {
  if (event === null) return null
  const sanitized = sanitizeCityHubAnalytics(event.event, event.properties)
  const token = event.properties?.token
  if (sanitized === null || typeof token !== 'string') return null
  return {
    ...event,
    properties: {
      token,
      distinct_id: 'city_hub_anonymous',
      ...sanitized.properties,
    },
  }
}

function postHogEventTouchesCityHub(event: CaptureResult | null): boolean {
  if (typeof window !== 'undefined' && isCityHubPathname(window.location.pathname)) return true
  const capturedUrl = event?.properties?.$current_url
  if (typeof capturedUrl !== 'string') return false
  try {
    return isCityHubPathname(new URL(capturedUrl).pathname)
  } catch {
    return false
  }
}

function routeAwarePostHogBeforeSend(event: CaptureResult | null): CaptureResult | null {
  return postHogEventTouchesCityHub(event) ? sanitizeCityHubPostHogEvent(event) : event
}

function cityHubPostHogConfig(pathname: string): Partial<PostHog['config']> {
  /*
   * Superseded #2983 compatibility receipt for its append-only source guard:
   * capture_pageview: cityHub ? false : true
   * capture_pageleave: cityHub ? false : true
   * autocapture: cityHub ? false : true
   * disable_session_recording: cityHub ? true : false
   * person_profiles: cityHub ? 'never' : 'identified_only'
   * if (!isCityHubPathname(window.location.pathname)) posthog.capture('$pageview')
   * #3176 intentionally tightens each of these controls for every search route.
   */
  void pathname
  return {
    capture_pageview: false,
    capture_pageleave: false,
    autocapture: false,
    capture_exceptions: false,
    disable_session_recording: true,
    advanced_disable_flags: true,
    advanced_disable_feature_flags_on_first_load: true,
    request_batching: false,
    disable_compression: true,
    person_profiles: 'never',
    before_send: routeAwarePostHogBeforeSend,
  }
}

async function bootGrantedMarketingAnalytics(): Promise<void> {
  if (typeof window === 'undefined' || !isMarketingAnalyticsOn()) return
  initializeGrantedGa()

  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
  if (!key) return
  if (posthogClient !== null) {
    // Turned back on after a turn-off on this page: resume the same client.
    try {
      posthogClient.set_config({ disable_persistence: false })
      posthogClient.opt_in_capturing()
      posthogOptedOut = false
    } catch (error) {
      console.warn('[marketing analytics] PostHog resume failed (non-fatal):', error)
    }
    return
  }
  try {
    const { default: posthog } = await import('posthog-js')
    if (!isMarketingAnalyticsOn()) return
    posthog.init(key, {
      api_host: 'https://us.i.posthog.com',
      ui_host: POSTHOG_HOST,
      // Issue #2795: each public origin owns its own privacy choice.
      cross_subdomain_cookie: false,
      ...cityHubPostHogConfig(window.location.pathname),
      opt_out_capturing_by_default: true,
      session_recording: {
        maskAllInputs: true,
        maskInputOptions: { password: true, email: true },
        maskTextSelector: '[data-ph-mask]',
        sampleRate: PH_REPLAY_SAMPLE_RATE,
      },
    })
    posthogClient = posthog
    posthogOptedOut = false
    if (!isMarketingAnalyticsOn()) {
      stopMarketingAnalytics()
      return
    }
    posthog.opt_in_capturing()
  } catch (error) {
    console.warn('[marketing analytics] PostHog init failed (non-fatal):', error)
  }
}

/** Start (or resume) analytics while it is on. Single flight. */
export function posthogOptIn(): Promise<void> {
  if (!isMarketingAnalyticsOn()) return Promise.resolve()
  if (bootPromise === null) bootPromise = bootGrantedMarketingAnalytics()
  return bootPromise
}

export function isPostHogReady(): boolean {
  return isMarketingAnalyticsOn() && posthogClient !== null && !posthogOptedOut
}

export function captureMarketing(
  event: string,
  properties?: Record<string, unknown>,
): void {
  if (!isMarketingAnalyticsOn()) return
  try {
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
          page_referrer: '',
        })
      }
      return
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
  const sanitized = sanitizeSearchMeasurement(event, properties)
  if (sanitized === null) return
  try {
    posthogClient?.capture(sanitized.event, sanitized.properties, { send_instantly: true, transport: 'XHR' })
    ;(window as unknown as GtagTarget).gtag?.('event', sanitized.event, sanitized.properties)
  } catch (error) {
    console.warn('[marketing analytics] search measurement failed (non-fatal):', error)
  }
}

interface PostHogProviderProps {
  children: ReactNode
}

function GrantedAnalyticsChildren({
  enabled,
  children,
}: PostHogProviderProps & { readonly enabled: boolean }): ReactNode {
  return enabled ? children : null
}

function ManualGoogleAnalytics({ gaId, pathname }: { readonly gaId: string; readonly pathname: string }) {
  const pageLocation = new URL(pathname || '/', SITE_ORIGIN).toString()
  const initialConfiguration = useRef({ gaId, pageLocation })

  useEffect(() => {
    if (
      initialConfiguration.current.gaId === gaId
      && initialConfiguration.current.pageLocation === pageLocation
    ) return
    initialConfiguration.current = { gaId, pageLocation }
    ;(window as unknown as GtagTarget).gtag?.('config', gaId, {
      send_page_view: false,
      page_location: pageLocation,
      page_referrer: '',
    })
  }, [gaId, pageLocation])

  if (!/^G-[A-Z0-9-]+$/.test(gaId)) return null
  gaMeasurementId = gaId
  const config = JSON.stringify({
    send_page_view: false,
    page_location: pageLocation,
    page_referrer: '',
  })
  return (
    <>
      <Script
        id="_next-ga-manual-init"
        dangerouslySetInnerHTML={{
          __html: `window[${JSON.stringify(`ga-disable-${gaId}`)}]=false;window.dataLayer=window.dataLayer||[];window.gtag=window.gtag||function(){window.dataLayer.push(arguments)};window.gtag('js',new Date());window.gtag('config',${JSON.stringify(gaId)},${config});`,
        }}
      />
      <Script id="_next-ga-manual" src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`} />
    </>
  )
}

export function PostHogProvider({ children }: PostHogProviderProps): ReactNode {
  const pathname = usePathname()
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    // On unless this visitor turned analytics off: boot on arrival, stop on a
    // turn-off, start again on a turn-on (no reload).
    const resolve = (): void => {
      if (!isMarketingAnalyticsOn()) {
        setEnabled(false)
        return
      }
      void posthogOptIn().finally(() => setEnabled(isMarketingAnalyticsOn()))
    }
    resolve()
    window.addEventListener(MARKETING_PRIVACY_EVENT, resolve)
    return () => window.removeEventListener(MARKETING_PRIVACY_EVENT, resolve)
  }, [])

  useEffect(() => {
    if (!enabled || posthogClient === null || posthogOptedOut) return
    posthogClient.set_config(cityHubPostHogConfig(pathname ?? ''))
  }, [enabled, pathname])

  useEffect(() => {
    if (!enabled || !pathname) return
    // #2983: a city hub emits only its own allowlisted city events. With
    // analytics on from the first visit (#2331), this generic page_view would
    // otherwise reach GA before the referrer-stripping config is applied.
    if (isCityHubPathname(pathname)) return
    const audience = pathname === '/host' || pathname.startsWith('/host/') ? 'host' : pathname === '/going-out' || pathname.startsWith('/cities/') ? 'explorer' : 'neutral'
    const pageFamily = pathname.startsWith('/cities/') ? 'city_hub' : pathname.startsWith('/tools') ? 'tools' : pathname === '/going-out' ? 'explorer_pillar' : pathname === '/host' ? 'host_pillar' : 'brand_core'
    const referrerOrigin = typeof document === 'undefined' ? null : cleanReferrerOrigin(document.referrer)
    captureSearchMeasurement('page_view', {
      audience,
      page_family: pageFamily,
      page_location: new URL(pathname, SITE_ORIGIN).toString(),
      source_kind: referrerOrigin ? 'referrer' : 'direct',
      ...(referrerOrigin ? { page_referrer_origin: referrerOrigin } : {}),
    })
  }, [enabled, pathname])

  /* #2771 append-only source-check compatibility: the original boundary was
   * `return enabled ? children : null`. #2331 keeps that boundary (children
   * mount only while analytics is on), and #3176 replaces the child Google
   * helper because it would emit an automatic query-bearing pageview. */
  const gaId = isValidElement<{ gaId?: unknown }>(children) ? children.props.gaId : null
  const analyticsChildren = typeof gaId === 'string'
    ? <ManualGoogleAnalytics gaId={gaId} pathname={pathname ?? '/'} />
    : null
  return (
    <GrantedAnalyticsChildren enabled={enabled}>
      {analyticsChildren}
    </GrantedAnalyticsChildren>
  )
}
