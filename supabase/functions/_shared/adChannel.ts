/**
 * adChannel.ts — the Full Rooms Ad Engine channel layer (ISSUE-862 WP1).
 *
 * SPEC: Mingla_Artifacts/specs/SPEC_ISSUE-862_META_ADS_CAMPAIGN_ENGINE.md
 *   Amendment A3 §B (interface + registry) as superseded by Amendment A4.a
 *   (the widened ChannelAdapter — createCreative? + setBudget), grounded in
 *   Mingla_Artifacts/research/ad-pipeline-2026-07-15/PROOF_LOG.md.
 *
 * One interface; per-platform modules _shared/{meta,tiktok,snapchat,google,
 * reddit}.ts each implement it. All five are live adapters — Meta (WP1),
 * Google (WP2), Reddit (WP6 #916), TikTok (WP7 #863) and Snapchat (WP5 #867)
 * — each fail-closing (AdNotConnectedError → 424 <platform>_not_connected)
 * while its secrets are unset.
 *
 * MONEY (A4.a / GR-01 — the 10,000x bug): budgets are stored in MINOR UNITS
 * (cents, bigint) everywhere; conversion to the platform unit happens at
 * EXACTLY ONE place per adapter — centsToPlatformBudget below. Minimum-budget
 * checks run in the platform unit AFTER conversion.
 *
 * CTA maps are per-platform — NEVER a shared normalizer (A4.a / GR-29).
 * Reddit's CTA enum is Title-Case display strings; any generic toUpperCase()
 * normalizer 400s there. Google RSA has NO CTA field at all — deliberately no
 * Google map.
 */

// ── Core types ────────────────────────────────────────────────────────────────

export type Platform = "meta" | "tiktok" | "snapchat" | "google" | "reddit";
export type Lane = "consumer" | "business";
export type EntityLevel = "campaign" | "ad_set" | "ad";

export const PLATFORMS: readonly Platform[] = [
  "meta",
  "tiktok",
  "snapchat",
  "google",
  "reddit",
] as const;

/**
 * Advertiser-set status the engine may write. Deliberately ONLY these two —
 * the "Google REMOVED-never" rule is encoded at the interface level: Google
 * campaign REMOVED is irreversible, so no adapter's setStatus can express a
 * delete/remove. Rollback (the §4.4b compensating cleanup) goes through the
 * separate rollbackCampaign hook instead.
 */
export type AdvertiserStatus = "PAUSED" | "ACTIVE";

/** The ad_connections row shape the adapters consume (token NEVER present). */
export interface AdConnectionRow {
  id: string;
  platform: Platform;
  lane: Lane;
  display_name: string;
  external_account_id: string;
  external_org_id: string | null;
  auth_kind: "system_user_token" | "refresh_token" | "dev_token_oauth";
  token_env_var: string;
  extra: Record<string, unknown>;
  status: "connected" | "invalid" | "unknown";
  currency: string | null;
  timezone: string | null;
  min_daily_budget_cents: number | null;
  account_status: string | null;
  token_last_verified_at: string | null;
  connected: boolean;
}

// ── Errors (A3 §B / A4.a) ─────────────────────────────────────────────────────

/** → 424 <platform>_not_connected (google provisioning gap → 409 google_not_provisioned). */
export class AdNotConnectedError extends Error {
  readonly platform: Platform;
  readonly detail: string;
  constructor(platform: Platform, detail = `${platform}_not_connected`) {
    super(detail);
    this.name = "AdNotConnectedError";
    this.platform = platform;
    this.detail = detail;
  }
}

/** Normalized provider error { platform, code, message, traceId } — NEVER echoes a token. */
export class AdApiError extends Error {
  readonly platform: Platform;
  readonly code: string | number | null;
  readonly subcode: string | number | null;
  readonly traceId: string | null;
  constructor(input: {
    platform: Platform;
    code?: string | number | null;
    subcode?: string | number | null;
    message: string;
    traceId?: string | null;
  }) {
    super(input.message);
    this.name = "AdApiError";
    this.platform = input.platform;
    this.code = input.code ?? null;
    this.subcode = input.subcode ?? null;
    this.traceId = input.traceId ?? null;
  }
  toJSON(): Record<string, unknown> {
    return {
      platform: this.platform,
      code: this.code,
      subcode: this.subcode,
      message: this.message,
      trace_id: this.traceId,
    };
  }
}

