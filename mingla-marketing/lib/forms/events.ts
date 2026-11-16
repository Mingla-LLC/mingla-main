// #4452 §8 — the forms analytics catalogue: every event, where it goes and the
// fixed property names. One helper builds every payload, so names and
// properties cannot drift between components. Never in any property: a name,
// an email, a phone number or answer text (only keys and fixed words).
//
// Destinations: PostHog (captureMarketing, which only runs with analytics on
// and drops unlisted names), GA4 (gtag, only with analytics on), and the
// funnel table (trackFunnel in lib/forms/submit.ts). Ad platforms get only the
// Lead and goal events (lib/marketing-pixels.ts).

export type FormEventName =
  | 'popup_shown' | 'form_viewed' | 'form_started' | 'form_step' | 'form_error' | 'form_submitted'
  | 'form_submit_failed' | 'popup_closed' | 'success_viewed' | 'next_step' | 'call_slot_selected'
  | 'call_booked_inform' | 'site_block_clicked' | 'call_button_clicked' | 'form_resumed' | 'tool_followup_shown'

/** §8 table: the GA4 event name (null = not sent to GA4) and whether the funnel table records it. */
export const FORM_EVENTS: Record<FormEventName, { ga4: string | null; funnel: boolean; extra: readonly string[] }> = {
  popup_shown: { ga4: 'popup_shown', funnel: true, extra: ['trigger', 'style'] },
  form_viewed: { ga4: 'form_viewed', funnel: true, extra: [] },
  form_started: { ga4: 'form_started', funnel: true, extra: ['first_field'] },
  form_step: { ga4: 'form_step', funnel: true, extra: ['step', 'of'] },
  form_error: { ga4: 'form_error', funnel: true, extra: ['fields', 'count', 'source'] },
  form_submitted: { ga4: 'generate_lead', funnel: false, extra: ['deduped'] },
  form_submit_failed: { ga4: null, funnel: false, extra: ['reason'] },
  popup_closed: { ga4: 'popup_closed', funnel: true, extra: ['how', 'had_answers', 'stage'] },
  success_viewed: { ga4: 'page_view', funnel: true, extra: ['screen', 'virtual_path'] },
  next_step: { ga4: 'next_step', funnel: true, extra: ['choice'] },
  call_slot_selected: { ga4: null, funnel: false, extra: [] },
  call_booked_inform: { ga4: 'book_appointment', funnel: false, extra: [] },
  site_block_clicked: { ga4: null, funnel: false, extra: ['block', 'dest_kind'] },
  call_button_clicked: { ga4: 'call_button_clicked', funnel: false, extra: ['where', 'dest'] },
  form_resumed: { ga4: null, funnel: false, extra: [] },
  tool_followup_shown: { ga4: null, funnel: false, extra: ['tool', 'reason'] },
}

/** The fixed property names (§8). */
export const FIXED_PROPS = ['form_key', 'form_version', 'label', 'placement', 'page_path', 'spot', 'trigger', 'style', 'device', 'utm_source', 'utm_campaign', 'click_source'] as const

export interface FormContext {
  form_key: string
  form_version: number
  label: 'host' | 'creator' | 'local'
  placement: 'inline' | 'popup' | 'form_page' | 'book_call_details'
  spot?: string | null
}

export interface PageFacts {
  page_path: string
  device: 'desktop' | 'phone'
  utm_source?: string
  utm_campaign?: string
  click_source?: 'meta' | 'google' | 'tiktok' | 'snap' | 'reddit'
}

const DIGIT_RUN = /\d[\d\s().-]{5,}\d/

/** A value that could identify a person never leaves the browser (SC-167). */
export function safeValue(v: unknown): string | number | boolean | undefined {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v !== 'string') return undefined
  const s = v.slice(0, 200)
  if (s.includes('@')) return undefined
  if (DIGIT_RUN.test(s) && s.replace(/\D/g, '').length >= 7) return undefined
  return s
}

/** The payload for one event: the fixed properties, then only that event's own extras. */
export function formEventProps(name: FormEventName, form: FormContext | null, page: PageFacts | null, extra: Record<string, unknown> = {}): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  const put = (k: string, v: unknown) => {
    const s = safeValue(v)
    if (s !== undefined && s !== '') out[k] = s
  }
  if (form) {
    put('form_key', form.form_key)
    put('form_version', form.form_version)
    put('label', form.label)
    put('placement', form.placement)
    if (form.spot) put('spot', form.spot)
  }
  if (page) {
    put('page_path', page.page_path)
    put('device', page.device)
    put('utm_source', page.utm_source)
    put('utm_campaign', page.utm_campaign)
    put('click_source', page.click_source)
  }
  for (const k of FORM_EVENTS[name].extra) if (k in extra) put(k, extra[k])
  if ('trigger' in extra && !FORM_EVENTS[name].extra.includes('trigger')) put('trigger', extra.trigger)
  if ('style' in extra && !FORM_EVENTS[name].extra.includes('style')) put('style', extra.style)
  return out
}

/** Which ad platform's click brought them (the platform only, never the id). */
export function clickSourceOf(search: string): PageFacts['click_source'] {
  const q = new URLSearchParams(search)
  if (q.has('gclid') || q.has('gbraid') || q.has('wbraid')) return 'google'
  if (q.has('fbclid')) return 'meta'
  if (q.has('ttclid')) return 'tiktok'
  if (q.has('ScCid') || q.has('sccid')) return 'snap'
  if (q.has('rdt_cid')) return 'reddit'
  return undefined
}
