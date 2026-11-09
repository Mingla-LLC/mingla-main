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
  analyticsSafePathname,
  isAnalyticsPrivatePathname,
  isAnalyticsPrivateUrl,
} from '@/lib/analytics-private-routes'
import {
  isCityHubPathname,
  sanitizeCityHubAnalytics,
} from '@/lib/city-hub-analytics'
import { cleanReferrerOrigin } from '@mingla/search-measurement'
import { pageMeasurement } from '@/lib/page-measurement'
import { rememberLandingCampaign } from '@/lib/landing-campaign'
// #4339 speed budget: the privacy read and the capture facades live in
// marketing-capture.ts so pages import them without this provider; they are
// re-exported here unchanged for every existing importer.
import {
  MARKETING_LEGACY_CONSENT_STORAGE_KEY,
  MARKETING_PRIVACY_EVENT,
  MARKETING_PRIVACY_STORAGE_KEY,
  captureSearchMeasurement,
  gaPageLocation,
  gaReferrerOrigin,
  isMarketingAdsOn,
  isMarketingAnalyticsOn,
  marketingGlobalPrivacyControlOn,
  marketingPostHogState,
  persistMarketingPrivacyChoice,
  readMarketingPrivacy,
  registerMarketingAnalyticsStart,
  setMarketingPageChoice,
  setMarketingPostHogState,
  type MarketingPrivacyChoice,
} from '@/components/marketing/marketing-capture'

export {
  MARKETING_LEGACY_CONSENT_STORAGE_KEY,
  MARKETING_PRIVACY_STORAGE_KEY,
  captureMarketing,
  captureSearchMeasurement,
  gaPageLocation,
  gaReferrerOrigin,
  isMarketingAdsOn,
  isMarketingAnalyticsOn,
  isPostHogReady,
  marketingGlobalPrivacyControlOn,
  parseLegacyMarketingConsent,
  posthogOptIn,
  readMarketingPrivacy,
  subscribeMarketingConsent,
  type MarketingPrivacyChoice,
} from '@/components/marketing/marketing-capture'

const POSTHOG_HOST =
  process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com'

export const PH_REPLAY_SAMPLE_RATE = 0.2
/** The folded privacy bar's "Privacy settings" button asks the bar to reopen, expanded (#4318). */
export const PRIVACY_CHOICES_EVENT = 'mingla:privacy-choices'

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

let lastSnapshot: MarketingPrivacySnapshot | null = null
let bootPromise: Promise<void> | null = null
let gaMeasurementId: string | null = null

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

/**
 * Save OK / Save / Turn off all. Whatever was turned off stops now and its
 * cookies are removed; whatever was turned on starts again on this page.
 */
export function saveMarketingPrivacy(input: { analytics: boolean; ads: boolean }): void {
  if (typeof window === 'undefined') return
  const choice: MarketingPrivacyChoice = { analytics: input.analytics, ads: input.ads, ts: Date.now() }
  setMarketingPageChoice(choice)
  persistMarketingPrivacyChoice(choice)
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
    setMarketingPageChoice(undefined)
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
  return /^ph_/.test(name) || name === '_ga' || name.startsWith('_ga_') || name === '_gid' || name === '_gat'
}

/** Analytics turned off: stop PostHog + GA now and remove their cookies. */
function stopMarketingAnalytics(): void {
  const { client: posthogClient, optedOut: posthogOptedOut } = marketingPostHogState()
  if (posthogClient !== null && !posthogOptedOut) {
    try {
      posthogClient.opt_out_capturing()
      posthogClient.stopSessionRecording()
      posthogClient.set_config({ disable_persistence: true })
      setMarketingPostHogState(posthogClient, true)
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
    // PostHog keeps its identity in localStorage and a tab marker in
    // sessionStorage (`ph_<token>_…`): both go.
    for (const store of [window.localStorage, window.sessionStorage]) {
      for (let index = store.length - 1; index >= 0; index -= 1) {
        const key = store.key(index)
        if (key !== null && isAnalyticsStorageName(key)) store.removeItem(key)
      }
    }
  } catch {
    // Nothing readable means nothing to clear.
  }
  bootPromise = null
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
  // #4273 — nothing is sent from a page whose URL carries a private token.
  if (
    (typeof window !== 'undefined' && isAnalyticsPrivatePathname(window.location.pathname))
    || isAnalyticsPrivateUrl(event?.properties?.$current_url)
  ) return null
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
  const { client: posthogClient } = marketingPostHogState()
  if (posthogClient !== null) {
    // Turned back on after a turn-off on this page: resume the same client.
    try {
      posthogClient.set_config({ disable_persistence: false })
      posthogClient.opt_in_capturing()
      setMarketingPostHogState(posthogClient, false)
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
    setMarketingPostHogState(posthog, false)
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
function startMarketingAnalytics(): Promise<void> {
  if (!isMarketingAnalyticsOn()) return Promise.resolve()
  if (bootPromise === null) bootPromise = bootGrantedMarketingAnalytics()
  return bootPromise
}

registerMarketingAnalyticsStart(startMarketingAnalytics)

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
  // #4339 round B: the canonical URL plus the allowlisted campaign parameters,
  // and the referrer's origin (the #2983 compatibility receipt for its source
  // guard was `page_referrer: ''`; city events keep their own sanitizer).
  // #4273 — a private-token path is configured as its token-free family.
  const pageLocation = gaPageLocation(new URL(analyticsSafePathname(pathname || '/'), SITE_ORIGIN).toString())
  const pageReferrer = gaReferrerOrigin()
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
      page_referrer: pageReferrer,
    })
  }, [gaId, pageLocation, pageReferrer])

  if (!/^G-[A-Z0-9-]+$/.test(gaId)) return null
  gaMeasurementId = gaId
  const config = JSON.stringify({
    send_page_view: false,
    page_location: pageLocation,
    page_referrer: pageReferrer,
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
      // #4339 round B: keep the landing campaign for the app hand-off while
      // ads are on (cleared when they are turned off).
      rememberLandingCampaign(window.location.search, isMarketingAdsOn())
      if (!isMarketingAnalyticsOn()) {
        setEnabled(false)
        return
      }
      void startMarketingAnalytics().finally(() => setEnabled(isMarketingAnalyticsOn()))
    }
    resolve()
    window.addEventListener(MARKETING_PRIVACY_EVENT, resolve)
    return () => window.removeEventListener(MARKETING_PRIVACY_EVENT, resolve)
  }, [])

  useEffect(() => {
    const { client: posthogClient, optedOut: posthogOptedOut } = marketingPostHogState()
    if (!enabled || posthogClient === null || posthogOptedOut) return
    posthogClient.set_config(cityHubPostHogConfig(pathname ?? ''))
  }, [enabled, pathname])

  useEffect(() => {
    if (!enabled || !pathname) return
    // #4273 — no page view for a page whose URL carries a private token.
    if (isAnalyticsPrivatePathname(pathname)) return
    // #2983: a city hub emits only its own allowlisted city events. With
    // analytics on from the first visit (#2331), this generic page_view would
    // otherwise reach GA before the referrer-stripping config is applied.
    if (isCityHubPathname(pathname)) return
    // #4339 round B: audience, page family and (Host landing pages) the ICP
    // come from one table (lib/page-measurement.ts); page_location keeps the
    // allowlisted campaign parameters.
    const page = pageMeasurement(pathname)
    const referrerOrigin = typeof document === 'undefined' ? null : cleanReferrerOrigin(document.referrer)
    captureSearchMeasurement('page_view', {
      ...page,
      page_location: gaPageLocation(new URL(pathname, SITE_ORIGIN).toString()),
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