// ── Money: cents at rest, one conversion point per adapter (A4.a / GR-01) ─────

export type PlatformBudgetUnit = "cents" | "dollars" | "micro";

export const PLATFORM_BUDGET_UNIT: Record<Platform, PlatformBudgetUnit> = {
  meta: "cents", // identity — Meta budgets are integer cents in the account currency
  tiktok: "dollars", // cents ÷ 100
  snapchat: "micro", // cents × 10,000
  google: "micro", // cents × 10,000
  reddit: "micro", // cents × 10,000
};

/**
 * QA P3-9 upper bound: the micro conversion (×10,000) must never leave
 * Number.MAX_SAFE_INTEGER — beyond it the converted budget silently loses
 * integer precision. Applied uniformly across platforms (conservative).
 * Math.floor(MAX_SAFE_INTEGER / 10_000) = 900,719,925,474¢ (~$9.0B) — the
 * tester's T-1 exactness boundary sits exactly AT this bound and must pass.
 */
export const MAX_BUDGET_CENTS = Math.floor(Number.MAX_SAFE_INTEGER / 10_000);

/**
 * THE single cents→platform-unit conversion (A4.a). Mandatory unit tests:
 * $5.00 (500¢) → 5,000,000 micro and $20.00 (2,000¢) → 20,000,000 micro.
 */
export function centsToPlatformBudget(platform: Platform, cents: number): number {
  if (!Number.isInteger(cents) || cents <= 0) {
    throw new Error(`centsToPlatformBudget: cents must be a positive integer; got ${cents}`);
  }
  if (cents > MAX_BUDGET_CENTS) {
    throw new Error(
      `centsToPlatformBudget: ${cents}¢ exceeds MAX_BUDGET_CENTS (${MAX_BUDGET_CENTS}) — micro conversion would lose integer precision (QA P3-9)`,
    );
  }
  switch (platform) {
    case "meta":
      return cents;
    case "tiktok":
      return cents / 100;
    case "snapchat":
    case "google":
    case "reddit":
      return cents * 10_000;
    default: {
      const never: never = platform;
      throw new Error(`centsToPlatformBudget: unknown platform ${String(never)}`);
    }
  }
}

// ── CTA maps — per-platform, never a shared normalizer (A4.a / GR-29) ─────────
// Source: PIPELINE_BLUEPRINT §1.6 CTA-map table (as corrected: GET_TICKETS is
// not a real Meta enum value — BUY_TICKETS is correct; VIEW_MORE is not a valid
// Snapchat CTA — MORE/BOOK_NOW/BUY_TICKETS are).

export type MinglaOffering =
  | "ticketed_event"
  | "bookable"
  | "restaurant"
  | "venue"
  | "upcoming_event"
  | "default";

export const META_CTA_MAP: Record<MinglaOffering, string> = {
  ticketed_event: "BUY_TICKETS",
  bookable: "BOOK_NOW",
  restaurant: "GET_DIRECTIONS",
  venue: "GET_DIRECTIONS",
  upcoming_event: "EVENT_RSVP",
  default: "LEARN_MORE",
};

// TikTok CTAs are bare display strings (no enum in the schema); auto-translated.
export const TIKTOK_CTA_MAP: Record<MinglaOffering, string> = {
  ticketed_event: "Get ticket now",
  bookable: "Book now",
  restaurant: "Learn more",
  venue: "Learn more",
  upcoming_event: "Get showtimes",
  default: "Learn more",
};

export const SNAPCHAT_CTA_MAP: Record<MinglaOffering, string> = {
  ticketed_event: "BUY_TICKETS",
  bookable: "BOOK_NOW",
  restaurant: "VIEW_MENU",
  venue: "BOOK_NOW",
  upcoming_event: "SHOWTIMES",
  default: "MORE",
};

/**
 * Reddit's CTA enum is Title-Case DISPLAY STRINGS ("Buy Tickets", not
 * BUY_TICKETS) — unlike every other channel. NEVER uppercase/snake-case these
 * (mandatory unit test: the Reddit CTA is never uppercased — A4.a).
 */
