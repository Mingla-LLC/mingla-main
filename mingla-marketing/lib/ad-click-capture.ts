/**
 * toward #3697 Wave 0a — first-party ad click capture on the marketing site.
 * Mirrors Host webAnalytics pre-consent rules: ad/UTM/mc_id before banner;
 * Reject stamps consent_state=rejected; vendor SDKs stay grant-gated elsewhere.
 */
'use client'

import { readMarketingConsent } from '@/components/marketing/posthog-provider'
import {
  MARKETING_BRAND_SLUG,
  marketingSlugFromPathname,
} from '@/lib/ad-marketing-routes'

const AD_CLICK_KEY = 'mingla_ad_click_v1'
const ATTR_TIMEOUT_MS = 2500

function functionsBase(): string | null {
  const functions = process.env.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL
  if (functions) return functions.replace(/\/$/, '')
  const rest = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!rest) return null
  return `${rest.replace(/\/$/, '')}/functions/v1`
}

function anonKey(): string | null {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? null
}

function storedClickId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(AD_CLICK_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { clickId?: unknown }
    return typeof parsed.clickId === 'string' ? parsed.clickId : null
  } catch {
    return null
  }
}

function storeClickId(clickId: string): void {
  if (readMarketingConsent() === 'denied') return
  try {
    window.sessionStorage.setItem(AD_CLICK_KEY, JSON.stringify({ clickId }))
  } catch {
    // private mode
  }
}

async function postCapture(body: Record<string, unknown>): Promise<string | null> {
  const base = functionsBase()
  const anon = anonKey()
  if (!base || !anon) return null
  const aborter = new AbortController()
  const timer = window.setTimeout(() => aborter.abort(), ATTR_TIMEOUT_MS)
  try {
    const res = await fetch(`${base}/attribution-capture`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${anon}`,
        apikey: anon,
      },
      body: JSON.stringify(body),
      signal: aborter.signal,
    })
    if (!res.ok) return null
    const data = (await res.json()) as { click_id?: string }
    return typeof data.click_id === 'string' ? data.click_id : null
  } catch {
    return null
  } finally {
    window.clearTimeout(timer)
  }
}

export function captureMarketingAdClickIds(): void {
  if (typeof window === 'undefined') return
  const consent = readMarketingConsent()
  const existingClickId = storedClickId()
  // toward #3697: Accept/Reject only stamp the stored first-party touch.
  if (consent === 'denied') {
    if (existingClickId) {
      void postCapture({
        kind: 'consent',
        click_id: existingClickId,
        consent_state: 'rejected',
        surface: 'web',
        lane: 'business',
      })
    }
    return
  }
  if (consent === 'granted' && existingClickId) {
    void postCapture({
      kind: 'consent',
      click_id: existingClickId,
      consent_state: 'granted',
      surface: 'web',
      lane: 'business',
    })
    return
  }
  try {
    const params = new URLSearchParams(window.location.search)
    const fbclid = params.get('fbclid')
    const ttclid = params.get('ttclid')
    const sccid = params.get('sccid') ?? params.get('ScCid')
    const gclid = params.get('gclid')
    const rdtCid = params.get('rdt_cid')
    const mcId = params.get('mc_id')
    const afCId = params.get('af_c_id') ?? params.get('c_id')
    const utm: Record<string, string> = {}
    for (const k of [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_content',
      'utm_term',
    ]) {
      const v = params.get(k)
      if (v) utm[k] = v
    }
    const external = fbclid ?? ttclid ?? sccid ?? gclid ?? rdtCid ?? null
    if (
      external === null &&
      mcId === null &&
      afCId === null &&
      Object.keys(utm).length === 0
    ) {
      return
    }
    const network = fbclid
      ? 'meta'
      : ttclid
        ? 'tiktok'
        : sccid
          ? 'snapchat'
          : rdtCid
            ? 'reddit'
            : gclid
              ? 'google'
              : 'other'
    const consentState = consent === 'granted' ? 'granted' : 'pending'
    const marketingSlug = marketingSlugFromPathname(window.location.pathname)
    void postCapture({
      kind: 'touch',
      surface: 'web',
      lane: 'business',
      network,
      external_click_id: external,
      mc_id: mcId,
      af_c_id: afCId,
      utm,
      consent_state: consentState,
      // toward #3697 Wave 4 — real marketing dest when path is allowlisted.
      ...(marketingSlug
        ? {
            dest: {
              page_type: 'marketing' as const,
              brand_slug: MARKETING_BRAND_SLUG,
              entity_slug: marketingSlug,
            },
          }
        : {}),
    }).then((clickId) => {
      if (clickId && !storedClickId()) storeClickId(clickId)
    })
  } catch {
    // Fail-open.
  }
}
