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

export const MARKETING_HOST_FUNNEL_PIXEL_EVENTS = {
  host_lead: { meta: "Lead", tiktok: "Lead", snap: "SIGN_UP", reddit: "Lead" },
} as const

export const MARKETING_HOST_LEAD_EVENT = MARKETING_HOST_FUNNEL_PIXEL_EVENTS.host_lead
