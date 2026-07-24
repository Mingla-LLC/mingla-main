/**
 * meta.ts — the Meta (Facebook/Instagram) ChannelAdapter (ISSUE-862 WP1).
 *
 * SPEC: SPEC_ISSUE-862_META_ADS_CAMPAIGN_ENGINE.md §4.3 as generalized by A3 §B
 * and corrected by A4 (M-1…M-13), grounded in PROOF_LOG.md (live probes with
 * the engine's own credentials, 2026-07-15):
 *   - Graph v25.0 (M-1); campaign create REQUIRES is_adset_budget_sharing_enabled
 *     when not using CBO (M-13, PROOF M-P5).
 *   - Creative link = the canonical dest_url, NEVER the OneLink (A4.f, PROOF D-P1).
 *   - special_ad_categories: CREDIT retired → FINANCIAL_PRODUCTS_SERVICES (M-4).
 *   - Budget floors are per-optimization-category via GET /act_{id}/minimum_budgets,
 *     fetched at connect, stored in ad_connections.extra — never hardcoded (A4.g, M-P8).
 *   - Preflight: Page check = GET /me/accounts + ADVERTISE task (A4.e.1, M-P4/M-P6);
 *     app-Live precondition via validate-only adcreatives probe, error 1885183 →
 *     424 meta_app_not_live (A4.e.2, M-P6).
 *   - Everything is created PAUSED explicitly at every level (GR-11).
 *
 * SECURITY (§6 SC-SEC-1): the System User token lives ONLY in Supabase Edge
 * Function Secrets, resolved via connection.token_env_var (A2). It is sent as
 * an Authorization: Bearer header (never a URL param), never logged, never
 * echoed in any normalized error or response.
 */

import {
  AdApiError,
  AdNotConnectedError,
  type AdConnectionRow,
  type AdvertiserStatus,
  type AuthedClient,
  type ChannelAdapter,
  centsToPlatformBudget,
  type CreateAdInput,
  type CreateAdSetInput,
  type CreateCampaignInput,
  type CreateCreativeInput,
  type EntityLevel,
  type MetaBudgetCategory,
} from "./adChannel.ts";

// ── Env config (NAMES only — values live in Supabase Edge Function Secrets) ───

export const META_DEFAULT_API_VERSION = "v25.0"; // A4.b M-1 — NOT v21.0
export const META_DEFAULT_GRAPH_BASE = "https://graph.facebook.com";

export type MetaLane = "consumer" | "business";

/**
 * QA P2-3: env-var NAMES are LANE-CORRECT — a business-lane resolution must
 * never fall back to the consumer credential/IDs (A2 pins the business token
 * names; the ID names follow the same META_MINGLABIZ_ prefix convention,
 * flagged in the WP1 rework report pending a spec amendment blessing).
 */
function laneEnvName(base: string, lane: MetaLane): string {
  return lane === "business" ? base.replace(/^META_/, "META_MINGLABIZ_") : base;
}

export function metaDefaultTokenEnvVar(lane: MetaLane): string {
  return laneEnvName("META_SYSTEM_USER_TOKEN", lane);
}

export interface MetaEnvConfig {
  apiVersion: string;
  graphBase: string;
  adAccountId: string;
  businessId: string | null;
  pageId: string;
  /**
   * ISSUE-939: the Page-linked Instagram identity used to turn ON Instagram
   * delivery in the ad creative. OPTIONAL — null when the lane's IG env var is
   * unset/empty, in which case the creative omits instagram_user_id entirely
   * and delivers Facebook-only (exactly as before).
   */
  igUserId: string | null;
  datasetId: string | null;
}

/**
 * Reads the non-secret Meta IDs from env, lane-correct (QA P2-3): consumer →
 * META_AD_ACCOUNT_ID / META_PAGE_ID / META_BUSINESS_ID / META_IG_USER_ID /
 * META_DATASET_ID; business → the META_MINGLABIZ_-prefixed names. IDs live in
 * env/config, never as literals in this public repo. Fail-CLOSE when the lane's
 * required IDs are unset — a business connect must NOT silently verify consumer
 * IDs. The IG user id (ISSUE-939) is OPTIONAL: unset/empty → null (Facebook-only).
 */
