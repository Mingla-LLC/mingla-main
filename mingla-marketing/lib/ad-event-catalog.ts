// #4238 spec 5.1 — the usemingla.com copy of the ad event catalogue.
//
// usemingla.com fires one host-funnel kind in the browser: the host lead (book
// a call on /schedule, the free tools' email gate). Its names MUST equal the
// `host_lead` row of supabase/functions/_shared/adEventCatalog.ts
// HOST_FUNNEL_EVENT_NAMES, so each browser/server pair deduplicates on the
// shared `lead:<id>` event id. supabase/functions/_shared/__tests__/
// issue_4238_event_catalog_parity.test.ts (T-CAT) reads this file as text.
//
// Step 0: TikTok's lead is `Lead` (Z2); Snapchat has no lead event, so a host
// lead is `SIGN_UP` (Z3); Reddit's standard `Lead` (Z5, v3).
//
// Pure: no imports, no I/O.

// #4452 §4.1: every lead carries its label (one kind per label) and a booked
// call is its own result. Each row equals its server catalogue row.
export const MARKETING_HOST_FUNNEL_PIXEL_EVENTS = {
  host_lead: { meta: "Lead", tiktok: "Lead", snap: "SIGN_UP", reddit: "Lead" },
  creator_lead: { meta: "Lead", tiktok: "Lead", snap: "SIGN_UP", reddit: "Lead" },
  local_lead: { meta: "Lead", tiktok: "Lead", snap: "SIGN_UP", reddit: "Lead" },
  host_call_booked: { meta: "Schedule", tiktok: "Schedule", snap: "RESERVE", reddit: "CallBooked" },
  creator_call_booked: { meta: "Schedule", tiktok: "Schedule", snap: "RESERVE", reddit: "CallBooked" },
  local_call_booked: { meta: "Schedule", tiktok: "Schedule", snap: "RESERVE", reddit: "CallBooked" },
} as const

export type MarketingLeadLabel = 'host' | 'creator' | 'local'

/** #4452: the label string each platform receives (content_category). */
export const MARKETING_LEAD_LABEL_VALUE: Record<MarketingLeadLabel, { lead: string; call: string; name: string }> = {
  host: { lead: 'host_lead', call: 'host_call', name: 'Host lead' },
  creator: { lead: 'creator_lead', call: 'creator_call', name: 'Creator lead' },
  local: { lead: 'local_lead', call: 'local_call', name: 'Local lead' },
}

export const MARKETING_HOST_LEAD_EVENT = MARKETING_HOST_FUNNEL_PIXEL_EVENTS.host_lead