export const REDDIT_CTA_MAP: Record<MinglaOffering, string> = {
  ticketed_event: "Buy Tickets",
  bookable: "Book Now",
  restaurant: "See Menu",
  venue: "Get Directions",
  upcoming_event: "Remind Me",
  default: "Learn More",
};

/** Google RSA has no CTA field (blueprint §1.6) — google is deliberately absent. */
export const PLATFORM_CTA_MAPS: Partial<Record<Platform, Record<MinglaOffering, string>>> = {
  meta: META_CTA_MAP,
  tiktok: TIKTOK_CTA_MAP,
  snapchat: SNAPCHAT_CTA_MAP,
  reddit: REDDIT_CTA_MAP,
};

// ── Meta objective → optimization_goal matrix (A4.b M-2/M-3, blueprint §3.5) ──
// An invalid goal is SILENTLY auto-corrected server-side by Meta — validate
// client-side against this matrix, never rely on Meta's correction.

export const META_OBJECTIVE_GOAL_MATRIX: Record<string, readonly string[]> = {
  OUTCOME_AWARENESS: [
    "REACH",
    "IMPRESSIONS",
    "AD_RECALL_LIFT",
    "THRUPLAY",
    "TWO_SECOND_CONTINUOUS_VIDEO_VIEWS",
  ],
  OUTCOME_TRAFFIC: [
    "LINK_CLICKS",
    "LANDING_PAGE_VIEWS",
    "OFFSITE_CONVERSIONS",
    "IMPRESSIONS",
    "POST_ENGAGEMENT",
    "REACH",
    "CONVERSATIONS",
    "THRUPLAY",
    "VISIT_INSTAGRAM_PROFILE",
    "PROFILE_VISIT",
    "QUALITY_CALL",
    "REMINDERS_SET",
  ],
  OUTCOME_ENGAGEMENT: [
    "THRUPLAY",
    "POST_ENGAGEMENT",
    "EVENT_RESPONSES",
    "PAGE_LIKES",
    "IMPRESSIONS",
    "REACH",
    "TWO_SECOND_CONTINUOUS_VIDEO_VIEWS",
    "VIDEO_VIEWS",
    "LINK_CLICKS",
    "CONVERSATIONS",
    "OFFSITE_CONVERSIONS",
    "LANDING_PAGE_VIEWS",
    "QUALITY_CALL",
  ],
  OUTCOME_LEADS: [
    "OFFSITE_CONVERSIONS",
    "LEAD_GENERATION",
    "QUALITY_LEAD",
    "LANDING_PAGE_VIEWS",
    "LINK_CLICKS",
    "IMPRESSIONS",
    "REACH",
    "VALUE",
    "CONVERSATIONS",
    "QUALITY_CALL",
  ],
  OUTCOME_SALES: [
    "OFFSITE_CONVERSIONS",
    "VALUE",
    "LANDING_PAGE_VIEWS",
    "IMPRESSIONS",
    "POST_ENGAGEMENT",
    "REACH",
    "LINK_CLICKS",
    "CONVERSATIONS",
  ],
  OUTCOME_APP_PROMOTION: [
    "APP_INSTALLS",
    "OFFSITE_CONVERSIONS",
    "IMPRESSIONS",
    "LINK_CLICKS",
    "REACH",
    "VALUE",
    "VIDEO_VIEWS",
  ],
};

export function isMetaGoalValidForObjective(objective: string, goal: string): boolean {
  const goals = META_OBJECTIVE_GOAL_MATRIX[objective];
  if (!goals) return false;
  return goals.includes(goal);
}

/** The pixel-measured goals gated by 422 pixel_no_signal while the pixel is epoch-0 (A4.e.5). */
export const META_PIXEL_GATED_GOALS: readonly string[] = [
  "LANDING_PAGE_VIEWS",
  "OFFSITE_CONVERSIONS",
  "VALUE",
];

