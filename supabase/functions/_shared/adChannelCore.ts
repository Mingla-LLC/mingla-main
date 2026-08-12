/**
 * adChannelCore.ts — the Full Rooms Ad Engine channel layer (ISSUE-862 WP1).
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
  /** GR-61 — true when the delivered creative contains materially generated pixels. */
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
