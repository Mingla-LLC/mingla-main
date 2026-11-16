'use client'

// #4452 §8 — one forms event to PostHog and (when the §8 table says so) GA4,
// only with analytics on. This stub checks the analytics choice first and
// loads the sender on first use, so every page's first-load JavaScript stays
// inside the #4339 budget (the call link is on every page).
import { isMarketingAnalyticsOn } from '@/components/marketing/marketing-capture'
import type { FormContext, FormEventName } from '@/lib/forms/events'

export function formEvent(name: FormEventName, form: FormContext | null, extra: Record<string, unknown> = {}): void {
  if (typeof window === 'undefined' || !isMarketingAnalyticsOn()) return
  void import('./form-events-send').then((m) => m.sendFormEvent(name, form, extra)).catch(() => {})
}