// ── Meta per-category budget floors (A4.g / M-9 / PROOF M-P8) ─────────────────
// The four categories returned by GET /act_{id}/minimum_budgets. NEVER hardcode
// the values — they are fetched at connect and stored in ad_connections.extra
// .minimum_budgets. This maps an optimization_goal to its floor CATEGORY
// (LINK_CLICKS is high-frequency ⇒ $5/day floor, not $1 — PROOF M-P8).

export type MetaBudgetCategory = "imp" | "video_views" | "high_freq" | "low_freq";

export function metaBudgetCategoryForGoal(goal: string): MetaBudgetCategory {
  switch (goal) {
    case "IMPRESSIONS":
    case "REACH":
    case "AD_RECALL_LIFT":
      return "imp";
    case "THRUPLAY":
    case "VIDEO_VIEWS":
    case "TWO_SECOND_CONTINUOUS_VIDEO_VIEWS":
      return "video_views";
    case "LINK_CLICKS":
    case "LANDING_PAGE_VIEWS":
    case "POST_ENGAGEMENT":
    case "PAGE_LIKES":
    case "EVENT_RESPONSES":
    case "PROFILE_VISIT":
    case "VISIT_INSTAGRAM_PROFILE":
    case "REMINDERS_SET":
      return "high_freq";
    default:
      // Conversion-class (low-frequency) events: OFFSITE_CONVERSIONS, VALUE,
      // LEAD_GENERATION, QUALITY_LEAD, APP_INSTALLS, CONVERSATIONS,
      // QUALITY_CALL, ... — the most conservative ($40) floor.
      return "low_freq";
  }
}

// ── ChannelAdapter — the A4.a interface (THE one coordinated change) ──────────

export interface CreateCampaignInput {
  name: string;
  objective: string;
  /** Minor units (cents). Present ⇒ CBO (budget on the campaign). */
  dailyBudgetCents?: number;
  /**
   * QA P1-1 (subcode 1815857, proven live): Meta REQUIRES an explicit bid
   * strategy or the ad-set create dies with "Bid amount required". Adapters
   * must send their default explicitly; §4.4b names LOWEST_COST_WITHOUT_CAP.
   */
  bidStrategy?: string;
  specialAdCategories?: string[];
  specialAdCategoryCountry?: string[];
  /** Meta execution_options:['validate_only'] passthrough — zero objects created. */
  validateOnly?: boolean;
}

export interface CreateAdSetInput {
  name: string;
  optimizationGoal: string;
  billingEvent: string;
  /** Minor units (cents). Only in ABO (campaign has no CBO budget). */
  budgetCents?: number;
  targeting: Record<string, unknown>;
  validateOnly?: boolean;
}

export interface CreateCreativeInput {
  /** Canonical public page — the AD-VISIBLE destination (A4.f). NEVER the OneLink. */
  destUrl: string;
  message: string;
  headline?: string;
  description?: string;
  imageUrl?: string;
  imageHash?: string;
  /** A4.g video_data branch — #866 produces the video_id. */
  videoId?: string;
  videoThumbnailImageHash?: string;
  callToActionType?: string;
  /** GR-61 — AI-generated creative disclosure (Higgsfield/Remotion pipeline ⇒ OPT_IN). */
  aiGenerated?: boolean;
  campaignName?: string;
  adName?: string;
  validateOnly?: boolean;
}

export interface CreateAdInput {
  name: string;
  externalCreativeId: string;
  /** A4.g — conversion_domain = the canonical destination domain (Meta AEM). */
  conversionDomain?: string;
  /**
   * WP6 (SPEC_ISSUE-REDDIT §3.5, additive-optional): Reddit ads carry
   * click_url = the canonical public page (NEVER the OneLink — D-P1) plus
   * ≤14 click_url_query_parameters including the {{AD_ID}} macro. Other
   * adapters ignore both fields.
   */
  clickUrl?: string;
  /** utm_campaign value for the Reddit click_url UTMs (ad_campaigns.id). */
  utmCampaign?: string;
  validateOnly?: boolean;
}

export interface ChannelAdapter {
  platform: Platform;

  /**
   * Resolves the token from Deno.env[conn.token_env_var]; for refresh_token /
   * dev_token_oauth, MINTS a short-lived access token in memory. Fail-CLOSE
   * (throw AdNotConnectedError) if the secret is missing/expired.
   */
  connect(conn: AdConnectionRow): Promise<AuthedClient>;

