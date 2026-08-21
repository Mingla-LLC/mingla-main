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
export interface AudienceQueryAllBrandPeople {
  kind: "all_brand_people";
  brand_id: string;
}

/** #2395 — a reusable membership overlay over canonical Brand People. */
export interface AudienceQueryManualGroup {
  kind: "manual_group";
}

export type AudienceQueryDefinition =
  | AudienceQueryBrandBuyers
  | AudienceQueryEventBuyers
  | AudienceQueryBrandFollowers
  | AudienceQueryCustomSegment
  | AudienceQueryAllBrandPeople
  | AudienceQueryManualGroup;

export interface ManualGroupSummary {
  groupId: string;
  name: string;
  kind: "manual";
  memberCount: number;
  pendingReviewCount: number;
  membershipVersion: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ManualGroupMember {
  personId: string;
  displayName: string;
  avatarUrl: string | null;
  contacts: {
    id: string;
    channel: "email" | "phone";
    value: string;
    isPrimary: boolean;
  }[];
  suppressions: { channel: "email" | "sms"; scope: string }[];
  isMember?: boolean;
}

export interface ManualGroupDetail extends ManualGroupSummary {
  members: ManualGroupMember[];
  totalMembers: number;
  filteredTotal: number;
  nextCursor: Record<string, unknown> | null;
}

export interface ManualGroupReviewResult {
  currentMemberCount: number;
  resultingMemberCount: number;
  newMemberCount: number;
}

export interface MarketingBookQuote {
  quoteVersion: 1;
  quoteHash: string;
  quotedAt: string;
  expiresAt: string;
  selectedCount: number;
  reachableCount: number;
  suppressedCount: number;
  unavailableCount: number;
  smsSegments: number;
  costKind: "provider_estimate" | "not_metered";
  estimatedCostMinor: number | null;
  currency: string | null;
  audienceId?: string;
  audienceKind?: "all_brand_people" | "manual_group";
  audienceVersion?: number;
}
export type MarketingBookPreviewState =
  | { kind: "idle" }
  | { kind: "loading"; previous: MarketingBookQuote | null }
  | { kind: "ready"; quote: MarketingBookQuote; staleWarning: boolean }
  | { kind: "error"; code: string; message: string; retryable: boolean };

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

/** SMS blast payload (live via Twilio US / Termii NG). */
export interface ChannelPayloadSms {
  kind: "sms";
  body: string;
  short_url_token?: string;
  /**
   * ORCH-1282 — MMS photo attachment. Verified PUBLIC URLs on the
   * `brand_covers` bucket (obtained via getPublicUrl + verifyBrandCoverPublicUrl
   * before write). Array for forward-compat; the composer sets exactly one.
   * US/Twilio only — the NG/Termii send path ignores media (SMS-only).
   */
  media_urls?: string[];
}

export type CampaignChannelPayload = ChannelPayloadEmail | ChannelPayloadSms;

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
  "draft" | "scheduled" | "sending" | "sent" | "failed" | "cancelled";

export interface MarketingCampaignRow {
  id: string;
  account_id: string;
  brand_id: string;
  audience_id: string;
  audience_name_snapshot?: string | null;
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
  | "preview_skipped"
  /**
   * ORCH-1270 — SMS recipient held OUT of the recipient-local quiet-hours
   * window; re-attempted in-window by the cron. Neither delivered nor failed
   * (the Marketing Overview funnel counts it as pending in NEITHER bucket).
   * The deferred cohort's campaign reuses CampaignStatus='scheduled'.
   */
  | "deferred";

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
