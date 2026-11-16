'use client'

// #4452 §8 — the sending half of formEvent (loaded on first use, so the site's
// first-load JavaScript does not carry the catalogue): PostHog, and GA4 when
// the catalogue says so. The payload comes from lib/forms/events.ts.
import { captureMarketing, isMarketingAnalyticsOn } from '@/components/marketing/marketing-capture'
import { FORM_EVENTS, type FormContext, type FormEventName, clickSourceOf, formEventProps } from '@/lib/forms/events'
import { sessionUtm } from '@/lib/forms/utm'

export function pageFacts() {
  if (typeof window === 'undefined') return null
  const utm = sessionUtm()
  return {
    page_path: window.location.pathname,
    device: window.matchMedia('(max-width: 859px)').matches ? 'phone' as const : 'desktop' as const,
    utm_source: utm.source,
    utm_campaign: utm.campaign,
    click_source: clickSourceOf(window.location.search),
  }
}

export function sendFormEvent(name: FormEventName, form: FormContext | null, extra: Record<string, unknown> = {}): void {
  if (typeof window === 'undefined' || !isMarketingAnalyticsOn()) return
  const props = formEventProps(name, form, pageFacts(), extra)
  captureMarketing(name, props)
  const ga4 = FORM_EVENTS[name].ga4
  if (!ga4) return
  try {
    const gtag = (window as unknown as { gtag?: (...a: unknown[]) => void }).gtag
    if (ga4 === 'page_view') gtag?.('event', 'page_view', { page_location: `https://usemingla.com${String(extra.virtual_path ?? '')}` })
    else gtag?.('event', ga4, props)
  } catch {
    // GA4 not loaded
  }
}
