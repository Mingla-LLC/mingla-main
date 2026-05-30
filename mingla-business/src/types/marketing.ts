/**
 * Marketing Hub TS types (ORCH-0815-A2).
 *
 * Mirrors `supabase/migrations/20260602000003_orch_0815_marketing_hub_phase_a.sql`
 * — 6 tables (audiences, templates, campaigns, messages, clicks, unsubscribes)
 * plus the two discriminated-union jsonb shapes (query_definition,
 * channel_payload) enforced at the DB layer via CHECK constraints
 * (I-PROPOSED-BP + I-PROPOSED-BQ).
 *
 * Discriminator rule: every union below has a required `kind` literal field.
 * NEW kinds extend additively in later phases (SMS / RCS / followers /
 * custom-segment). Existing kinds NEVER change shape.
 */

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export type MarketingChannel = "email" | "sms" | "rcs";

// ---------------------------------------------------------------------------
// Audience query_definition — discriminated union (I-PROPOSED-BP)
// ---------------------------------------------------------------------------

export interface AudienceQueryBrandBuyers {
  kind: "brand_buyers";
  brand_id: string;
  payment_statuses: ReadonlyArray<"paid" | "partial_refund">;
}

export interface AudienceQueryEventBuyers {
  kind: "event_buyers";
  event_id: string;
  payment_statuses: ReadonlyArray<"paid" | "partial_refund">;
}

/** Phase D — brand followers (not yet shippable; type reserved). */
export interface AudienceQueryBrandFollowers {
  kind: "brand_followers";
  brand_id: string;
}

/** Phase A+ — saved custom-segment query (not yet shippable). */
export interface AudienceQueryCustomSegment {
  kind: "custom_segment";
  filters: ReadonlyArray<{
    field: string;
    op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "not_in";
    value: unknown;
  }>;
}

export type AudienceQueryDefinition =
  | AudienceQueryBrandBuyers
  | AudienceQueryEventBuyers
  | AudienceQueryBrandFollowers
  | AudienceQueryCustomSegment;

// ---------------------------------------------------------------------------
// Campaign channel_payload — discriminated union (I-PROPOSED-BQ)
// ---------------------------------------------------------------------------

export interface ChannelPayloadEmail {
  kind: "email";
  subject: string;
  body_html: string;
  body_text: string;
  /** Event UUIDs referenced via `{{event:<id>}}` tokens in body. */
  embedded_events?: string[];
}

/** Phase B (SMS via Twilio 10DLC — not yet shippable). */
export interface ChannelPayloadSms {
  kind: "sms";
  body: string;
  short_url_token?: string;
}

/** Phase C (RCS via Twilio RBM — not yet shippable). */
export interface ChannelPayloadRcs {
  kind: "rcs";
  rich_card: {
    title: string;
    description?: string;
    image_url?: string;
    buttons?: Array<{ label: string; url: string }>;
  };
  quick_replies?: string[];
  fallback_sms: string;
}

export type CampaignChannelPayload =
  | ChannelPayloadEmail
  | ChannelPayloadSms
  | ChannelPayloadRcs;

// ---------------------------------------------------------------------------
// Row types — match table shapes
// ---------------------------------------------------------------------------

export interface MarketingTemplateRow {
  id: string;
  account_id: string | null;
  brand_id: string | null;
  name: string;
  channel: MarketingChannel;
  subject_template: string | null;
  body_template: string;
  is_starter_pack: boolean;
  created_at: string;
  updated_at: string;
}

export type CampaignStatus =
  | "draft"
  | "scheduled"
  | "sending"
  | "sent"
  | "failed"
  | "cancelled";

export interface MarketingCampaignRow {
  id: string;
  account_id: string;
  brand_id: string;
  audience_id: string;
  template_id: string | null;
  name: string;
  channel: MarketingChannel;
  channel_payload: CampaignChannelPayload;
  status: CampaignStatus;
  scheduled_for: string | null;
  sent_at: string | null;
  recipient_count: number | null;
  created_at: string;
  updated_at: string;
}

