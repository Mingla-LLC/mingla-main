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

export interface MarketingAudienceRow {
  id: string;
  account_id: string;
  brand_id: string | null;
  name: string;
  query_definition: AudienceQueryDefinition;
  is_system_generated: boolean;
  created_at: string;
  updated_at: string;
}

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

export interface MarketingMessageRow {
  id: string;
  campaign_id: string;
  recipient_email: string | null;
  recipient_phone: string | null;
  channel: MarketingChannel;
  provider_message_id: string | null;
  status: MessageStatus;
  sent_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  last_clicked_at: string | null;
  click_count: number;
  failure_reason: string | null;
  created_at: string;
}

export interface MarketingClickRow {
  id: string;
  campaign_id: string;
  message_id: string | null;
  destination_url: string;
  tracking_id: string;
  clicked_at: string | null;
  user_agent: string | null;
  ip_hash: string | null;
  created_at: string;
}

export type UnsubscribeScope = "account" | "brand" | "global";
export type UnsubscribeChannel = MarketingChannel | "all";

export interface MarketingUnsubscribeRow {
  id: string;
  contact_email: string | null;
  contact_phone: string | null;
  channel: UnsubscribeChannel;
  scope: UnsubscribeScope;
  brand_id: string | null;
  account_id: string | null;
  reason: string | null;
  unsubscribed_at: string;
}

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
// Type guards (runtime discriminator narrowing — I-PROPOSED-BP/BQ)
// ---------------------------------------------------------------------------

export function isBrandBuyersQuery(
  q: AudienceQueryDefinition,
): q is AudienceQueryBrandBuyers {
  return q.kind === "brand_buyers";
}

export function isEventBuyersQuery(
  q: AudienceQueryDefinition,
): q is AudienceQueryEventBuyers {
  return q.kind === "event_buyers";
}

export function isEmailPayload(
  p: CampaignChannelPayload,
): p is ChannelPayloadEmail {
  return p.kind === "email";
}

/** Exhaustiveness helper — call from default-branch switch arms. */
export function assertNeverChannelKind(p: never): never {
  throw new Error(
    `unknown_channel_kind:${(p as { kind?: string } | undefined)?.kind ?? "undefined"}`,
  );
}

export function assertNeverAudienceKind(q: never): never {
  throw new Error(
    `unknown_audience_kind:${(q as { kind?: string } | undefined)?.kind ?? "undefined"}`,
  );
}
