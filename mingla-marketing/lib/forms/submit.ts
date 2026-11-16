// #4452 §3 — the page side of forms-submit: one POST, the client failure states,
// the save-and-resume draft and the UTM / ad context. Browser-only helpers are
// guarded; the pure parts are unit tested.

import { isMarketingAdsOn, isMarketingAnalyticsOn } from '@/components/marketing/marketing-capture'
import { marketingAdContext } from '@/lib/marketing-ad-context'
import { readLandingCampaign } from '@/lib/landing-campaign'

const FUNCTIONS_URL = process.env.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL ?? 'https://gqnoajqerqhnvulmnyvv.functions.supabase.co'
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

export { FAILURE_COPY, outcomeFor, type SubmitOutcome } from './outcome'
import { outcomeFor, type SubmitOutcome } from './outcome'

export function sessionUtm(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  try {
    const c = readLandingCampaign(isMarketingAdsOn())
    const u = c.utm as Record<string, string | undefined>
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries({ source: u.utm_source, medium: u.utm_medium, campaign: u.utm_campaign, content: u.utm_content, term: u.utm_term })) {
      if (v) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

export async function postForm(payload: Record<string, unknown>, timeoutMs = 15_000): Promise<SubmitOutcome> {
  try {
    const res = await fetch(`${FUNCTIONS_URL}/forms-submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(ANON_KEY ? { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } : {}) },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
    return outcomeFor(res.status, body)
  } catch {
    return { ok: false, kind: 'network' }
  }
}

/** The submit body (the idempotency key is minted when the form opens and reused on retry). */
export function submitBody(input: {
  idempotencyKey: string; formId: string; version: number; answers: Record<string, unknown>; placement: string;
  spotKey?: string | null; blockId?: string | null; openedAt: number; honeypot: string;
}): Record<string, unknown> {
  return {
    action: 'submit',
    idempotency_key: input.idempotencyKey,
    form_id: input.formId,
    form_version: input.version,
    answers: input.answers,
    placement: input.placement,
    spot_key: input.spotKey ?? undefined,
    block_id: input.blockId ?? undefined,
    page_url: typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : undefined,
    referrer: typeof document !== 'undefined' && document.referrer ? document.referrer : undefined,
    utm: sessionUtm(),
    time_zone: (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return undefined } })(),
    ad: marketingAdContext(),
    hp: input.honeypot,
    t_open_ms: Date.now() - input.openedAt,
  }
}

/** §8 funnel events: only with the analytics choice on; ids and enums only. */
export function trackFunnel(event: string, input: { formId: string; visitId: string; placement: string; step?: number; props?: Record<string, string | number | boolean> }): void {
  if (typeof window === 'undefined' || !isMarketingAnalyticsOn()) return
  void fetch(`${FUNCTIONS_URL}/forms-submit`, {
    method: 'POST',
    keepalive: true,
    headers: { 'Content-Type': 'application/json', ...(ANON_KEY ? { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } : {}) },
    body: JSON.stringify({
      action: 'track', event, form_id: input.formId, visit_id: input.visitId, placement: input.placement,
      page_url: `${window.location.origin}${window.location.pathname}`, step: input.step, props: input.props ?? {},
      utm_campaign: sessionUtm().campaign,
    }),
  }).catch(() => {})
}

// Save and resume (§2.7): never sent anywhere, 7 days, consent never restored.
export const DRAFT_MS = 7 * 24 * 3_600_000

export function readDraft(formId: string, nowMs: number): Record<string, unknown> | null {
  try {
    const raw = window.localStorage.getItem(`mingla:form-draft:${formId}`)
    if (!raw) return null
    const d = JSON.parse(raw) as { v?: number; saved_at?: number; answers?: Record<string, unknown> }
    if (d.v !== 1 || typeof d.saved_at !== 'number' || nowMs - d.saved_at > DRAFT_MS) {
      window.localStorage.removeItem(`mingla:form-draft:${formId}`)
      return null
    }
    return d.answers ?? null
  } catch {
    return null
  }
}

export function stripConsent(answers: Record<string, unknown>, consentKeys: string[]): Record<string, unknown> {
  const out = { ...answers }
  for (const k of consentKeys) delete out[k]
  return out
}

export function writeDraft(formId: string, answers: Record<string, unknown>, consentKeys: string[], nowMs: number): void {
  try {
    window.localStorage.setItem(`mingla:form-draft:${formId}`, JSON.stringify({ v: 1, saved_at: nowMs, answers: stripConsent(answers, consentKeys) }))
  } catch {
    // Storage off: nothing is kept.
  }
}

export function clearDraft(formId: string): void {
  try {
    window.localStorage.removeItem(`mingla:form-draft:${formId}`)
  } catch {
    // ignore
  }
}