export function resolveMetaEnvConfig(lane: MetaLane = "consumer"): MetaEnvConfig {
  const adAccountId = (Deno.env.get(laneEnvName("META_AD_ACCOUNT_ID", lane)) ?? "").trim();
  const pageId = (Deno.env.get(laneEnvName("META_PAGE_ID", lane)) ?? "").trim();
  if (!adAccountId) throw new AdNotConnectedError("meta", "meta_not_connected");
  if (!pageId) throw new AdNotConnectedError("meta", "meta_not_connected");
  return {
    apiVersion: (Deno.env.get("META_API_VERSION") ?? META_DEFAULT_API_VERSION).trim(),
    graphBase: (Deno.env.get("META_GRAPH_BASE") ?? META_DEFAULT_GRAPH_BASE).trim(),
    adAccountId,
    businessId: (Deno.env.get(laneEnvName("META_BUSINESS_ID", lane)) ?? "").trim() || null,
    pageId,
    // ISSUE-939: lane-correct IG identity (consumer META_IG_USER_ID / business
    // META_MINGLABIZ_IG_USER_ID). OPTIONAL — unset/empty resolves to null so the
    // creative omits instagram_user_id and stays Facebook-only. The business
    // lane has no IG configured yet, so it naturally resolves to null.
    igUserId: (Deno.env.get(laneEnvName("META_IG_USER_ID", lane)) ?? "").trim() || null,
    datasetId: (Deno.env.get(laneEnvName("META_DATASET_ID", lane)) ?? "").trim() || null,
  };
}

/**
 * Resolves the System User token from Deno.env[connection.token_env_var] (A2 —
 * per-lane env names, e.g. META_SYSTEM_USER_TOKEN consumer /
 * META_MINGLABIZ_SYSTEM_USER_TOKEN business). With no persisted row, the
 * default env-var NAME is the LANE's (QA P2-3) — a first business connect
 * must verify the credential the row will claim, not the consumer's.
 *
 * FAIL-CLOSE (RT-1): a missing token throws AdNotConnectedError BEFORE any
 * Graph call — connect/create/launch must return 424 meta_not_connected and
 * never proceed to spend on a broken connection. Do NOT soften this throw.
 */
export function resolveMetaToken(
  conn?: Pick<AdConnectionRow, "token_env_var"> | null,
  lane: MetaLane = "consumer",
): string {
  const envVarName = (conn?.token_env_var ?? metaDefaultTokenEnvVar(lane)).trim() ||
    metaDefaultTokenEnvVar(lane);
  const value = Deno.env.get(envVarName);
  if (!value || value.trim().length === 0) {
    throw new AdNotConnectedError("meta", "meta_not_connected");
  }
  return value.trim();
}

export interface MetaClient extends AuthedClient {
  platform: "meta";
  token: string;
  config: MetaEnvConfig;
}

export function resolveMetaClient(
  conn?: AdConnectionRow | null,
  lane?: MetaLane,
): MetaClient {
  const effectiveLane: MetaLane = conn?.lane ?? lane ?? "consumer";
  const token = resolveMetaToken(conn ?? null, effectiveLane);
  const config = resolveMetaEnvConfig(effectiveLane);
  return { platform: "meta", token, config };
}

// ── Graph fetch wrapper + error normalization (§4.3) ──────────────────────────

export interface NormalizedMetaError {
  code: string | number | null;
  subcode: string | number | null;
  message: string;
  fbtrace_id: string | null;
}

/**
 * QA P3-8 defense-in-depth: scrub anything shaped like a Meta user/system
 * token (EAA…) out of provider text before it can reach the admin client.
 */
export function scrubMetaTokens(text: string): string {
  return text.replace(/EAA[A-Za-z0-9]{16,}/g, "[redacted]");
}

/** Client-safe error shape. The raw token is NEVER present in Graph error bodies we surface. */
export function normalizeMetaError(payload: unknown): NormalizedMetaError {
  const err = (payload as { error?: Record<string, unknown> } | null)?.error ?? {};
  const message = typeof err.error_user_msg === "string" && err.error_user_msg
    ? String(err.error_user_msg)
    : typeof err.message === "string"
    ? String(err.message)
    : "Meta API error";
  return {
    code: (err.code as string | number | undefined) ?? null,
    subcode: (err.error_subcode as string | number | undefined) ?? null,
    message: scrubMetaTokens(message),
    fbtrace_id: (err.fbtrace_id as string | undefined) ?? null,
  };
}

/** Meta error code for "app in development mode" → 424 meta_app_not_live (A4.e.2, PROOF M-P6). */
export const META_ERROR_APP_NOT_LIVE = 1885183;

