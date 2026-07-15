/**
 * admin-ad-campaign-sync — ISSUE-862 WP1 [Full Rooms Ad Engine].
 *
 * Status read-back (SPEC §4.4d as generalized by A3 §C, widened by GR-18):
 * for one campaign (body.campaign_id) or all, reads from the platform:
 *   - campaign: status + effective_status (+ issues_info)
 *   - ad sets:  effective_status → ad_sets.external_status
 *   - ads:      effective_status + issues_info + ad_review_feedback →
 *               ads.review_status + ads.review_detail jsonb
 *
 * HARD RULE (GR-18 / blueprint §9b): Meta's `recommendations` feed is
 * optimization tips, NOT rejection reasons — it is NEVER requested and NEVER
 * stored in review_detail (buildMetaReviewDetail strips it defensively).
 *
 * NO attribution / insights here — that is #865.
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
import { buildMetaReviewDetail } from "../_shared/meta.ts";

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

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    body = {};
  }
  const campaignId = typeof body.campaign_id === "string" ? body.campaign_id : null;
  if (campaignId && !UUID_REGEX.test(campaignId)) {
    return json({ error: "validation_error", detail: "campaign_id_invalid_uuid" }, 400);
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

  // ── Load target campaigns. ───────────────────────────────────────────────────
  // QA P3-10: the all-campaign sweep is BOUNDED — oldest-synced first, capped,
  // with `truncated` reported so a cron/UI caller knows to sweep again.
  const SYNC_SWEEP_LIMIT = 50;
  const campaignQuery = supabase.from("ad_campaigns").select("*");
  const { data: campaigns } = campaignId
    ? await campaignQuery.eq("id", campaignId)
    : await campaignQuery
      .order("status_synced_at", { ascending: true, nullsFirst: true })
      .limit(SYNC_SWEEP_LIMIT);
  if (!campaigns || campaigns.length === 0) {
    return json(campaignId ? { error: "not_found", detail: "campaign_not_found" } : { synced: [], errors: [], truncated: false }, campaignId ? 404 : 200);
  }
  const truncated = !campaignId && campaigns.length === SYNC_SWEEP_LIMIT;

  const connectionCache = new Map<string, AdConnectionRow | null>();
  const synced: Record<string, unknown>[] = [];
  const errors: Record<string, unknown>[] = [];

  for (const campaign of campaigns) {
    try {
      let connection = connectionCache.get(String(campaign.connection_id));
      if (connection === undefined) {
        const { data: conn } = await supabase
          .from("ad_connections")
          .select("*")
          .eq("id", campaign.connection_id)
          .maybeSingle();
        connection = conn && conn.connected && conn.status === "connected"
          ? conn as unknown as AdConnectionRow
          : null;
        connectionCache.set(String(campaign.connection_id), connection);
      }
      if (!connection) {
        errors.push({ campaign_id: campaign.id, error: `${campaign.platform}_not_connected` });
        continue;
      }

      const adapter = getAdapter(campaign.platform);
      const nowIso = new Date().toISOString();

      // Campaign level: status + effective_status.
      const campaignStatus = await adapter.getStatus(
        connection,
        "campaign",
        campaign.external_campaign_id,
      );
      const { data: updatedCampaign } = await supabase
        .from("ad_campaigns")
        .update({
          status: campaignStatus.status ?? campaign.status,
          delivery_status: campaignStatus.effectiveStatus,
          status_synced_at: nowIso,
        })
        .eq("id", campaign.id)
        .select("*")
        .maybeSingle();

      // Ad sets: effective_status → external_status.
      const { data: adSets } = await supabase
        .from("ad_sets")
        .select("*")
        .eq("campaign_id", campaign.id);
      for (const adSet of adSets ?? []) {
        try {
          const s = await adapter.getStatus(connection, "ad_set", String(adSet.external_adset_id));
          await supabase
            .from("ad_sets")
            .update({
              status: s.status ?? adSet.status,
              external_status: s.effectiveStatus,
            })
            .eq("id", adSet.id);
        } catch {
          // per-entity read failure is non-fatal for the sweep
        }
      }

      // Ads: review_status + review_detail (GR-18; never `recommendations`).
      const adSetIds = (adSets ?? []).map((s: Record<string, unknown>) => String(s.id));
      const { data: ads } = adSetIds.length > 0
        ? await supabase.from("ads").select("*").in("ad_set_id", adSetIds)
        : { data: [] };
      for (const ad of ads ?? []) {
        try {
          const s = await adapter.getStatus(connection, "ad", String(ad.external_ad_id));
          await supabase
            .from("ads")
            .update({
              status: s.status ?? ad.status,
              review_status: s.effectiveStatus,
              review_detail: buildMetaReviewDetail({
                issuesInfo: s.issuesInfo,
                adReviewFeedback: s.adReviewFeedback,
              }),
            })
            .eq("id", ad.id);
        } catch {
          // per-entity read failure is non-fatal for the sweep
        }
      }

      await supabase.from("ad_status_events").insert({
        campaign_id: campaign.id,
        platform: campaign.platform,
        entity: "campaign",
        action: "sync",
        actor: user.id,
        from_status: campaign.status,
        to_status: campaignStatus.status ?? campaign.status,
        provider_response: campaignStatus.effectiveStatus
          ? { effective_status: campaignStatus.effectiveStatus }
          : null,
      });

      synced.push(updatedCampaign ?? campaign);
    } catch (err) {
      if (err instanceof AdNotConnectedError) {
        errors.push({ campaign_id: campaign.id, error: `${campaign.platform}_not_connected` });
      } else if (err instanceof AdApiError) {
        errors.push({ campaign_id: campaign.id, error: "sync_failed", detail: err.toJSON() });
      } else {
        errors.push({
          campaign_id: campaign.id,
          error: "sync_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return json({ synced, errors, truncated });
});