export type MessageStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "opened"
  | "clicked"
  | "bounced"
  | "failed"
  | "unsubscribed"
  /** Live-broadcast gate (MARKETING_SEND_LIVE_ENABLED=false). */
  | "preview_skipped";

export type UnsubscribeScope = "account" | "brand" | "global";
export type UnsubscribeChannel = MarketingChannel | "all";

// ---------------------------------------------------------------------------
// Buyer-row shape (shared by Brand Customers + Event Buyers + audience detail)
// ---------------------------------------------------------------------------

export interface BuyerConsentSummary {
  email_marketing_ok: boolean;
  sms_marketing_ok: boolean;
  unsubscribed_brand_scope: boolean;
  unsubscribed_global_scope: boolean;
}

export interface BuyerRowData {
  /** Stable identity — buyer email is canonical for Phase A. */
  contact_key: string;
  /** Display name; "Anonymous buyer" when no name on file. */
  display_name: string;
  /** Masked email like `ale**@gmail.com`; null if no email on file. */
  masked_email: string | null;
  /** Raw email — only used internally for blast targeting + suppression match. */
  raw_email: string | null;
  /** Masked phone like `(555) ***-1234`; null if no phone on file. */
  masked_phone: string | null;
  raw_phone: string | null;
  order_count: number;
  total_spend_minor: number;
  total_spend_currency: string;
  last_event_id: string | null;
  last_event_name: string | null;
  last_purchase_at: string | null;
  consent: BuyerConsentSummary;
}

// ---------------------------------------------------------------------------
// Reach summary (audience header counts)
// ---------------------------------------------------------------------------

export interface AudienceReachSummary {
  total: number;
  reachable_email: number;
  reachable_sms: number;
}

// ---------------------------------------------------------------------------
// Phase B — Marketing → Overview tab snapshot (ORCH-0863)
// ---------------------------------------------------------------------------
// Funnel formulas pinned in SPEC §6.1.4:
//   sent      = COUNT(messages WHERE status IN ('sent','delivered','clicked','preview_skipped'))
//   delivered = COUNT(messages WHERE status IN ('delivered','clicked'))
//   clicked   = COUNT(DISTINCT message_id from marketing_clicks WHERE clicked_at IS NOT NULL)
//   failed    = COUNT(messages WHERE status IN ('failed','bounced'))
// All counts windowed to the last 30 days.

export interface MarketingOverviewFunnel {
  sent: number;
  delivered: number;
  clicked: number;
  failed: number;
}

export interface MarketingOverviewRecentCampaign {
  id: string;
  name: string;
  status: CampaignStatus;
  sent_at: string | null;
  scheduled_for: string | null;
  recipient_count: number | null;
  created_at: string;
}

export interface MarketingOverviewSnapshot {
  window_days: 30;
  campaigns_sent_count: number;
  funnel: MarketingOverviewFunnel;
  recent_campaigns: MarketingOverviewRecentCampaign[];
}

// ---------------------------------------------------------------------------
// Phase B — Audiences tab unified list entry (ORCH-0863)
// ---------------------------------------------------------------------------
// `audience_id` is null for "virtual" entries — discoverable brand/event
// audiences that have no `marketing_audiences` row yet. Tap-handler lazily
// materializes the row via ensureBrandBuyersAudience / ensureEventBuyersAudience
// before navigating to the composer. Real and virtual rows render identically.

export type AudienceListEntryKind = "brand_buyers" | "event_buyers";

export interface AudienceListEntry {
  /** Stable client-side key: `${kind}:${target_id}`. */
  client_key: string;
  kind: AudienceListEntryKind;
  /** UUID of the marketing_audiences row IF it exists in DB. Null when virtual. */
  audience_id: string | null;
  brand_id: string;
  brand_name: string;
  /** For event_buyers; null for brand_buyers. */
  event_id: string | null;
  /** Display name shown on the card (e.g., "All buyers — Sunset Rooftop"). */
  display_name: string;
  /** Most recent marketing_campaigns.created_at using this audience_id; null when never used or virtual. */
  last_used_at: string | null;
}

