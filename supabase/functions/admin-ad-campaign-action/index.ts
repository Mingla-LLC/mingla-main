/**
 * admin-ad-campaign-action — ISSUE-862 WP1 [Full Rooms Ad Engine].
 *
 * Launch / pause (SPEC §4.4c as generalized by A3 §C):
 *   - launch: fail-close on the connection; set ACTIVE TOP-DOWN — campaign →
 *     ad sets → ads (a paused parent blocks a child's delivery). Re-read
 *     effective_status; if it lands in {PENDING_BILLING_INFO, DISAPPROVED,
 *     WITH_ISSUES} the launch still returns 200 with a `warning` (that is
 *     Meta's delivery state, not our error).
 *   - pause: campaign level PAUSED (children stay as-is; the parent blocks them).
 *
 * The adapter interface can only express PAUSED|ACTIVE (AdvertiserStatus) —
 * the "Google REMOVED-never" rule is encoded at the type level; no action here
 * can ever delete/remove a platform campaign.
 *
 * Every action appends an ad_status_events audit row.
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
  getAdapter,
} from "../_shared/adChannel.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

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

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const WARNING_STATUSES = ["PENDING_BILLING_INFO", "DISAPPROVED", "WITH_ISSUES"];

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const campaignId = typeof body.campaign_id === "string" ? body.campaign_id : "";
  const action = body.action;
  if (!UUID_REGEX.test(campaignId)) {
    return json({ error: "validation_error", detail: "campaign_id_invalid_uuid" }, 400);
  }
  if (action !== "launch" && action !== "pause") {
    return json({ error: "validation_error", detail: "action_invalid" }, 400);
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

  // ── Load campaign + connection + children. ───────────────────────────────────
  const { data: campaign } = await supabase
    .from("ad_campaigns")
    .select("*")
    .eq("id", campaignId)
    .maybeSingle();
  if (!campaign) return json({ error: "not_found", detail: "campaign_not_found" }, 404);

  const { data: conn } = await supabase
    .from("ad_connections")
    .select("*")
    .eq("id", campaign.connection_id)
    .maybeSingle();
  if (!conn || !conn.connected || conn.status !== "connected") {
    return json({ error: `${campaign.platform}_not_connected` }, 424);
  }
  const connection = conn as unknown as AdConnectionRow;

  const { data: adSets } = await supabase
    .from("ad_sets")
    .select("*")
    .eq("campaign_id", campaign.id);
  const adSetIds = (adSets ?? []).map((s: Record<string, unknown>) => String(s.id));
  const { data: ads } = adSetIds.length > 0
    ? await supabase.from("ads").select("*").in("ad_set_id", adSetIds)
    : { data: [] };

  const adapter = getAdapter(campaign.platform);
  const fromStatus = String(campaign.status ?? "PAUSED");

  try {
    if (action === "launch") {
      // Top-down: campaign → ad sets → ads (§4.0 launch order).
      await adapter.setStatus(connection, "campaign", campaign.external_campaign_id, "ACTIVE");
      for (const adSet of adSets ?? []) {
        await adapter.setStatus(connection, "ad_set", String(adSet.external_adset_id), "ACTIVE");
      }
      for (const ad of ads ?? []) {
        await adapter.setStatus(connection, "ad", String(ad.external_ad_id), "ACTIVE");
      }
    } else {
      await adapter.setStatus(connection, "campaign", campaign.external_campaign_id, "PAUSED");
    }

    // Read back delivery state.
    let effectiveStatus: string | null = null;
    try {
      const status = await adapter.getStatus(connection, "campaign", campaign.external_campaign_id);
      effectiveStatus = status.effectiveStatus;
    } catch {
      effectiveStatus = null; // best-effort; sync repairs it
    }

    const toStatus = action === "launch" ? "ACTIVE" : "PAUSED";
    const nowIso = new Date().toISOString();
    const { data: updated } = await supabase
      .from("ad_campaigns")
      .update({ status: toStatus, delivery_status: effectiveStatus, status_synced_at: nowIso })
      .eq("id", campaign.id)
      .select("*")
      .maybeSingle();
    if (action === "launch") {
      if (adSetIds.length > 0) {
        await supabase.from("ad_sets").update({ status: "ACTIVE" }).in("id", adSetIds);
        await supabase.from("ads").update({ status: "ACTIVE" }).in(
          "ad_set_id",
          adSetIds,
        );
      }
    }

    await supabase.from("ad_status_events").insert({
      campaign_id: campaign.id,
      platform: campaign.platform,
      entity: "campaign",
      action,
      actor: user.id,
      from_status: fromStatus,
      to_status: toStatus,
      external_ids: { external_campaign_id: campaign.external_campaign_id },
      provider_response: effectiveStatus ? { effective_status: effectiveStatus } : null,
    });

    const warning = action === "launch" && effectiveStatus &&
        WARNING_STATUSES.includes(effectiveStatus)
      ? `Launched, but delivery is blocked upstream: effective_status=${effectiveStatus}. ` +
        (effectiveStatus === "PENDING_BILLING_INFO"
          ? "Add a payment method in Meta Ads Manager."
          : "Check Meta Ads Manager for review detail.")
      : undefined;

    return json({ campaign: updated ?? campaign, ...(warning ? { warning } : {}) });
  } catch (err) {
    if (err instanceof AdNotConnectedError) {
      return json({ error: `${campaign.platform}_not_connected` }, 424);
    }
    if (err instanceof AdApiError) {
      return json({ error: `${campaign.platform}_action_failed`, detail: err.toJSON() }, 502);
    }
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[admin-ad-campaign-action] unexpected:", detail);
    return json({ error: "internal_error" }, 500);
  }
});
