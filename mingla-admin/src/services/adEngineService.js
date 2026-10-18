/**
 * ISSUE-862 WP1 [Full Rooms Ad Engine] — admin service seam.
 *
 * Thin wrappers over the admin-ad-* edge fns (all verify_jwt + admin-gated
 * server-side) + direct RLS-gated reads of the ad_* tables (admin SELECT via
 * is_admin_user()). No platform token ever reaches this client — the DB stores
 * env-var NAMES only and the edge fns never echo a secret.
 *
 * Every invoke goes through invokeWithRefresh (idle-tab JWT refresh). Edge
 * errors (424 fail-close / 422 validation / 502 provider) arrive as non-2xx —
 * parseEdgeError extracts { status, body } so pages can render the normalized
 * detail (SC-7) instead of a generic failure.
 */

import { supabase, invokeWithRefresh } from "../lib/supabase";
import { normalizePreparationInvoke } from "../lib/adBuilder/preparationState";

/** Extract { status, body } from a supabase.functions.invoke error (SC-7). */
export async function parseEdgeError(error) {
  if (!error) return null;
  const status = error?.context?.status ?? error?.status ?? null;
  let body = null;
  try {
    if (error?.context && typeof error.context.json === "function") {
      body = await error.context.json();
    }
  } catch {
    body = null;
  }
  return {
    status,
    body,
    message:
      body?.detail?.message ?? body?.detail ?? body?.error ?? error.message,
  };
}

// ── Connection ────────────────────────────────────────────────────────────────

export async function getMetaConnection() {
  return supabase
    .from("ad_connections")
    .select("*")
    .eq("platform", "meta")
    .eq("lane", "consumer")
    .maybeSingle();
}

/** action: 'connect' | 'status' */
export async function connectMeta(action = "connect") {
  return invokeWithRefresh("admin-ad-connect", {
    body: { platform: "meta", lane: "consumer", action },
  });
}

// ── ISSUE-978 [Ad Connections panel] — generalizes connectMeta to all 5 ──────

/**
 * action: 'connect' | 'status'. Generalizes connectMeta to any of the 5
 * live channels (admin-ad-connect already connects/verifies all of them —
 * see the function's own header comment). No token ever reaches this client;
 * the call is authenticated by the admin's own session JWT (invokeWithRefresh).
 */
export async function connectChannel(
  platform,
  action = "connect",
  lane = "consumer",
) {
  return invokeWithRefresh("admin-ad-connect", {
    body: { platform, lane, action },
  });
}

/** All ad_connections rows for a lane (one read covers all 5 platforms — a
 * platform with no row yet, e.g. Google pre-provisioning, is simply absent
 * from the result; callers must not fabricate a row for it). */
export async function getConnections(lane = "consumer") {
  return supabase.from("ad_connections").select("*").eq("lane", lane);
}

// ── Preflight ─────────────────────────────────────────────────────────────────

/** platform omitted → all five channels (stubs report not_connected). */
export async function runPreflight(platform) {
  return invokeWithRefresh("admin-ad-preflight", {
    body: { lane: "consumer", ...(platform ? { platform } : {}) },
  });
}

/** Issue #1928: exact app/public-identity check. Mutation-free by contract. */
export async function runAppIdentityPreflight(appKey, { signal } = {}) {
  return invokeWithRefresh("admin-ad-app-identity-preflight", {
    body: { app_key: appKey, providers: ["meta", "tiktok"] },
    ...(signal ? { signal } : {}),
  });
}

// ── Issue #1950: server-owned app-download readiness ────────────────────────

export async function loadAppReadiness(appKey, os, { signal } = {}) {
  return invokeWithRefresh("admin-ad-app-readiness", {
    body: { action: "load", app_key: appKey, os },
    ...(signal ? { signal } : {}),
  });
}

export async function checkAppReadiness(appKey, os, { signal } = {}) {
  return invokeWithRefresh("admin-ad-app-readiness", {
    body: { action: "check", app_key: appKey, os },
    ...(signal ? { signal } : {}),
  });
}

/** Issue #2015: audited safe-ID registry write. Never creates provider objects. */
export async function setAppReadinessSafeBinding(input, { signal } = {}) {
  return invokeWithRefresh("admin-ad-app-readiness", {
    body: { action: "set_safe_binding", ...input },
    ...(signal ? { signal } : {}),
  });
}

/** Issue #3697: load or transition one explicit app-certification cell. */
export async function appCertificationAction(payload, { signal } = {}) {
  return invokeWithRefresh("admin-ad-app-certification", {
    body: payload,
    ...(signal ? { signal } : {}),
  });
}

export async function recordAppReadinessEvent(event) {
  return invokeWithRefresh("admin-ad-app-readiness-event", { body: event });
}

// ── Campaigns ─────────────────────────────────────────────────────────────────

export async function listCampaigns() {
  return supabase
    .from("ad_campaigns")
    .select("*, ad_sets(*, ads(*))")
    .order("created_at", { ascending: false });
}

