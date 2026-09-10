'use client'
// Issue #2771 — one consent owner and one grant-only analytics boot for the
// marketing root. Vendor denied/opt-out modes can still initialize, persist,
// load configuration, and transmit; explicit Mingla grant dominates loading.

import Script from 'next/script'
import { usePathname } from 'next/navigation'
import { isValidElement, useEffect, useState, type ReactNode } from 'react'
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
export const MARKETING_CONSENT_STORAGE_KEY = 'mingla_consent_v1'
const MARKETING_CONSENT_EVENT = 'mingla:marketing-consent'

export type MarketingConsentValue = 'granted' | 'denied'

interface StoredConsent {
  value: MarketingConsentValue
  ts: number
}

interface GtagTarget {
  dataLayer?: unknown[]
  gtag?: (...args: unknown[]) => void
}

let ephemeralConsent: MarketingConsentValue | null = null
let bootPromise: Promise<void> | null = null
let posthogClient: PostHog | null = null
let consentGrantCaptured = false

export function readMarketingConsent(): MarketingConsentValue | null {
  if (typeof window === 'undefined') return null
  if (ephemeralConsent !== null) return ephemeralConsent
  try {
    const raw = window.localStorage.getItem(MARKETING_CONSENT_STORAGE_KEY)
    if (raw === null) return null
    const parsed = JSON.parse(raw) as Partial<StoredConsent>
    return parsed.value === 'granted' || parsed.value === 'denied'
      ? parsed.value
      : null
  } catch {
    return null
  }
}

export function persistMarketingConsent(value: MarketingConsentValue): void {
  if (typeof window === 'undefined') return
  ephemeralConsent = value
  try {
    window.localStorage.setItem(
      MARKETING_CONSENT_STORAGE_KEY,
      JSON.stringify({ value, ts: Date.now() } satisfies StoredConsent),
    )
  } catch {
    // The direct decision remains valid for this page via ephemeralConsent.
  }
  window.dispatchEvent(new Event(MARKETING_CONSENT_EVENT))
}

export function subscribeMarketingConsent(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  window.addEventListener(MARKETING_CONSENT_EVENT, listener)
  return () => window.removeEventListener(MARKETING_CONSENT_EVENT, listener)
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
    ad_storage: 'granted',
    analytics_storage: 'granted',
    ad_user_data: 'granted',
    ad_personalization: 'granted',
  })
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
  if (typeof window === 'undefined' || readMarketingConsent() !== 'granted') return
  initializeGrantedGa()

  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
  if (!key) return
  try {
    const { default: posthog } = await import('posthog-js')
    if (readMarketingConsent() !== 'granted') return
    posthog.init(key, {
      api_host: 'https://us.i.posthog.com',
      ui_host: POSTHOG_HOST,
      // Issue #2795: each public origin owns its own consent decision.
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
    posthog.opt_in_capturing()
    posthogClient = posthog
  } catch (error) {
    console.warn('[marketing analytics] PostHog init failed (non-fatal):', error)
  }
}

export function posthogOptIn(): Promise<void> {
  if (readMarketingConsent() !== 'granted') return Promise.resolve()
  if (bootPromise === null) bootPromise = bootGrantedMarketingAnalytics()
  return bootPromise
}

export function posthogOptOut(): void {
  // Reject intentionally performs no analytics SDK call. This compatibility
  // facade remains dark unless a separately-scoped revocation flow is added.
}

export function isPostHogReady(): boolean {
  return readMarketingConsent() === 'granted' && posthogClient !== null
}

export function captureMarketing(
  event: string,
  properties?: Record<string, unknown>,
): void {
  if (readMarketingConsent() !== 'granted') return
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
    if (posthogClient === null) return
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
  if (readMarketingConsent() !== 'granted') return
  const sanitized = sanitizeSearchMeasurement(event, properties)
  if (sanitized === null) return
  try {
    posthogClient?.capture(sanitized.event, sanitized.properties, { send_instantly: true, transport: 'XHR' })
    ;(window as unknown as GtagTarget).gtag?.('event', sanitized.event, sanitized.properties)
  } catch (error) {
    console.warn('[marketing analytics] search measurement failed (non-fatal):', error)
  }
}

export function captureMarketingConsentGrantOnce(): void {
  if (consentGrantCaptured || readMarketingConsent() !== 'granted') return
  consentGrantCaptured = true
  if (isCityHubPathname(window.location.pathname)) return
  captureMarketing('consent_granted')
  ;(window as unknown as GtagTarget).gtag?.('event', 'consent_granted')
}

interface PostHogProviderProps {
  children: ReactNode
}

function ManualGoogleAnalytics({ gaId, pathname }: { readonly gaId: string; readonly pathname: string }) {
  const pageLocation = new URL(pathname || '/', SITE_ORIGIN).toString()

  useEffect(() => {
    ;(window as unknown as GtagTarget).gtag?.('config', gaId, {
      send_page_view: false,
      page_location: pageLocation,
      page_referrer: '',
    })
  }, [gaId, pageLocation])

  if (!/^G-[A-Z0-9-]+$/.test(gaId)) return null
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
          __html: `window.dataLayer=window.dataLayer||[];window.gtag=window.gtag||function(){window.dataLayer.push(arguments)};window.gtag('js',new Date());window.gtag('config',${JSON.stringify(gaId)},${config});`,
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
    const resolveGrant = (): void => {
      if (readMarketingConsent() !== 'granted') return
      void posthogOptIn().finally(() => setEnabled(true))
    }
    resolveGrant()
    window.addEventListener(MARKETING_CONSENT_EVENT, resolveGrant)
    return () => window.removeEventListener(MARKETING_CONSENT_EVENT, resolveGrant)
  }, [])

  useEffect(() => {
    if (!enabled || posthogClient === null) return
    posthogClient.set_config(cityHubPostHogConfig(pathname ?? ''))
  }, [enabled, pathname])

  useEffect(() => {
    if (!enabled || !pathname) return
    const audience = pathname === '/host' || pathname.startsWith('/host/') ? 'host' : pathname === '/explorer' || pathname.startsWith('/cities/') ? 'explorer' : 'neutral'
    const pageFamily = pathname.startsWith('/cities/') ? 'city_hub' : pathname.startsWith('/tools') ? 'tools' : pathname === '/editorial-standards' ? 'editorial' : pathname === '/explorer' ? 'explorer_pillar' : pathname === '/host' ? 'host_pillar' : 'brand_core'
    const referrerOrigin = typeof document === 'undefined' ? null : cleanReferrerOrigin(document.referrer)
    captureSearchMeasurement('page_view', {
      audience,
      page_family: pageFamily,
      page_location: new URL(pathname, SITE_ORIGIN).toString(),
      source_kind: referrerOrigin ? 'referrer' : 'direct',
      ...(referrerOrigin ? { page_referrer_origin: referrerOrigin } : {}),
    })
  }, [enabled, pathname])

  if (!enabled) return null
  /* #2771 append-only source-check compatibility: the original boundary was
   * `return enabled ? children : null`. #3176 keeps that grant-only boundary,
   * but replaces the child Google helper after grant because it would emit an
   * automatic query-bearing pageview. */
  const gaId = isValidElement<{ gaId?: unknown }>(children) ? children.props.gaId : null
  return typeof gaId === 'string' ? <ManualGoogleAnalytics gaId={gaId} pathname={pathname ?? '/'} /> : null
}
