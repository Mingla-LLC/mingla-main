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
  return { status, body, message: body?.detail?.message ?? body?.detail ?? body?.error ?? error.message };
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
export async function connectChannel(platform, action = "connect", lane = "consumer") {
  return invokeWithRefresh("admin-ad-connect", {
    body: { platform, lane, action },
  });
}

/** All ad_connections rows for a lane (one read covers all 5 platforms — a
 * platform with no row yet, e.g. Google pre-provisioning, is simply absent
 * from the result; callers must not fabricate a row for it). */
export async function getConnections(lane = "consumer") {
  return supabase
    .from("ad_connections")
    .select("*")
    .eq("lane", lane);
}

// ── Preflight ─────────────────────────────────────────────────────────────────

/** platform omitted → all five channels (stubs report not_connected). */
export async function runPreflight(platform) {
  return invokeWithRefresh("admin-ad-preflight", {
    body: { lane: "consumer", ...(platform ? { platform } : {}) },
  });
}

// ── Campaigns ─────────────────────────────────────────────────────────────────

export async function listCampaigns() {
  return supabase
    .from("ad_campaigns")
    .select("*, ad_sets(*, ads(*))")
    .order("created_at", { ascending: false });
}

/** The atomic create (everything PAUSED). payload matches admin-ad-create-campaign. */
export async function createCampaign(payload) {
  return invokeWithRefresh("admin-ad-create-campaign", { body: payload });
}

/** action: 'launch' | 'pause' */
export async function campaignAction(campaignId, action) {
  return invokeWithRefresh("admin-ad-campaign-action", {
    body: { campaign_id: campaignId, action },
  });
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

/**
 * ISSUE-989 [Campaign Builder real targeting] — admin-ad-targeting-search: turn
 * a typed city/interest NAME into per-platform targeting keys/ids. READ-ONLY,
 * admin-gated server-side (no platform token reaches this client). Fail-open:
 * the fn returns { results:[], warning } on a provider hiccup, never an error.
 * kind ∈ 'city' | 'interest'; country is the ISO code that disambiguates a city.
 */
export async function searchTargeting({ platform, kind, q, country, lane = "consumer" }) {
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
  const result = await invokeWithRefresh("admin-ad-creative-prepare", { body: payload });
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