/** Creative Library inventory for the unified Admin Ads surface. */
export async function listAdCreatives() {
  return supabase
    .from("ad_creatives")
    .select(
      "id,name,kind,status,source_url,poster_url,mp4_master_url,duration_seconds,aspect_ratio,brand_id,created_at,updated_at",
    )
    .order("created_at", { ascending: false })
    .limit(250);
}

/** The atomic create (everything PAUSED). payload matches admin-ad-create-campaign. */
export async function createCampaign(payload) {
  const destinationFamily = payload?.destination?.page_type;
  const endpoint = ["explorer_app", "host_app"].includes(destinationFamily)
    ? "admin-ad-create-native-app-campaign"
    : "admin-ad-create-campaign";
  return invokeWithRefresh(endpoint, { body: payload });
}

/** Issue #3697 v1.4 immutable plan lifecycle shared by Admin, Host and Ari. */
export async function adPlanAction(payload) {
  return invokeWithRefresh("ad-plan", { body: payload });
}

export async function loadAdminAdRecoveryQueue() {
  return adPlanAction({ action: "recovery_queue" });
}

async function planActionOrThrow(payload, fallback) {
  const { data, error } = await adPlanAction(payload);
  if (!error) return data;
  const parsed = await parseEdgeError(error);
  throw new Error(String(parsed?.message ?? fallback));
}

/** Resume only the missing PAUSED provider objects from a frozen Admin plan. */
export async function resumeAdminAdPlan(planId) {
  let aggregate = await planActionOrThrow(
    { action: "get", plan_id: planId },
    "The frozen plan could not be loaded.",
  );
  const { plan, version } = aggregate ?? {};
  if (plan?.owner_kind !== "mingla" || !version?.id || !version?.plan_hash) {
    throw new Error("This is not a recoverable Mingla plan.");
  }
  if (plan.state === "creation_failed_terminal") {
    throw new Error(
      "This plan has a terminal provider failure. Inspect the provider evidence before creating a new version.",
    );
  }
  if (
    ![
      "ready_for_funding",
      "funded_held",
      "creating_paused_objects",
      "creation_failed_retryable",
    ].includes(plan.state)
  ) {
    throw new Error(
      `Plan state ${plan.state} cannot resume provider creation.`,
    );
  }
  const templates = version.canonical_plan?.execution_payloads;
  if (!templates || typeof templates !== "object" || Array.isArray(templates)) {
    throw new Error(
      "This older plan has no sealed execution template. Rebuild it in Campaign Builder; no provider action was taken.",
    );
  }
  if (plan.state === "ready_for_funding") {
    await planActionOrThrow(
      {
        action: "fund",
        plan_version_id: version.id,
        plan_hash: version.plan_hash,
      },
      "The provider-account funding binding failed.",
    );
  }
  await planActionOrThrow(
    {
      action: "confirm_launch",
      plan_version_id: version.id,
      plan_hash: version.plan_hash,
      phrase: "CREATE PAUSED",
    },
    "The exact paused-create confirmation failed.",
  );

  const existingPlatforms = new Set(
    (aggregate.campaigns ?? []).map((campaign) => campaign.platform),
  );
  for (const allocation of aggregate.provider_allocations ?? []) {
    const platform = allocation.platform;
    if (existingPlatforms.has(platform)) continue;
    const template = templates[platform];
    if (!template || typeof template !== "object" || Array.isArray(template)) {
      throw new Error(`The sealed ${platform} execution template is missing.`);
    }
    const payload = structuredClone(template);
    payload.plan_version_id = version.id;
    payload.plan_hash = version.plan_hash;
    const { error } = await createCampaign(payload);
    if (error) {
      const parsed = await parseEdgeError(error);
      const detail = String(
        parsed?.body?.detail?.message ??
          parsed?.body?.detail ??
          parsed?.message ??
          `${platform} create failed.`,
      );
      await adPlanAction({
        action: "record_create_failure",
        plan_version_id: version.id,
        plan_hash: version.plan_hash,
        platform,
        error_detail: detail,
      });
      throw new Error(`${platform}: ${detail}`);
    }
  }
  aggregate = await planActionOrThrow(
    { action: "get", plan_id: planId },
    "The recovered plan could not be reloaded.",
  );
  return aggregate;
}

/** Cancel a frozen Mingla plan only while provider-object evidence is absent. */
export async function cancelAdminAdPlan(item, reason) {
  const version = item?.version;
  if (!version?.id || !version?.plan_hash) {
    throw new Error("The frozen plan binding is missing.");
  }
  return planActionOrThrow(
    {
      action: "cancel_before_create",
      plan_version_id: version.id,
      plan_hash: version.plan_hash,
      phrase: "CANCEL PLAN",
      reason,
      idempotency_key: `admin_cancel_${version.plan_hash}`.slice(0, 120),
    },
    "The frozen plan could not be canceled.",
  );
}

