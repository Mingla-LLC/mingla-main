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