  createCampaign(
    conn: AdConnectionRow,
    input: CreateCampaignInput,
  ): Promise<{ externalId: string; status: string }>;

  createAdSet(
    conn: AdConnectionRow,
    campaignExternalId: string,
    input: CreateAdSetInput,
  ): Promise<{ externalId: string }>;

  /**
   * OPTIONAL creative step (A4.a — GR-17/GR-10):
   *   meta     → AdCreative (POST /act_{id}/adcreatives)         → externalCreativeId
   *   snapchat → Media → Creative (upload, poll READY, create)   → externalCreativeId
   *   google   → assets via assets:mutate (linked at ad-create)  → externalCreativeId
   *   reddit   → structured-post job (poll; CLIENT_ERROR ⇒ new job) → { postId, profileId }
   *   tiktok   → NO-OP (creative is inline in ad create)
   */
  createCreative?(
    conn: AdConnectionRow,
    input: CreateCreativeInput,
  ): Promise<{ externalCreativeId?: string; postId?: string; profileId?: string }>;

  createAd(
    conn: AdConnectionRow,
    adSetExternalId: string,
    input: CreateAdInput,
  ): Promise<{ externalId: string; reviewStatus: string | null }>;

  /** status is pause|activate ONLY (top-down launch); REMOVED/DELETED is not expressible. */
  setStatus(
    conn: AdConnectionRow,
    level: EntityLevel,
    externalId: string,
    status: AdvertiserStatus,
  ): Promise<void>;

  getStatus(
    conn: AdConnectionRow,
    level: EntityLevel,
    externalId: string,
  ): Promise<{
    status: string | null;
    effectiveStatus: string | null;
    issuesInfo?: unknown[] | null;
    adReviewFeedback?: Record<string, unknown> | null;
  }>;

  /**
   * NEW — folds in #884's coordinated change (BLUEPRINT §4.12); the Brain's
   * reallocation loop needs a budget mutator. `cents` is the at-rest unit;
   * the adapter converts via centsToPlatformBudget at its boundary.
   */
  setBudget(
    conn: AdConnectionRow,
    level: EntityLevel,
    externalId: string,
    cents: number,
  ): Promise<void>;

  /**
   * §4.4b compensating-cleanup hook (optional — Google's atomic mutate never
   * needs it). meta → DELETE /{campaign_id} (cascades the ad set); reddit →
   * PATCH configured_status:"DELETED" (no DELETE verb exists — R-5).
   */
  rollbackCampaign?(conn: AdConnectionRow, campaignExternalId: string): Promise<void>;

  /**
   * QA P2-5 (proven live): a platform creative can be an ACCOUNT-level object
   * that campaign deletion does NOT cascade (Meta AdCreative). When a create
   * fails AFTER the creative step, this hook removes the residue. Optional —
   * platforms whose creative is campaign-scoped or inline (TikTok) omit it;
   * when absent/failing, the residue id is surfaced for the audit row.
   */
  rollbackCreative?(conn: AdConnectionRow, creativeExternalId: string): Promise<void>;
}

/** Opaque per-platform authed client (Meta: token + resolved env config). */
export interface AuthedClient {
  platform: Platform;
  [key: string]: unknown;
}

// ── Registry (A3 §B getAdapter) ───────────────────────────────────────────────

import { metaAdapter } from "./meta.ts";
import { googleAdapter } from "./google.ts";
import { redditAdapter } from "./reddit.ts";
import { snapchatAdapter } from "./snapchat.ts";
import { tiktokAdapter } from "./tiktok.ts";

const ADAPTER_REGISTRY: Record<Platform, ChannelAdapter> = {
  meta: metaAdapter,
  tiktok: tiktokAdapter, // WP7 (#863) — live adapter (fail-close until TIKTOK_* secrets are set)
  snapchat: snapchatAdapter, // WP5 (#867) — live adapter (fail-close until SNAPCHAT_* secrets are set)
  google: googleAdapter, // WP2 (#867) — live adapter (A1.3-0 provisioning flip)
  reddit: redditAdapter, // WP6 (#916) — live adapter (SPEC_ISSUE-REDDIT §3)
};

