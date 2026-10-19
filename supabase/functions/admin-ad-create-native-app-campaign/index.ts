/**
 * Issue #3697 — Admin provider-native app campaign creation.
 *
 * This endpoint consumes a funded, confirmed immutable plan and creates one
 * provider chain PAUSED/DISABLED. It never accepts caller-owned app IDs,
 * store URLs, targeting, copy, currency, or provider budget as authority.
 */

// @ts-ignore Deno ESM runtime import.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore Deno ESM runtime import.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { creativeSelectionError } from "../_shared/adCreativeLifecycle.ts";
import {
  AdApiError,
  type AdConnectionRow,
  AdNotConnectedError,
  AtomicCreateError,
  createFullCampaignAtomic,
  getAdapter,
  isPlatform,
} from "../_shared/adChannel.ts";
import type { Platform } from "../_shared/adChannelCore.ts";
import {
  assertNativeAppImmutableRequest,
  assertNativeAppRequestDestination,
  type FrozenNativeAppDestination,
  nativeAppCopyFromCanonicalPlan,
  nativeAppCreativeIdFromCanonicalPlan,
  NativeAppPlanError,
  nativeCompiledTargeting,
  parseFrozenNativeAppDestination,
} from "../_shared/adNativeAppCampaign.ts";
import { parseCampaignSchedule } from "../_shared/adMoney.ts";
import {
  GOOGLE_GEO_COUNTRY_CONSTANTS,
  googleCreateAppCampaign,
} from "../_shared/google.ts";
import type { MetaCreateCreativeExtensions } from "../_shared/meta.ts";
import {
  RedditChainError,
  redditConnExtras,
  redditCreateFullChain,
  type RedditCreativeBuildInput,
} from "../_shared/reddit.ts";
import type {
  SnapchatCreateAdExtensions,
  SnapchatCreateCampaignExtensions,
  SnapchatCreateCreativeExtensions,
} from "../_shared/snapchat.ts";
import {
  formatTikTokScheduleTime,
  resolveTikTokGeo,
  type TikTokCreateAdExtensions,
} from "../_shared/tiktok.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_RE = /^[0-9a-f]{64}$/;

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

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function canonicalJson(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === "object") {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, normalize(item)]),
      );
    }
    return input;
  };
  return JSON.stringify(normalize(value));
}

function executionTemplateMatches(
  canonicalPlan: Record<string, unknown> | null,
  platform: Platform,
  body: Record<string, unknown>,
): boolean {
  const templates = record(canonicalPlan?.execution_payloads);
  if (!templates) return true; // Plans created before the recovery seal.
  const expected = record(templates[platform]);
  if (!expected) return false;
  const supplied = structuredClone(body);
  delete supplied.plan_version_id;
  delete supplied.plan_hash;
  return canonicalJson(expected) === canonicalJson(supplied);
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => typeof item === "string" ? item.trim() : "")
      .filter(Boolean)
    : [];
}

