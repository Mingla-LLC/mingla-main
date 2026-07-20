/**
 * admin-ad-create-campaign — ISSUE-862 WP1 [Full Rooms Ad Engine].
 *
 * The atomic create (SPEC §4.4b as generalized by A3 §C and corrected by A4):
 * destination resolve → validations → per-adapter campaign→ad-set→creative→ad
 * (ALL PAUSED) → persist ONE ad_campaigns+ad_sets+ads set → audit. No-orphan
 * compensating rollback: any failed step deletes the platform campaign and
 * writes NO DB row (§4.4b partial-failure contract).
 *
 * Fail-close order (BEFORE any platform write):
 *   1. connection loaded + connected                  → 424 <platform>_not_connected
 *   2. objective + optimization_goal matrix (M-2/M-3) → 422 invalid_optimization_goal
 *   3. special_ad_categories (M-4: CREDIT rejected)   → 422
 *   4. per-category budget floor from
 *      ad_connections.extra.minimum_budgets (A4.g)    → 422 budget_below_minimum
 *   5. pixel gate: LANDING_PAGE_VIEWS/OFFSITE_
 *      CONVERSIONS/VALUE while pixel epoch-0 (A4.e.5) → 422 pixel_no_signal
 *   6. destination must be public + live (§4.4b)      → 422 destination_not_public
 *
 * Destination policy v1 (A4.f, PROOF D-P1): the creative link is the canonical
 * dest_url. The OneLink (dest_smart_link) is BUILT and STORED (A1) but never
 * sent to the platform.
 *
 * VALIDATE-ONLY passthrough: body.validate_only=true runs Meta's
 * execution_options:['validate_only'] on the campaign + creative shapes —
 * zero objects created, zero DB writes.
 *
 * SNAPCHAT (ISSUE-867 WP5 — AC-S-2/3/4/11/13): a self-contained branch runs
 * the A1.2-corrected sequential create — campaign (objective_v2_type, S-1) →
 * ad squad (delivery_constraint derived, S-4; demographics min_age "18"
 * default, GR-39) → creative (WEB_VIEW; CTA allowlist, S-3; headline ≤34 /
 * brand ≤32 / URL https ≤2048, GR-54; profile trusted config, A1.2-8) → ad
 * (type REMOTE_WEBPAGE via the creative-type map, S-2) — ALL PAUSED, floors
 * checked in MICRO after the ×10,000 conversion (AC-S-3), media consumed from
 * the #866 library (never uploaded inline). Snap has NO validate-only:
 * validate_only=true returns an explicit named-skipped-layers response with
 * ZERO adapter calls (WP2 §10 — the generic block would create a REAL
 * creative).
 *
 * GOOGLE (ISSUE-867 WP2 — AC-G-2): a self-contained branch issues ONE atomic
 * `googleAds:mutate` (`partialFailure:false` — native no-orphan atomicity,
 * A1.1(4)) matching the PROVEN G-P3 reference body: budget → campaign (PAUSED,
 * SEARCH, targetSpend, G-14 containsEuPoliticalAdvertising, PRESENCE geo
 * type) → geo criteria (GR-37 resolver) → ad group → RSA (3–15×≤30 / 2–4×≤90,
 * validated pre-call) → PHRASE keywords (required — GR-15). finalUrls carry
 * the canonical dest_url; the OneLink rides ONLY in tracking_url_template
 * (A1.1(5)). validate_only=true maps to googleAds:mutate validateOnly.
 *
 * verify_jwt = true + in-code admin_users active gate; service-role DB writes.
 */

// @ts-ignore — Deno ESM import; types resolved at runtime.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore — Deno ESM import; types resolved at runtime.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  AdApiError,
  AdNotConnectedError,
  type AdConnectionRow,
  AtomicCreateError,
  centsToPlatformBudget,
  type CreateAdInput,
  type CreateAdSetInput,
  type CreateCampaignInput,
  type CreateCreativeInput,
  createFullCampaignAtomic,
  getAdapter,
  isLane,
  isPlatform,
  META_OBJECTIVE_GOAL_MATRIX,
  META_PIXEL_GATED_GOALS,
  isMetaGoalValidForObjective,
  metaBudgetCategoryForGoal,
  REDDIT_CTA_MAP,
  TIKTOK_CTA_MAP,
} from "../_shared/adChannel.ts";
import {
  applySpecialAdCategoryRestrictions,
  buildMetaGeoLocations,
  buildMetaInterestFlexibleSpec,
  metaFetchPixelLastFired,
  normalizeMetaCities,
  resolveMetaClient,
  validateSpecialAdCategories,
} from "../_shared/meta.ts";
import {
  GOOGLE_GEO_COUNTRY_CONSTANTS,
  googleCreateFullCampaign,
  type GoogleKeywordInput,
  normalizeGoogleKeywords,
  type ResolvedGeoTarget,
  resolveGoogleClient,
  suggestGeoTargetConstants,
  validateGoogleFinalUrl,
  validateGoogleRsa,
} from "../_shared/google.ts";
import {
  assertTikTokIdentityAllowed,
  resolveTikTokGeo,
  TIKTOK_BILLING_EVENTS,
  TIKTOK_GENDERS,
  TIKTOK_OPTIMIZATION_GOALS,
  TIKTOK_PIXEL_GATED_OBJECTIVES,
  type TikTokCreateAdExtensions,
  tiktokUploadImage,
  validateTikTokAdText,
  validateTikTokBudgetFloor,
  validateTikTokLandingPageUrl,
  validateTikTokLocationIds,
  validateTikTokName,
  validateTikTokObjective,
  normalizeTikTokInterestCategoryIds,
} from "../_shared/tiktok.ts";
import {
  normalizeRedditObjective,
  REDDIT_NAME_MAX,
  REDDIT_NAME_MIN,
  redditConnExtras,
  redditCreateFullChain,
  RedditChainError,
  type RedditCreativeBuildInput,
  validateRedditCreative,
} from "../_shared/reddit.ts";
import {
  buildSnapchatReviewDetail,
  SNAPCHAT_BID_STRATEGIES,
  SNAPCHAT_DEFAULT_BID_STRATEGY,
  SNAPCHAT_DEFAULT_OPTIMIZATION_GOAL,
  SNAPCHAT_MIN_ADSQUAD_BUDGET_MICRO,
  SNAPCHAT_MIN_CAMPAIGN_BUDGET_MICRO,
  SNAPCHAT_MIN_SPEND_CAP_MICRO,
  SNAPCHAT_PIXEL_GATED_GOALS,
  type SnapchatCreateAdExtensions,
  type SnapchatCreateCampaignExtensions,
  type SnapchatCreateCreativeExtensions,
  snapchatDemographicsWithDefault,
  validateSnapchatBrandName,
  validateSnapchatCta,
  validateSnapchatDemographics,
  validateSnapchatHeadline,
  validateSnapchatName,
  validateSnapchatObjective,
  validateSnapchatOptimizationGoal,
  validateSnapchatVideoDuration,
  validateSnapchatWebViewUrl,
} from "../_shared/snapchat.ts";
import { PRODUCTION_BUSINESS_WEB_ORIGIN } from "../_shared/businessWebOrigin.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BUSINESS_WEB_ORIGIN = (Deno.env.get("BUSINESS_WEB_ORIGIN") ?? "").trim() ||
  PRODUCTION_BUSINESS_WEB_ORIGIN;

/** A1 smart-link host + template (consumer OneLink w36m on go.usemingla.com — LIVE). */
const ONELINK_BASE = "https://go.usemingla.com/w36m";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Registrable destination domain for Meta AEM conversion_domain (A4.g). */
function conversionDomainFromUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    const labels = host.split(".");
    if (labels.length < 2) return host;
    return labels.slice(-2).join(".");
  } catch {
    return null;
  }
}

/**
 * A1 construction (demoted by A4.f — stored, never sent as the creative link):
 * OneLink with deep_link payload + attribution params, following the
 * app-mobile oneLinkShare.ts convention (deep_link_value ∈ {brand,event,...},
 * deep_link_sub1 = brandSlug, deep_link_sub2 = entitySlug; af_c_id / af_ad /
 * pid attribution; fbclid pass-through slots are reserved for #865).
 */
function buildDestSmartLink(input: {
  pageType: string;
  brandSlug: string;
  entitySlug: string | null;
  externalCampaignId: string;
  adName: string;
  platform: string;
}): string {
  const params = new URLSearchParams();
  params.set("pid", `${input.platform}_ads`);
  params.set("af_c_id", input.externalCampaignId);
  params.set("af_ad", input.adName);
  params.set("deep_link_value", input.pageType);
  params.set("deep_link_sub1", input.brandSlug);
  if (input.entitySlug) params.set("deep_link_sub2", input.entitySlug);
  return `${ONELINK_BASE}?${params.toString()}`;
}

/**
 * ISSUE-867 A1.1(5) (PROOF D-P1): the OneLink rides ONLY in Google's
 * `tracking_url_template` — the platform-sanctioned slot. `{campaignid}`,
 * `{creative}` and `{lpurl}` are Google ValueTrack macros expanded at serve
 * time (so no chicken-and-egg on the campaign id); `af_r={lpurl}` makes the
 * AppsFlyer OneLink redirect land on the ad's real final URL, as Google's
 * tracking-template policy requires. Stored as ad_campaigns.dest_smart_link
 * (the column's A4.f-demoted role: tracking-template source, never the
 * creative link).
 */
function buildGoogleTrackingUrlTemplate(input: {
  pageType: string;
  brandSlug: string;
  entitySlug: string | null;
}): string {
  const params: string[] = [
    "pid=google_ads",
    "af_c_id={campaignid}",
    "af_ad={creative}",
    `deep_link_value=${encodeURIComponent(input.pageType)}`,
    `deep_link_sub1=${encodeURIComponent(input.brandSlug)}`,
  ];
  if (input.entitySlug) {
    params.push(`deep_link_sub2=${encodeURIComponent(input.entitySlug)}`);
  }
  params.push("af_r={lpurl}");
  return `${ONELINK_BASE}?${params.join("&")}`;
}

interface DestinationInput {
  page_type?: string;
  brand_slug?: string;
  entity_slug?: string;
  event_id?: string;
}

/**
 * ISSUE-1002 [Campaign Builder multi-destination fan-out] — the request now
 * accepts a `destinations: DestinationInput[]` array (the multi-select set) in
 * addition to the legacy singular `destination`. The wizard fans out one create
 * call per (destination × platform) — architecturally identical to the existing
 * per-platform fan-out — so EACH call carries the single destination it builds an
 * ad for (as the first/only element of `destinations`, or the legacy singular
 * `destination`), plus a shared `destination_group_id` that ties the whole
 * fan-out together (persisted as ad_campaigns.dest_group_id).
 *
 * This ONE resolver replaces the 5×-copy-pasted `(body.destination ?? {})` pick
 * (ISSUE-977 Lane C discovery #2) and adds array tolerance. It deliberately does
 * NOT merge the five per-platform resolve-against-view blocks below — those are
 * genuinely platform-specific (different views/columns/URL builders) and merging
 * them would be an over-refactor that risks the Wave 0–3 behaviour.
 *
 * Backward compatible: a body with only the singular `destination` (every
 * pre-1002 caller, and every single-destination build) resolves byte-identically.
 */
function pickCallDestination(body: Record<string, unknown>): DestinationInput {
  const single = body.destination;
  if (single && typeof single === "object" && !Array.isArray(single)) {
    return single as DestinationInput;
  }
  const list = body.destinations;
  if (Array.isArray(list) && list.length > 0 && list[0] && typeof list[0] === "object") {
    return list[0] as DestinationInput;
  }
  return {} as DestinationInput;
}

/**
 * ISSUE-1002 — the shared fan-out group id (optional, nullable). Present on every
 * call of a multi-destination fan-out so the N resulting ad_campaigns rows share
 * it; absent (→ NULL) for a single-destination build, keeping that path
 * byte-identical to before.
 */
function pickDestGroupId(body: Record<string, unknown>): string | null {
  return typeof body.destination_group_id === "string" && body.destination_group_id.trim()
    ? body.destination_group_id.trim()
    : null;
}

/**
 * ISSUE-979 Bug 3 [Campaign Builder correctness] — the GLOBAL compliance intent
 * (AI-generated disclosure + special-ad-category) now reaches every platform's
 * create path via `body.compliance` (the builder used to send it to Meta only,
 * silently dropping it for the other four). Meta APPLIES both (self_ai_disclosure
 * + special_ad_categories, handled inline in the Meta branch). The other four
 * platforms have NO usable equivalent field on their create API — but the drop
 * must be DOCUMENTED and OBSERVABLE, never silent.
 *
 * Researched per-platform capability (2026-07, adapters + create-campaign):
 *   - tiktok:   aigc_disclosure_type is CUSTOMIZED_USER-only and unreachable for
 *               our account (PROOF T-P6); no special-ad-category field.
 *   - snapchat: no AI-disclosure field; no special-ad-category field.
 *   - reddit:   no AI-disclosure field; no special-ad-category field.
 *   - google:   no general special-ad-category field (account-level policy/
 *               verification, not a create field); no RSA AI-disclosure field;
 *               only containsEuPoliticalAdvertising (already declared
 *               DOES_NOT_CONTAIN — G-14).
 */
const COMPLIANCE_UNSUPPORTED_REASON: Record<string, string> = {
  tiktok:
    "TikTok's aigc_disclosure_type is CUSTOMIZED_USER-only (unreachable for this account, T-P6) and it exposes no special-ad-category field",
  snapchat: "Snapchat's create API exposes no AI-disclosure field and no special-ad-category field",
  reddit: "Reddit's create API exposes no AI-disclosure field and no special-ad-category field",
  google:
    "Google Ads exposes no general special-ad-category field (account-level policy) and no RSA AI-disclosure field; only containsEuPoliticalAdvertising (already declared)",
};

/**
 * Record + observe the compliance drop for a platform whose API cannot carry
 * the flags. No-op when nothing was set. Never silent when something was set.
 */
