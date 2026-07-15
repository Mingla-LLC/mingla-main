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
  createFullCampaignAtomic,
  getAdapter,
  isLane,
  isPlatform,
  META_OBJECTIVE_GOAL_MATRIX,
  META_PIXEL_GATED_GOALS,
  isMetaGoalValidForObjective,
  metaBudgetCategoryForGoal,
} from "../_shared/adChannel.ts";
import {
  applySpecialAdCategoryRestrictions,
  metaFetchPixelLastFired,
  resolveMetaClient,
  validateSpecialAdCategories,
} from "../_shared/meta.ts";
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

interface DestinationInput {
  page_type?: string;
  brand_slug?: string;
  entity_slug?: string;
  event_id?: string;
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

  const destination = (body.destination ?? {}) as DestinationInput;
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
  const specialValidation = validateSpecialAdCategories(body.special_ad_categories);
  if (!specialValidation.ok) {
    return json({ error: specialValidation.detail, detail: specialValidation.message }, 422);
  }
  const specialAdCategories = specialValidation.categories;
  let targeting: Record<string, unknown> = {
    geo_locations: { countries },
    ...(typeof targetingInput.age_min === "number" ? { age_min: targetingInput.age_min } : {}),
    ...(typeof targetingInput.age_max === "number" ? { age_max: targetingInput.age_max } : {}),
    ...(Array.isArray(targetingInput.genders) ? { genders: targetingInput.genders } : {}),
    ...(Array.isArray(targetingInput.cities)
      ? { geo_locations: { countries, cities: targetingInput.cities } }
      : {}),
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
