'use client'
// Issue #2771 — one consent owner and one grant-only analytics boot for the
// marketing root. Vendor denied/opt-out modes can still initialize, persist,
// load configuration, and transmit; explicit Mingla grant dominates loading.

import { useEffect, useState, type ReactNode } from 'react'
import type { PostHog } from 'posthog-js'

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
      person_profiles: 'identified_only',
      capture_pageview: true,
      capture_pageleave: true,
      opt_out_capturing_by_default: true,
      autocapture: true,
      capture_exceptions: true,
      disable_session_recording: false,
      session_recording: {
        maskAllInputs: true,
        maskInputOptions: { password: true, email: true },
        maskTextSelector: '[data-ph-mask]',
        sampleRate: PH_REPLAY_SAMPLE_RATE,
      },
    })
    posthog.opt_in_capturing()
    // Init's automatic pageview was suppressed by opt-out-default; emit one
    // explicit post-grant pageview and never replay pre-grant activity.
    posthog.capture('$pageview')
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
  if (readMarketingConsent() !== 'granted' || posthogClient === null) return
  try {
    posthogClient.capture(event, properties)
  } catch (error) {
    console.warn('[marketing analytics] capture failed (non-fatal):', error)
  }
}

export function captureMarketingConsentGrantOnce(): void {
  if (consentGrantCaptured || readMarketingConsent() !== 'granted') return
  consentGrantCaptured = true
  captureMarketing('consent_granted')
  ;(window as unknown as GtagTarget).gtag?.('event', 'consent_granted')
}

interface PostHogProviderProps {
  children: ReactNode
}

export function PostHogProvider({ children }: PostHogProviderProps): ReactNode {
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

  return enabled ? children : null
}
