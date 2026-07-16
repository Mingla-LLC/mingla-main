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
 * GOOGLE (ISSUE-867 WP2, G-3): the ad-level sync persists BOTH review
 * vocabularies — policy_summary.approval_status (the delivery gate →
 * ads.review_status) AND policy_summary.review_status, plus
 * policy_topic_entries[] — into ads.review_detail via buildGoogleReviewDetail.
 *
 * SNAPCHAT (ISSUE-867 WP5, GR-38): TWO review vocabularies — the AD enum
 * (PENDING|APPROVED|REJECTED → ads.review_status, the delivery gate) and the
 * CREATIVE enum (PENDING_REVIEW|APPROVED) — BOTH persisted, plus
 * review_status_reasons[] (verbatim — the only machine-readable rejection
 * signal) and delivery_status, into ads.review_detail via
 * buildSnapchatReviewDetail; campaign/squad delivery_status arrays land as
 * text on ad_campaigns.delivery_status / ad_sets.external_status. Poll-only:
 * review is 3–5 business days with no SLA and Snap RE-REVIEWS post-launch —
 * the same 30–60 min-while-PENDING cron cadence as Reddit drives this fn.
 *
 * REDDIT (ISSUE-916 WP6, R-3/§6.1): Reddit has NO review_status field —
 * ads.review_status is DERIVED from ad.effective_status (PENDING_APPROVAL/
 * PROCESSING→PENDING, REJECTED→REJECTED, ACTIVE→APPROVED); billing/identity/
 * permission states leave review_status UNCHANGED and land in review_detail
 * (rejection_reason VERBATIM incl. Reddit's own FACILIATE_… typo). Poll-only:
 * no webhooks exist — cron drives this fn on a 30–60 min cadence while any
 * Reddit ad is PENDING, then daily (§6.3; the sweep is already oldest-first).
 *
 * GR-52 destination re-checker (ISSUE-867 WP2, channel-generic): every sweep
 * re-asserts each campaign's destination is still public + live (the same
 * read-only gate as create). On failure, an ACTIVE campaign is auto-PAUSED on
 * the platform + in the DB, with an ad_status_events audit row
 * (action='pause', provider_response.reason='destination_not_public'). Google
 * polices "unavailable offers"/"destination not working" for the ad's whole
 * life — this protects the ACCOUNT, not just the campaign; Meta benefits too.
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
  type DestinationQueryClient,
  destinationStillPublicLive,
  getAdapter,
} from "../_shared/adChannel.ts";
import { buildMetaReviewDetail } from "../_shared/meta.ts";
import { buildGoogleReviewDetail } from "../_shared/google.ts";
import {
  buildRedditReviewDetail,
  redditReviewStatusFromEffectiveStatus,
} from "../_shared/reddit.ts";
import { buildSnapchatReviewDetail } from "../_shared/snapchat.ts";

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
          // Per-platform review payload: Google splits what Meta merges (G-3);
          // Reddit has NO review_status field at all (R-3) — review state is
          // DERIVED from ad.effective_status, and rejection_reason +
          // delivery_status[] persist VERBATIM into review_detail (§6.1–§6.2).
          const reviewDetail = campaign.platform === "google"
            ? buildGoogleReviewDetail({
              issuesInfo: s.issuesInfo,
              adReviewFeedback: s.adReviewFeedback,
            })
            : campaign.platform === "reddit"
            ? buildRedditReviewDetail({
              issuesInfo: s.issuesInfo,
              adReviewFeedback: s.adReviewFeedback,
            })
            : campaign.platform === "snapchat"
            // ISSUE-867 WP5 (GR-38): BOTH Snap review vocabularies — the AD
            // enum (PENDING|APPROVED|REJECTED) and the CREATIVE enum
            // (PENDING_REVIEW|APPROVED) — plus review_status_reasons (the only
            // machine-readable rejection signal) and delivery_status, all into
            // review_detail. Mapping one vocabulary onto the other loses the
            // distinction; don't.
            ? buildSnapchatReviewDetail({
              issuesInfo: s.issuesInfo,
              adReviewFeedback: s.adReviewFeedback,
            })
            : buildMetaReviewDetail({
              issuesInfo: s.issuesInfo,
              adReviewFeedback: s.adReviewFeedback,
            });
          const updates: Record<string, unknown> = {
            status: s.status ?? ad.status,
            review_detail: reviewDetail,
          };
          if (campaign.platform === "reddit") {
            // §6.1: only PENDING_APPROVAL/PROCESSING/REJECTED/ACTIVE map into
            // review_status; billing/identity/permission/paused states leave
            // it UNCHANGED (they are delivery warnings, not review verdicts).
            const mapped = redditReviewStatusFromEffectiveStatus(s.effectiveStatus);
            if (mapped !== null) updates.review_status = mapped;
          } else {
            updates.review_status = s.effectiveStatus;
          }
          await supabase
            .from("ads")
            .update(updates)
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

      // ── GR-52 destination re-checker (channel-generic — ISSUE-867 WP2). ─────
      // Re-assert the destination is still public + live (same read-only gate
      // as create). A read failure is fail-OPEN here (never pause a live
      // campaign on a transient view hiccup — the next sweep retries); a
      // definitive "not public" auto-pauses an ACTIVE campaign + audits.
      let campaignRowForOutput = updatedCampaign ?? campaign;
      let destinationOk = true;
      try {
        // Narrowing cast — the supabase-js client generics are too deep for a
        // direct structural check (TS2589); same house idiom as the WP1
        // `as unknown as AdConnectionRow` row narrowing above.
        const destinationDb = supabase as unknown as DestinationQueryClient;
        destinationOk = await destinationStillPublicLive(destinationDb, {
          dest_page_type: String(campaign.dest_page_type),
          dest_brand_slug: String(campaign.dest_brand_slug),
          dest_entity_slug: campaign.dest_entity_slug ? String(campaign.dest_entity_slug) : null,
        });
      } catch {
        destinationOk = true;
      }
      const statusAfterSync = String(campaignRowForOutput.status ?? campaign.status);
      if (!destinationOk && statusAfterSync === "ACTIVE") {
        try {
          await adapter.setStatus(
            connection,
            "campaign",
            String(campaign.external_campaign_id),
            "PAUSED",
          );
          const { data: pausedRow } = await supabase
            .from("ad_campaigns")
            .update({ status: "PAUSED", status_synced_at: new Date().toISOString() })
            .eq("id", campaign.id)
            .select("*")
            .maybeSingle();
          if (pausedRow) campaignRowForOutput = pausedRow;
          await supabase.from("ad_status_events").insert({
            campaign_id: campaign.id,
            platform: campaign.platform,
            entity: "campaign",
            action: "pause",
            actor: user.id,
            from_status: statusAfterSync,
            to_status: "PAUSED",
            external_ids: { external_campaign_id: campaign.external_campaign_id },
            provider_response: { reason: "destination_not_public" },
          });
        } catch (pauseErr) {
          errors.push({
            campaign_id: campaign.id,
            error: "destination_pause_failed",
            detail: pauseErr instanceof AdApiError
              ? pauseErr.toJSON()
              : pauseErr instanceof Error
              ? pauseErr.message
              : String(pauseErr),
          });
        }
      }

      synced.push({ ...campaignRowForOutput, destination_ok: destinationOk });
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