export function getAdapter(platform: Platform): ChannelAdapter {
  const adapter = ADAPTER_REGISTRY[platform];
  if (!adapter) throw new AdNotConnectedError(platform);
  return adapter;
}

export function isPlatform(value: unknown): value is Platform {
  return typeof value === "string" && (PLATFORMS as readonly string[]).includes(value);
}

export function isLane(value: unknown): value is Lane {
  return value === "consumer" || value === "business";
}

// ── GR-52 destination re-checker (ISSUE-867 A1.3 — channel-generic) ───────────
// Google polices "unavailable offers" / "destination not working" for the ad's
// WHOLE life, and every Mingla ad promotes a dated, finite event. The sync fn
// re-asserts the destination is public + live on every sweep and auto-pauses
// (+ audits) on failure — protecting the ACCOUNT, not just the campaign. The
// same check runs for every channel (Meta benefits too).

interface DestinationMaybeSingleResult {
  data: unknown;
}

interface DestinationEventChain {
  // PromiseLike, not Promise — supabase-js query builders are thenables.
  maybeSingle(): PromiseLike<DestinationMaybeSingleResult>;
}

interface DestinationEqChain {
  eq(column: string, value: string): DestinationEqChain;
  in(column: string, values: string[]): DestinationEventChain;
  maybeSingle(): PromiseLike<DestinationMaybeSingleResult>;
}

interface DestinationSelectChain {
  eq(column: string, value: string): DestinationEqChain;
}

/** Minimal structural view of the supabase client the checker needs. */
export interface DestinationQueryClient {
  from(table: string): { select(columns: string): DestinationSelectChain };
}

export interface DestinationRef {
  dest_page_type: string;
  dest_brand_slug: string;
  dest_entity_slug: string | null;
}

/**
 * Mirrors the create-time destination gate (§4.4b): an event destination must
 * still resolve in business_public_events_view with status scheduled|live
 * (the view also exposes ended/cancelled — paid traffic must never point at
 * one); a brand destination must still resolve in business_public_brands_view.
 * Unknown/uncreatable page types are NOT public (fail-close).
 */
export async function destinationStillPublicLive(
  db: DestinationQueryClient,
  dest: DestinationRef,
): Promise<boolean> {
  if (dest.dest_page_type === "event") {
    if (!dest.dest_entity_slug) return false;
    const { data } = await db
      .from("business_public_events_view")
      .select("id")
      .eq("brand_slug", dest.dest_brand_slug)
      .eq("slug", dest.dest_entity_slug)
      .in("status", ["scheduled", "live"])
      .maybeSingle();
    return Boolean(data);
  }
  if (dest.dest_page_type === "brand") {
    const { data } = await db
      .from("business_public_brands_view")
      .select("id")
      .eq("slug", dest.dest_brand_slug)
      .maybeSingle();
    return Boolean(data);
  }
  // trip/venue have no public read model yet (create fails-close on them too).
  return false;
}

// ── Atomic create with compensating rollback (§4.4b — no orphans) ─────────────

export interface AtomicCreateInput {
  campaign: CreateCampaignInput;
  adSet: CreateAdSetInput;
  creative: CreateCreativeInput;
  ad: Omit<CreateAdInput, "externalCreativeId">;
}

export interface AtomicCreateResult {
  externalCampaignId: string;
  externalAdSetId: string;
  externalCreativeId: string | null;
  postId: string | null;
  externalAdId: string;
  reviewStatus: string | null;
}

export interface AtomicCreateFailure {
  step: "campaign" | "ad_set" | "creative" | "ad";
  partialExternalIds: Record<string, string>;
  rollbackSucceeded: boolean | null; // null = no rollback needed (nothing created)
  /**
   * QA P2-5: account-level creative cleanup outcome. null = no creative was
   * created (nothing to clean); true = deleted; false = RESIDUE REMAINS — the
   * id (partialExternalIds.external_creative_id) must land in the audit row
   * for manual reconciliation.
   */
  creativeRollbackSucceeded: boolean | null;
  cause: unknown;
}