async function stableUuid(value: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  ).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((item) => item.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${
    hex.slice(16, 20)
  }-${hex.slice(20)}`;
}

function requestDestination(body: Record<string, unknown>): unknown {
  if (record(body.destination)) return body.destination;
  return Array.isArray(body.destinations) ? body.destinations[0] : null;
}

function failureState(error: unknown): "failed_retryable" | "failed_terminal" {
  const code = error instanceof AdApiError ? String(error.code ?? "") : "";
  return /network|timeout|429|5\d\d|rate/i.test(code) ||
      error instanceof AdNotConnectedError
    ? "failed_retryable"
    : "failed_terminal";
}

function publicError(error: unknown): Record<string, unknown> {
  if (error instanceof AdApiError) return error.toJSON();
  if (error instanceof AdNotConnectedError) {
    return {
      platform: error.platform,
      code: error.detail,
      message: error.detail,
    };
  }
  if (error instanceof AtomicCreateError) {
    return {
      code: "provider_create_failed",
      step: error.failure.step,
      partial_external_ids: error.failure.partialExternalIds,
      rollback_succeeded: error.failure.rollbackSucceeded,
      creative_rollback_succeeded: error.failure.creativeRollbackSucceeded,
      message: error.message,
    };
  }
  if (error instanceof RedditChainError) {
    return {
      code: "provider_create_failed",
      step: error.failure.step,
      partial_external_ids: error.failure.partialExternalIds,
      rollback: error.failure.rollback,
      message: error.message,
    };
  }
  return {
    code: "provider_create_failed",
    message: error instanceof Error ? error.message : String(error),
  };
}

interface LoadedCreative {
  id: string;
  kind: "image" | "video";
  sourceUrl: string | null;
  mp4Url: string | null;
  posterUrl: string | null;
  aiGenerated: boolean;
  externalRef: string | null;
  refExtra: Record<string, unknown>;
}

interface ProviderCreateResult {
  externalCampaignId: string;
  externalAdSetId: string;
  externalCreativeId: string | null;
  externalAdId: string;
  reviewStatus: string | null;
  extraExternalIds?: Record<string, unknown>;
}

// deno-lint-ignore no-explicit-any
async function loadCreative(
  db: any,
  creativeId: string,
  platform: Platform,
  lane: string,
  externalAccountId: string,
): Promise<LoadedCreative> {
  const { data: creative, error } = await db.from("ad_creatives").select(
    "id,kind,source_url,mp4_master_url,poster_url,content_hash,ai_generated,status,purged_at",
  ).eq("id", creativeId).maybeSingle();
  // #3697 (C-13): the creative id always comes from the frozen plan version,
  // so an archived creative stays usable; a purged one has no media.
  if (
    error || !creative ||
    creativeSelectionError(creative, { frozen: true }) ||
    !["image", "video"].includes(creative.kind) || !creative.content_hash
  ) {
    throw new NativeAppPlanError("native_creative_not_found");
  }
  let externalRef: string | null = null;
  let refExtra: Record<string, unknown> = {};
  if (["meta", "tiktok", "snapchat"].includes(platform)) {
    const { data: ref, error: refError } = await db
      .from("ad_creative_platform_refs")
      .select("external_ref,external_ref_extra,status,content_hash")
      .eq("creative_id", creativeId)
      .eq("platform", platform)
      .eq("lane", lane)
      .eq("external_account_id", externalAccountId)
      .eq("external_kind", creative.kind)
      .eq("content_hash", creative.content_hash)
      .eq("status", "ready")
      .maybeSingle();
    if (refError || !ref?.external_ref) {
      throw new NativeAppPlanError(
        `native_creative_preparation_required:${platform}`,
      );
    }
    externalRef = String(ref.external_ref);
    refExtra = record(ref.external_ref_extra) ?? {};
  }
  if (platform === "reddit") {
    if (creative.kind === "image" && !creative.source_url) {
      throw new NativeAppPlanError("native_creative_source_missing:reddit");
    }
    if (
      creative.kind === "video" &&
      (!creative.mp4_master_url || !creative.poster_url)
    ) {
      throw new NativeAppPlanError("native_creative_source_missing:reddit");
    }
  }
  return {
    id: String(creative.id),
    kind: creative.kind,
    sourceUrl: typeof creative.source_url === "string"
      ? creative.source_url
      : null,
    mp4Url: typeof creative.mp4_master_url === "string"
      ? creative.mp4_master_url
      : null,
    posterUrl: typeof creative.poster_url === "string"
      ? creative.poster_url
      : null,
    aiGenerated: creative.ai_generated === true,
    externalRef,
    refExtra,
  };
}

function snapDemographics(targeting: Record<string, unknown>) {
  const demographic: Record<string, unknown> = {};
  if (Number.isInteger(targeting.age_min)) {
    demographic.min_age = String(targeting.age_min);
  }
  if (Number.isInteger(targeting.age_max)) {
    demographic.max_age = String(targeting.age_max);
  }
  if (targeting.gender === "men") demographic.genders = ["MALE"];
  if (targeting.gender === "women") demographic.genders = ["FEMALE"];
  return Object.keys(demographic).length ? [demographic] : undefined;
}

function googleGeoIds(targeting: Record<string, unknown>): string[] {
  const ids = strings(targeting.location_ids).map((value) => {
    if (/^\d+$/.test(value)) return value;
    return GOOGLE_GEO_COUNTRY_CONSTANTS[value.toUpperCase()]?.criterionId ?? "";
  }).filter(Boolean);
  if (!ids.length) throw new NativeAppPlanError("native_google_geo_unresolved");
  return [...new Set(ids)];
}

async function executeProvider(input: {
  platform: Platform;
  connection: AdConnectionRow;
  destination: FrozenNativeAppDestination;
  providerAppId: string;
  providerIconMediaId: string | null;
  identity: Record<string, unknown> | null;
  targeting: Record<string, unknown>;
  creative: LoadedCreative;
  copy: ReturnType<typeof nativeAppCopyFromCanonicalPlan>;
  name: string;
  providerDailyBudgetCents: number;
  startsAt: string | null;
  endsAt: string | null;
}): Promise<ProviderCreateResult> {
  const {
    platform,
    connection,
    destination,
    providerAppId,
    providerIconMediaId,
    identity,
    targeting,
    creative,
    copy,
    name,
    providerDailyBudgetCents,
    startsAt,
    endsAt,
  } = input;

  if (platform === "google") {
    const created = await googleCreateAppCampaign(connection, {
      name,
      dailyBudgetCents: providerDailyBudgetCents,
      appId: destination.storeIdentifier,
      os: destination.os,
      geoTargetCriterionIds: googleGeoIds(targeting),
      headlines: copy.googleHeadlines,
      descriptions: copy.googleDescriptions,
    });
    return {
      externalCampaignId: created.externalCampaignId,
      externalAdSetId: created.externalAdSetId,
      externalCreativeId: null,
      externalAdId: created.externalAdId,
      reviewStatus: null,
      extraExternalIds: { request_id: created.requestId },
    };
  }

  if (platform === "reddit") {
    redditConnExtras(connection);
    const creativeInput: RedditCreativeBuildInput = creative.kind === "video"
      ? {
        type: "VIDEO",
        headline: copy.headline,
        destinationUrl: destination.storeUrl,
        callToAction: "Install",
        videoUrl: creative.mp4Url,
        thumbnailUrl: creative.posterUrl,
        supplementaryText: copy.primary,
      }
      : {
        type: "IMAGE",
        headline: copy.headline,
        destinationUrl: destination.storeUrl,
        callToAction: "Install",
        imageUrl: creative.sourceUrl,
        supplementaryText: copy.primary,
      };
    const result = await redditCreateFullChain(connection, {
      campaign: {
        name,
        objective: "APP_INSTALLS",
        isCbo: false,
        appId: destination.storeIdentifier,
      },
      adGroup: {
        name: `${name} — ad group`,
        budgetCents: providerDailyBudgetCents,
        optimizationGoal: "MOBILE_CONVERSION_INSTALL",
        startTime: startsAt ?? new Date().toISOString(),
        endTime: endsAt,
        normalizedTargeting: {
          countries: strings(targeting.country_codes),
          genders: targeting.gender === "women"
            ? ["FEMALE"]
            : targeting.gender === "men"
            ? ["MALE"]
            : [],
        },
        redditPassthrough: strings(targeting.interests).length
          ? { interests: strings(targeting.interests) }
          : null,
        appId: destination.storeIdentifier,
        deviceOs: destination.os,
      },
      creative: creativeInput,
      ad: {
        name: `${name} — ad`,
        clickUrl: destination.storeUrl,
        utmCampaign: "native-app-plan",
      },
    });
    return {
      externalCampaignId: result.externalCampaignId,
      externalAdSetId: result.externalAdSetId,
      externalCreativeId: result.postId,
      externalAdId: result.externalAdId,
      reviewStatus: result.reviewStatus,
      extraExternalIds: {
        profile_id: result.profileId,
        preview_url: result.previewUrl,
      },
    };
  }

  const adapter = getAdapter(platform);
  if (platform === "meta") {
    const pageId = typeof identity?.meta_page_id === "string"
      ? identity.meta_page_id
      : "";
    const instagramId = typeof identity?.meta_instagram_user_id === "string"
      ? identity.meta_instagram_user_id
      : null;
    if (!pageId) throw new NativeAppPlanError("native_meta_identity_missing");
    const metaCreative: Record<string, unknown> = {
      destUrl: destination.storeUrl,
      message: copy.primary,
      headline: copy.headline,
      description: copy.description || undefined,
      callToActionType: "INSTALL_MOBILE_APP",
      aiGenerated: creative.aiGenerated,
      campaignName: name,
      adName: `${name} — ad`,
      metaPageId: pageId,
      metaInstagramUserId: instagramId,
      ...(creative.kind === "video"
        ? {
          videoId: creative.externalRef,
          videoThumbnailImageHash: creative.refExtra.thumbnail_image_hash,
        }
        : { imageHash: creative.externalRef }),
    } satisfies Record<string, unknown> & MetaCreateCreativeExtensions;
    const created = await createFullCampaignAtomic(adapter, connection, {
      campaign: {
        name,
        objective: "OUTCOME_APP_PROMOTION",
        bidStrategy: "LOWEST_COST_WITHOUT_CAP",
        specialAdCategories: [],
      },
      adSet: {
        name: `${name} — ad set`,
        optimizationGoal: "APP_INSTALLS",
        billingEvent: "IMPRESSIONS",
        budgetCents: providerDailyBudgetCents,
        targeting,
        promotedObject: {
          application_id: providerAppId,
          object_store_url: destination.storeUrl,
        },
        ...(startsAt ? { startTime: startsAt } : {}),
        ...(endsAt ? { endTime: endsAt } : {}),
      },
      creative: metaCreative as never,
      ad: { name: `${name} — ad` },
    });
    return created;
  }

  if (platform === "tiktok") {
    const identityId = typeof identity?.tiktok_identity_id === "string"
      ? identity.tiktok_identity_id
      : "";
    const identityType = typeof identity?.tiktok_identity_type === "string"
      ? identity.tiktok_identity_type
      : "";
    if (!identityId || !identityType) {
      throw new NativeAppPlanError("native_tiktok_identity_missing");
    }
    let locations = strings(targeting.location_ids);
    const countryCodes = locations.filter((value) => /^[A-Z]{2}$/.test(value));
    const numericLocations = locations.filter((value) => /^\d+$/.test(value));
    if (countryCodes.length) {
      locations = [
        ...numericLocations,
        ...await resolveTikTokGeo(connection, countryCodes, "APP_PROMOTION"),
      ];
    }
    if (!locations.length || locations.some((value) => !/^\d+$/.test(value))) {
      throw new NativeAppPlanError("native_tiktok_geo_unresolved");
    }
    const scheduleStart = startsAt
      ? formatTikTokScheduleTime(new Date(startsAt))
      : undefined;
    const scheduleEnd = endsAt
      ? formatTikTokScheduleTime(new Date(endsAt))
      : undefined;
    const imageIds = creative.kind === "video"
      ? [String(creative.refExtra.cover_image_id ?? "")]
      : [String(creative.refExtra.image_id ?? "")];
    if (imageIds.some((value) => !value)) {
      throw new NativeAppPlanError("native_tiktok_media_incomplete");
    }
    const tiktokAd: TikTokCreateAdExtensions = {
      adText: copy.primary,
      imageIds,
      ...(creative.kind === "video"
        ? {
          adFormat: "SINGLE_VIDEO",
          videoId: String(creative.refExtra.video_id ?? ""),
        }
        : { adFormat: "SINGLE_IMAGE" }),
      landingPageUrl: destination.storeUrl,
      identityType,
      identityId,
      callToAction: "Download",
    };
    if (creative.kind === "video" && !tiktokAd.videoId) {
      throw new NativeAppPlanError("native_tiktok_media_incomplete");
    }
    const created = await createFullCampaignAtomic(adapter, connection, {
      campaign: { name, objective: "APP_PROMOTION" },
      adSet: {
        name: `${name} — ad group`,
        optimizationGoal: "INSTALL",
        billingEvent: "OCPM",
        budgetCents: providerDailyBudgetCents,
        targeting: {
          ...targeting,
          location_ids: [...new Set(locations)],
          country_codes: countryCodes,
          promotion_type: destination.os === "ios" ? "APP_IOS" : "APP_ANDROID",
          app_id: providerAppId,
          ...(scheduleStart ? { schedule_start_time: scheduleStart } : {}),
          ...(scheduleEnd
            ? {
              schedule_type: "SCHEDULE_START_END",
              schedule_end_time: scheduleEnd,
            }
            : {}),
        },
      },
      creative: {
        destUrl: destination.storeUrl,
        message: copy.primary,
      },
      ad: { name: `${name} — ad`, ...tiktokAd },
    });
    return created;
  }

  if (!providerIconMediaId) {
    throw new NativeAppPlanError("native_snapchat_app_icon_missing");
  }
  const circles = Array.isArray(targeting.geo_circles)
    ? targeting.geo_circles as Array<Record<string, unknown>>
    : undefined;
  const snapCampaign: SnapchatCreateCampaignExtensions = {
    promotionType: "APP_INSTALL",
    measurementSpec: destination.os === "ios"
      ? { ios_app_id: destination.storeIdentifier }
      : { android_app_url: destination.storeIdentifier },
    mobileAppId: providerAppId,
    startTime: startsAt ?? undefined,
    endTime: endsAt ?? undefined,
  };
  const snapCreative: SnapchatCreateCreativeExtensions = {
    topSnapMediaId: creative.externalRef ?? undefined,
    brandName: "Mingla",
    creativeType: "APP_INSTALL",
    appName: destination.appKey === "explorer"
      ? "Mingla Explorer"
      : "Mingla Host",
    ...(destination.os === "ios"
      ? { iosAppId: destination.storeIdentifier }
      : { androidAppUrl: destination.storeIdentifier }),
    iconMediaId: providerIconMediaId,
  };
  const snapAd: SnapchatCreateAdExtensions = { creativeType: "APP_INSTALL" };
  const created = await createFullCampaignAtomic(adapter, connection, {
    campaign: {
      name,
      objective: "APP_PROMOTION",
      ...snapCampaign,
    },
    adSet: {
      name: `${name} — ad squad`,
      optimizationGoal: "APP_INSTALLS",
      billingEvent: "IMPRESSION",
      budgetCents: providerDailyBudgetCents,
      targeting: {
        countries: strings(targeting.country_codes),
        demographics: snapDemographics(targeting),
        circles,
        interests: strings(targeting.interest_category_ids),
        mobile_app_id: providerAppId,
        device_os: destination.os,
        ...(startsAt ? { start_time: startsAt } : {}),
        ...(endsAt ? { end_time: endsAt } : {}),
      },
    },
    creative: {
      destUrl: destination.storeUrl,
      message: copy.primary,
      headline: copy.headline,
      callToActionType: "INSTALL_NOW",
      campaignName: name,
      adName: `${name} — ad`,
      ...snapCreative,
    },
    ad: { name: `${name} — ad`, ...snapAd },
  });
  return created;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const authorization = req.headers.get("authorization");
  if (!authorization) return json({ error: "unauthorized" }, 401);
  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (!isPlatform(body.platform)) {
    return json({ error: "validation_error", detail: "platform_invalid" }, 400);
  }
  const platform = body.platform;
  if (body.validate_only === true) {
    return json({
      error: "validation_error",
      detail: "native_app_certification_flow_required",
    }, 422);
  }
  const planVersionId = typeof body.plan_version_id === "string"
    ? body.plan_version_id.trim()
    : "";
  const planHash = typeof body.plan_hash === "string"
    ? body.plan_hash.trim().toLowerCase()
    : "";
  const requestId = typeof body.request_id === "string"
    ? body.request_id.trim()
    : "";
  if (
    !UUID_RE.test(planVersionId) || !HASH_RE.test(planHash) ||
    requestId.length < 8 || requestId.length > 240
  ) {
    return json({
      error: "plan_required",
      detail: "immutable_plan_binding_invalid",
    }, 409);
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const jwt = authorization.replace(/^Bearer\s+/i, "");
  const { data: { user }, error: authError } = await db.auth.getUser(jwt);
  if (authError || !user) return json({ error: "unauthorized" }, 401);
  const { data: admin } = await db.from("admin_users").select("id,role")
    .eq("email", user.email).eq("status", "active").maybeSingle();
  if (!admin) return json({ error: "forbidden" }, 403);

  const { data: version, error: versionError } = await db
    .from("ad_plan_versions")
    .select(
      "id,plan_id,plan_hash,canonical_plan,destination_snapshot,host_currency,host_budget_cents",
    )
    .eq("id", planVersionId).eq("plan_hash", planHash).maybeSingle();
  if (versionError || !version) {
    return json({
      error: "plan_conflict",
      detail: "plan_version_hash_mismatch",
    }, 409);
  }
  const [planResult, allocationResult, targetingResult, confirmationResult] =
    await Promise.all([
      db.from("ad_plans")
        .select(
          "id,owner_kind,brand_id,current_version_id,state,destination_family,destination_key",
        )
        .eq("id", version.plan_id).maybeSingle(),
      db.from("ad_plan_provider_allocations").select("*")
        .eq("plan_version_id", planVersionId).eq("platform", platform)
        .maybeSingle(),
      db.from("ad_plan_targeting_snapshots")
        .select("verdict,broader_accepted,audience_intent,compiled_targeting")
        .eq("plan_version_id", planVersionId).eq("platform", platform)
        .maybeSingle(),
      db.from("ad_plan_confirmations").select(
        "id,required_phrase,provided_phrase",
      )
        .eq("plan_version_id", planVersionId).eq("plan_hash", planHash)
        .maybeSingle(),
    ]);
  const plan = planResult.data;
  const allocation = allocationResult.data;
  const targetingSnapshot = targetingResult.data;
  const confirmation = confirmationResult.data;
  if (
    planResult.error || allocationResult.error || targetingResult.error ||
    confirmationResult.error || !plan || !allocation || !targetingSnapshot ||
    !confirmation || plan.owner_kind !== "mingla" || plan.brand_id !== null ||
    plan.current_version_id !== planVersionId ||
    confirmation.required_phrase !== confirmation.provided_phrase ||
    !["exact", "broader"].includes(targetingSnapshot.verdict) ||
    (targetingSnapshot.verdict === "broader" &&
      targetingSnapshot.broader_accepted !== true)
  ) {
    return json(
      { error: "plan_conflict", detail: "plan_binding_incomplete" },
      409,
    );
  }

  let destination: FrozenNativeAppDestination;
  let targeting: Record<string, unknown>;
  let copy: ReturnType<typeof nativeAppCopyFromCanonicalPlan>;
  let creativeId: string;
  const schedule = parseCampaignSchedule(body.schedule ?? body);
  const canonicalPlan = record(version.canonical_plan);
  if (!executionTemplateMatches(canonicalPlan, platform, body)) {
    return json({
      error: "plan_conflict",
      detail: "plan_execution_template_mismatch",
    }, 409);
  }
  const certificationMode = canonicalPlan?.certification_mode === true;
  const delivery = record(canonicalPlan?.delivery_budgets);
  const platformDelivery = record(delivery?.[platform]);
  const hostDaily = Number(platformDelivery?.host_amount_cents);
  const providerDaily = Number(platformDelivery?.provider_amount_cents);
  try {
    destination = parseFrozenNativeAppDestination({
      snapshot: version.destination_snapshot,
      expectedFamily: plan.destination_family,
      expectedKey: plan.destination_key,
      platform,
    });
    assertNativeAppRequestDestination(requestDestination(body), destination);
    assertNativeAppImmutableRequest({
      canonicalPlan: version.canonical_plan,
      requestBody: body,
      startsAt: schedule.starts_at,
      endsAt: schedule.ends_at,
      hostDeliveryBudgetCents: hostDaily,
    });
    targeting = nativeCompiledTargeting(targetingSnapshot.compiled_targeting);
    copy = nativeAppCopyFromCanonicalPlan(version.canonical_plan);
    creativeId = nativeAppCreativeIdFromCanonicalPlan(version.canonical_plan);
  } catch (error) {
    if (error instanceof NativeAppPlanError) {
      return json({ error: "plan_conflict", detail: error.code }, 409);
    }
    throw error;
  }

  if (
    !Number.isSafeInteger(hostDaily) || hostDaily <= 0 ||
    !Number.isSafeInteger(providerDaily) || providerDaily <= 0 ||
    allocation.host_budget_cents !== record(body.budget)?.cap_cents ||
    allocation.host_delivery_budget_cents !== hostDaily ||
    allocation.provider_delivery_budget_cents !== providerDaily ||
    allocation.host_currency !== version.host_currency
  ) {
    return json({ error: "plan_conflict", detail: "plan_money_mismatch" }, 409);
  }

  const { data: connectionRow } = await db.from("ad_connections").select("*")
    .eq("id", allocation.connection_id).eq("platform", platform).maybeSingle();
  if (
    !connectionRow || connectionRow.connected !== true ||
    connectionRow.status !== "connected" ||
    connectionRow.currency !== allocation.provider_currency
  ) {
    return json({ error: `${platform}_not_connected` }, 424);
  }
  const connection = connectionRow as unknown as AdConnectionRow;
  const { data: binding } = await db.from("ad_app_provider_bindings")
    .select(
      "app_key,os,provider,payer_connection_id,provider_app_id,provider_measurement_id,provider_app_icon_media_id,active",
    )
    .eq("app_key", destination.appKey).eq("os", destination.os)
    .eq("provider", platform).maybeSingle();
  if (
    !binding || binding.active !== true ||
    binding.payer_connection_id !== connection.id ||
    typeof binding.provider_app_id !== "string" ||
    !binding.provider_app_id.trim() ||
    typeof binding.provider_measurement_id !== "string" ||
    !binding.provider_measurement_id.trim()
  ) {
    return json({
      error: "plan_conflict",
      detail: "native_provider_binding_invalid",
    }, 409);
  }

  let certificationCanary: Record<string, unknown> | null = null;
  if (certificationMode) {
    const { data: canary, error: canaryError } = await db
      .from("ad_app_acquisition_canaries").select("*")
      .eq("app_key", destination.appKey).eq("os", destination.os)
      .eq("provider", platform).maybeSingle();
    certificationCanary = record(canary);
    if (
      canaryError || !certificationCanary ||
      certificationCanary.plan_version_id !== planVersionId ||
      certificationCanary.plan_hash !== planHash
    ) {
      return json({
        error: "certification_approval_required",
        detail: "canary_plan_binding_missing",
      }, 409);
    }
  }

  const { data: existing } = await db.from("ad_campaigns").select(
    "*,ad_sets(*,ads(*))",
  ).eq("plan_version_id", planVersionId).eq("platform", platform)
    .maybeSingle();
  if (existing) {
    if (
      certificationMode &&
      certificationCanary?.status === "approved_to_prepare"
    ) {
      const { error: transitionError } = await db.rpc(
        "transition_ad_app_canary",
        {
          p_change: {
            action: "provider_prepared",
            app_key: destination.appKey,
            os: destination.os,
            provider: platform,
            actor: user.id,
            reason: "Recover the audited paused certification provider state.",
            expected_canary_version: certificationCanary.canary_version,
            idempotency_key: await stableUuid(
              `${planHash}:${platform}:provider_prepared`,
            ),
            external_campaign_id: existing.external_campaign_id,
            local_campaign_id: existing.id,
            provider_effective_status: existing.delivery_status ?? "PAUSED",
          },
        },
      );
      if (transitionError) {
        return json({
          error: "certification_state_recovery_required",
          detail: transitionError.message,
        }, 503);
      }
    }
    return json({ campaign: existing, idempotent_replay: true });
  }

  let identity: Record<string, unknown> | null = null;
  if (platform === "meta" || platform === "tiktok") {
    const identityResult = await db.from("ad_app_provider_identities")
      .select("*").eq("app_key", destination.appKey).eq("provider", platform)
      .eq("active", true).maybeSingle();
    identity = identityResult.data;
    if (!identity || identity.payer_lane !== connection.lane) {
      return json({
        error: "plan_conflict",
        detail: "native_public_identity_invalid",
      }, 409);
    }
  }

  const creative = await loadCreative(
    db,
    creativeId,
    platform,
    connection.lane,
    connection.external_account_id,
  ).catch((error) => error);
  if (creative instanceof Error) {
    return json({
      error: "validation_error",
      detail: creative instanceof NativeAppPlanError
        ? creative.code
        : "native_creative_lookup_failed",
    }, 422);
  }

  // Last possible check before any provider write: current exact-cell authority.
  const authorityRpc = certificationMode
    ? "can_create_native_app_canary"
    : "can_create_native_app_campaign";
  const { data: canCreate, error: readinessError } = await db.rpc(
    authorityRpc,
    certificationMode
      ? {
        p_app_key: destination.appKey,
        p_os: destination.os,
        p_provider: platform,
        p_plan_version_id: planVersionId,
        p_plan_hash: planHash,
      }
      : {
        p_app_key: destination.appKey,
        p_os: destination.os,
        p_provider: platform,
      },
  );
  if (readinessError || canCreate !== true) {
    return json({
      error: certificationMode
        ? "certification_approval_required"
        : "native_app_acquisition_not_ready",
    }, 409);
  }
  if (!certificationMode) {
    const { error: launchableError } = await db.rpc(
      "ad_plan_assert_launchable",
      {
        p_plan_version_id: planVersionId,
        p_plan_hash: planHash,
      },
    );
    if (launchableError) {
      return json({
        error: "plan_not_launchable",
        detail: launchableError.message,
      }, 409);
    }
  }

  const attemptKey = `${planHash}:${platform}:create`;
  const recordAttempt = (
    state: string,
    externalIds: Record<string, unknown>,
    providerResponse: Record<string, unknown> | null,
    errorDetail: string | null = null,
  ) =>
    db.rpc(
      certificationMode
        ? "ad_record_canary_provider_attempt"
        : "ad_record_provider_attempt",
      {
        p_plan_version_id: planVersionId,
        p_plan_hash: planHash,
        p_platform: platform,
        ...(certificationMode ? {} : { p_command: "create_paused_objects" }),
        p_idempotency_key: attemptKey,
        p_state: state,
        p_external_ids: externalIds,
        p_provider_response: providerResponse,
        p_error_detail: errorDetail,
      },
    );
  await recordAttempt("running", {}, {
    destination: destination.family,
    os: destination.os,
    certification_mode: certificationMode,
  });

  let created: ProviderCreateResult;
  try {
    created = await executeProvider({
      platform,
      connection,
      destination,
      providerAppId: binding.provider_app_id.trim(),
      providerIconMediaId:
        typeof binding.provider_app_icon_media_id === "string"
          ? binding.provider_app_icon_media_id.trim()
          : null,
      identity,
      targeting,
      creative,
      copy,
      name: String(record(version.canonical_plan)?.name ?? "").trim(),
      providerDailyBudgetCents: providerDaily,
      startsAt: schedule.starts_at,
      endsAt: schedule.ends_at,
    });
  } catch (error) {
    const detail = publicError(error);
    await recordAttempt(
      failureState(error),
      record(detail.partial_external_ids) ?? {},
      detail,
      String(detail.message ?? detail.code),
    );
    return json({ error: "provider_create_failed", detail }, 502);
  }

  const objectiveByPlatform: Record<Platform, string> = {
    meta: "OUTCOME_APP_PROMOTION",
    tiktok: "APP_PROMOTION",
    snapchat: "APP_PROMOTION",
    google: "APP_CAMPAIGN",
    reddit: "APP_INSTALLS",
  };
  const optimizationByPlatform: Record<Platform, string> = {
    meta: "APP_INSTALLS",
    tiktok: "INSTALL",
    snapchat: "APP_INSTALLS",
    google: "OPTIMIZE_INSTALLS_WITHOUT_TARGET_INSTALL_COST",
    reddit: "MOBILE_CONVERSION_INSTALL",
  };
  const billingByPlatform: Record<Platform, string> = {
    meta: "IMPRESSIONS",
    tiktok: "OCPM",
    snapchat: "IMPRESSION",
    google: "CONVERSIONS",
    reddit: "CPM",
  };

  const { data: campaignRow, error: campaignError } = await db
    .from("ad_campaigns").insert({
      connection_id: connection.id,
      platform,
      external_campaign_id: created.externalCampaignId,
      name: String(record(version.canonical_plan)?.name ?? "").trim(),
      objective: objectiveByPlatform[platform],
      status: "PAUSED",
      daily_budget_cents: hostDaily,
      delivery_status: "PAUSED",
      status_synced_at: new Date().toISOString(),
      targeting,
      dest_page_type: destination.family,
      dest_brand_slug: "mingla",
      dest_entity_slug: destination.os,
      dest_event_id: null,
      dest_venue_id: null,
      dest_url: destination.storeUrl,
      dest_smart_link: destination.oneLinkUrl,
      dest_group_id: null,
      request_id: requestId,
      created_by: user.id,
      brand_id: null,
      owner_kind: "mingla",
      cap_cents: allocation.host_budget_cents,
      lifetime_budget_cents: null,
      starts_at: schedule.starts_at,
      ends_at: schedule.ends_at,
      currency: allocation.host_currency,
      plan_version_id: planVersionId,
      plan_hash: planHash,
      host_currency: allocation.host_currency,
      provider_currency: allocation.provider_currency,
      host_budget_cents: allocation.host_budget_cents,
      provider_budget_cents: allocation.provider_budget_cents,
      provider_delivery_budget_cents: providerDaily,
      fx_snapshot_id: allocation.fx_snapshot_id,
    }).select("*").single();
  let persistError = campaignError;
  let adSetRow: Record<string, unknown> | null = null;
  let adRow: Record<string, unknown> | null = null;
  if (!persistError && campaignRow) {
    const result = await db.from("ad_sets").insert({
      campaign_id: campaignRow.id,
      external_adset_id: created.externalAdSetId,
      name: `${campaignRow.name} — ad set`,
      targeting,
      budget_cents: platform === "google" ? null : providerDaily,
      optimization_goal: optimizationByPlatform[platform],
      billing_event: billingByPlatform[platform],
      status: "PAUSED",
      schedule_start_at: schedule.starts_at,
      schedule_end_at: schedule.ends_at,
    }).select("*").single();
    adSetRow = result.data;
    persistError = result.error;
  }
  if (!persistError && adSetRow) {
    const result = await db.from("ads").insert({
      ad_set_id: adSetRow.id,
      external_ad_id: created.externalAdId,
      external_creative_id: created.externalCreativeId,
      creative_id: creative.id,
      name: `${campaignRow.name} — ad`,
      status: "PAUSED",
      review_status: created.reviewStatus,
    }).select("*").single();
    adRow = result.data;
    persistError = result.error;
  }
  if (persistError || !campaignRow || !adSetRow || !adRow) {
    if (campaignRow) {
      await db.from("ad_campaigns").delete().eq("id", campaignRow.id);
    }
    const adapter = getAdapter(platform);
    let rollbackCampaign = false;
    let rollbackCreative: boolean | null = null;
    if (created.externalCreativeId && adapter.rollbackCreative) {
      try {
        await adapter.rollbackCreative(connection, created.externalCreativeId);
        rollbackCreative = true;
      } catch {
        rollbackCreative = false;
      }
    }
    if (adapter.rollbackCampaign) {
      try {
        await adapter.rollbackCampaign(connection, created.externalCampaignId);
        rollbackCampaign = true;
      } catch {
        rollbackCampaign = false;
      }
    }
    const externalIds = {
      external_campaign_id: created.externalCampaignId,
      external_adset_id: created.externalAdSetId,
      external_creative_id: created.externalCreativeId,
      external_ad_id: created.externalAdId,
      ...created.extraExternalIds,
    };
    await recordAttempt("failed_terminal", externalIds, {
      db_error: persistError?.message ?? "incomplete_persist",
      rollback_campaign: rollbackCampaign,
      rollback_creative: rollbackCreative,
    }, "db_persist_failed");
    return json({
      error: "internal_error",
      detail: platform === "google"
        ? "db_persist_failed_paused_google_residue_recorded"
        : "db_persist_failed_provider_rollback_attempted",
    }, 500);
  }

  await db.from("ad_status_events").insert({
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
      ...created.extraExternalIds,
    },
    provider_response: {
      destination_family: destination.family,
      os: destination.os,
    },
  });
  if (certificationMode && certificationCanary) {
    const { error: transitionError } = await db.rpc(
      "transition_ad_app_canary",
      {
        p_change: {
          action: "provider_prepared",
          app_key: destination.appKey,
          os: destination.os,
          provider: platform,
          actor: user.id,
          reason: "Record the audited paused certification provider objects.",
          expected_canary_version: certificationCanary.canary_version,
          idempotency_key: await stableUuid(
            `${planHash}:${platform}:provider_prepared`,
          ),
          external_campaign_id: created.externalCampaignId,
          local_campaign_id: campaignRow.id,
          provider_effective_status: "PAUSED",
        },
      },
    );
    if (transitionError) {
      return json({
        error: "certification_state_recovery_required",
        detail: transitionError.message,
        campaign: campaignRow,
      }, 503);
    }
  }
  return json({ campaign: campaignRow, ad_set: adSetRow, ad: adRow }, 201);
});