export async function metaGraph(
  client: MetaClient,
  method: "GET" | "POST" | "DELETE",
  path: string,
  params?: Record<string, unknown>,
  opts: { timeoutMs?: number } = {},
): Promise<Record<string, unknown>> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const base = `${client.config.graphBase}/${client.config.apiVersion}`;
  let url = `${base}/${path.replace(/^\//, "")}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const init: RequestInit = {
    method,
    signal: controller.signal,
    headers: {
      // Bearer header — never a URL param, so the token can't leak via URLs/logs.
      Authorization: `Bearer ${client.token}`,
      "Content-Type": "application/json",
    },
  };
  if (params && Object.keys(params).length > 0) {
    if (method === "GET" || method === "DELETE") {
      const qs = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null) continue;
        qs.set(key, typeof value === "string" ? value : JSON.stringify(value));
      }
      url += `?${qs.toString()}`;
    } else {
      init.body = JSON.stringify(params);
    }
  }

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (err) {
    clearTimeout(timer);
    const detail = err instanceof Error ? err.message : String(err);
    throw new AdApiError({
      platform: "meta",
      code: "network_error",
      message: `Meta Graph request failed: ${detail}`,
    });
  }
  clearTimeout(timer);

  let payload: Record<string, unknown> = {};
  try {
    payload = await response.json() as Record<string, unknown>;
  } catch {
    payload = {};
  }

  if (!response.ok) {
    const normalized = normalizeMetaError(payload);
    throw new AdApiError({
      platform: "meta",
      code: normalized.code,
      subcode: normalized.subcode,
      message: normalized.message,
      traceId: normalized.fbtrace_id,
    });
  }
  return payload;
}

// ── Targeting Search (ISSUE-989) — READ-ONLY /search resolvers ────────────────
// The exact upstream calls admin-ad-preflight P6 already runs green (M-P9).
// PROVEN live 2026-07-20 (master token, read-only): adgeolocation q=london
// country_code=GB promotes London/England/GB to #1 (unscoped puts London,NJ and
// London,Ontario first); adinterest q=nightlife → 6003375995381; adradiussuggestion
// (lat/lng) → {suggested_radius,distance_unit}. These are SEARCHES — they create
// nothing. distance_unit + a default radius come from the admin control; the
// adgeolocation city record carries no lat/lng, so radius is admin-chosen.

/** Normalized Meta city geo result. `key` is the geo_locations.cities key. */
export interface MetaGeoResult {
  key: string;
  name: string;
  type: string;
  region: string | null;
  country_code: string | null;
  supports_region: boolean;
}

/** Normalized Meta interest result → feeds flexible_spec:[{interests:[{id}]}]. */
export interface MetaInterestResult {
  id: string;
  name: string;
  audience_size_lower_bound: number | null;
  audience_size_upper_bound: number | null;
}

/**
 * Thin read-only wrapper over Graph GET /search (the same call preflight P6
 * makes). NEVER creates an object. Callers pass a country_code for city search
 * so 'London' disambiguates to the campaign's country (the London/Canada hazard).
 */
export async function metaSearch(
  client: MetaClient,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return metaGraph(client, "GET", "search", params);
}

/** Tolerant parser over an adgeolocation payload → MetaGeoResult[]. */
export function parseMetaGeoResults(payload: unknown): MetaGeoResult[] {
  const data = ((payload as { data?: unknown })?.data ?? []) as Record<string, unknown>[];
  if (!Array.isArray(data)) return [];
  const out: MetaGeoResult[] = [];
  for (const entry of data) {
    if (entry === null || typeof entry !== "object") continue;
    const key = typeof entry.key === "string"
      ? entry.key
      : typeof entry.key === "number"
      ? String(entry.key)
      : "";
    const name = typeof entry.name === "string" ? entry.name : "";
    if (!key || !name) continue;
    out.push({
      key,
      name,
      type: typeof entry.type === "string" ? entry.type : "city",
      region: typeof entry.region === "string" ? entry.region : null,
      country_code: typeof entry.country_code === "string" ? entry.country_code : null,
      supports_region: entry.supports_region === true,
    });
  }
  return out;
}

/** Tolerant parser over an adinterest payload → MetaInterestResult[]. */
export function parseMetaInterestResults(payload: unknown): MetaInterestResult[] {
  const data = ((payload as { data?: unknown })?.data ?? []) as Record<string, unknown>[];
  if (!Array.isArray(data)) return [];
  const out: MetaInterestResult[] = [];
  for (const entry of data) {
    if (entry === null || typeof entry !== "object") continue;
    const id = typeof entry.id === "string"
      ? entry.id
      : typeof entry.id === "number"
      ? String(entry.id)
      : "";
    const name = typeof entry.name === "string" ? entry.name : "";
    if (!id || !name) continue;
    const lower = entry.audience_size_lower_bound;
    const upper = entry.audience_size_upper_bound;
    out.push({
      id,
      name,
      audience_size_lower_bound: typeof lower === "number" ? lower : null,
      audience_size_upper_bound: typeof upper === "number" ? upper : null,
    });
  }
  return out;
}

/**
 * ISSUE-989 — normalize the builder's city selections into the exact Meta
 * geo_locations.cities shape [{key, radius, distance_unit}]. Meta radius is
 * 1-50 mi / 1-80 km; anything out of range or missing falls back to the
 * default. Non-numeric/absent keys are dropped (never fabricated).
 */
export const META_DEFAULT_CITY_RADIUS_MILE = 10;
export function normalizeMetaCities(cities: unknown): { key: string; radius: number; distance_unit: string }[] {
  if (!Array.isArray(cities)) return [];
  const out: { key: string; radius: number; distance_unit: string }[] = [];
  for (const raw of cities) {
    if (raw === null || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    const key = typeof c.key === "string" && c.key.trim()
      ? c.key.trim()
      : typeof c.key === "number"
      ? String(c.key)
      : "";
    if (!key) continue;
    const unit = c.distance_unit === "kilometer" ? "kilometer" : "mile";
    const max = unit === "mile" ? 50 : 80;
    const r = typeof c.radius === "number" && Number.isFinite(c.radius) ? c.radius : META_DEFAULT_CITY_RADIUS_MILE;
    const radius = Math.min(max, Math.max(1, Math.round(r)));
    out.push({ key, radius, distance_unit: unit });
  }
  return out;
}

/**
 * ISSUE-989 (tester P1 fix) — assemble geo_locations so city targeting is not
 * INERT. Meta UNIONS geo_locations.countries ∪ cities: sending both makes the
 * radius meaningless (PROVEN live — countries:[US] ∪ London/GB 10mi ≈ 263.4M vs
 * pure cities:[London] ≈ 7.3M). So when ≥1 city is chosen, target the CITIES
 * ONLY and DROP countries (mirrors TikTok, where city location_ids replace the
 * country resolution). Country is the fallback ONLY when no city is chosen.
 */
export function buildMetaGeoLocations(
  countries: unknown,
  cities: readonly { key: string; radius: number; distance_unit: string }[],
): Record<string, unknown> {
  if (Array.isArray(cities) && cities.length > 0) {
    return { cities: [...cities] };
  }
  return { countries };
}

/**
 * ISSUE-989 — build the flexible_spec interest clause from resolved Meta
 * interest ids. Returns null when there are none (so the caller omits the key).
 */
export function buildMetaInterestFlexibleSpec(
  interestIds: unknown,
): { interests: { id: string }[] }[] | null {
  if (!Array.isArray(interestIds)) return null;
  const interests = interestIds
    .map((id) => (typeof id === "string" ? id.trim() : typeof id === "number" ? String(id) : ""))
    .filter((id) => id.length > 0)
    .map((id) => ({ id }));
  return interests.length > 0 ? [{ interests }] : null;
}

// ── special_ad_categories validation (A4.g / M-4 / GR-56) ─────────────────────

export const META_SPECIAL_AD_CATEGORIES: readonly string[] = [
  "HOUSING",
  "EMPLOYMENT",
  "FINANCIAL_PRODUCTS_SERVICES",
  "ISSUES_ELECTIONS_POLITICS",
  "NONE",
];

export type SpecialAdCategoriesValidation =
  | { ok: true; categories: string[] }
  | { ok: false; detail: string; message: string };

export function validateSpecialAdCategories(input: unknown): SpecialAdCategoriesValidation {
  if (input === undefined || input === null) return { ok: true, categories: [] };
  if (!Array.isArray(input) || input.some((c) => typeof c !== "string")) {
    return {
      ok: false,
      detail: "special_ad_categories_invalid",
      message: "special_ad_categories must be an array of strings.",
    };
  }
  const categories = input as string[];
  if (categories.includes("CREDIT")) {
    return {
      ok: false,
      detail: "special_ad_category_credit_retired",
      message:
        "CREDIT was retired by Meta on 2025-01-14 — use FINANCIAL_PRODUCTS_SERVICES instead.",
    };
  }
  const unknown = categories.filter((c) => !META_SPECIAL_AD_CATEGORIES.includes(c));
  if (unknown.length > 0) {
    return {
      ok: false,
      detail: "special_ad_categories_unknown",
      message: `Unknown special_ad_categories: ${unknown.join(", ")}. ` +
        `Valid: ${META_SPECIAL_AD_CATEGORIES.join(" | ")} (there is no ONLINE_GAMBLING_AND_GAMING).`,
    };
  }
  return { ok: true, categories: categories.filter((c) => c !== "NONE") };
}

/**
 * A4.g restriction cascade, enforced BEFORE the Meta call when special ad
 * categories are non-empty: force age 18–65, strip genders, forbid zips /
 * excluded_geo_locations, strip behavior/demographic flexible_spec.
 */
export function applySpecialAdCategoryRestrictions(
  targeting: Record<string, unknown>,
): Record<string, unknown> {
  const restricted: Record<string, unknown> = { ...targeting };
  restricted.age_min = 18;
  restricted.age_max = 65;
  delete restricted.genders;
  delete restricted.zips;
  delete restricted.excluded_geo_locations;
  delete restricted.flexible_spec;
  const geo = restricted.geo_locations as Record<string, unknown> | undefined;
  if (geo) {
    const cleanGeo = { ...geo };
    delete cleanGeo.zips;
    restricted.geo_locations = cleanGeo;
  }
  return restricted;
}

// ── Pure request-body builders (unit-testable; the exact wire shapes) ─────────

/** A4.g url_tags UTM template — without it PostHog/GA are blind to paid traffic. */
export const META_URL_TAGS =
  "utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&placement={{placement}}";

/** §4.4b default bid strategy — the only value WP1 accepts (cap strategies need bid_amount). */
export const META_DEFAULT_BID_STRATEGY = "LOWEST_COST_WITHOUT_CAP";

export function buildMetaCampaignBody(input: CreateCampaignInput): Record<string, unknown> {
  const isCbo = typeof input.dailyBudgetCents === "number" && input.dailyBudgetCents > 0;
  const body: Record<string, unknown> = {
    name: input.name,
    objective: input.objective,
    buying_type: "AUCTION",
    special_ad_categories: input.specialAdCategories ?? [],
    // QA P1-1 (subcode 1815857, proven live BOTH directions): without an
    // explicit campaign bid_strategy every real ad-set create fails with
    // "Bid amount required"; with LOWEST_COST_WITHOUT_CAP the exact builder
    // shape validates clean. Sent explicitly on BOTH the CBO and non-CBO
    // branches — never rely on a Meta default (§4.0/§4.4b).
    bid_strategy: input.bidStrategy ?? META_DEFAULT_BID_STRATEGY,
    // GR-11: PAUSED explicitly at every level on every channel — never a default.
    status: "PAUSED",
  };
  if (isCbo) {
    // CBO — budget lives on the campaign, integer cents (Meta identity unit).
    body.daily_budget = centsToPlatformBudget("meta", input.dailyBudgetCents as number);
  } else {
    // M-13 (PROOF M-P5): v25 campaign create REQUIRES is_adset_budget_sharing_enabled
    // when not using CBO — send explicit false unless CBO.
    body.is_adset_budget_sharing_enabled = false;
  }
  if ((input.specialAdCategories ?? []).some((c) => c !== "NONE")) {
    body.special_ad_category_country = input.specialAdCategoryCountry ?? [];
  }
  if (input.validateOnly) body.execution_options = ["validate_only"];
  return body;
}

export function buildMetaAdSetBody(
  campaignExternalId: string,
  input: CreateAdSetInput,
): Record<string, unknown> {
  const targeting: Record<string, unknown> = { ...input.targeting };
  if (targeting.targeting_automation === undefined) {
    // §4.0: Advantage+ Audience is ON by default and turns age bounds into
    // suggestions — pin it OFF so the operator's targeting is literal.
    targeting.targeting_automation = { advantage_audience: 0 };
  }
  const body: Record<string, unknown> = {
    campaign_id: campaignExternalId,
    name: input.name,
    billing_event: input.billingEvent,
    optimization_goal: input.optimizationGoal,
    targeting,
    status: "PAUSED", // GR-11
  };
  if (typeof input.budgetCents === "number" && input.budgetCents > 0) {
    // ABO only — with CBO the budget lives on the campaign and this is rejected.
    body.daily_budget = centsToPlatformBudget("meta", input.budgetCents);
  }
  if (input.validateOnly) body.execution_options = ["validate_only"];
  return body;
}

export function buildMetaCreativeBody(
  pageId: string,
  input: CreateCreativeInput,
  igUserId?: string | null,
): Record<string, unknown> {
  const callToAction = {
    type: input.callToActionType ?? "LEARN_MORE",
    value: {
      // A4.f destination policy v1 (PROOF D-P1): the ad-visible destination is
      // the canonical public page — NEVER the OneLink smart link.
      link: input.destUrl,
    },
  };

  // ISSUE-939: the Page-linked Instagram identity that switches ON Instagram
  // delivery. When configured (consumer META_IG_USER_ID / business
  // META_MINGLABIZ_IG_USER_ID, threaded via client.config.igUserId) the creative
  // sets instagram_user_id in BOTH object_story_spec AND at the adcreatives top
  // level — matching the validate-only proof that returned {"success":true}.
  // Unset/empty ⇒ OMITTED from both placements (Facebook-only, exactly as
  // before). Never emit an empty/undefined instagram_user_id.
  const igIdentity = typeof igUserId === "string" ? igUserId.trim() : "";

  const objectStorySpec: Record<string, unknown> = { page_id: pageId };
  if (igIdentity) objectStorySpec.instagram_user_id = igIdentity;
  if (input.videoId) {
    // A4.g video_data branch (GR-57/M-10) — #866 produces video_id via
    // POST /act_{id}/advideos + poll video_status === 'ready'.
    objectStorySpec.video_data = {
      video_id: input.videoId,
      ...(input.videoThumbnailImageHash ? { image_hash: input.videoThumbnailImageHash } : {}),
      title: input.headline ?? "",
      message: input.message,
      link_description: input.description ?? "",
      call_to_action: callToAction,
    };
  } else {
    const linkData: Record<string, unknown> = {
      link: input.destUrl,
      message: input.message,
      call_to_action: callToAction,
    };
    if (input.headline) linkData.name = input.headline;
    if (input.description) linkData.description = input.description;
    if (input.imageHash) linkData.image_hash = input.imageHash;
    else if (input.imageUrl) linkData.picture = input.imageUrl;
    objectStorySpec.link_data = linkData;
  }

  const body: Record<string, unknown> = {
    name: input.adName ? `${input.adName} — creative` : `${input.campaignName ?? "ad"} — creative`,
    object_story_spec: objectStorySpec,
    // A4.g url_tags UTM template.
    url_tags: META_URL_TAGS,
  };
  // ISSUE-939: mirror the IG identity at the adcreatives top level (per the
  // validate-only proof). Only present when configured — see igIdentity above.
  if (igIdentity) body.instagram_user_id = igIdentity;
  if (input.aiGenerated) {
    // GR-61 self_ai_disclosure — explicit true means the final creative
    // contains materially generated pixels (for example authorized Magnific).
    body.self_ai_disclosure = "OPT_IN";
  }
  if (input.validateOnly) body.execution_options = ["validate_only"];
  return body;
}

export function buildMetaAdBody(
  adSetExternalId: string,
  input: CreateAdInput,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    adset_id: adSetExternalId,
    name: input.name,
    creative: { creative_id: input.externalCreativeId },
    status: "PAUSED", // GR-11
  };
  if (input.conversionDomain) {
    // A4.g: conversion_domain = the canonical destination domain (Meta AEM);
    // pairs with A4.f — the conversion domain IS the destination domain.
    body.conversion_domain = input.conversionDomain;
  }
  if (input.validateOnly) body.execution_options = ["validate_only"];
  return body;
}

// ── Preflight / connect probes (A4.e, PROOF M-P1…M-P11) ───────────────────────

const ACCOUNT_STATUS_LABELS: Record<number, string> = {
  1: "ACTIVE",
  2: "DISABLED",
  3: "UNSETTLED",
  7: "PENDING_RISK_REVIEW",
  8: "PENDING_SETTLEMENT",
  9: "IN_GRACE_PERIOD",
  100: "PENDING_CLOSURE",
  101: "CLOSED",
};

export function metaAccountStatusLabel(status: unknown): string | null {
  if (typeof status !== "number") return null;
  return ACCOUNT_STATUS_LABELS[status] ?? String(status);
}

export interface MetaAccountSnapshot {
  id: string;
  name: string | null;
  currency: string | null;
  accountStatus: string | null;
  hasPaymentMethod: boolean;
  minDailyBudgetCents: number | null;
  timezone: string | null;
}

export async function metaFetchAccount(client: MetaClient): Promise<MetaAccountSnapshot> {
  const payload = await metaGraph(
    client,
    "GET",
    `act_${client.config.adAccountId}`,
    {
      fields: "id,name,currency,account_status,min_daily_budget,funding_source,timezone_name",
    },
  );
  return {
    id: String(payload.id ?? `act_${client.config.adAccountId}`),
    name: typeof payload.name === "string" ? payload.name : null,
    currency: typeof payload.currency === "string" ? payload.currency : null,
    accountStatus: metaAccountStatusLabel(payload.account_status),
    hasPaymentMethod: Boolean(payload.funding_source),
    minDailyBudgetCents: typeof payload.min_daily_budget === "number"
      ? payload.min_daily_budget
      : null,
    timezone: typeof payload.timezone_name === "string" ? payload.timezone_name : null,
  };
}

/**
 * A4.e.1 (PROOF M-P4 + M-P6): the CORRECT Page preflight — GET /me/accounts
 * must contain the configured Page with an ADVERTISE task. promote_pages being
 * empty does NOT block creates; /me/accounts + ADVERTISE is the sufficient
 * condition. Absent → 424 meta_page_not_assigned.
 */
export async function metaCheckPageAdvertiseTask(
  client: MetaClient,
): Promise<{ ok: boolean; pageName: string | null; tasks: string[] }> {
  const payload = await metaGraph(client, "GET", "me/accounts", {
    fields: "id,name,tasks",
    limit: "100",
  });
  const rows = Array.isArray(payload.data) ? payload.data as Record<string, unknown>[] : [];
  const page = rows.find((row) => String(row.id) === client.config.pageId);
  if (!page) return { ok: false, pageName: null, tasks: [] };
  const tasks = Array.isArray(page.tasks) ? (page.tasks as string[]) : [];
  return {
    ok: tasks.includes("ADVERTISE"),
    pageName: typeof page.name === "string" ? page.name : null,
    tasks,
  };
}

/**
 * A4.e.2 (PROOF M-P6): connect-time B6 precondition — the Meta developer app
 * must be Live. Runs a VALIDATE-ONLY adcreatives probe (zero objects created);
 * error 1885183 ("app in development mode") → { appLive: false } which the
 * connect fn maps to 424 meta_app_not_live.
 */
export async function metaValidateOnlyCreativeProbe(
  client: MetaClient,
): Promise<{ appLive: boolean; ok: boolean; detail: string | null }> {
  const body = buildMetaCreativeBody(client.config.pageId, {
    destUrl: "https://usemingla.com",
    message: "connect-probe (validate-only; never created)",
    campaignName: "connect-probe",
    validateOnly: true,
  }, client.config.igUserId);
  try {
    await metaGraph(client, "POST", `act_${client.config.adAccountId}/adcreatives`, body);
    return { appLive: true, ok: true, detail: null };
  } catch (err) {
    if (err instanceof AdApiError) {
      const numericCode = typeof err.code === "number" ? err.code : Number(err.code);
      const numericSub = typeof err.subcode === "number" ? err.subcode : Number(err.subcode);
      if (numericCode === META_ERROR_APP_NOT_LIVE || numericSub === META_ERROR_APP_NOT_LIVE) {
        return { appLive: false, ok: false, detail: err.message };
      }
      return { appLive: true, ok: false, detail: err.message };
    }
    throw err;
  }
}

/**
 * A4.g (PROOF M-P8): per-category minimum budgets — fetched at connect, stored
 * in ad_connections.extra.minimum_budgets. Never hardcode the four values.
 */
export async function metaFetchMinimumBudgets(
  client: MetaClient,
  currency: string | null,
): Promise<Record<MetaBudgetCategory, number> | null> {
  const payload = await metaGraph(
    client,
    "GET",
    `act_${client.config.adAccountId}/minimum_budgets`,
    {},
  );
  const rows = Array.isArray(payload.data) ? payload.data as Record<string, unknown>[] : [];
  const row = (currency ? rows.find((r) => r.currency === currency) : rows[0]) ?? rows[0];
  if (!row) return null;
  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
  const imp = num(row.min_daily_budget_imp);
  const video = num(row.min_daily_budget_video_views);
  const high = num(row.min_daily_budget_high_freq);
  const low = num(row.min_daily_budget_low_freq);
  if (imp === null || video === null || high === null || low === null) return null;
  return { imp, video_views: video, high_freq: high, low_freq: low };
}

/** Epoch-0/null last_fired_time ⇒ the pixel has never fired (A4.e.5, PROOF M-P7). */
export function metaPixelHasSignal(lastFiredTime: unknown): boolean {
  if (typeof lastFiredTime !== "string" || lastFiredTime.trim() === "") return false;
  const parsed = Date.parse(lastFiredTime);
  if (Number.isNaN(parsed)) return false;
  // Epoch-0 renders as 1969/1970 depending on timezone — anything before
  // 2001-01-01 is "never fired".
  return parsed > Date.UTC(2001, 0, 1);
}

export async function metaFetchPixelLastFired(
  client: MetaClient,
): Promise<{ lastFiredTime: string | null; hasSignal: boolean }> {
  if (!client.config.datasetId) return { lastFiredTime: null, hasSignal: false };
  const payload = await metaGraph(client, "GET", client.config.datasetId, {
    fields: "last_fired_time",
  });
  const lastFiredTime = typeof payload.last_fired_time === "string"
    ? payload.last_fired_time
    : null;
  return { lastFiredTime, hasSignal: metaPixelHasSignal(lastFiredTime) };
}

/** A4.e.7 (PROOF M-P10): resolve the Page-linked IG business account (absent today → Facebook-only). */
export async function metaFetchIgBusinessAccount(client: MetaClient): Promise<string | null> {
  const payload = await metaGraph(client, "GET", client.config.pageId, {
    fields: "instagram_business_account",
  });
  const ig = payload.instagram_business_account as Record<string, unknown> | undefined;
  return ig && typeof ig.id === "string" ? ig.id : null;
}

// ── Status fields per level (sync — GR-18) ────────────────────────────────────
// NOTE: `recommendations` is deliberately NEVER requested or stored — it is
// Meta's optimization-suggestion feed, not a rejection mechanism (blueprint §9b).

function statusFieldsForLevel(level: EntityLevel): string {
  if (level === "ad") {
    return "id,status,effective_status,issues_info,ad_review_feedback";
  }
  return "id,status,effective_status,issues_info";
}

/**
 * GR-18: the ads.review_detail jsonb payload — issues_info + ad_review_feedback
 * (.global / .placement_specific) ONLY. Meta's `recommendations` feed is
 * optimization tips, NOT rejection reasons; it must NEVER be stored here.
 * Defensively strips a `recommendations` key even if a caller passes one.
 */
export function buildMetaReviewDetail(input: {
  issuesInfo?: unknown[] | null;
  adReviewFeedback?: Record<string, unknown> | null;
}): Record<string, unknown> | null {
  const feedback = input.adReviewFeedback ?? null;
  const detail: Record<string, unknown> = {};
  if (Array.isArray(input.issuesInfo) && input.issuesInfo.length > 0) {
    detail.issues_info = input.issuesInfo.map((item) => {
      if (item && typeof item === "object") {
        const clean = { ...(item as Record<string, unknown>) };
        delete clean.recommendations;
        return clean;
      }
      return item;
    });
  }
  if (feedback) {
    if (feedback.global !== undefined) detail.ad_review_feedback_global = feedback.global;
    if (feedback.placement_specific !== undefined) {
      detail.ad_review_feedback_placement_specific = feedback.placement_specific;
    }
  }
  delete detail.recommendations;
  return Object.keys(detail).length > 0 ? detail : null;
}

// ── The adapter ───────────────────────────────────────────────────────────────

export const metaAdapter: ChannelAdapter = {
  platform: "meta",

  // deno-lint-ignore require-await
  connect: async (conn: AdConnectionRow): Promise<AuthedClient> => {
    return resolveMetaClient(conn);
  },

  createCampaign: async (conn, input) => {
    const client = resolveMetaClient(conn);
    const body = buildMetaCampaignBody(input);
    const payload = await metaGraph(
      client,
      "POST",
      `act_${client.config.adAccountId}/campaigns`,
      body,
    );
    if (input.validateOnly) {
      return { externalId: "", status: "VALIDATED" };
    }
    return { externalId: String(payload.id ?? ""), status: "PAUSED" };
  },

  createAdSet: async (conn, campaignExternalId, input) => {
    const client = resolveMetaClient(conn);
    const body = buildMetaAdSetBody(campaignExternalId, input);
    const payload = await metaGraph(
      client,
      "POST",
      `act_${client.config.adAccountId}/adsets`,
      body,
    );
    return { externalId: String(payload.id ?? "") };
  },

  createCreative: async (conn, input) => {
    const client = resolveMetaClient(conn);
    const body = buildMetaCreativeBody(client.config.pageId, input, client.config.igUserId);
    const payload = await metaGraph(
      client,
      "POST",
      `act_${client.config.adAccountId}/adcreatives`,
      body,
    );
    return { externalCreativeId: String(payload.id ?? "") };
  },

  createAd: async (conn, adSetExternalId, input) => {
    const client = resolveMetaClient(conn);
    const body = buildMetaAdBody(adSetExternalId, input);
    const payload = await metaGraph(client, "POST", `act_${client.config.adAccountId}/ads`, body);
    return { externalId: String(payload.id ?? ""), reviewStatus: null };
  },

  setStatus: async (conn, _level, externalId, status: AdvertiserStatus) => {
    const client = resolveMetaClient(conn);
    await metaGraph(client, "POST", externalId, { status });
  },

  getStatus: async (conn, level, externalId) => {
    const client = resolveMetaClient(conn);
    const payload = await metaGraph(client, "GET", externalId, {
      fields: statusFieldsForLevel(level),
    });
    return {
      status: typeof payload.status === "string" ? payload.status : null,
      effectiveStatus: typeof payload.effective_status === "string"
        ? payload.effective_status
        : null,
      issuesInfo: Array.isArray(payload.issues_info) ? payload.issues_info : null,
      adReviewFeedback: (payload.ad_review_feedback as Record<string, unknown> | undefined) ??
        null,
    };
  },

  setBudget: async (conn, level, externalId, cents) => {
    if (level === "ad") {
      throw new AdApiError({
        platform: "meta",
        code: "unsupported_level",
        message: "Meta budgets live on the campaign (CBO) or ad set (ABO) — never the ad.",
      });
    }
    const client = resolveMetaClient(conn);
    // THE one cents→platform conversion point for Meta (identity — A4.a).
    await metaGraph(client, "POST", externalId, {
      daily_budget: centsToPlatformBudget("meta", cents),
    });
  },

  // §4.4b compensating cleanup: DELETE /{campaign_id} — live-proven to cascade
  // the child ad set. NOTE (QA P2-5): it does NOT cascade the AdCreative — that
  // is an ACCOUNT-level object, cleaned by rollbackCreative below.
  rollbackCampaign: async (conn, campaignExternalId) => {
    const client = resolveMetaClient(conn);
    await metaGraph(client, "DELETE", campaignExternalId);
  },

  // QA P2-5 (proven live): the AdCreative survives campaign deletion. On a
  // post-creative-step failure the ad never existed, so the creative is
  // unreferenced and safely deletable.
  rollbackCreative: async (conn, creativeExternalId) => {
    const client = resolveMetaClient(conn);
    await metaGraph(client, "DELETE", creativeExternalId);
  },
};
