// #4339 round B — THE PostHog event allowlist for usemingla.com.
//
// captureMarketing (components/marketing/posthog-provider.tsx) sends only the
// events named here; anything else is dropped before it reaches PostHog, so a
// typo or an ad-hoc event can never start a new, unreviewed data stream. City
// pages keep their own stricter allowlist on top (lib/city-hub-analytics.ts,
// #2983). Adding an event is adding it here, in the same pull request.
//
// The issue-4339 round B tracking test fails if any captureMarketing call in
// the app names an event that is not listed.

export const MARKETING_EVENT_NAMES = [
  // #2983 city pages (also sanitized by lib/city-hub-analytics.ts)
  'city_hub_view',
  'city_hub_explorer_action',
  'city_hub_host_action',
  'city_hub_inventory_action',
  'city_hub_switch_city',
  // site CTAs and /links (#4137, #4318)
  'get_the_app_clicked',
  'marketing_cta_clicked',
  'links_banner_tapped',
  'links_city_changed',
  'links_filter_changed',
  'links_full_week_opened',
  'links_page_social_clicked',
  'links_sheet_closed',
  'links_strip_opened',
  // free tools and Book a call
  'tool_run_started',
  'tool_report_ready',
  'tool_report_emailed',
  'tool_gate_viewed',
  'tool_gate_email_submitted',
  'tool_gate_app_click',
  'tool_offer_view',
  'tool_offer_cta_click',
  'tool_ratelimit_cta_click',
  'tool_book_view',
  'tool_book_confirmed',
  // #4339 round B — the hand-off sheet
  'handoff_sheet_opened',
  'handoff_store_clicked',
  'handoff_host_web_clicked',
  'handoff_sheet_closed',
  // #4339 round B — "Prompt your website into existence" → Ari
  'website_prompt_started',
  'website_prompt_generated',
  'ari_handoff_clicked',
  // #4339 round B — Host landing pages
  'icp_talk_to_team_clicked',
  'icp_see_inside_clicked',
  'icp_tool_card_clicked',
  'icp_faq_opened',
  // #4339 round B — /schedule and /download
  'schedule_slot_selected',
  'schedule_details_submitted',
  'download_toggle_changed',
] as const

export type MarketingEventName = (typeof MARKETING_EVENT_NAMES)[number]

const ALLOWED: ReadonlySet<string> = new Set(MARKETING_EVENT_NAMES)

export function isMarketingEventName(name: string): name is MarketingEventName {
  return ALLOWED.has(name)
}

/**
 * Events recorded outside the browser, named here so the full funnel has one
 * list: `ari_draft_created` is written by the site-prompt-draft edge function
 * (a structured log line), `ari_draft_claimed` by host web's own PostHog
 * (mingla-business ariPolishAnalytics).
 */
export const SERVER_FUNNEL_EVENT_NAMES = ['ari_draft_created', 'ari_draft_claimed'] as const