function documentComplianceDrop(platform: string, compliance: unknown): void {
  const c = (compliance ?? {}) as Record<string, unknown>;
  const specialCategory = typeof c.specialAdCategory === "string" ? c.specialAdCategory : "NONE";
  const aiGenerated = c.aiGenerated === true;
  if (specialCategory === "NONE" && !aiGenerated) return; // nothing set — nothing to note
  const reason = COMPLIANCE_UNSUPPORTED_REASON[platform] ?? `${platform} exposes no compliance-flag field`;
  console.warn(
    `[admin-ad-create-campaign] ${platform}: compliance intent received ` +
      `(special_ad_category=${specialCategory}, ai_generated=${aiGenerated}) but cannot be ` +
      `expressed on this platform — ${reason}. Documented, not applied (ISSUE-979 Bug 3).`,
  );
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  // ── ADMIN GATE (SPEC §4.4). ──────────────────────────────────────────────────
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const jwt = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
  if (authError || !user) return json({ error: "unauthorized" }, 401);
  const { data: adminRow } = await supabase
    .from("admin_users")
    .select("id")
    .eq("email", user.email)
    .eq("status", "active")
    .maybeSingle();
  if (!adminRow) return json({ error: "forbidden" }, 403);

  // ── Input validation. ────────────────────────────────────────────────────────
  const platform = body.platform ?? "meta";
  const lane = body.lane ?? "consumer";
  if (!isPlatform(platform)) return json({ error: "validation_error", detail: "platform_invalid" }, 400);
  if (!isLane(lane)) return json({ error: "validation_error", detail: "lane_invalid" }, 400);

  // ISSUE-1002 [multi-destination fan-out] — the shared group id for the N
  // ad_campaigns rows this fan-out produces (one call per destination × platform).
  // NULL for single-destination/legacy builds → those rows are byte-identical.
  const destGroupId = pickDestGroupId(body);

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return json({ error: "validation_error", detail: "name_required" }, 400);

  const objective = typeof body.objective === "string" ? body.objective : "OUTCOME_TRAFFIC";
  // A4.e.5 (supersedes OD-4): LINK_CLICKS is the default until the pixel fires.
  const optimizationGoal = typeof body.optimization_goal === "string"
    ? body.optimization_goal
    : "LINK_CLICKS";
  const billingEvent = typeof body.billing_event === "string" ? body.billing_event : "IMPRESSIONS";

  const budget = (body.budget ?? {}) as Record<string, unknown>;
  const budgetType = budget.type ?? "daily";
  const amountCents = budget.amount_cents;
  if (budgetType !== "daily") {
    // A3 §A persists daily_budget_cents only; lifetime budgets land with the
    // builder (#864). Flagged in the WP1 report.
    return json({ error: "validation_error", detail: "budget_type_unsupported_wp1" }, 422);
  }
  if (!Number.isInteger(amountCents) || (amountCents as number) <= 0) {
    return json({ error: "validation_error", detail: "budget_amount_cents_invalid" }, 400);
  }
  // QA P3-9: sane business ceiling — $1M/day. A typo'd budget must die here,
  // not at Meta (the conversion layer separately guards integer-precision).
  const MAX_DAILY_BUDGET_CENTS = 100_000_000;
  if ((amountCents as number) > MAX_DAILY_BUDGET_CENTS) {
    return json({
      error: "budget_above_maximum",
      detail:
        `Daily budget ${amountCents}¢ exceeds the ${MAX_DAILY_BUDGET_CENTS}¢ ($1,000,000/day) ceiling.`,
      max_cents: MAX_DAILY_BUDGET_CENTS,
    }, 422);
  }

  // ══ GOOGLE branch (ISSUE-867 WP2 — AC-G-2) ══════════════════════════════════
  // ONE atomic googleAds:mutate (partialFailure:false — native no-orphan
  // atomicity, A1.1(4)); SEARCH+RSA only (PMax DEFERRED — A1.1(2)); everything
  // below the budget checks is google-shaped, so the branch is self-contained
  // and the Meta path below stays byte-identical.
  if (platform === "google") {
    const requestIdG = typeof body.request_id === "string" && body.request_id.trim()
      ? body.request_id.trim()
      : null;
    const validateOnlyG = body.validate_only === true;

    // (1) Pure input validation — all 422s BEFORE any provider call.
    const creativeG = (body.creative ?? {}) as Record<string, unknown>;
    // ISSUE-979 Bug 3: the global compliance intent reaches Google's create path
    // now. Google has no general special-ad-category field and no RSA AI field —
    // documented + observable, never silently dropped.
    documentComplianceDrop("google", body.compliance);
    const rsa = validateGoogleRsa(creativeG.headlines, creativeG.descriptions);
    if (!rsa.ok) return json({ error: rsa.detail, detail: rsa.message }, 422);
    const headlines = (creativeG.headlines as string[]).map((h) => h.trim());
    const descriptions = (creativeG.descriptions as string[]).map((d) => d.trim());

    // Keywords REQUIRED for SEARCH (GR-15); PHRASE default; ≤80 chars/≤10 words (GR-73).
    const keywordsResult = normalizeGoogleKeywords(body.keywords, { required: true });
    if (!keywordsResult.ok) {
      return json({ error: keywordsResult.detail, detail: keywordsResult.message }, 422);
    }
    const negativesResult = normalizeGoogleKeywords(body.negative_keywords, {
      required: false,
      field: "negative_keywords",
    });
    if (!negativesResult.ok) {
      return json({ error: negativesResult.detail, detail: negativesResult.message }, 422);
    }
    const keywords: GoogleKeywordInput[] = keywordsResult.keywords;
    const negativeKeywords: GoogleKeywordInput[] = negativesResult.keywords;

    const cpcBidCentsRaw = budget.cpc_bid_cents;
    if (
      cpcBidCentsRaw !== undefined &&
      (!Number.isInteger(cpcBidCentsRaw) || (cpcBidCentsRaw as number) <= 0)
    ) {
      return json({ error: "validation_error", detail: "cpc_bid_cents_invalid" }, 400);
    }
    const cpcBidCents = cpcBidCentsRaw as number | undefined;

    const targetingG = (body.targeting ?? {}) as Record<string, unknown>;
    const countriesG = targetingG.countries;
    if (
      !Array.isArray(countriesG) || countriesG.length === 0 ||
      countriesG.some((c) => typeof c !== "string" || !c.trim())
    ) {
      return json({ error: "validation_error", detail: "targeting_countries_required" }, 400);
    }
    const countryCodes = (countriesG as string[]).map((c) => c.trim().toUpperCase());
    const locationsG = Array.isArray(targetingG.locations)
      ? targetingG.locations as Record<string, unknown>[]
      : [];
    for (const location of locationsG) {
      if (
        typeof location.name !== "string" || !location.name.trim() ||
        typeof location.country_code !== "string" || !location.country_code.trim()
      ) {
        return json({
          error: "validation_error",
          detail: "targeting_location_invalid — each location needs { name, country_code }",
        }, 400);
      }
    }

    const destinationG = pickCallDestination(body); // ISSUE-1002: singular or destinations[0]
    const pageTypeG = destinationG.page_type ?? "";
    const brandSlugG = typeof destinationG.brand_slug === "string"
      ? destinationG.brand_slug.trim()
      : "";
    const entitySlugG = typeof destinationG.entity_slug === "string"
      ? destinationG.entity_slug.trim()
      : "";
    if (!["event", "trip", "brand", "venue"].includes(pageTypeG)) {
      return json({ error: "validation_error", detail: "destination_page_type_invalid" }, 400);
    }
    if (!brandSlugG) {
      return json({ error: "validation_error", detail: "destination_brand_slug_required" }, 400);
    }

    // (2) Connection (fail-close): an absent/broken google connection is a
    //     provisioning state → 409 google_not_provisioned (SPEC §4.4b — the
    //     google exception to the 424 rule), zero Google calls.
    const { data: gconnRow } = await supabase
      .from("ad_connections")
      .select("*")
      .eq("platform", "google")
      .eq("lane", lane)
      .maybeSingle();
    if (!gconnRow || !gconnRow.connected || gconnRow.status !== "connected") {
      return json({ error: "google_not_provisioned" }, 409);
    }
    const gconn = gconnRow as unknown as AdConnectionRow;

    // Idempotency (A3 §A request_id): replay returns the existing row.
    if (requestIdG && !validateOnlyG) {
      const { data: existingG } = await supabase
        .from("ad_campaigns")
        .select("*")
        .eq("connection_id", gconn.id)
        .eq("request_id", requestIdG)
        .maybeSingle();
      if (existingG) return json({ campaign: existingG, idempotent_replay: true });
    }

    // (3) Destination resolve — READ-ONLY, public + live only (§4.4b; the
    //     GR-52 sync re-checker re-asserts this same gate for the ad's life).
    let destUrlG: string;
    let destEventIdG: string | null = null;
    if (pageTypeG === "event") {
      if (!entitySlugG) {
        return json({ error: "validation_error", detail: "destination_entity_slug_required" }, 400);
      }
      const { data: eventRow } = await supabase
        .from("business_public_events_view")
        .select("id, brand_slug, slug, status")
        .eq("brand_slug", brandSlugG)
        .eq("slug", entitySlugG)
        .in("status", ["scheduled", "live"])
        .maybeSingle();
      if (!eventRow) return json({ error: "destination_not_public" }, 422);
      destUrlG = `${BUSINESS_WEB_ORIGIN}/e/${brandSlugG}/${entitySlugG}`;
      destEventIdG = String(eventRow.id);
    } else if (pageTypeG === "brand") {
      const { data: brandRow } = await supabase
        .from("business_public_brands_view")
        .select("id, slug")
        .eq("slug", brandSlugG)
        .maybeSingle();
      if (!brandRow) return json({ error: "destination_not_public" }, 422);
      destUrlG = `${BUSINESS_WEB_ORIGIN}/b/${brandSlugG}`;
    } else {
      return json({ error: "destination_not_public", detail: "dest_page_type_not_supported_wp1" }, 422);
    }

    // A4.f/GR-73: finalUrls = [canonical dest_url] — https, ≤2,084 bytes.
    const finalUrlCheck = validateGoogleFinalUrl(destUrlG);
    if (!finalUrlCheck.ok) {
      return json({ error: finalUrlCheck.detail, detail: finalUrlCheck.message }, 422);
    }

    // (4) Geo resolution (GR-37/G-P2 — numeric criterion IDs, never names).
    //     Named locations resolve via the countryCode-scoped suggest (the
    //     London/Ontario disambiguation path); with none, the verified country
    //     seed constants target the whole country. Resolved id + canonical
    //     name are PERSISTED in targeting jsonb.
    const resolvedLocations: ResolvedGeoTarget[] = [];
    try {
      if (locationsG.length > 0) {
        const gclient = await resolveGoogleClient(gconn);
        for (const location of locationsG) {
          const name = (location.name as string).trim();
          const countryCode = (location.country_code as string).trim().toUpperCase();
          const resolved = await suggestGeoTargetConstants(gclient, { name, countryCode });
          if (!resolved) {
            return json({
              error: "geo_not_resolvable",
              detail:
                `"${name}" did not resolve to an ENABLED geo target constant in ${countryCode} (countryCode-scoped suggest — GR-37).`,
            }, 422);
          }
          resolvedLocations.push(resolved);
        }
      }
    } catch (err) {
      if (err instanceof AdNotConnectedError) {
        return json(
          { error: err.detail === "google_not_provisioned" ? "google_not_provisioned" : "google_not_connected" },
          err.detail === "google_not_provisioned" ? 409 : 424,
        );
      }
      if (err instanceof AdApiError) {
        return json({ error: "geo_not_resolvable", detail: err.toJSON() }, 422);
      }
      throw err;
    }
    let geoTargetCriterionIds: string[];
    const geoTargetingRecord: Record<string, unknown> = {
      countries: countryCodes,
      // GR-37: PRESENCE always — recorded so the persisted targeting states it.
      positive_geo_target_type: "PRESENCE",
    };
    if (resolvedLocations.length > 0) {
      geoTargetCriterionIds = resolvedLocations.map((l) => l.criterionId);
      geoTargetingRecord.locations = resolvedLocations.map((l) => ({
        criterion_id: l.criterionId,
        name: l.name,
        canonical_name: l.canonicalName,
        country_code: l.countryCode,
        target_type: l.targetType,
      }));
    } else {
      const unresolved = countryCodes.filter((code) => !GOOGLE_GEO_COUNTRY_CONSTANTS[code]);
      if (unresolved.length > 0) {
        return json({
          error: "geo_not_resolvable",
          detail:
            `Country code(s) ${unresolved.join(", ")} are not in the verified seed constants (US/GB/NG — A1.3 GR-37). Add a CSV-verified constant or target a named location instead.`,
        }, 422);
      }
      geoTargetCriterionIds = countryCodes.map(
        (code) => GOOGLE_GEO_COUNTRY_CONSTANTS[code].criterionId,
      );
      geoTargetingRecord.country_criterion_ids = geoTargetCriterionIds;
    }

    const trackingUrlTemplate = buildGoogleTrackingUrlTemplate({
      pageType: pageTypeG,
      brandSlug: brandSlugG,
      entitySlug: entitySlugG || null,
    });

    const createInput = {
      name,
      dailyBudgetCents: amountCents as number,
      cpcBidCents,
      finalUrl: destUrlG,
      trackingUrlTemplate,
      headlines,
      descriptions,
      keywords,
      negativeKeywords,
      geoTargetCriterionIds,
      validateOnly: validateOnlyG,
    };

    // (5) The atomic mutate — validateOnly passthrough validates the EXACT
    //     same body with zero objects created (PROVEN clean — G-P3).
    try {
      const created = await googleCreateFullCampaign(gconn, createInput);
      if (validateOnlyG) {
        return json({
          validated: true,
          validated_layers: ["campaign_budget", "campaign", "geo_criteria", "ad_group", "ad", "keywords"],
          skipped_layers: [],
          request_id: created.requestId,
          detail: "validate_only — nothing created on the platform, nothing persisted.",
        });
      }

      // Best-effort delivery read-back (sync repairs it).
      let deliveryStatusG: string | null = null;
      try {
        const adapterG = getAdapter("google");
        const statusG = await adapterG.getStatus(gconn, "campaign", created.externalCampaignId);
        deliveryStatusG = statusG.effectiveStatus;
      } catch {
        deliveryStatusG = null;
      }

      // (6) Persist ONE campaign+ad_set+ad row set (only now that all IDs exist).
      const { data: campaignRowG, error: campaignErrG } = await supabase
        .from("ad_campaigns")
        .insert({
          connection_id: gconn.id,
          platform: "google",
          external_campaign_id: created.externalCampaignId,
          name,
          objective: "SEARCH", // normalized-per-platform: the advertising channel type
          status: "PAUSED",
          daily_budget_cents: amountCents,
          delivery_status: deliveryStatusG,
          status_synced_at: new Date().toISOString(),
          targeting: geoTargetingRecord,
          dest_page_type: pageTypeG,
          dest_brand_slug: brandSlugG,
          dest_entity_slug: entitySlugG || null,
          dest_event_id: destEventIdG,
          dest_url: destUrlG,
          dest_smart_link: trackingUrlTemplate, // A4.f-demoted slot: tracking template, never the creative link
          dest_group_id: destGroupId, // ISSUE-1002: shared fan-out group (NULL for single-destination)
          request_id: requestIdG,
          created_by: user.id,
        })
        .select("*")
        .single();

      let adSetRowG: Record<string, unknown> | null = null;
      let adRowG: Record<string, unknown> | null = null;
      let persistErrG = campaignErrG;
      if (!persistErrG && campaignRowG) {
        const { data, error } = await supabase
          .from("ad_sets")
          .insert({
            campaign_id: campaignRowG.id,
            external_adset_id: created.externalAdSetId,
            name: `${name} — ad group`,
            targeting: geoTargetingRecord,
            budget_cents: null, // budget lives on the campaign budget resource
            optimization_goal: "MAXIMIZE_CLICKS", // targetSpend = maximize clicks (GR-55)
            bid_strategy: "TARGET_SPEND",
            billing_event: null,
            // The PROVEN shape (G-P3): PAUSED parent + ENABLED ad group — the
            // paused campaign gates delivery; the row mirrors platform truth.
            status: "ACTIVE",
          })
          .select("*")
          .single();
        adSetRowG = data;
        persistErrG = error;
      }
      if (!persistErrG && adSetRowG) {
        const { data, error } = await supabase
          .from("ads")
          .insert({
            ad_set_id: adSetRowG.id,
            // The `{ad_group_id}~{ad_id}` composite IS the external ad id.
            external_ad_id: created.externalAdId,
            external_creative_id: null, // RSA text is inline — no creative object
            name: `${name} — ad`,
            status: "PAUSED",
            review_status: null, // sync fills approval_status + review_detail (G-3)
          })
          .select("*")
          .single();
        adRowG = data;
        persistErrG = error;
      }

      if (persistErrG) {
        // Never a half-written DB row set. Everything on Google is PAUSED
        // (zero spend risk) and natively consistent; there is no delete path
        // (REMOVED is permanent — A1.1(4)), so the audit row carries the IDs
        // for manual reconciliation.
        if (campaignRowG) await supabase.from("ad_campaigns").delete().eq("id", campaignRowG.id);
        await supabase.from("ad_status_events").insert({
          campaign_id: null,
          platform: "google",
          entity: "campaign",
          action: "create_failed",
          actor: user.id,
          to_status: null,
          external_ids: {
            external_campaign_id: created.externalCampaignId,
            external_adset_id: created.externalAdSetId,
            external_ad_id: created.externalAdId,
            budget_resource_name: created.budgetResourceName,
          },
          provider_response: {
            db_error: persistErrG.message,
            request_id: created.requestId,
            note: "google objects exist PAUSED (atomic create succeeded; DB persist failed) — reconcile manually",
          },
        });
        console.error("[admin-ad-create-campaign] google persist failed:", persistErrG.message);
        return json({ error: "internal_error", detail: "db_persist_failed_google_objects_paused" }, 500);
      }

      await supabase.from("ad_status_events").insert({
        campaign_id: campaignRowG.id,
        platform: "google",
        entity: "campaign",
        action: "create",
        actor: user.id,
        from_status: null,
        to_status: "PAUSED",
        external_ids: {
          external_campaign_id: created.externalCampaignId,
          external_adset_id: created.externalAdSetId,
          external_ad_id: created.externalAdId,
          budget_resource_name: created.budgetResourceName,
        },
        // A1.1(4): the Google request_id is what Google support requires.
        provider_response: created.requestId ? { request_id: created.requestId } : null,
      });

      return json({ campaign: campaignRowG, ad_set: adSetRowG, ad: adRowG });
    } catch (err) {
      if (err instanceof AdNotConnectedError) {
        return json(
          { error: err.detail === "google_not_provisioned" ? "google_not_provisioned" : "google_not_connected" },
          err.detail === "google_not_provisioned" ? 409 : 424,
        );
      }
      if (err instanceof AdApiError) {
        // partialFailure:false — the WHOLE request failed; nothing exists on
        // Google (native atomicity), so there are no partial IDs to reconcile.
        await supabase.from("ad_status_events").insert({
          campaign_id: null,
          platform: "google",
          entity: "campaign",
          action: "create_failed",
          actor: user.id,
          external_ids: null,
          provider_response: { step: "atomic_mutate", ...err.toJSON() },
        });
        return json({
          error: "google_create_failed",
          detail: err.toJSON(),
          step: "atomic_mutate",
          rolled_back: null, // nothing to roll back — the mutate is all-or-nothing
        }, 502);
      }
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[admin-ad-create-campaign] google unexpected:", detail);
      return json({ error: "internal_error" }, 500);
    }
  }

  // ══ SNAPCHAT branch (ISSUE-867 WP5 — AC-S-2/3/4/11/13, A1.2) ═══════════════
  // Self-contained (like google's) so the Meta path stays byte-identical:
  // validators (422s) → connection (424) → profile trusted-config gate (424
  // snapchat_profile_missing — AC-S-11) → idempotent replay → destination
  // resolve → media resolve (#866 library ref or explicit top_snap_media_id)
  // → the VALIDATE GATE (Snap has NO validate-only — WP2 §10: the generic
  // block would create a REAL creative; this branch returns named-skipped
  // layers instead) → sequential atomic create (campaign → squad → creative →
  // ad, ALL PAUSED) with compensating rollback → persist → audit.
  if (platform === "snapchat") {
    const requestIdS = typeof body.request_id === "string" && body.request_id.trim()
      ? body.request_id.trim()
      : null;
    const validateOnlyS = body.validate_only === true;

    // (1) Pure input validation — all 422s BEFORE any provider call.
    const nameCheck = validateSnapchatName(name, "campaign name");
    if (!nameCheck.ok) return json({ error: nameCheck.detail, detail: nameCheck.message }, 422);

    const objectiveS = typeof body.objective === "string" ? body.objective : "TRAFFIC";
    const objectiveCheck = validateSnapchatObjective(objectiveS);
    if (!objectiveCheck.ok) {
      return json({ error: objectiveCheck.detail, detail: objectiveCheck.message }, 422);
    }

    // A1.1(6) (OD-4 REVERSED): SWIPES default until #865's pixel fires.
    const optimizationGoalS = typeof body.optimization_goal === "string"
      ? body.optimization_goal
      : SNAPCHAT_DEFAULT_OPTIMIZATION_GOAL;
    const goalCheck = validateSnapchatOptimizationGoal(optimizationGoalS);
    if (!goalCheck.ok) return json({ error: goalCheck.detail, detail: goalCheck.message }, 422);

    // Budget level (OD-3): ABO (squad, ≥$5/day) default; CBO (campaign, ≥$20/day).
    const budgetLevelS = budget.level === "campaign" ? "campaign" : "adset";
    const budgetMicroS = (amountCents as number) * 10_000; // display-math only; the adapter owns THE conversion
    const floorMicroS = budgetLevelS === "campaign"
      ? SNAPCHAT_MIN_CAMPAIGN_BUDGET_MICRO
      : SNAPCHAT_MIN_ADSQUAD_BUDGET_MICRO;
    if (budgetMicroS < floorMicroS) {
      // AC-S-3: min-check in MICRO after conversion, BEFORE any provider write.
      return json({
        error: "budget_below_minimum",
        detail:
          `Daily budget ${amountCents}¢ converts to ${budgetMicroS} micro — below Snap's ${floorMicroS} micro ${
            budgetLevelS === "campaign" ? "($20.00 campaign)" : "($5.00 ad-squad)"
          } floor (AC-S-3).`,
        floor_micro: floorMicroS,
        level: budgetLevelS,
      }, 422);
    }

    // GR-64(a): the lifetime spend cap — the early safety rail on the
    // $15k/day-limit account (S-P3). Optional; cents → micro ×10,000; min $20.
    const spendCapCentsRaw = budget.spend_cap_cents;
    if (
      spendCapCentsRaw !== undefined &&
      (!Number.isInteger(spendCapCentsRaw) || (spendCapCentsRaw as number) <= 0)
    ) {
      return json({ error: "validation_error", detail: "spend_cap_cents_invalid" }, 400);
    }
    const spendCapCentsS = spendCapCentsRaw as number | undefined;
    if (
      typeof spendCapCentsS === "number" &&
      spendCapCentsS * 10_000 < SNAPCHAT_MIN_SPEND_CAP_MICRO
    ) {
      return json({
        error: "spend_cap_below_minimum",
        detail:
          `spend_cap_cents ${spendCapCentsS}¢ converts below Snap's ${SNAPCHAT_MIN_SPEND_CAP_MICRO} micro ($20.00) minimum (GR-64).`,
      }, 422);
    }

    // S-7 pre-call: bid strategy allowlist (MIN_ROAS deprecated) + bid_cents.
    const bidStrategyS = typeof body.bid_strategy === "string"
      ? body.bid_strategy
      : SNAPCHAT_DEFAULT_BID_STRATEGY;
    if (!(SNAPCHAT_BID_STRATEGIES as readonly string[]).includes(bidStrategyS)) {
      return json({
        error: "bid_strategy_invalid",
        detail: `bid_strategy "${bidStrategyS}" is invalid — valid: ${
          SNAPCHAT_BID_STRATEGIES.join(" | ")
        } (MIN_ROAS was deprecated 10 Feb 2025 — S-7).`,
      }, 422);
    }
    const bidCentsRaw = budget.bid_cents;
    if (
      bidCentsRaw !== undefined && (!Number.isInteger(bidCentsRaw) || (bidCentsRaw as number) <= 0)
    ) {
      return json({ error: "validation_error", detail: "bid_cents_invalid" }, 400);
    }
    const bidCentsS = bidCentsRaw as number | undefined;
    if (bidStrategyS !== "AUTO_BID" && typeof bidCentsS !== "number") {
      return json({
        error: "bid_micro_required",
        detail: `bid_strategy ${bidStrategyS} requires budget.bid_cents (converted ×10,000 to bid_micro).`,
      }, 422);
    }

    const targetingS = (body.targeting ?? {}) as Record<string, unknown>;
    const countriesS = targetingS.countries;
    if (
      !Array.isArray(countriesS) || countriesS.length === 0 ||
      countriesS.some((c) => typeof c !== "string" || !c.trim())
    ) {
      return json({ error: "validation_error", detail: "targeting_countries_required" }, 400);
    }
    const countryCodesS = (countriesS as string[]).map((c) => c.trim().toUpperCase());
    // GR-39: demographics default [{min_age:"18"}]; STRINGS, validated pre-call.
    const demographicsS = snapchatDemographicsWithDefault(
      Array.isArray(targetingS.demographics)
        ? targetingS.demographics as Record<string, unknown>[]
        : null,
    );
    const demographicsCheck = validateSnapchatDemographics(demographicsS);
    if (!demographicsCheck.ok) {
      return json({ error: demographicsCheck.detail, detail: demographicsCheck.message }, 422);
    }

    const creativeS = (body.creative ?? {}) as Record<string, unknown>;
    // ISSUE-979 Bug 3: the global compliance intent reaches Snapchat's create
    // path now. Snapchat has no AI-disclosure and no special-ad-category field —
    // documented + observable, never silently dropped.
    documentComplianceDrop("snapchat", body.compliance);
    const headlineCheck = validateSnapchatHeadline(creativeS.headline);
    if (!headlineCheck.ok) {
      return json({ error: headlineCheck.detail, detail: headlineCheck.message }, 422);
    }
    const headlineS = (creativeS.headline as string).trim();
    const brandNameCheck = validateSnapchatBrandName(creativeS.brand_name);
    if (!brandNameCheck.ok) {
      return json({ error: brandNameCheck.detail, detail: brandNameCheck.message }, 422);
    }
    const brandNameS = typeof creativeS.brand_name === "string"
      ? creativeS.brand_name.trim()
      : undefined;

    const destinationS = pickCallDestination(body); // ISSUE-1002: singular or destinations[0]
    const pageTypeS = destinationS.page_type ?? "";
    const brandSlugS = typeof destinationS.brand_slug === "string"
      ? destinationS.brand_slug.trim()
      : "";
    const entitySlugS = typeof destinationS.entity_slug === "string"
      ? destinationS.entity_slug.trim()
      : "";
    if (!["event", "trip", "brand", "venue"].includes(pageTypeS)) {
      return json({ error: "validation_error", detail: "destination_page_type_invalid" }, 400);
    }
    if (!brandSlugS) {
      return json({ error: "validation_error", detail: "destination_brand_slug_required" }, 400);
    }

    // S-3: CTA from the WEB_VIEW allowlist (VIEW_MORE does not exist) — defaults
    // for reservation traffic: BUY_TICKETS (ticketed events) / BOOK_NOW (else).
    const ctaS = typeof creativeS.call_to_action === "string"
      ? creativeS.call_to_action
      : pageTypeS === "event"
      ? "BUY_TICKETS"
      : "BOOK_NOW";
    const ctaCheck = validateSnapchatCta("WEB_VIEW", ctaS);
    if (!ctaCheck.ok) return json({ error: ctaCheck.detail, detail: ctaCheck.message }, 422);

    // (2) Connection (fail-close) — 424 snapchat_not_connected.
    const { data: sconnRow } = await supabase
      .from("ad_connections")
      .select("*")
      .eq("platform", "snapchat")
      .eq("lane", lane)
      .maybeSingle();
    if (!sconnRow || !sconnRow.connected || sconnRow.status !== "connected") {
      return json({ error: "snapchat_not_connected" }, 424);
    }
    const sconn = sconnRow as unknown as AdConnectionRow;
    const sconnExtra = (sconn.extra ?? {}) as Record<string, unknown>;

    // (3) AC-S-11: Public Profile TRUSTED CONFIG gate — 424
    //     snapchat_profile_missing with ZERO provider calls (A1.2-8; the API
    //     lookup 403s on our token class, S-P4).
    const profileIdS =
      (typeof sconnExtra.profile_id === "string" && sconnExtra.profile_id.trim()) ||
      (Deno.env.get(
        lane === "business" ? "SNAPCHAT_MINGLABIZ_PROFILE_ID" : "SNAPCHAT_PROFILE_ID",
      ) ?? "").trim();
    if (!profileIdS) {
      return json({
        error: "snapchat_profile_missing",
        detail:
          "Snap creatives require profile_properties.profile_id (mandatory for all Snap advertisers). Set the SNAPCHAT_PROFILE_ID Function Secret (UI-captured trusted config — the Public Profile API 403s on our token class, S-P4), then reconnect.",
      }, 424);
    }

    // A1.1(6)/AC-S-13: pixel-measured goals are gated on the #865 signal; a
    // permitted pixel goal must carry pixel_id on the squad.
    let pixelIdS: string | null = null;
    if (SNAPCHAT_PIXEL_GATED_GOALS.includes(optimizationGoalS)) {
      if (sconnExtra.pixel_installed !== true) {
        return json({
          error: "pixel_goal_unavailable",
          detail:
            `${optimizationGoalS} is pixel-measured and the Snap pixel sends no events yet (#865 owns the install) — optimizing to an event we don't send means no/erratic delivery (GR-21). Use SWIPES until the pixel fires.`,
        }, 422);
      }
      pixelIdS = typeof sconnExtra.pixel_id === "string" && sconnExtra.pixel_id.trim()
        ? sconnExtra.pixel_id.trim()
        : null;
      if (!pixelIdS) {
        return json({
          error: "pixel_goal_unavailable",
          detail:
            "The connection carries no pixel_id — a pixel-measured goal requires pixel_id on the ad squad (A1.1(6)). Reconnect to capture it.",
        }, 422);
      }
    }

    // Idempotency (A3 §A request_id): replay returns the existing row.
    if (requestIdS && !validateOnlyS) {
      const { data: existingS } = await supabase
        .from("ad_campaigns")
        .select("*")
        .eq("connection_id", sconn.id)
        .eq("request_id", requestIdS)
        .maybeSingle();
      if (existingS) return json({ campaign: existingS, idempotent_replay: true });
    }

    // (4) Destination resolve — READ-ONLY, public + live only (§4.4b; the
    //     GR-52 sync re-checker re-asserts this same gate for the ad's life).
    let destUrlS: string;
    let destEventIdS: string | null = null;
    if (pageTypeS === "event") {
      if (!entitySlugS) {
        return json({ error: "validation_error", detail: "destination_entity_slug_required" }, 400);
      }
      const { data: eventRow } = await supabase
        .from("business_public_events_view")
        .select("id, brand_slug, slug, status")
        .eq("brand_slug", brandSlugS)
        .eq("slug", entitySlugS)
        .in("status", ["scheduled", "live"])
        .maybeSingle();
      if (!eventRow) return json({ error: "destination_not_public" }, 422);
      destUrlS = `${BUSINESS_WEB_ORIGIN}/e/${brandSlugS}/${entitySlugS}`;
      destEventIdS = String(eventRow.id);
    } else if (pageTypeS === "brand") {
      const { data: brandRow } = await supabase
        .from("business_public_brands_view")
        .select("id, slug")
        .eq("slug", brandSlugS)
        .maybeSingle();
      if (!brandRow) return json({ error: "destination_not_public" }, 422);
      destUrlS = `${BUSINESS_WEB_ORIGIN}/b/${brandSlugS}`;
    } else {
      return json({ error: "destination_not_public", detail: "dest_page_type_not_supported_wp1" }, 422);
    }
    // GR-54 + destination policy v1: the web-view URL is the canonical page
    // (https, ≤2048) — NEVER the OneLink (D-P1).
    const webViewUrlCheck = validateSnapchatWebViewUrl(destUrlS);
    if (!webViewUrlCheck.ok) {
      return json({ error: webViewUrlCheck.detail, detail: webViewUrlCheck.message }, 422);
    }

    // (5) Media resolve — the adapter NEVER uploads; media comes from the #866
    //     creative library (uploadToSnap) or an explicit top_snap_media_id.
    let topSnapMediaIdS = typeof creativeS.top_snap_media_id === "string"
      ? creativeS.top_snap_media_id.trim()
      : "";
    const creativeLibraryIdS = typeof creativeS.creative_library_id === "string"
      ? creativeS.creative_library_id.trim()
      : "";
    let creativeLibraryRowIdS: string | null = null;
    if (!topSnapMediaIdS && creativeLibraryIdS) {
      const { data: libCreative } = await supabase
        .from("ad_creatives")
        .select("id, kind, content_hash, duration_seconds")
        .eq("id", creativeLibraryIdS)
        .maybeSingle();
      if (!libCreative) {
        return json({ error: "creative_not_found", detail: "creative_library_id does not resolve" }, 422);
      }
      const { data: ref } = await supabase
        .from("ad_creative_platform_refs")
        .select("external_ref, status, content_hash")
        .eq("creative_id", creativeLibraryIdS)
        .eq("platform", "snapchat")
        .eq("lane", lane)
        .eq("external_account_id", sconn.external_account_id)
        .maybeSingle();
      if (!ref || ref.status !== "ready" || !ref.external_ref) {
        return json({
          error: "creative_not_uploaded",
          detail:
            "No READY snapchat platform ref for this creative on this ad account — upload it through the #866 creative library (admin-ad-creative-upload) first; create never uploads inline.",
        }, 422);
      }
      if (ref.content_hash && libCreative.content_hash && ref.content_hash !== libCreative.content_hash) {
        // A1-1 (#866): cache validity keys on CONTENT — a stale ref must never serve.
        return json({
          error: "creative_ref_stale",
          detail:
            "The snapchat platform ref was uploaded from different bytes than the creative's current content_hash — re-upload through the creative library.",
        }, 422);
      }
      if (libCreative.kind === "video" && typeof libCreative.duration_seconds === "number") {
        const durationCheck = validateSnapchatVideoDuration(libCreative.duration_seconds);
        if (!durationCheck.ok) {
          return json({ error: durationCheck.detail, detail: durationCheck.message }, 422);
        }
      }
      topSnapMediaIdS = String(ref.external_ref);
      creativeLibraryRowIdS = String(libCreative.id);
    }
    if (!topSnapMediaIdS) {
      return json({
        error: "validation_error",
        detail:
          "creative_media_required — pass creative.top_snap_media_id (an already-READY Snap media id) or creative.creative_library_id (#866 library).",
      }, 400);
    }

    // ── THE VALIDATE GATE (WP2 report §10, binding): Snapchat has NO
    //    validate-only — the generic validate block calls createCreative
    //    unconditionally, which here would create a REAL media-backed
    //    creative. Return the explicit named-skipped-layers response instead;
    //    ZERO adapter calls. Deleting this gate re-opens the real-object
    //    creation path during "validation". ──────────────────────────────────
    if (validateOnlyS) {
      const reason =
        "snapchat_no_validate_only — the Snap Marketing API has no validate-only mode; attempting to validate would CREATE a real object (WP2 §10). Client-side validators (name/headline/brand/CTA/budget-floor/demographics/destination/media) all passed.";
      return json({
        validated: false,
        validated_layers: [],
        skipped_layers: [
          { layer: "campaign", reason },
          { layer: "ad_squad", reason },
          { layer: "creative", reason },
          { layer: "ad", reason },
        ],
        detail:
          "validate_only — nothing was validated on Snapchat (no validate-only exists), nothing created, nothing persisted. The first real create is the platform-side validation.",
      });
    }

    // (6) The sequential atomic create (§4.4b): campaign → squad → creative →
    //     ad, ALL PAUSED, with compensating rollback (campaign delete does NOT
    //     cascade the ad-account-scoped creative — GR-48; the runner tracks +
    //     attempts both and audits residue).
    const adapterS = getAdapter("snapchat");
    const campaignInputS: CreateCampaignInput & SnapchatCreateCampaignExtensions = {
      name,
      objective: objectiveS,
      ...(budgetLevelS === "campaign" ? { dailyBudgetCents: amountCents as number } : {}),
      ...(typeof spendCapCentsS === "number" ? { spendCapCents: spendCapCentsS } : {}),
      ...(typeof body.promotion_type === "string" ? { promotionType: body.promotion_type } : {}),
    };
    const adSetInputS: CreateAdSetInput = {
      name: `${name} — ad squad`,
      optimizationGoal: optimizationGoalS,
      billingEvent: "IMPRESSION",
      ...(budgetLevelS === "adset" ? { budgetCents: amountCents as number } : {}),
      targeting: {
        countries: countryCodesS,
        demographics: demographicsS,
        budget_mode: "daily",
        bid_strategy: bidStrategyS,
        ...(typeof bidCentsS === "number" ? { bid_cents: bidCentsS } : {}),
        ...(pixelIdS ? { pixel_id: pixelIdS } : {}),
      },
    };
    const creativeInputS: CreateCreativeInput & SnapchatCreateCreativeExtensions = {
      destUrl: destUrlS, // A4.f/A1.1(5): the AD-VISIBLE destination — never the OneLink
      message: headlineS, // interface-required; Snap creatives carry headline, not message
      headline: headlineS,
      callToActionType: ctaS,
      campaignName: name,
      adName: `${name} — ad`,
      topSnapMediaId: topSnapMediaIdS,
      brandName: brandNameS,
      creativeType: "WEB_VIEW",
    };
    const adInputS: Omit<CreateAdInput, "externalCreativeId"> & SnapchatCreateAdExtensions = {
      name: `${name} — ad`,
      creativeType: "WEB_VIEW", // S-2: the map derives type REMOTE_WEBPAGE from this
    };

    try {
      const created = await createFullCampaignAtomic(adapterS, sconn, {
        campaign: campaignInputS,
        adSet: adSetInputS,
        creative: creativeInputS,
        ad: adInputS,
      });

      // Read back BOTH review vocabularies + delivery state (best-effort;
      // the GR-38 sync cron repairs/refreshes them).
      let deliveryStatusS: string | null = null;
      let adReviewStatusS: string | null = created.reviewStatus;
      let reviewDetailS: Record<string, unknown> | null = null;
      try {
        const campaignStatus = await adapterS.getStatus(
          sconn,
          "campaign",
          created.externalCampaignId,
        );
        deliveryStatusS = campaignStatus.effectiveStatus;
      } catch {
        deliveryStatusS = null;
      }
      try {
        const adStatus = await adapterS.getStatus(sconn, "ad", created.externalAdId);
        adReviewStatusS = adStatus.effectiveStatus ?? adReviewStatusS;
        reviewDetailS = buildSnapchatReviewDetail({
          issuesInfo: adStatus.issuesInfo,
          adReviewFeedback: adStatus.adReviewFeedback,
        });
      } catch {
        reviewDetailS = null;
      }

      const snapSmartLink = buildDestSmartLink({
        pageType: pageTypeS,
        brandSlug: brandSlugS,
        entitySlug: entitySlugS || null,
        externalCampaignId: created.externalCampaignId,
        adName: `${name} — ad`,
        platform: "snapchat",
      });
      const targetingRecordS: Record<string, unknown> = {
        countries: countryCodesS,
        demographics: demographicsS, // GR-39: min_age "18" default, strings
      };

      // (7) Persist ONE campaign+ad_set+ad row set (only now that all IDs exist).
      const { data: campaignRowS, error: campaignErrS } = await supabase
        .from("ad_campaigns")
        .insert({
          connection_id: sconn.id,
          platform: "snapchat",
          external_campaign_id: created.externalCampaignId,
          name,
          objective: objectiveS, // the objective_v2_type value (S-1)
          status: "PAUSED",
          daily_budget_cents: budgetLevelS === "campaign" ? amountCents : null,
          delivery_status: deliveryStatusS,
          status_synced_at: new Date().toISOString(),
          targeting: targetingRecordS,
          dest_page_type: pageTypeS,
          dest_brand_slug: brandSlugS,
          dest_entity_slug: entitySlugS || null,
          dest_event_id: destEventIdS,
          dest_url: destUrlS,
          // A4.f-demoted slot: stored for attribution reference, never sent to Snap.
          dest_smart_link: snapSmartLink,
          dest_group_id: destGroupId, // ISSUE-1002: shared fan-out group (NULL for single-destination)
          request_id: requestIdS,
          created_by: user.id,
        })
        .select("*")
        .single();

      let adSetRowS: Record<string, unknown> | null = null;
      let adRowS: Record<string, unknown> | null = null;
      let persistErrS = campaignErrS;
      if (!persistErrS && campaignRowS) {
        const { data, error } = await supabase
          .from("ad_sets")
          .insert({
            campaign_id: campaignRowS.id,
            external_adset_id: created.externalAdSetId,
            name: `${name} — ad squad`,
            targeting: targetingRecordS,
            budget_cents: budgetLevelS === "adset" ? amountCents : null,
            optimization_goal: optimizationGoalS,
            billing_event: "IMPRESSION",
            bid_strategy: bidStrategyS,
            status: "PAUSED",
          })
          .select("*")
          .single();
        adSetRowS = data;
        persistErrS = error;
      }
      if (!persistErrS && adSetRowS) {
        const { data, error } = await supabase
          .from("ads")
          .insert({
            ad_set_id: adSetRowS.id,
            external_ad_id: created.externalAdId,
            external_creative_id: created.externalCreativeId,
            ...(creativeLibraryRowIdS ? { creative_id: creativeLibraryRowIdS } : {}),
            name: `${name} — ad`,
            status: "PAUSED",
            // GR-38: the AD vocabulary (PENDING|APPROVED|REJECTED); the creative
            // vocabulary + reasons + delivery_status live in review_detail.
            review_status: adReviewStatusS,
            review_detail: reviewDetailS,
          })
          .select("*")
          .single();
        adRowS = data;
        persistErrS = error;
      }

      if (persistErrS) {
        // Never a half-written DB row set: delete the campaign row (cascades),
        // roll back the platform chain (creative FIRST — campaign delete does
        // NOT cascade the ad-account-scoped creative, GR-48), then audit.
        if (campaignRowS) await supabase.from("ad_campaigns").delete().eq("id", campaignRowS.id);
        let creativeRollbackOkS: boolean | null = null;
        if (created.externalCreativeId && adapterS.rollbackCreative) {
          try {
            await adapterS.rollbackCreative(sconn, created.externalCreativeId);
            creativeRollbackOkS = true;
          } catch {
            creativeRollbackOkS = false; // residue — id recorded below
          }
        } else if (created.externalCreativeId) {
          creativeRollbackOkS = false;
        }
        let rollbackOkS = false;
        try {
          if (adapterS.rollbackCampaign) {
            await adapterS.rollbackCampaign(sconn, created.externalCampaignId);
            rollbackOkS = true;
          }
        } catch {
          rollbackOkS = false;
        }
        await supabase.from("ad_status_events").insert({
          campaign_id: null,
          platform: "snapchat",
          entity: "campaign",
          action: rollbackOkS && creativeRollbackOkS !== false ? "rollback" : "create_failed",
          actor: user.id,
          to_status: null,
          external_ids: {
            external_campaign_id: created.externalCampaignId,
            external_adset_id: created.externalAdSetId,
            external_creative_id: created.externalCreativeId,
            external_ad_id: created.externalAdId,
            // GR-48: the media id is tracked for reconciliation too (library
            // media is a durable #866 asset — recorded, never deleted here).
            external_media_id: topSnapMediaIdS,
          },
          provider_response: {
            db_error: persistErrS.message,
            ...(creativeRollbackOkS === false
              ? { creative_residue_id: created.externalCreativeId }
              : {}),
          },
        });
        console.error("[admin-ad-create-campaign] snapchat persist failed:", persistErrS.message);
        return json({ error: "internal_error", detail: "db_persist_failed_platform_rolled_back" }, 500);
      }

      await supabase.from("ad_status_events").insert({
        campaign_id: campaignRowS.id,
        platform: "snapchat",
        entity: "campaign",
        action: "create",
        actor: user.id,
        from_status: null,
        to_status: "PAUSED",
        external_ids: {
          external_campaign_id: created.externalCampaignId,
          external_adset_id: created.externalAdSetId,
          external_creative_id: created.externalCreativeId,
          external_ad_id: created.externalAdId,
          external_media_id: topSnapMediaIdS,
        },
        provider_response: null,
      });

      return json({ campaign: campaignRowS, ad_set: adSetRowS, ad: adRowS });
    } catch (err) {
      if (err instanceof AdNotConnectedError) {
        // A1.2-8 defense-in-depth: the adapter re-checks the profile config.
        return json(
          { error: err.detail === "snapchat_profile_missing" ? "snapchat_profile_missing" : "snapchat_not_connected" },
          424,
        );
      }
      if (err instanceof AtomicCreateError) {
        // §4.4b partial-failure contract: NO ad_* rows; compensating cleanup
        // already attempted (creative first — GR-48); audit for reconciliation.
        const failure = err.failure;
        const providerResponseS = failure.cause instanceof AdApiError
          ? failure.cause.toJSON()
          : {
            message: failure.cause instanceof Error
              ? failure.cause.message
              : String(failure.cause),
          };
        const creativeResidueS = failure.creativeRollbackSucceeded === false
          ? { creative_residue_id: failure.partialExternalIds.external_creative_id ?? null }
          : {};
        const fullyRolledBackS = failure.rollbackSucceeded !== false &&
          failure.creativeRollbackSucceeded !== false;
        await supabase.from("ad_status_events").insert({
          campaign_id: null,
          platform: "snapchat",
          entity: "campaign",
          action: fullyRolledBackS && failure.rollbackSucceeded === true
            ? "rollback"
            : "create_failed",
          actor: user.id,
          external_ids: {
            ...failure.partialExternalIds,
            external_media_id: topSnapMediaIdS,
          },
          provider_response: { step: failure.step, ...providerResponseS, ...creativeResidueS },
        });
        return json({
          error: "snapchat_create_failed",
          detail: providerResponseS,
          step: failure.step,
          rolled_back: failure.rollbackSucceeded,
          creative_rolled_back: failure.creativeRollbackSucceeded,
        }, 502);
      }
      if (err instanceof AdApiError) {
        return json({ error: "snapchat_create_failed", detail: err.toJSON() }, 502);
      }
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[admin-ad-create-campaign] snapchat unexpected:", detail);
      return json({ error: "internal_error" }, 500);
    }
  }

  // ══ TIKTOK branch (ISSUE-927; SPEC_ISSUE-863 §4.4(b) as corrected by A1) ═══
  // Self-contained (house pattern) so the Meta path stays byte-identical:
  // validators (422s) → connection + identity fail-close (424) → idempotent
  // replay → destination resolve → media resolve → THE VALIDATE GATE (TikTok
  // has NO validate-only mode — the generic block would create REAL objects;
  // named-skipped-layers instead, zero adapter calls) → LIVE geo resolve
  // (A1.1(e): tool/region per objective, fail LOUD on unavailable countries —
  // GB is live-proven absent, T-P2) → image upload (GR-58) → the atomic
  // create (campaign → ad group → no-op creative → ad, operation_status=
  // DISABLE at ALL THREE levels — A1.0-4) → persist → audit. Budget floors
  // run in DOLLARS after the ÷100 conversion (A1.0-1: $20/day ad group,
  // $50/day CBO campaign); bid_type under CBO defaults in the builder
  // (A1.1(b)); schedule_start_time defaults to now in UTC+0 (A1.1(a)).
  if (platform === "tiktok") {
    const requestIdT = typeof body.request_id === "string" && body.request_id.trim()
      ? body.request_id.trim()
      : null;
    const validateOnlyT = body.validate_only === true;

    // (1) Pure input validation — all 400/422s BEFORE any provider call.
    const nameCheckT = validateTikTokName(name, "campaign_name");
    if (!nameCheckT.ok) return json({ error: nameCheckT.detail, detail: nameCheckT.message }, 422);

    const objectiveT = typeof body.objective === "string" ? body.objective : "TRAFFIC";
    const objectiveCheckT = validateTikTokObjective(objectiveT);
    if (!objectiveCheckT.ok) {
      return json({ error: objectiveCheckT.detail, detail: objectiveCheckT.message }, 422);
    }
    // A1.0-6: no conversion optimization until #865 — the pixel has ZERO
    // events (T-P4); optimizing to an event we don't send means no delivery.
    if (TIKTOK_PIXEL_GATED_OBJECTIVES.includes(objectiveT)) {
      return json({
        error: "pixel_goal_unavailable",
        detail:
          `${objectiveT} is pixel-measured and the TikTok pixel sends no events yet (#865 owns the install — T-P4). Use TRAFFIC until the pixel fires.`,
      }, 422);
    }

    const optimizationGoalT = typeof body.optimization_goal === "string"
      ? body.optimization_goal
      : "TRAFFIC_LANDING_PAGE_VIEW"; // A1.0-6 default
    if (!(TIKTOK_OPTIMIZATION_GOALS as readonly string[]).includes(optimizationGoalT)) {
      return json({
        error: "invalid_optimization_goal",
        detail: `optimization_goal "${optimizationGoalT}" is invalid — valid: ${
          TIKTOK_OPTIMIZATION_GOALS.join(" | ")
        }.`,
      }, 422);
    }
    const billingEventT = typeof body.billing_event === "string" ? body.billing_event : "CPC";
    if (!(TIKTOK_BILLING_EVENTS as readonly string[]).includes(billingEventT)) {
      return json({
        error: "validation_error",
        detail: `billing_event "${billingEventT}" is invalid — valid: ${
          TIKTOK_BILLING_EVENTS.join(" | ")
        }.`,
      }, 422);
    }

    // Budget level (OD-3 analog): ABO (ad group, ≥$20/day) default; CBO
    // (campaign, ≥$50/day) on budget.level === "campaign". THE one cents→
    // dollars conversion is centsToPlatformBudget; floors AFTER it (A1.0-1).
    const budgetLevelT = budget.level === "campaign" ? "campaign" : "adset";
    const dollarsT = centsToPlatformBudget("tiktok", amountCents as number);
    const floorCheckT = validateTikTokBudgetFloor({
      level: budgetLevelT === "campaign" ? "campaign" : "ad_group",
      mode: "daily",
      dollars: dollarsT,
    });
    if (!floorCheckT.ok) {
      // AC-3 (amended): min-check after conversion, before any provider write.
      return json({ error: floorCheckT.detail, detail: floorCheckT.message }, 422);
    }

    // Bidding (A1.1(b)): bid_type is optional here — under CBO the builder
    // defaults BID_TYPE_NO_BID; bid_price rides only with BID_TYPE_CUSTOM.
    const bidTypeT = typeof budget.bid_type === "string" ? budget.bid_type : undefined;
    const bidPriceCentsRawT = budget.bid_price_cents;
    if (
      bidPriceCentsRawT !== undefined &&
      (!Number.isInteger(bidPriceCentsRawT) || (bidPriceCentsRawT as number) <= 0)
    ) {
      return json({ error: "validation_error", detail: "bid_price_cents_invalid" }, 400);
    }
    const bidPriceCentsT = bidPriceCentsRawT as number | undefined;

    const creativeT = (body.creative ?? {}) as Record<string, unknown>;
    // ISSUE-979 Bug 3: the global compliance intent reaches TikTok's create path
    // now. TikTok's aigc_disclosure_type is CUSTOMIZED_USER-only (unreachable,
    // T-P6) and it has no special-ad-category field — documented + observable,
    // never silently dropped.
    documentComplianceDrop("tiktok", body.compliance);
    const adTextT = typeof creativeT.ad_text === "string"
      ? creativeT.ad_text.trim()
      : typeof creativeT.message === "string"
      ? creativeT.message.trim()
      : "";
    const adTextCheckT = validateTikTokAdText(adTextT);
    if (!adTextCheckT.ok) {
      // AC-14: >100 weighted chars / emoji rejected edge-side, pre-call.
      return json({ error: adTextCheckT.detail, detail: adTextCheckT.message }, 422);
    }

    const targetingT = (body.targeting ?? {}) as Record<string, unknown>;
    const countriesT = targetingT.countries;
    if (
      !Array.isArray(countriesT) || countriesT.length === 0 ||
      countriesT.some((c) => typeof c !== "string" || !c.trim())
    ) {
      return json({ error: "validation_error", detail: "targeting_countries_required" }, 400);
    }
    const countryCodesT = (countriesT as string[]).map((c) => c.trim().toUpperCase());
    const genderT = typeof targetingT.gender === "string" ? targetingT.gender : undefined;
    if (genderT !== undefined && !(TIKTOK_GENDERS as readonly string[]).includes(genderT)) {
      return json({
        error: "validation_error",
        detail: `gender "${genderT}" is invalid — valid: ${TIKTOK_GENDERS.join(" | ")}.`,
      }, 422);
    }
    const ageMinT = typeof targetingT.age_min === "number" ? targetingT.age_min : undefined;
    const ageMaxT = typeof targetingT.age_max === "number" ? targetingT.age_max : undefined;
    // ISSUE-989 — city location_ids (resolved via admin-ad-targeting-search
    // tool/region CITY filter) targeting laser city audiences; when present they
    // REPLACE the whole-country resolution below. Numeric ids only (never ISO
    // codes) — validated here so a malformed id 422s instead of silently widening.
    const cityLocationIdsT = Array.isArray(targetingT.location_ids)
      ? (targetingT.location_ids as unknown[]).filter((id): id is string => typeof id === "string")
      : [];
    if (cityLocationIdsT.length > 0) {
      const cityCheck = validateTikTokLocationIds(cityLocationIdsT);
      if (!cityCheck.ok) {
        return json({ error: cityCheck.detail, detail: cityCheck.message }, 422);
      }
    }
    // ISSUE-989 — interest_category_ids from tool/interest_category (numeric,
    // deduped, capped). Empty when none picked → broad targeting unchanged.
    const interestCategoryIdsT = normalizeTikTokInterestCategoryIds(targetingT.interest_category_ids);

    const destinationT = pickCallDestination(body); // ISSUE-1002: singular or destinations[0]
    const pageTypeT = destinationT.page_type ?? "";
    const brandSlugT = typeof destinationT.brand_slug === "string"
      ? destinationT.brand_slug.trim()
      : "";
    const entitySlugT = typeof destinationT.entity_slug === "string"
      ? destinationT.entity_slug.trim()
      : "";
    if (!["event", "trip", "brand", "venue"].includes(pageTypeT)) {
      return json({ error: "validation_error", detail: "destination_page_type_invalid" }, 400);
    }
    if (!brandSlugT) {
      return json({ error: "validation_error", detail: "destination_brand_slug_required" }, 400);
    }

    // CTA: TikTok CTAs are bare display strings (never a shared normalizer —
    // GR-29); reservation-traffic defaults from the per-platform map.
    const ctaT = typeof creativeT.call_to_action === "string"
      ? creativeT.call_to_action
      : pageTypeT === "event"
      ? TIKTOK_CTA_MAP.ticketed_event
      : TIKTOK_CTA_MAP.default;

    // (2) Connection (fail-close) — 424 tiktok_not_connected.
    const { data: tconnRow } = await supabase
      .from("ad_connections")
      .select("*")
      .eq("platform", "tiktok")
      .eq("lane", lane)
      .maybeSingle();
    if (!tconnRow || !tconnRow.connected || tconnRow.status !== "connected") {
      return json({ error: "tiktok_not_connected" }, 424);
    }
    const tconn = tconnRow as unknown as AdConnectionRow;
    const tconnExtra = (tconn.extra ?? {}) as Record<string, unknown>;

    // (3) Identity fail-close BEFORE any create (T-6/AC-12): the adapter only
    // asserts identity at the AD step — post-campaign, mid-chain. Gate here so
    // a broken identity config never creates-then-rolls-back.
    const identityTypeT = typeof tconnExtra.identity_type === "string"
      ? tconnExtra.identity_type
      : "TT_USER";
    try {
      assertTikTokIdentityAllowed(identityTypeT);
    } catch (err) {
      if (err instanceof AdApiError) {
        return json({ error: err.code ?? "identity_forbidden", detail: err.message }, 422);
      }
      throw err;
    }
    const identityIdT = typeof tconnExtra.identity_id === "string"
      ? tconnExtra.identity_id.trim()
      : "";
    if (!identityIdT) {
      return json({
        error: "tiktok_identity_missing",
        detail:
          "The connection carries no identity_id (extra.identity_id) — TikTok ad create requires an identity (TT_USER @usemingla — T-6). Re-run admin-ad-connect to capture it.",
      }, 424);
    }

    // Idempotency (A3 §A request_id): replay returns the existing row.
    if (requestIdT && !validateOnlyT) {
      const { data: existingT } = await supabase
        .from("ad_campaigns")
        .select("*")
        .eq("connection_id", tconn.id)
        .eq("request_id", requestIdT)
        .maybeSingle();
      if (existingT) return json({ campaign: existingT, idempotent_replay: true });
    }

    // (4) Destination resolve — READ-ONLY, public + live only (§4.4b).
    let destUrlT: string;
    let destEventIdT: string | null = null;
    if (pageTypeT === "event") {
      if (!entitySlugT) {
        return json({ error: "validation_error", detail: "destination_entity_slug_required" }, 400);
      }
      const { data: eventRow } = await supabase
        .from("business_public_events_view")
        .select("id, brand_slug, slug, status")
        .eq("brand_slug", brandSlugT)
        .eq("slug", entitySlugT)
        .in("status", ["scheduled", "live"])
        .maybeSingle();
      if (!eventRow) return json({ error: "destination_not_public" }, 422);
      destUrlT = `${BUSINESS_WEB_ORIGIN}/e/${brandSlugT}/${entitySlugT}`;
      destEventIdT = String(eventRow.id);
    } else if (pageTypeT === "brand") {
      const { data: brandRow } = await supabase
        .from("business_public_brands_view")
        .select("id, slug")
        .eq("slug", brandSlugT)
        .maybeSingle();
      if (!brandRow) return json({ error: "destination_not_public" }, 422);
      destUrlT = `${BUSINESS_WEB_ORIGIN}/b/${brandSlugT}`;
    } else {
      return json({ error: "destination_not_public", detail: "dest_page_type_not_supported_wp1" }, 422);
    }
    // A1.0-5 (PROOF D-P1): the ad-visible landing_page_url is the canonical
    // page — NEVER the OneLink; attribution rides in utm_params.
    const landingCheckT = validateTikTokLandingPageUrl(destUrlT);
    if (!landingCheckT.ok) {
      return json({ error: landingCheckT.detail, detail: landingCheckT.message }, 422);
    }

    // (5) Media resolve — an explicit Asset-Library image_id, a #866 library
    // ref (external_ref_extra.image_id), or an image_url to upload AFTER the
    // validate gate (UPLOAD_BY_URL — GR-58).
    let imageIdT = typeof creativeT.image_id === "string" ? creativeT.image_id.trim() : "";
    const creativeLibraryIdT = typeof creativeT.creative_library_id === "string"
      ? creativeT.creative_library_id.trim()
      : "";
    const imageUrlT = typeof creativeT.image_url === "string" ? creativeT.image_url.trim() : "";
    let creativeLibraryRowIdT: string | null = null;
    if (!imageIdT && creativeLibraryIdT) {
      const { data: libCreativeT } = await supabase
        .from("ad_creatives")
        .select("id, kind, content_hash")
        .eq("id", creativeLibraryIdT)
        .maybeSingle();
      if (!libCreativeT) {
        return json({ error: "creative_not_found", detail: "creative_library_id does not resolve" }, 422);
      }
      const { data: refT } = await supabase
        .from("ad_creative_platform_refs")
        .select("external_ref, external_ref_extra, status, content_hash")
        .eq("creative_id", creativeLibraryIdT)
        .eq("platform", "tiktok")
        .eq("lane", lane)
        .eq("external_account_id", tconn.external_account_id)
        .maybeSingle();
      if (!refT || refT.status !== "ready" || !refT.external_ref) {
        return json({
          error: "creative_not_uploaded",
          detail:
            "No READY tiktok platform ref for this creative on this advertiser — upload it through the #866 creative library (admin-ad-creative-upload) first, or pass creative.image_url for a create-time UPLOAD_BY_URL.",
        }, 422);
      }
      if (refT.content_hash && libCreativeT.content_hash && refT.content_hash !== libCreativeT.content_hash) {
        return json({
          error: "creative_ref_stale",
          detail:
            "The tiktok platform ref was uploaded from different bytes than the creative's current content_hash — re-upload through the creative library.",
        }, 422);
      }
      // #866 keys external_ref = material_id; ad/create needs the image_id
      // secondary ref (A1-9 captures BOTH).
      const refExtraT = (refT.external_ref_extra ?? {}) as Record<string, unknown>;
      const refImageIdT = typeof refExtraT.image_id === "string" ? refExtraT.image_id : "";
      if (!refImageIdT) {
        return json({
          error: "creative_ref_incomplete",
          detail:
            "The tiktok platform ref carries no external_ref_extra.image_id (ad/create needs the image_id, not the material_id) — re-upload through the creative library.",
        }, 422);
      }
      imageIdT = refImageIdT;
      creativeLibraryRowIdT = String(libCreativeT.id);
    }
    if (!imageIdT && !imageUrlT) {
      return json({
        error: "validation_error",
        detail:
          "creative_media_required — pass creative.image_id (Asset-Library id), creative.creative_library_id (#866 library), or creative.image_url (create-time UPLOAD_BY_URL).",
      }, 400);
    }

    // ── THE VALIDATE GATE: TikTok has NO validate-only / dry-run mode — the
    //    generic validate block calls createCampaign unconditionally, which
    //    here would create a REAL (paused) campaign. Return the explicit
    //    named-skipped-layers response instead; ZERO adapter calls, ZERO
    //    uploads. (Snapchat precedent: WP2 §10.) ────────────────────────────
    if (validateOnlyT) {
      const reasonT =
        "tiktok_no_validate_only — the TikTok Marketing API has no validate-only mode; attempting to validate would CREATE real objects. Client-side validators (name/objective/goal/billing/budget-floor/ad-text/gender/destination/media/identity) all passed.";
      return json({
        validated: false,
        validated_layers: [],
        skipped_layers: [
          { layer: "campaign", reason: reasonT },
          { layer: "ad_group", reason: reasonT },
          { layer: "ad", reason: reasonT },
        ],
        detail:
          "validate_only — nothing was validated on TikTok (no validate-only exists), nothing created, nothing persisted. The first real create is the platform-side validation.",
      });
    }

    const adapterT = getAdapter("tiktok");
    try {
      // (6) Geo resolve. ISSUE-989: when the builder picked specific cities
      // (resolved location_ids), target THOSE directly — a laser city audience.
      // Otherwise fall back to the LIVE per-country resolve (A1.1(e)/T-5 — OD-7
      // REVERSED): tool/region per objective; an unavailable country (GB today —
      // T-P2) fails LOUD 422.
      let locationIdsT: string[];
      if (cityLocationIdsT.length > 0) {
        locationIdsT = cityLocationIdsT;
      } else {
        try {
          locationIdsT = await resolveTikTokGeo(tconn, countryCodesT, objectiveT);
        } catch (err) {
          if (err instanceof AdApiError && err.code === "geo_unavailable") {
            // AC-13: 422 naming the unavailable countries — never a silent drop.
            return json({ error: "geo_unavailable", detail: err.message }, 422);
          }
          throw err;
        }
      }

      // (7) Image upload when the create-time URL path is used (GR-58:
      // UPLOAD_BY_URL, unique per-advertiser file name, both ids captured).
      if (!imageIdT) {
        const uploaded = await tiktokUploadImage(tconn, imageUrlT);
        imageIdT = uploaded.imageId;
      }

      // (8) The atomic create (§4.4b): campaign → ad group → creative (the
      // documented NO-OP — TikTok creatives are inline in ad/create) → ad,
      // operation_status=DISABLE at ALL THREE levels (A1.0-4), with
      // compensating rollback (campaign DELETE cascades — §4.4b).
      const campaignInputT: CreateCampaignInput = {
        name,
        objective: objectiveT,
        // CBO ⇒ budget on the campaign ($50/day floor in the builder).
        ...(budgetLevelT === "campaign" ? { dailyBudgetCents: amountCents as number } : {}),
      };
      const adSetInputT: CreateAdSetInput = {
        name: `${name} — ad group`,
        optimizationGoal: optimizationGoalT,
        billingEvent: billingEventT,
        ...(budgetLevelT === "adset" ? { budgetCents: amountCents as number } : {}),
        targeting: {
          location_ids: locationIdsT,
          ...(interestCategoryIdsT.length > 0 ? { interest_category_ids: interestCategoryIdsT } : {}),
          ...(ageMinT !== undefined ? { age_min: ageMinT } : {}),
          ...(ageMaxT !== undefined ? { age_max: ageMaxT } : {}),
          ...(genderT ? { gender: genderT } : {}),
          budget_mode: "daily",
          // A1.1(b): bid_type REQUIRED under CBO — the builder defaults
          // BID_TYPE_NO_BID; campaign-level bid_type is deprecated in v1.3.
          campaign_budget_optimize_on: budgetLevelT === "campaign",
          ...(budgetLevelT === "campaign" ? { campaign_budget_cents: amountCents as number } : {}),
          ...(bidTypeT ? { bid_type: bidTypeT } : {}),
          ...(typeof bidPriceCentsT === "number" ? { bid_price_cents: bidPriceCentsT } : {}),
          ...(requestIdT ? { request_id: requestIdT } : {}),
          // schedule_start_time defaults to NOW in UTC+0 inside the builder
          // (A1.1(a): TikTok schedule strings are UTC+0, never advertiser-tz).
        },
      };
      const creativeInputT: CreateCreativeInput = {
        destUrl: destUrlT, // interface-required; TikTok's createCreative is a documented no-op
        message: adTextT,
      };
      const adInputT: Omit<CreateAdInput, "externalCreativeId"> & TikTokCreateAdExtensions = {
        name: `${name} — ad`,
        adText: adTextT,
        imageIds: [imageIdT],
        // A1.0-5: the canonical page is the ad-visible URL; attribution rides
        // utm_params (≤14, case-sensitive keys, TikTok serve-time macros).
        landingPageUrl: destUrlT,
        identityType: identityTypeT,
        identityId: identityIdT,
        callToAction: ctaT,
        utmParams: [
          { key: "utm_source", value: "tiktok" },
          { key: "utm_medium", value: "paid" },
          { key: "utm_campaign", value: "__CAMPAIGN_ID__" },
          { key: "utm_content", value: "__CID__" },
        ],
      };

      const createdT = await createFullCampaignAtomic(adapterT, tconn, {
        campaign: campaignInputT,
        adSet: adSetInputT,
        creative: creativeInputT,
        ad: adInputT,
      });

      // Best-effort delivery read-back (the two-status rule: the SECONDARY
      // status is the real state; the GR-38 sync cron repairs/refreshes).
      let deliveryStatusT: string | null = null;
      try {
        const statusT = await adapterT.getStatus(tconn, "campaign", createdT.externalCampaignId);
        deliveryStatusT = statusT.effectiveStatus;
      } catch {
        deliveryStatusT = null;
      }

      const tiktokSmartLink = buildDestSmartLink({
        pageType: pageTypeT,
        brandSlug: brandSlugT,
        entitySlug: entitySlugT || null,
        externalCampaignId: createdT.externalCampaignId,
        adName: `${name} — ad`,
        platform: "tiktok",
      });
      const targetingRecordT: Record<string, unknown> = {
        countries: countryCodesT,
        location_ids: locationIdsT, // resolved numeric ids persisted (T-5)
        ...(cityLocationIdsT.length > 0 ? { city_targeted: true } : {}),
        ...(interestCategoryIdsT.length > 0 ? { interest_category_ids: interestCategoryIdsT } : {}),
        ...(ageMinT !== undefined ? { age_min: ageMinT } : {}),
        ...(ageMaxT !== undefined ? { age_max: ageMaxT } : {}),
        ...(genderT ? { gender: genderT } : {}),
      };

      // (9) Persist ONE campaign+ad_set+ad row set (only now that all IDs exist).
      const { data: campaignRowT, error: campaignErrT } = await supabase
        .from("ad_campaigns")
        .insert({
          connection_id: tconn.id,
          platform: "tiktok",
          external_campaign_id: createdT.externalCampaignId,
          name,
          objective: objectiveT,
          status: "PAUSED",
          daily_budget_cents: budgetLevelT === "campaign" ? amountCents : null,
          delivery_status: deliveryStatusT,
          status_synced_at: new Date().toISOString(),
          targeting: targetingRecordT,
          dest_page_type: pageTypeT,
          dest_brand_slug: brandSlugT,
          dest_entity_slug: entitySlugT || null,
          dest_event_id: destEventIdT,
          dest_url: destUrlT,
          // A4.f-demoted slot: stored for attribution reference, never sent to TikTok.
          dest_smart_link: tiktokSmartLink,
          dest_group_id: destGroupId, // ISSUE-1002: shared fan-out group (NULL for single-destination)
          request_id: requestIdT,
          created_by: user.id,
        })
        .select("*")
        .single();

      let adSetRowT: Record<string, unknown> | null = null;
      let adRowT: Record<string, unknown> | null = null;
      let persistErrT = campaignErrT;
      if (!persistErrT && campaignRowT) {
        const { data, error } = await supabase
          .from("ad_sets")
          .insert({
            campaign_id: campaignRowT.id,
            external_adset_id: createdT.externalAdSetId,
            name: `${name} — ad group`,
            targeting: targetingRecordT,
            budget_cents: budgetLevelT === "adset" ? amountCents : null,
            optimization_goal: optimizationGoalT,
            billing_event: billingEventT,
            ...(bidTypeT ? { bid_strategy: bidTypeT } : {}),
            status: "PAUSED",
          })
          .select("*")
          .single();
        adSetRowT = data;
        persistErrT = error;
      }
      if (!persistErrT && adSetRowT) {
        const { data, error } = await supabase
          .from("ads")
          .insert({
            ad_set_id: adSetRowT.id,
            external_ad_id: createdT.externalAdId,
            external_creative_id: null, // TikTok creatives are inline — no standalone object
            ...(creativeLibraryRowIdT ? { creative_id: creativeLibraryRowIdT } : {}),
            name: `${name} — ad`,
            status: "PAUSED",
            review_status: createdT.reviewStatus, // null — sync ingests review states (fast-follow)
          })
          .select("*")
          .single();
        adRowT = data;
        persistErrT = error;
      }

      if (persistErrT) {
        // Never a half-written DB row set: delete the campaign row (cascades)
        // and roll back the platform campaign (DELETE cascades adgroup/ad; no
        // account-level creative residue exists — TikTok inlines it), then audit.
        if (campaignRowT) await supabase.from("ad_campaigns").delete().eq("id", campaignRowT.id);
        let rollbackOkT = false;
        try {
          if (adapterT.rollbackCampaign) {
            await adapterT.rollbackCampaign(tconn, createdT.externalCampaignId);
            rollbackOkT = true;
          }
        } catch {
          rollbackOkT = false;
        }
        await supabase.from("ad_status_events").insert({
          campaign_id: null,
          platform: "tiktok",
          entity: "campaign",
          action: rollbackOkT ? "rollback" : "create_failed",
          actor: user.id,
          to_status: null,
          external_ids: {
            external_campaign_id: createdT.externalCampaignId,
            external_adset_id: createdT.externalAdSetId,
            external_ad_id: createdT.externalAdId,
            external_image_id: imageIdT, // Asset-Library media is durable — recorded, never deleted here
          },
          provider_response: { db_error: persistErrT.message },
        });
        console.error("[admin-ad-create-campaign] tiktok persist failed:", persistErrT.message);
        return json({ error: "internal_error", detail: "db_persist_failed_platform_rolled_back" }, 500);
      }

      await supabase.from("ad_status_events").insert({
        campaign_id: campaignRowT.id,
        platform: "tiktok",
        entity: "campaign",
        action: "create",
        actor: user.id,
        from_status: null,
        to_status: "PAUSED",
        external_ids: {
          external_campaign_id: createdT.externalCampaignId,
          external_adset_id: createdT.externalAdSetId,
          external_ad_id: createdT.externalAdId,
          external_image_id: imageIdT,
        },
        provider_response: null,
      });

      return json({ campaign: campaignRowT, ad_set: adSetRowT, ad: adRowT });
    } catch (err) {
      if (err instanceof AdNotConnectedError) {
        return json({ error: "tiktok_not_connected" }, 424);
      }
      if (err instanceof AtomicCreateError) {
        // §4.4b partial-failure contract: NO ad_* rows; compensating cleanup
        // already attempted (campaign DELETE cascades); audit for reconciliation.
        const failureT = err.failure;
        const providerResponseT = failureT.cause instanceof AdApiError
          ? failureT.cause.toJSON()
          : {
            message: failureT.cause instanceof Error
              ? failureT.cause.message
              : String(failureT.cause),
          };
        await supabase.from("ad_status_events").insert({
          campaign_id: null,
          platform: "tiktok",
          entity: "campaign",
          action: failureT.rollbackSucceeded === true ? "rollback" : "create_failed",
          actor: user.id,
          external_ids: {
            ...failureT.partialExternalIds,
            ...(imageIdT ? { external_image_id: imageIdT } : {}),
          },
          provider_response: { step: failureT.step, ...providerResponseT },
        });
        return json({
          error: "tiktok_create_failed",
          detail: providerResponseT,
          step: failureT.step,
          rolled_back: failureT.rollbackSucceeded,
        }, 502);
      }
      if (err instanceof AdApiError) {
        // Pre-chain provider failure (geo read / image upload) — nothing created.
        return json({ error: "tiktok_create_failed", detail: err.toJSON() }, 502);
      }
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[admin-ad-create-campaign] tiktok unexpected:", detail);
      return json({ error: "internal_error" }, 500);
    }
  }

  // ══ REDDIT branch (ISSUE-927; SPEC_ISSUE-REDDIT_CHANNEL §3 / §7) ═══════════
  // Self-contained (house pattern): validators (422s — copy caps, Title-Case
  // CTA enum, destination policy incl. the OneLink/bridge-page ban) →
  // connection + extras fail-close (424) → idempotent replay → destination
  // resolve → THE VALIDATE GATE (Reddit has NO validate-only — §9: the first
  // real create is the platform-side proof; named-skipped-layers, zero
  // adapter calls) → redditCreateFullChain (campaign → ad group → structured-
  // post job → ad; configured_status:"PAUSED" EXPLICIT at all three levels —
  // G-1, Reddit's schema default is ACTIVE = live spend; conversion_pixel_id
  // injected UNCONDITIONALLY on the ad group — GR-12) → persist → audit. A
  // mid-chain failure PATCHes configured_status:"DELETED" in reverse order
  // and records any orphaned t3_ post (§7.1/§7.2).
  if (platform === "reddit") {
    const requestIdR = typeof body.request_id === "string" && body.request_id.trim()
      ? body.request_id.trim()
      : null;
    const validateOnlyR = body.validate_only === true;

    // (1) Pure input validation — all 422s BEFORE any provider call.
    if (name.length < REDDIT_NAME_MIN || name.length > REDDIT_NAME_MAX) {
      return json({
        error: "name_out_of_range",
        detail: `Campaign name must be ${REDDIT_NAME_MIN}–${REDDIT_NAME_MAX} chars [SPEC].`,
      }, 422);
    }
    const objectiveInputR = typeof body.objective === "string" ? body.objective : "TRAFFIC";
    const objectiveR = normalizeRedditObjective(objectiveInputR);
    if (!objectiveR.ok) {
      return json({ error: objectiveR.detail, detail: objectiveR.message }, 422);
    }

    const targetingR = (body.targeting ?? {}) as Record<string, unknown>;
    const countriesR = targetingR.countries;
    if (
      !Array.isArray(countriesR) || countriesR.length === 0 ||
      countriesR.some((c) => typeof c !== "string" || !c.trim())
    ) {
      return json({ error: "validation_error", detail: "targeting_countries_required" }, 400);
    }
    const countryCodesR = (countriesR as string[]).map((c) => c.trim().toUpperCase());
    const passthroughRootR = (targetingR.passthrough ?? {}) as Record<string, unknown>;
    const redditPassthroughR = (passthroughRootR.reddit ?? null) as
      | Record<string, unknown>
      | null;

    const destinationR = pickCallDestination(body); // ISSUE-1002: singular or destinations[0]
    const pageTypeR = destinationR.page_type ?? "";
    const brandSlugR = typeof destinationR.brand_slug === "string"
      ? destinationR.brand_slug.trim()
      : "";
    const entitySlugR = typeof destinationR.entity_slug === "string"
      ? destinationR.entity_slug.trim()
      : "";
    if (!["event", "trip", "brand", "venue"].includes(pageTypeR)) {
      return json({ error: "validation_error", detail: "destination_page_type_invalid" }, 400);
    }
    if (!brandSlugR) {
      return json({ error: "validation_error", detail: "destination_brand_slug_required" }, 400);
    }

    const creativeR = (body.creative ?? {}) as Record<string, unknown>;
    // ISSUE-979 Bug 3: the global compliance intent reaches Reddit's create path
    // now. Reddit has no AI-disclosure and no special-ad-category field —
    // documented + observable, never silently dropped.
    documentComplianceDrop("reddit", body.compliance);
    const headlineR = typeof creativeR.headline === "string"
      ? creativeR.headline.trim()
      : typeof creativeR.message === "string"
      ? creativeR.message.trim()
      : "";
    if (!headlineR) {
      return json({ error: "validation_error", detail: "creative_headline_required" }, 400);
    }
    const imageUrlR = typeof creativeR.image_url === "string" ? creativeR.image_url.trim() : "";
    if (!imageUrlR) {
      return json({
        error: "validation_error",
        detail:
          "creative_media_required — Reddit v1 is the IMAGE structured-post variant; pass creative.image_url (a public master URL — Reddit downloads and rehosts, §5.5).",
      }, 400);
    }
    // §5.1 (GR-29): Reddit CTAs are Title-Case display strings, VERBATIM —
    // never uppercased, never shared with another channel's normalizer.
    const ctaR = typeof creativeR.call_to_action === "string"
      ? creativeR.call_to_action
      : pageTypeR === "event"
      ? REDDIT_CTA_MAP.ticketed_event
      : REDDIT_CTA_MAP.default;

    // (2) Connection (fail-close) — 424 reddit_not_connected; the chain also
    // requires the §1.4 extras (profile / funding instrument / pixel).
    const { data: rconnRow } = await supabase
      .from("ad_connections")
      .select("*")
      .eq("platform", "reddit")
      .eq("lane", lane)
      .maybeSingle();
    if (!rconnRow || !rconnRow.connected || rconnRow.status !== "connected") {
      return json({ error: "reddit_not_connected" }, 424);
    }
    const rconn = rconnRow as unknown as AdConnectionRow;
    try {
      redditConnExtras(rconn); // fail-close: 424 with the re-connect instruction
    } catch (err) {
      if (err instanceof AdApiError) {
        return json({ error: "reddit_connection_incomplete", detail: err.message }, 424);
      }
      throw err;
    }

    // Idempotency (A3 §A request_id): replay returns the existing row.
    if (requestIdR && !validateOnlyR) {
      const { data: existingR } = await supabase
        .from("ad_campaigns")
        .select("*")
        .eq("connection_id", rconn.id)
        .eq("request_id", requestIdR)
        .maybeSingle();
      if (existingR) return json({ campaign: existingR, idempotent_replay: true });
    }

    // (3) Destination resolve — READ-ONLY, public + live only (§4.4b).
    let destUrlR: string;
    let destEventIdR: string | null = null;
    if (pageTypeR === "event") {
      if (!entitySlugR) {
        return json({ error: "validation_error", detail: "destination_entity_slug_required" }, 400);
      }
      const { data: eventRow } = await supabase
        .from("business_public_events_view")
        .select("id, brand_slug, slug, status")
        .eq("brand_slug", brandSlugR)
        .eq("slug", entitySlugR)
        .in("status", ["scheduled", "live"])
        .maybeSingle();
      if (!eventRow) return json({ error: "destination_not_public" }, 422);
      destUrlR = `${BUSINESS_WEB_ORIGIN}/e/${brandSlugR}/${entitySlugR}`;
      destEventIdR = String(eventRow.id);
    } else if (pageTypeR === "brand") {
      const { data: brandRow } = await supabase
        .from("business_public_brands_view")
        .select("id, slug")
        .eq("slug", brandSlugR)
        .maybeSingle();
      if (!brandRow) return json({ error: "destination_not_public" }, 422);
      destUrlR = `${BUSINESS_WEB_ORIGIN}/b/${brandSlugR}`;
    } else {
      return json({ error: "destination_not_public", detail: "dest_page_type_not_supported_wp1" }, 422);
    }

    // (4) Creative validation (§5 — copy caps, Title-Case CTA enum, and the
    // §5.4 destination policy: display_url must match; NO OneLink can reach a
    // Reddit create body — D-P1 bridge-page rejection class).
    const creativeInputR: RedditCreativeBuildInput = {
      type: "IMAGE",
      headline: headlineR,
      destinationUrl: destUrlR,
      callToAction: ctaR,
      imageUrl: imageUrlR,
    };
    const creativeCheckR = validateRedditCreative(creativeInputR);
    if (!creativeCheckR.ok) {
      return json({ error: creativeCheckR.detail, detail: creativeCheckR.message }, 422);
    }
    const creativeWarningsR = creativeCheckR.warnings;

    // ── THE VALIDATE GATE: Reddit has NO validate-only (§9 — the first real
    //    create, executed PAUSED, is the platform-side proof). The generic
    //    validate block would run the structured-post job and create a REAL
    //    t3_ post on the profile. Named-skipped-layers; ZERO adapter calls. ──
    if (validateOnlyR) {
      const reasonR =
        "reddit_no_validate_only — the Reddit Ads API has no validate-only mode; attempting to validate would CREATE a real t3_ post via the structured-post job (§3.4). Client-side validators (name/objective/copy/CTA/destination-policy/targeting/media) all passed.";
      return json({
        validated: false,
        validated_layers: [],
        skipped_layers: [
          { layer: "campaign", reason: reasonR },
          { layer: "ad_group", reason: reasonR },
          { layer: "creative", reason: reasonR },
          { layer: "ad", reason: reasonR },
        ],
        detail:
          "validate_only — nothing was validated on Reddit (no validate-only exists), nothing created, nothing persisted. The first real create (everything PAUSED) is the platform-side validation.",
        ...(creativeWarningsR.length > 0 ? { warnings: creativeWarningsR } : {}),
      });
    }

    // (5) The full §3 chain: campaign → ad group → structured-post job → ad,
    // ALL PAUSED (G-1 explicit ×3), conversion_pixel_id injected
    // UNCONDITIONALLY (GR-12), §7 compensating rollback inside the runner.
    // The ad_campaigns row id is minted UP FRONT so utm_campaign carries the
    // eventual DB id (§3.5) with no chicken-and-egg on the insert.
    const campaignRowIdR = crypto.randomUUID();
    try {
      const createdR = await redditCreateFullChain(rconn, {
        campaign: {
          name,
          objective: objectiveInputR, // normalized inside the builder (TRAFFIC → CLICKS)
          isCbo: false, // v1 default: non-CBO — the budget lives on the ad group (§3.1)
        },
        adGroup: {
          name: `${name} — ad group`,
          budgetCents: amountCents as number, // → goal_value micro in the builder; NO floor of ours (GR-59)
          optimizationGoal: "CLICKS", // pixel-independent safe default (§3.2)
          startTime: new Date().toISOString(),
          normalizedTargeting: {
            countries: countryCodesR,
            ...(Array.isArray(targetingR.genders) ? { genders: targetingR.genders } : {}),
            // age_min/age_max are deliberately NEVER forwarded — Reddit has no
            // age targeting (R-8); the serializer warns if they appear.
          },
          redditPassthrough: redditPassthroughR,
        },
        creative: creativeInputR,
        ad: {
          name: `${name} — ad`,
          clickUrl: destUrlR, // canonical page — never the OneLink (D-P1)
          utmCampaign: campaignRowIdR,
        },
      });

      const redditSmartLink = buildDestSmartLink({
        pageType: pageTypeR,
        brandSlug: brandSlugR,
        entitySlug: entitySlugR || null,
        externalCampaignId: createdR.externalCampaignId,
        adName: `${name} — ad`,
        platform: "reddit",
      });
      const targetingRecordR: Record<string, unknown> = {
        countries: countryCodesR,
        ...(redditPassthroughR ? { passthrough: { reddit: redditPassthroughR } } : {}),
      };
      const allWarningsR = [...creativeWarningsR, ...createdR.targetingWarnings];

      // (6) Persist ONE campaign+ad_set+ad row set (only now that all IDs exist).
      const { data: campaignRowR, error: campaignErrR } = await supabase
        .from("ad_campaigns")
        .insert({
          id: campaignRowIdR, // pre-minted — it is already riding in click_url utm_campaign
          connection_id: rconn.id,
          platform: "reddit",
          external_campaign_id: createdR.externalCampaignId,
          name,
          objective: objectiveR.objective, // the normalized enum value (CLICKS)
          status: "PAUSED",
          daily_budget_cents: null, // non-CBO: the budget lives on the ad group
          delivery_status: createdR.effectiveStatus,
          status_synced_at: new Date().toISOString(),
          targeting: targetingRecordR,
          dest_page_type: pageTypeR,
          dest_brand_slug: brandSlugR,
          dest_entity_slug: entitySlugR || null,
          dest_event_id: destEventIdR,
          dest_url: destUrlR,
          // A4.f-demoted slot: stored for attribution reference, never sent to Reddit.
          dest_smart_link: redditSmartLink,
          dest_group_id: destGroupId, // ISSUE-1002: shared fan-out group (NULL for single-destination)
          request_id: requestIdR,
          created_by: user.id,
        })
        .select("*")
        .single();

      let adSetRowR: Record<string, unknown> | null = null;
      let adRowR: Record<string, unknown> | null = null;
      let persistErrR = campaignErrR;
      if (!persistErrR && campaignRowR) {
        const { data, error } = await supabase
          .from("ad_sets")
          .insert({
            campaign_id: campaignRowR.id,
            external_adset_id: createdR.externalAdSetId,
            name: `${name} — ad group`,
            targeting: targetingRecordR,
            budget_cents: amountCents, // goal_value source (cents at rest)
            optimization_goal: "CLICKS",
            bid_strategy: "MAXIMIZE_VOLUME", // §3.2 default start
            billing_event: null,
            status: "PAUSED",
          })
          .select("*")
          .single();
        adSetRowR = data;
        persistErrR = error;
      }
      if (!persistErrR && adSetRowR) {
        const { data, error } = await supabase
          .from("ads")
          .insert({
            ad_set_id: adSetRowR.id,
            external_ad_id: createdR.externalAdId,
            // GR-10: the t3_ post IS the creative reference on Reddit.
            external_creative_id: createdR.postId,
            name: `${name} — ad`,
            status: "PAUSED",
            review_status: createdR.reviewStatus,
            review_detail: {
              effective_status: createdR.effectiveStatus,
              // §3.5/GR-33: the cheapest pre-launch QA lever on the channel.
              preview_url: createdR.previewUrl,
              profile_id: createdR.profileId,
            },
          })
          .select("*")
          .single();
        adRowR = data;
        persistErrR = error;
      }

      if (persistErrR) {
        // Never a half-written DB row set: delete the campaign row (cascades)
        // and roll back the platform tree (PATCH configured_status:"DELETED" —
        // R-5; the t3_ post is profile-scoped residue, recorded not deleted).
        if (campaignRowR) await supabase.from("ad_campaigns").delete().eq("id", campaignRowR.id);
        let rollbackOkR = false;
        try {
          if (getAdapter("reddit").rollbackCampaign) {
            await getAdapter("reddit").rollbackCampaign!(rconn, createdR.externalCampaignId);
            rollbackOkR = true;
          }
        } catch {
          rollbackOkR = false;
        }
        await supabase.from("ad_status_events").insert({
          campaign_id: null,
          platform: "reddit",
          entity: "campaign",
          action: rollbackOkR ? "rollback" : "create_failed",
          actor: user.id,
          to_status: null,
          external_ids: {
            external_campaign_id: createdR.externalCampaignId,
            external_adset_id: createdR.externalAdSetId,
            external_ad_id: createdR.externalAdId,
            // §7.2: a post with no ad attached is safe residue — but recorded.
            orphaned_post_id: createdR.postId,
            profile_id: createdR.profileId,
          },
          provider_response: { db_error: persistErrR.message },
        });
        console.error("[admin-ad-create-campaign] reddit persist failed:", persistErrR.message);
        return json({ error: "internal_error", detail: "db_persist_failed_platform_rolled_back" }, 500);
      }

      await supabase.from("ad_status_events").insert({
        campaign_id: campaignRowR.id,
        platform: "reddit",
        entity: "campaign",
        action: "create",
        actor: user.id,
        from_status: null,
        to_status: "PAUSED",
        external_ids: {
          external_campaign_id: createdR.externalCampaignId,
          external_adset_id: createdR.externalAdSetId,
          external_ad_id: createdR.externalAdId,
          post_id: createdR.postId,
          profile_id: createdR.profileId,
        },
        provider_response: null,
      });

      return json({
        campaign: campaignRowR,
        ad_set: adSetRowR,
        ad: adRowR,
        preview_url: createdR.previewUrl,
        ...(allWarningsR.length > 0 ? { warnings: allWarningsR } : {}),
      });
    } catch (err) {
      if (err instanceof AdNotConnectedError) {
        return json({ error: "reddit_not_connected" }, 424);
      }
      if (err instanceof RedditChainError) {
        // §7 partial-failure contract: NO ad_* rows; the runner already
        // PATCHed configured_status:"DELETED" in reverse order; any orphaned
        // t3_ post is in partialExternalIds.orphaned_post_id (§7.2) — audit.
        const failureR = err.failure;
        const providerResponseR = failureR.cause instanceof AdApiError
          ? failureR.cause.toJSON()
          : {
            message: failureR.cause instanceof Error
              ? failureR.cause.message
              : String(failureR.cause),
          };
        // §7.1 rollback outcome: attempted levels minus any whose PATCH failed.
        const rollbackCleanR = failureR.rollback.failed.length === 0;
        await supabase.from("ad_status_events").insert({
          campaign_id: null,
          platform: "reddit",
          entity: "campaign",
          action: rollbackCleanR && failureR.rollback.attempted.length > 0
            ? "rollback"
            : "create_failed",
          actor: user.id,
          external_ids: failureR.partialExternalIds,
          provider_response: {
            step: failureR.step,
            ...providerResponseR,
            ...(failureR.rollback.failed.length > 0
              ? { rollback_failed_levels: failureR.rollback.failed }
              : {}),
          },
        });
        return json({
          error: "reddit_create_failed",
          detail: providerResponseR,
          step: failureR.step,
          rolled_back: rollbackCleanR,
        }, 502);
      }
      if (err instanceof AdApiError) {
        return json({ error: "reddit_create_failed", detail: err.toJSON() }, 502);
      }
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[admin-ad-create-campaign] reddit unexpected:", detail);
      return json({ error: "internal_error" }, 500);
    }
  }

  // QA P1-1: WP1 accepts ONLY the §4.4b default bid strategy — cap strategies
  // require a bid_amount WP1 does not collect. The builder sends it EXPLICITLY.
  const bidStrategy = typeof body.bid_strategy === "string"
    ? body.bid_strategy
    : "LOWEST_COST_WITHOUT_CAP";
  if (bidStrategy !== "LOWEST_COST_WITHOUT_CAP") {
    return json({
      error: "validation_error",
      detail:
        "bid_strategy_unsupported_wp1 — only LOWEST_COST_WITHOUT_CAP ships in WP1 (cap strategies need bid_amount; #864).",
    }, 422);
  }

  const targetingInput = (body.targeting ?? {}) as Record<string, unknown>;
  const countries = targetingInput.countries;
  if (!Array.isArray(countries) || countries.length === 0 || countries.some((c) => typeof c !== "string")) {
    return json({ error: "validation_error", detail: "targeting_countries_required" }, 400);
  }

  const destination = pickCallDestination(body); // ISSUE-1002: singular or destinations[0]
  const pageType = destination.page_type ?? "";
  const brandSlug = typeof destination.brand_slug === "string" ? destination.brand_slug.trim() : "";
  const entitySlug = typeof destination.entity_slug === "string" ? destination.entity_slug.trim() : "";
  if (!["event", "trip", "brand", "venue"].includes(pageType)) {
    return json({ error: "validation_error", detail: "destination_page_type_invalid" }, 400);
  }
  if (!brandSlug) return json({ error: "validation_error", detail: "destination_brand_slug_required" }, 400);

  const creative = (body.creative ?? {}) as Record<string, unknown>;
  const message = typeof creative.message === "string" ? creative.message.trim() : "";
  if (!message) return json({ error: "validation_error", detail: "creative_message_required" }, 400);
  const imageUrl = typeof creative.image_url === "string" ? creative.image_url : undefined;
  const imageHash = typeof creative.image_hash === "string" ? creative.image_hash : undefined;
  const videoId = typeof creative.video_id === "string" ? creative.video_id : undefined;
  if (!imageUrl && !imageHash && !videoId) {
    return json({ error: "validation_error", detail: "creative_media_required" }, 400);
  }

  const requestId = typeof body.request_id === "string" && body.request_id.trim()
    ? body.request_id.trim()
    : null;
  const validateOnly = body.validate_only === true;

  // ── 1. Connection (fail-close). ──────────────────────────────────────────────
  const { data: conn } = await supabase
    .from("ad_connections")
    .select("*")
    .eq("platform", platform)
    .eq("lane", lane)
    .maybeSingle();
  if (!conn || !conn.connected || conn.status !== "connected") {
    return json({ error: `${platform}_not_connected` }, 424);
  }
  const connection = conn as unknown as AdConnectionRow;

  // Idempotency (A3 §A request_id): replay returns the existing row.
  if (requestId && !validateOnly) {
    const { data: existing } = await supabase
      .from("ad_campaigns")
      .select("*")
      .eq("connection_id", connection.id)
      .eq("request_id", requestId)
      .maybeSingle();
    if (existing) return json({ campaign: existing, idempotent_replay: true });
  }

  // ── 2. Objective → optimization_goal matrix (M-2/M-3 — never rely on Meta's
  //       silent auto-correct). ─────────────────────────────────────────────────
  if (!META_OBJECTIVE_GOAL_MATRIX[objective]) {
    return json({ error: "validation_error", detail: "invalid_objective" }, 422);
  }
  if (!isMetaGoalValidForObjective(objective, optimizationGoal)) {
    return json({
      error: "invalid_optimization_goal",
      detail:
        `optimization_goal ${optimizationGoal} is not compatible with ${objective} — Meta would silently auto-correct it (M-3). Valid: ${
          META_OBJECTIVE_GOAL_MATRIX[objective].join(", ")
        }`,
    }, 422);
  }

  // ── 3. special_ad_categories (M-4/GR-56: CREDIT retired; restriction cascade). ─
  // ISSUE-979 Bug 3: Meta is the platform that APPLIES the global compliance
  // intent — special_ad_categories here + self_ai_disclosure in the creative
  // (creative.ai_generated below). The platform-neutral body.compliance mirror
  // is redundant for Meta (these API-shaped keys are authoritative) and is only
  // consumed by the other four branches, which cannot express it.
  const specialValidation = validateSpecialAdCategories(body.special_ad_categories);
  if (!specialValidation.ok) {
    return json({ error: specialValidation.detail, detail: specialValidation.message }, 422);
  }
  const specialAdCategories = specialValidation.categories;
  // ISSUE-989 — real city + interest targeting. Cities carry the exact Meta
  // geo_locations.cities shape [{key, radius, distance_unit}] (normalized/clamped
  // to Meta's 1-50mi / 1-80km bounds — never a raw passthrough); interests become
  // flexible_spec:[{interests:[{id}]}] from the resolved adinterest ids. Both are
  // omitted when the builder sends none, so broad country+age targeting is
  // byte-identical to before. Under a special ad category the restriction cascade
  // (below) strips genders + flexible_spec and pins age 18-65, unchanged.
  //
  // ISSUE-989 tester P1 fix: when ≥1 city is chosen, geo_locations targets the
  // CITIES ONLY and DROPS countries — Meta UNIONS countries ∪ cities, so keeping
  // both made the radius INERT (London 10mi ∪ US ≈ 263M instead of ~7.3M).
  // buildMetaGeoLocations mirrors TikTok's city-replaces-country behavior; the
  // country stays the fallback ONLY when no city is chosen.
  const metaCities = normalizeMetaCities(targetingInput.cities);
  const metaInterestSpec = buildMetaInterestFlexibleSpec(targetingInput.interests);
  let targeting: Record<string, unknown> = {
    geo_locations: buildMetaGeoLocations(countries, metaCities),
    ...(typeof targetingInput.age_min === "number" ? { age_min: targetingInput.age_min } : {}),
    ...(typeof targetingInput.age_max === "number" ? { age_max: targetingInput.age_max } : {}),
    ...(Array.isArray(targetingInput.genders) ? { genders: targetingInput.genders } : {}),
    ...(metaInterestSpec ? { flexible_spec: metaInterestSpec } : {}),
  };
  if (specialAdCategories.length > 0) {
    targeting = applySpecialAdCategoryRestrictions(targeting);
  }

  // ── 4. Per-category budget floor (A4.g / PROOF M-P8 — never hardcoded). ──────
  const extra = (connection.extra ?? {}) as Record<string, unknown>;
  const floors = extra.minimum_budgets as Record<string, number> | null | undefined;
  const category = metaBudgetCategoryForGoal(optimizationGoal);
  if (!floors || typeof floors[category] !== "number") {
    return json({
      error: `${platform}_not_connected`,
      detail:
        "minimum_budgets missing from the connection — re-run admin-ad-connect to fetch the per-category floors (A4.g: they are never hardcoded).",
    }, 424);
  }
  const floorCents = floors[category];
  if ((amountCents as number) < floorCents) {
    return json({
      error: "budget_below_minimum",
      detail:
        `Daily budget ${amountCents}¢ is below the ${category} floor ${floorCents}¢ for ${optimizationGoal} (per-category minimum_budgets — PROOF M-P8).`,
      floor_cents: floorCents,
      category,
    }, 422);
  }

  // ── 5. Pixel gate (A4.e.5): pixel-measured goals refused while epoch-0. ──────
  if (META_PIXEL_GATED_GOALS.includes(optimizationGoal)) {
    try {
      const client = resolveMetaClient(connection);
      const pixel = await metaFetchPixelLastFired(client);
      if (!pixel.hasSignal) {
        return json({
          error: "pixel_no_signal",
          detail:
            `${optimizationGoal} is measured by the pixel, which has never fired (last_fired_time epoch-0/null — PROOF M-P7). Use LINK_CLICKS until #865 wires the pixel.`,
        }, 422);
      }
    } catch (err) {
      if (err instanceof AdNotConnectedError) return json({ error: "meta_not_connected" }, 424);
      return json({
        error: "pixel_no_signal",
        detail: "Pixel signal could not be verified — refusing a pixel-measured goal (fail-close). Use LINK_CLICKS.",
      }, 422);
    }
  }

  // ── 6. Destination resolve — READ-ONLY, public + live only (§4.4b). ──────────
  let destUrl: string;
  let destEventId: string | null = null;
  if (pageType === "event") {
    if (!entitySlug) {
      return json({ error: "validation_error", detail: "destination_entity_slug_required" }, 400);
    }
    // QA P3-6 (AC-4 "public + LIVE"): the view also exposes ended/cancelled
    // events — paid traffic must never point at one.
    const { data: eventRow } = await supabase
      .from("business_public_events_view")
      .select("id, brand_slug, slug, status")
      .eq("brand_slug", brandSlug)
      .eq("slug", entitySlug)
      .in("status", ["scheduled", "live"])
      .maybeSingle();
    if (!eventRow) return json({ error: "destination_not_public" }, 422);
    destUrl = `${BUSINESS_WEB_ORIGIN}/e/${brandSlug}/${entitySlug}`;
    destEventId = String(eventRow.id);
  } else if (pageType === "brand") {
    const { data: brandRow } = await supabase
      .from("business_public_brands_view")
      .select("id, slug")
      .eq("slug", brandSlug)
      .maybeSingle();
    if (!brandRow) return json({ error: "destination_not_public" }, 422);
    destUrl = `${BUSINESS_WEB_ORIGIN}/b/${brandSlug}`;
  } else {
    // trip/venue public resolution has no server-side read model in WP1 —
    // fail-close rather than guess (flagged in the WP1 report).
    return json({ error: "destination_not_public", detail: "dest_page_type_not_supported_wp1" }, 422);
  }

  const conversionDomain = conversionDomainFromUrl(destUrl);
  const adapter = getAdapter(platform);

  const campaignInput = {
    name,
    objective,
    dailyBudgetCents: amountCents as number, // CBO (OD-3) — budget on the campaign
    bidStrategy, // QA P1-1 — explicit LOWEST_COST_WITHOUT_CAP, never a Meta default
    specialAdCategories,
    specialAdCategoryCountry: Array.isArray(body.special_ad_category_country)
      ? body.special_ad_category_country as string[]
      : specialAdCategories.length > 0
      ? (countries as string[])
      : undefined,
    validateOnly,
  };
  const adSetInput = {
    name: `${name} — ad set`,
    optimizationGoal,
    billingEvent,
    targeting,
    validateOnly,
  };
  const creativeInput = {
    destUrl, // A4.f: the AD-VISIBLE destination — never the OneLink
    message,
    headline: typeof creative.headline === "string" ? creative.headline : undefined,
    description: typeof creative.description === "string" ? creative.description : undefined,
    imageUrl,
    imageHash,
    videoId,
    videoThumbnailImageHash: typeof creative.video_thumbnail_image_hash === "string"
      ? creative.video_thumbnail_image_hash
      : undefined,
    callToActionType: typeof creative.call_to_action_type === "string"
      ? creative.call_to_action_type
      : "LEARN_MORE",
    aiGenerated: creative.ai_generated === true, // GR-61 self_ai_disclosure
    campaignName: name,
    adName: `${name} — ad`,
    validateOnly,
  };
  const adInput = {
    name: `${name} — ad`,
    conversionDomain: conversionDomain ?? undefined,
    validateOnly,
  };

  // ── VALIDATE-ONLY passthrough: zero objects created, zero DB writes. ─────────
  // QA P2-2: the ad-set layer is validated too (this is exactly where P1-1
  // hid), and the response NAMES which layers were validated. Meta's ad-set
  // validate-only requires a campaign_id, so the ad set is validated against
  // the connection's most recent persisted campaign; with none yet, the layer
  // is reported as skipped with the reason — never silently.
  if (validateOnly) {
    const validatedLayers: string[] = [];
    const skippedLayers: { layer: string; reason: string }[] = [];
    try {
      await adapter.createCampaign(connection, campaignInput);
      validatedLayers.push("campaign");

      const { data: referenceCampaign } = await supabase
        .from("ad_campaigns")
        .select("external_campaign_id")
        .eq("connection_id", connection.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (referenceCampaign?.external_campaign_id) {
        await adapter.createAdSet(
          connection,
          String(referenceCampaign.external_campaign_id),
          { ...adSetInput, validateOnly: true },
        );
        validatedLayers.push("ad_set");
      } else {
        skippedLayers.push({
          layer: "ad_set",
          reason:
            "no_reference_campaign — Meta ad-set validation needs a campaign_id; the first real create exercises this layer live (client-side goal/matrix/floor checks already passed).",
        });
      }

      if (adapter.createCreative) {
        await adapter.createCreative(connection, creativeInput);
        validatedLayers.push("creative");
      }
      return json({
        validated: true,
        validated_layers: validatedLayers,
        skipped_layers: skippedLayers,
        detail: "validate_only — nothing created on the platform, nothing persisted.",
      });
    } catch (err) {
      if (err instanceof AdNotConnectedError) return json({ error: err.detail }, 424);
      if (err instanceof AdApiError) {
        return json({
          error: "validation_failed",
          detail: err.toJSON(),
          validated_layers: validatedLayers,
        }, 422);
      }
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[admin-ad-create-campaign] validate-only unexpected:", detail);
      return json({ error: "internal_error" }, 500);
    }
  }

  // ── The atomic create (§4.4b — no orphans; everything PAUSED). ───────────────
  try {
    const created = await createFullCampaignAtomic(adapter, connection, {
      campaign: campaignInput,
      adSet: adSetInput,
      creative: creativeInput,
      ad: adInput,
    });

    // Read back delivery status (effective_status).
    let deliveryStatus: string | null = null;
    try {
      const status = await adapter.getStatus(connection, "campaign", created.externalCampaignId);
      deliveryStatus = status.effectiveStatus;
    } catch {
      deliveryStatus = null; // status read-back is best-effort; sync repairs it
    }

    const destSmartLink = buildDestSmartLink({
      pageType,
      brandSlug,
      entitySlug: entitySlug || null,
      externalCampaignId: created.externalCampaignId,
      adName: `${name} — ad`,
      platform,
    });

    // ── Persist ONE campaign+ad_set+ad row set (only now that all IDs exist). ──
    const { data: campaignRow, error: campaignInsertError } = await supabase
      .from("ad_campaigns")
      .insert({
        connection_id: connection.id,
        platform,
        external_campaign_id: created.externalCampaignId,
        name,
        objective,
        status: "PAUSED",
        daily_budget_cents: amountCents,
        delivery_status: deliveryStatus,
        status_synced_at: new Date().toISOString(),
        targeting,
        dest_page_type: pageType,
        dest_brand_slug: brandSlug,
        dest_entity_slug: entitySlug || null,
        dest_event_id: destEventId,
        dest_url: destUrl,
        dest_smart_link: destSmartLink,
        dest_group_id: destGroupId, // ISSUE-1002: shared fan-out group (NULL for single-destination)
        request_id: requestId,
        created_by: user.id,
      })
      .select("*")
      .single();

    let adSetRow: Record<string, unknown> | null = null;
    let adRow: Record<string, unknown> | null = null;
    let persistError = campaignInsertError;

    if (!persistError && campaignRow) {
      const { data, error } = await supabase
        .from("ad_sets")
        .insert({
          campaign_id: campaignRow.id,
          external_adset_id: created.externalAdSetId,
          name: adSetInput.name,
          targeting,
          budget_cents: null, // CBO — budget lives on the campaign
          optimization_goal: optimizationGoal,
          billing_event: billingEvent,
          status: "PAUSED",
        })
        .select("*")
        .single();
      adSetRow = data;
      persistError = error;
    }
    if (!persistError && adSetRow) {
      const { data, error } = await supabase
        .from("ads")
        .insert({
          ad_set_id: adSetRow.id,
          external_ad_id: created.externalAdId,
          external_creative_id: created.externalCreativeId,
          name: adInput.name,
          status: "PAUSED",
          review_status: created.reviewStatus,
        })
        .select("*")
        .single();
      adRow = data;
      persistError = error;
    }

    if (persistError) {
      // Never a half-written DB row set: delete the campaign row (cascades) and
      // roll back the platform campaign, then audit for reconciliation.
      if (campaignRow) await supabase.from("ad_campaigns").delete().eq("id", campaignRow.id);
      // QA P2-5: the account-level creative does NOT cascade with the campaign.
      let creativeRollbackOk: boolean | null = null;
      if (created.externalCreativeId && adapter.rollbackCreative) {
        try {
          await adapter.rollbackCreative(connection, created.externalCreativeId);
          creativeRollbackOk = true;
        } catch {
          creativeRollbackOk = false; // residue — id recorded below
        }
      } else if (created.externalCreativeId) {
        creativeRollbackOk = false;
      }
      let rollbackOk = false;
      try {
        if (adapter.rollbackCampaign) {
          await adapter.rollbackCampaign(connection, created.externalCampaignId);
          rollbackOk = true;
        }
      } catch {
        rollbackOk = false;
      }
      await supabase.from("ad_status_events").insert({
        campaign_id: null,
        platform,
        entity: "campaign",
        action: rollbackOk && creativeRollbackOk !== false ? "rollback" : "create_failed",
        actor: user.id,
        to_status: null,
        external_ids: {
          external_campaign_id: created.externalCampaignId,
          external_adset_id: created.externalAdSetId,
          external_creative_id: created.externalCreativeId,
          external_ad_id: created.externalAdId,
        },
        provider_response: {
          db_error: persistError.message,
          ...(creativeRollbackOk === false
            ? { creative_residue_id: created.externalCreativeId }
            : {}),
        },
      });
      console.error("[admin-ad-create-campaign] persist failed:", persistError.message);
      return json({ error: "internal_error", detail: "db_persist_failed_platform_rolled_back" }, 500);
    }

    await supabase.from("ad_status_events").insert({
      campaign_id: campaignRow.id,
      platform,
      entity: "campaign",
      action: "create",
      actor: user.id,
      from_status: null,
      to_status: "PAUSED",
      external_ids: {
        external_campaign_id: created.externalCampaignId,
        external_adset_id: created.externalAdSetId,
        external_creative_id: created.externalCreativeId,
        external_ad_id: created.externalAdId,
      },
      provider_response: null,
    });

    return json({ campaign: campaignRow, ad_set: adSetRow, ad: adRow });
  } catch (err) {
    if (err instanceof AdNotConnectedError) {
      return json({ error: `${platform}_not_connected` }, 424);
    }
    if (err instanceof AtomicCreateError) {
      // §4.4b partial-failure contract: NO ad_campaigns row; compensating
      // cleanup already attempted; audit the outcome for reconciliation.
      const failure = err.failure;
      const providerResponse = failure.cause instanceof AdApiError
        ? failure.cause.toJSON()
        : { message: failure.cause instanceof Error ? failure.cause.message : String(failure.cause) };
      // QA P2-5: any surviving account-level creative is named in the audit row.
      const creativeResidue = failure.creativeRollbackSucceeded === false
        ? { creative_residue_id: failure.partialExternalIds.external_creative_id ?? null }
        : {};
      const fullyRolledBack = failure.rollbackSucceeded !== false &&
        failure.creativeRollbackSucceeded !== false;
      await supabase.from("ad_status_events").insert({
        campaign_id: null,
        platform,
        entity: "campaign",
        action: fullyRolledBack && failure.rollbackSucceeded === true
          ? "rollback"
          : "create_failed",
        actor: user.id,
        external_ids: failure.partialExternalIds,
        provider_response: { step: failure.step, ...providerResponse, ...creativeResidue },
      });
      return json({
        error: `${platform}_create_failed`,
        detail: providerResponse,
        step: failure.step,
        rolled_back: failure.rollbackSucceeded,
        creative_rolled_back: failure.creativeRollbackSucceeded,
      }, 502);
    }
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[admin-ad-create-campaign] unexpected:", detail);
    return json({ error: "internal_error" }, 500);
  }
});