/**
 * action: 'launch' | 'pause' | 'end'
 * Launch and End require an exact phrase + reason; Pause is reversible.
 */
export async function campaignAction(campaignId, action, extras = {}) {
  const body = { campaign_id: campaignId, action };
  if (action === "launch" || action === "end") {
    if (typeof extras.confirm_phrase === "string") {
      body.confirm_phrase = extras.confirm_phrase;
    }
    if (typeof extras.reason === "string") {
      body.reason = extras.reason;
    }
  }
  return invokeWithRefresh("admin-ad-campaign-action", { body });
}

/** campaignId omitted → sync all. */
export async function syncCampaigns(campaignId) {
  return invokeWithRefresh("admin-ad-campaign-sync", {
    body: campaignId ? { campaign_id: campaignId } : {},
  });
}

// ── ISSUE-864 WP4 [Campaign Builder] — additive extensions ────────────────────

/** Connection row for any (platform, lane) — generalizes getMetaConnection. */
export async function getConnection(platform, lane = "consumer") {
  return supabase
    .from("ad_connections")
    .select("*")
    .eq("platform", platform)
    .eq("lane", lane)
    .maybeSingle();
}

/** ONE campaign with its nested ad sets + ads (review_status + review_detail). */
export async function getCampaignDetail(campaignId) {
  return supabase
    .from("ad_campaigns")
    .select("*, ad_sets(*, ads(*))")
    .eq("id", campaignId)
    .maybeSingle();
}

export async function getPlanSettlements(planVersionId) {
  return supabase
    .from("ad_campaign_settlements")
    .select("*")
    .eq("plan_version_id", planVersionId)
    .order("created_at", { ascending: true });
}

/**
 * ISSUE-865 PR1 WP-4 — per-campaign conversions & ROI for the campaign-detail
 * "Conversions & ROI" panel. Reads the SECURITY DEFINER, self-authorizing
 * `ad_campaign_conversion_rollup(p_campaign_id)` RPC (conversions, attributed
 * value per currency, by-platform, send health; spend_cents is NULL — no in-DB
 * spend source yet, so the panel never fabricates ROAS). Returns the raw
 * { data, error } (the page toasts the error), matching this service's contract.
 */
export async function getCampaignConversions(campaignId) {
  return supabase.rpc("ad_campaign_conversion_rollup", {
    p_campaign_id: campaignId,
  });
}

/** Admin-only attributed Stay request/booking/refund funnel. */
export async function getStayCampaignRollup(campaignId) {
  return supabase.rpc("admin_stay_ad_campaign_rollup", {
    p_campaign_id: campaignId,
  });
}

/**
 * ISSUE-989 [Campaign Builder real targeting] — admin-ad-targeting-search: turn
 * a typed city/interest NAME into per-platform targeting keys/ids. READ-ONLY,
 * admin-gated server-side (no platform token reaches this client). Fail-open:
 * the fn returns { results:[], warning } on a provider hiccup, never an error.
 * kind ∈ 'city' | 'interest'; country is the ISO code that disambiguates a city.
 */
export async function searchTargeting({
  platform,
  kind,
  q,
  country,
  lane = "consumer",
}) {
  return invokeWithRefresh("admin-ad-targeting-search", {
    body: { platform, kind, q, lane, ...(country ? { country } : {}) },
  });
}

/**
 * admin-ad-creative-upload (#866): action='validate' returns the byte-probe +
 * per-channel matrix report WITHOUT writing; action='record' persists the
 * ad_creatives row. The client must have already put the bytes in storage
 * (image → meta-ad-creatives bucket via mediaUpload.js).
 */
export async function creativeUpload(payload) {
  return invokeWithRefresh("admin-ad-creative-upload", { body: payload });
}

// ── ISSUE-1184 [Video Phase A] ──────────────────────────────────────────────

/**
 * Preparation is one platform per call. A newly discovered provider-terminal
 * result is deliberately returned by the edge as a canonical 502 envelope;
 * normalize that envelope into authoritative row data so the UI can render
 * Retry immediately instead of replacing it with a generic transport error.
 */
export async function prepareVideoCreative(payload) {
  const result = await invokeWithRefresh("admin-ad-creative-prepare", {
    body: payload,
  });
  if (!result.error) return result;
  const parsed = await parseEdgeError(result.error);
  return normalizePreparationInvoke(result, parsed);
}

export function startVideoPreparation(input) {
  return prepareVideoCreative({ ...input, action: "start" });
}

export function checkVideoPreparation(input) {
  return prepareVideoCreative({ ...input, action: "status" });
}

export function retryVideoPreparation(input) {
  return prepareVideoCreative({ ...input, action: "retry" });
}

/** Real previews exist only for Meta and TikTok; Snap/Google remain local. */
export async function requestVideoPreview(payload) {
  const result = await invokeWithRefresh("admin-ad-preview", { body: payload });
  if (!result.error) return result;
  return { ...result, parsedError: await parseEdgeError(result.error) };
}