export class AtomicCreateError extends Error {
  readonly failure: AtomicCreateFailure;
  constructor(failure: AtomicCreateFailure) {
    const causeMessage =
      failure.cause instanceof Error ? failure.cause.message : String(failure.cause);
    super(`atomic create failed at step "${failure.step}": ${causeMessage}`);
    this.name = "AtomicCreateError";
    this.failure = failure;
  }
}

/**
 * The fixed create order (campaign → ad set → creative → ad), all PAUSED, with
 * the §4.4b no-orphan contract: if any step fails, the already-created campaign
 * is rolled back via adapter.rollbackCampaign (platform cascade deletes the
 * children) and AtomicCreateError carries the partial IDs for the audit trail.
 * NO DB row is written by this function — the caller persists ONLY on success.
 */
export async function createFullCampaignAtomic(
  adapter: ChannelAdapter,
  conn: AdConnectionRow,
  input: AtomicCreateInput,
): Promise<AtomicCreateResult> {
  const partial: Record<string, string> = {};

  const fail = async (
    step: AtomicCreateFailure["step"],
    cause: unknown,
  ): Promise<never> => {
    // QA P2-5 (proven live): the creative is an ACCOUNT-level object — campaign
    // deletion does NOT cascade it. Clean it FIRST (the failed chain's ad never
    // existed, so the creative is unreferenced and deletable), then the campaign.
    let creativeRollbackSucceeded: boolean | null = null;
    const creativeId = partial.external_creative_id;
    if (creativeId) {
      if (adapter.rollbackCreative) {
        try {
          await adapter.rollbackCreative(conn, creativeId);
          creativeRollbackSucceeded = true;
        } catch {
          creativeRollbackSucceeded = false; // residue — audit row carries the id
        }
      } else {
        creativeRollbackSucceeded = false; // no hook — residue, reconcile from audit
      }
    }

    let rollbackSucceeded: boolean | null = null;
    const campaignId = partial.external_campaign_id;
    if (campaignId && adapter.rollbackCampaign) {
      try {
        await adapter.rollbackCampaign(conn, campaignId);
        rollbackSucceeded = true;
      } catch {
        // Rollback itself failed — the caller records the partial IDs in
        // ad_status_events (action='create_failed') for manual reconciliation.
        rollbackSucceeded = false;
      }
    } else if (campaignId) {
      rollbackSucceeded = false; // campaign exists but no rollback hook — reconcile manually
    }
    throw new AtomicCreateError({
      step,
      partialExternalIds: { ...partial },
      rollbackSucceeded,
      creativeRollbackSucceeded,
      cause,
    });
  };

  // 1. Campaign
  let campaignExternalId: string;
  try {
    const created = await adapter.createCampaign(conn, input.campaign);
    campaignExternalId = created.externalId;
    partial.external_campaign_id = campaignExternalId;
  } catch (cause) {
    return await fail("campaign", cause);
  }

  // 2. Ad set
  let adSetExternalId: string;
  try {
    const created = await adapter.createAdSet(conn, campaignExternalId, input.adSet);
    adSetExternalId = created.externalId;
    partial.external_adset_id = adSetExternalId;
  } catch (cause) {
    return await fail("ad_set", cause);
  }

  // 3. Creative (optional per-adapter — TikTok inlines it in ad create)
  let externalCreativeId: string | null = null;
  let postId: string | null = null;
  if (adapter.createCreative) {
    try {
      const created = await adapter.createCreative(conn, input.creative);
      externalCreativeId = created.externalCreativeId ?? null;
      postId = created.postId ?? null;
      if (externalCreativeId) partial.external_creative_id = externalCreativeId;
      if (postId) partial.post_id = postId;
    } catch (cause) {
      return await fail("creative", cause);
    }
  }

  // 4. Ad
  try {
    const created = await adapter.createAd(conn, adSetExternalId, {
      ...input.ad,
      externalCreativeId: externalCreativeId ?? postId ?? "",
    });
    partial.external_ad_id = created.externalId;
    return {
      externalCampaignId: campaignExternalId,
      externalAdSetId: adSetExternalId,
      externalCreativeId,
      postId,
      externalAdId: created.externalId,
      reviewStatus: created.reviewStatus,
    };
  } catch (cause) {
    return await fail("ad", cause);
  }
}
