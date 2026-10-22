/**
 * admin-ad-spend-sync — toward #3697 Wave 2 (#3701 / #3705).
 *
 * Hourly worker (pg_cron): pull platform daily spend into ad_spend_daily,
 * pause ACTIVE campaigns at 98% of the immutable provider-account cap, after
 * ends_at, or when their public destination is no longer advertisable.
 *
 * Auth: service-role Bearer (cron) OR active admin JWT (manual refresh).
 * verify_jwt = false so the cron POST is accepted; in-code gate is mandatory.
 *
 * All five providers normalize their daily spend into the shared feed.
 */

// @ts-ignore — Deno ESM import; types resolved at runtime.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore — Deno ESM import; types resolved at runtime.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  AdApiError,
  type AdConnectionRow,
  AdNotConnectedError,
  getAdapter,
  isPlatform,
  type Platform,
} from "../_shared/adChannel.ts";
import {
  type CampaignSpendTarget,
  decideSpendSync,
  parseGoogleAdsSpend,
  parseMetaInsightsSpend,
  parseRedditReportSpend,
  parseSnapchatStatsSpend,
  parseTikTokReportSpend,
  preserveObservedSpend,
  providerCapCents,
  type SpendDayRow,
  type SpendSyncDecision,
  sumSpendCents,
} from "../_shared/adSpendSync.ts";
import {
  type AdStageMetricRow,
  type AdStageMetricTarget,
  parseMetaStageMetrics,
  parseSnapchatStageMetrics,
  parseTikTokStageMetrics,
} from "../_shared/adStageReporting.ts";
import { metaGraph, resolveMetaClient } from "../_shared/meta.ts";
import { resolveTikTokClient, tiktokApi } from "../_shared/tiktok.ts";
import { resolveSnapchatClient } from "../_shared/snapchat.ts";
import {
  fetchSnapchatAdSquadStats,
  fetchSnapchatCampaignStats,
} from "../_shared/snapchatSpendStats.ts";
import { googleAdsRequest, resolveGoogleClient } from "../_shared/google.ts";
import { redditRequest, resolveRedditClient } from "../_shared/reddit.ts";
import {
  AdDestinationError,
  resolveAdDestination,
} from "../_shared/adDestination.ts";
import { markPlanPaused } from "../_shared/adPlanPauseTransition.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function isServiceBearer(req: Request): boolean {
  if (!SERVICE_KEY) return false;
  const header = req.headers.get("Authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (presented.length !== SERVICE_KEY.length) return false;
  let diff = 0;
  for (let i = 0; i < SERVICE_KEY.length; i += 1) {
    diff |= presented.charCodeAt(i) ^ SERVICE_KEY.charCodeAt(i);
  }
  return diff === 0;
}

async function isActiveAdmin(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  req: Request,
): Promise<boolean> {
  const header = req.headers.get("Authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const jwt = header.slice(7).trim();
  const { data: { user }, error } = await supabase.auth.getUser(jwt);
  if (error || !user?.email) return false;
  const { data: adminRow } = await supabase
    .from("admin_users")
    .select("id")
    .eq("email", user.email)
    .eq("status", "active")
    .maybeSingle();
  return !!adminRow;
}

async function fetchMetaSpendDays(
  conn: AdConnectionRow,
  externalCampaignId: string,
): Promise<SpendDayRow[]> {
  const client = resolveMetaClient(conn);
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30);
  const until = new Date();
  const payload = await metaGraph(
    client,
    "GET",
    `${externalCampaignId}/insights`,
    {
      fields:
        "spend,impressions,clicks,inline_link_clicks,account_currency,date_start",
      time_increment: 1,
      time_range: JSON.stringify({
        since: since.toISOString().slice(0, 10),
        until: until.toISOString().slice(0, 10),
      }),
      level: "campaign",
      limit: 100,
    },
  );
  return parseMetaInsightsSpend(payload);
}

function spendWindow(): { since: string; until: string } {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30);
  const until = new Date();
  return {
    since: since.toISOString().slice(0, 10),
    until: until.toISOString().slice(0, 10),
  };
}

async function fetchTikTokSpendDays(
  conn: AdConnectionRow,
  externalCampaignId: string,
): Promise<SpendDayRow[]> {
  const client = resolveTikTokClient(conn);
  const { since, until } = spendWindow();
  const payload = await tiktokApi(client, "GET", "report/integrated/get/", {
    advertiser_id: client.advertiserId,
    report_type: "BASIC",
    data_level: "AUCTION_CAMPAIGN",
    dimensions: ["campaign_id", "stat_time_day"],
    metrics: ["spend", "impressions", "clicks"],
    start_date: since,
    end_date: until,
    filtering: { campaign_ids: [externalCampaignId] },
    page_size: 1000,
  });
  return parseTikTokReportSpend(payload);
}

async function fetchSnapchatSpendDays(
  conn: AdConnectionRow,
  externalCampaignId: string,
  timeZoneCache: Map<string, string | null>,
): Promise<SpendDayRow[]> {
  const client = await resolveSnapchatClient(conn);
  // #3697: relative path (apiBase already ends in /v1) + account-timezone
  // local-midnight window ≤ 28 days — Snap's DAY-granularity contract.
  const payload = await fetchSnapchatCampaignStats(client, externalCampaignId, {
    timeZoneCache,
  });
  return parseSnapchatStatsSpend(payload);
}

async function fetchPaidSocialStageMetrics(
  connection: AdConnectionRow,
  platform: Platform,
  externalCampaignId: string,
  targets: readonly AdStageMetricTarget[],
  snapchatTimeZoneCache: Map<string, string | null>,
): Promise<AdStageMetricRow[]> {
  if (targets.length === 0) return [];
  if (platform === "meta") {
    const client = resolveMetaClient(connection);
    const { since, until } = spendWindow();
    const payload = await metaGraph(
      client,
      "GET",
      `${externalCampaignId}/insights`,
      {
        fields: "adset_id,spend,impressions,reach,frequency,actions,date_start",
        time_increment: 1,
        time_range: { since, until },
        level: "adset",
        limit: 1000,
      },
    );
    return parseMetaStageMetrics(payload, targets);
  }
  if (platform === "tiktok") {
    const client = resolveTikTokClient(connection);
    const { since, until } = spendWindow();
    const payload = await tiktokApi(client, "GET", "report/integrated/get/", {
      advertiser_id: client.advertiserId,
      report_type: "BASIC",
      data_level: "AUCTION_ADGROUP",
      dimensions: ["adgroup_id", "stat_time_day"],
      metrics: [
        "spend",
        "impressions",
        "reach",
        "frequency",
        "landing_page_view",
        "conversion",
        "total_complete_payment",
      ],
      start_date: since,
      end_date: until,
      filtering: { campaign_ids: [externalCampaignId] },
      page_size: 1000,
    });
    return parseTikTokStageMetrics(payload, targets);
  }
  if (platform === "snapchat") {
    const client = await resolveSnapchatClient(connection);
    const batches = await Promise.all(targets.map(async (target) => {
      const payload = await fetchSnapchatAdSquadStats(
        client,
        target.externalAdSetId,
        { timeZoneCache: snapchatTimeZoneCache },
      );
      return parseSnapchatStageMetrics(payload, target);
    }));
    return batches.flat();
  }
  return [];
}

async function fetchGoogleSpendDays(
  conn: AdConnectionRow,
  externalCampaignId: string,
): Promise<SpendDayRow[]> {
  const client = await resolveGoogleClient(conn);
  if (!/^\d+$/.test(externalCampaignId)) {
    throw new Error("google_campaign_id_invalid");
  }
  const { since, until } = spendWindow();
  const query =
    "SELECT campaign.id, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks " +
    `FROM campaign WHERE campaign.id = ${externalCampaignId} ` +
    `AND segments.date BETWEEN '${since}' AND '${until}'`;
  const { payload } = await googleAdsRequest(
    client,
    `customers/${client.customerId}/googleAds:search`,
    { query, pageSize: 1000 },
  );
  return parseGoogleAdsSpend(payload);
}

async function fetchRedditSpendDays(
  conn: AdConnectionRow,
  externalCampaignId: string,
): Promise<SpendDayRow[]> {
  const client = await resolveRedditClient(conn);
  const accountId = String(conn.external_account_id ?? "").trim();
  if (!accountId) throw new Error("reddit_account_id_missing");
  const { since, until } = spendWindow();
  const payload = await redditRequest(
    client,
    "POST",
    `/ad_accounts/${encodeURIComponent(accountId)}/reports`,
    {
      starts_at: `${since}T00:00:00Z`,
      ends_at: `${until}T23:59:59Z`,
      fields: ["SPEND", "IMPRESSIONS", "CLICKS"],
      breakdowns: ["CAMPAIGN_ID", "DATE"],
      filter: `campaign:id==${externalCampaignId}`,
    },
  );
  return parseRedditReportSpend(payload);
}

async function loadCumulativeSpendCents(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  campaignId: string,
): Promise<{ ok: true; cents: number } | { ok: false; detail: string }> {
  const { data, error } = await supabase
    .from("ad_spend_daily")
    .select("spend_cents")
    .eq("campaign_id", campaignId);
  if (error) {
    return { ok: false, detail: `spend_read_failed: ${error.message}` };
  }
  if (!Array.isArray(data)) {
    return { ok: false, detail: "spend_read_failed: unexpected_payload" };
  }
  return {
    ok: true,
    cents: sumSpendCents(
      data.map((row: { spend_cents?: unknown }) => ({
        spend_date: "1970-01-01",
        spend_cents: Number(row.spend_cents) || 0,
      })),
    ),
  };
}

async function touchSpendSyncWatermark(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  campaignId: string,
): Promise<string | null> {
  const { error } = await supabase
    .from("ad_campaigns")
    .update({ status_synced_at: new Date().toISOString() })
    .eq("id", campaignId);
  return error?.message ?? null;
}

async function pauseCampaignForReason(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  target: CampaignSpendTarget,
  connectionId: unknown,
  planId: unknown,
  reason: string,
  totalSpendCents: number,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  try {
    const { data: conn, error: connErr } = await supabase
      .from("ad_connections")
      .select("*")
      .eq("id", connectionId)
      .maybeSingle();
    if (connErr) {
      return {
        ok: false,
        detail: `pause_connection_read_failed: ${connErr.message}`,
      };
    }
    if (!conn) {
      return { ok: false, detail: "pause_connection_missing" };
    }
    const adapter = getAdapter(target.platform);
    await adapter.setStatus(
      conn as AdConnectionRow,
      "campaign",
      target.external_campaign_id,
      "PAUSED",
    );
    const { error: updErr } = await supabase
      .from("ad_campaigns")
      .update({
        status: "PAUSED",
        auto_pause_reason: reason,
        status_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", target.id);
    if (updErr) {
      return {
        ok: false,
        detail: `pause_status_write_failed: ${updErr.message}`,
      };
    }
    const { error: auditErr } = await supabase.from("ad_status_events").insert({
      campaign_id: target.id,
      platform: target.platform,
      entity: "campaign",
      action: "pause",
      actor: null,
      from_status: "ACTIVE",
      to_status: "PAUSED",
      external_ids: { external_campaign_id: target.external_campaign_id },
      provider_response: {
        reason,
        total_spend_cents: totalSpendCents,
        provider_cap_cents: providerCapCents(target),
        provider_currency: target.provider_currency,
      },
    });
    if (auditErr) {
      return {
        ok: false,
        detail: `pause_audit_write_failed: ${auditErr.message}`,
      };
    }
    if (typeof planId === "string" && UUID_REGEX.test(planId)) {
      const planPause = await markPlanPaused(supabase, planId, reason);
      if (!planPause.ok) {
        return { ok: false, detail: planPause.detail };
      }
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function reconcileStoppedCampaign(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  target: CampaignSpendTarget,
  connection: AdConnectionRow,
  totalProviderSpendCents: number,
): Promise<Record<string, unknown> | null> {
  const { data: settlement, error: settlementError } = await supabase
    .from("ad_campaign_settlements")
    .select("*")
    .eq("campaign_id", target.id)
    .maybeSingle();
  if (settlementError || !settlement) return null;
  if (
    settlement.state === "settled" || settlement.state === "attention_required"
  ) {
    return { settlement: settlement.state };
  }

  if (
    settlement.state === "ready_to_settle" &&
    Number(settlement.final_provider_spend_cents) === totalProviderSpendCents
  ) {
    const settleAfter = Date.parse(String(settlement.settle_after ?? ""));
    if (Number.isFinite(settleAfter) && Date.now() >= settleAfter) {
      const { data, error } = await supabase.rpc(
        "ad_finalize_campaign_settlement",
        {
          p_campaign_id: target.id,
          // A multi-provider plan has one independently finalizing campaign
          // per provider. Key settlement by both immutable plan and campaign;
          // sharing one key could make the first provider suppress the rest.
          p_idempotency_key: `settlement:${settlement.plan_hash}:${target.id}`,
          p_now: new Date().toISOString(),
        },
      );
      return error
        ? { settlement: "finalize_failed", detail: error.message }
        : { settlement: data?.state ?? "ready_to_settle" };
    }
    return { settlement: "awaiting_finality_window" };
  }

  let providerStatus: string;
  try {
    const status = await getAdapter(target.platform).getStatus(
      connection,
      "campaign",
      target.external_campaign_id,
    );
    providerStatus = String(status.effectiveStatus ?? "").toUpperCase();
  } catch (error) {
    return {
      settlement: "provider_status_check_failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  if (providerStatus !== "PAUSED") {
    return {
      settlement: "provider_stop_pending",
      provider_status: providerStatus,
    };
  }
  const { data: campaign } = await supabase.from("ad_campaigns")
    .select("plan_version_id, plan_hash, platform, external_campaign_id")
    .eq("id", target.id).maybeSingle();
  if (!campaign?.plan_version_id || !campaign?.plan_hash) {
    return { settlement: "legacy_campaign_reconciliation_required" };
  }
  await supabase.rpc("ad_record_provider_attempt", {
    p_plan_version_id: campaign.plan_version_id,
    p_plan_hash: campaign.plan_hash,
    p_platform: target.platform,
    p_command: "stop",
    p_idempotency_key: `stop:${campaign.plan_hash}:${target.platform}`,
    p_state: "succeeded",
    p_external_ids: { campaign_id: target.external_campaign_id },
    p_provider_response: { status: providerStatus },
    p_error_detail: null,
  });
  const { data, error } = await supabase.rpc("ad_confirm_campaign_stop", {
    p_campaign_id: target.id,
    p_final_provider_spend_cents: totalProviderSpendCents,
    p_provider_currency: target.provider_currency,
    p_final_spend_observed_at: new Date().toISOString(),
    p_provider_evidence: {
      provider_status: providerStatus,
      source: "admin-ad-spend-sync",
    },
    p_finality_delay: "24 hours",
  });
  return error
    ? { settlement: "confirmation_failed", detail: error.message }
    : { settlement: data?.state ?? "ready_to_settle" };
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const serviceOk = isServiceBearer(req);
  const adminOk = serviceOk ? false : await isActiveAdmin(supabase, req);
  if (!serviceOk && !adminOk) return json({ error: "unauthorized" }, 401);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    body = {};
  }
  const onlyCampaignId = typeof body.campaign_id === "string"
    ? body.campaign_id
    : null;

  let query = supabase
    .from("ad_campaigns")
    .select(
      "id, platform, external_campaign_id, status, cap_cents, currency, provider_budget_cents, amended_provider_budget_cents, ends_at, provider_currency, connection_id, dest_page_type, dest_brand_slug, dest_entity_slug, plan_version:ad_plan_versions(plan_id)",
    )
    .in("status", ["ACTIVE", "PAUSED"])
    .order("status_synced_at", { ascending: true, nullsFirst: true })
    .limit(80);
  if (onlyCampaignId) query = query.eq("id", onlyCampaignId);

  const { data: campaigns, error: listErr } = await query;
  if (listErr) {
    return json({ error: "list_failed", detail: listErr.message }, 503);
  }

  const results: Array<Record<string, unknown>> = [];
  let paused = 0;
  let upserted = 0;
  let stageMetricsUpserted = 0;
  // #3697: one Snap ad-account timezone read per account per sync run.
  const snapchatTimeZoneCache = new Map<string, string | null>();

  for (const raw of campaigns ?? []) {
    const row = raw as Record<string, unknown>;
    const platform = String(row.platform ?? "");
    if (!isPlatform(platform)) {
      results.push({ campaign_id: row.id, skipped: "platform_invalid" });
      await touchSpendSyncWatermark(supabase, String(row.id));
      continue;
    }
    const target: CampaignSpendTarget = {
      id: String(row.id),
      platform: platform as Platform,
      external_campaign_id: String(row.external_campaign_id ?? ""),
      status: String(row.status ?? ""),
      cap_cents: typeof row.cap_cents === "number" ? row.cap_cents : null,
      currency: typeof row.currency === "string" ? row.currency : null,
      provider_budget_cents: typeof row.provider_budget_cents === "number"
        ? row.provider_budget_cents
        : null,
      // #3697: a governed budget change moves the enforced cap.
      amended_provider_budget_cents:
        typeof row.amended_provider_budget_cents === "number"
          ? row.amended_provider_budget_cents
          : null,
      ends_at: typeof row.ends_at === "string" ? row.ends_at : null,
      provider_currency: typeof row.provider_currency === "string"
        ? row.provider_currency
        : null,
    };
    if (!target.external_campaign_id) {
      results.push({ campaign_id: target.id, skipped: "no_external_id" });
      await touchSpendSyncWatermark(supabase, target.id);
      continue;
    }

    if (
      typeof target.provider_currency !== "string" ||
      !/^[A-Z]{3}$/.test(target.provider_currency.trim().toUpperCase())
    ) {
      const cumulative = await loadCumulativeSpendCents(supabase, target.id);
      if (target.status === "ACTIVE" && cumulative.ok) {
        const pauseResult = await pauseCampaignForReason(
          supabase,
          target,
          row.connection_id,
          (row.plan_version as { plan_id?: unknown } | null)?.plan_id,
          "provider_currency_unresolved",
          cumulative.cents,
        );
        if (pauseResult.ok) paused += 1;
        results.push({
          campaign_id: target.id,
          ...(pauseResult.ok
            ? { paused: "provider_currency_unresolved" }
            : { pause_failed: pauseResult.detail }),
          total_spend_cents: cumulative.cents,
        });
      } else {
        results.push({
          campaign_id: target.id,
          error: cumulative.ok
            ? "provider_currency_unresolved"
            : cumulative.detail,
          retryable: true,
        });
        await touchSpendSyncWatermark(supabase, target.id);
      }
      continue;
    }

    if (target.status === "ACTIVE") {
      let destinationPause:
        | "destination_unavailable"
        | "destination_check_failed"
        | null = null;
      try {
        await resolveAdDestination(supabase, {
          page_type: row.dest_page_type,
          brand_slug: row.dest_brand_slug,
          entity_slug: row.dest_entity_slug,
        });
      } catch (err) {
        destinationPause = err instanceof AdDestinationError && err.status < 500
          ? "destination_unavailable"
          : "destination_check_failed";
      }
      if (destinationPause) {
        const cumulative = await loadCumulativeSpendCents(supabase, target.id);
        if (!cumulative.ok) {
          results.push({
            campaign_id: target.id,
            error: cumulative.detail,
            destination_check: destinationPause,
            retryable: true,
          });
          await touchSpendSyncWatermark(supabase, target.id);
          continue;
        }
        const pauseResult = await pauseCampaignForReason(
          supabase,
          target,
          row.connection_id,
          (row.plan_version as { plan_id?: unknown } | null)?.plan_id,
          destinationPause,
          cumulative.cents,
        );
        if (!pauseResult.ok) {
          results.push({
            campaign_id: target.id,
            pause_failed: pauseResult.detail,
            destination_check: destinationPause,
            total_spend_cents: cumulative.cents,
          });
          await touchSpendSyncWatermark(supabase, target.id);
          continue;
        }
        paused += 1;
        results.push({
          campaign_id: target.id,
          paused: destinationPause,
          total_spend_cents: cumulative.cents,
        });
        continue;
      }
    }

    let days: SpendDayRow[] = [];
    let spendConnection: AdConnectionRow | null = null;
    let fetchError: string | null = null;
    let upsertError: string | null = null;
    let stageMetricsError: string | null = null;
    let stageMetrics: AdStageMetricRow[] = [];
    try {
      const { data: conn } = await supabase
        .from("ad_connections")
        .select("*")
        .eq("id", row.connection_id)
        .maybeSingle();
      if (!conn) throw new AdNotConnectedError(platform as Platform);
      const connection = conn as AdConnectionRow;
      spendConnection = connection;
      if (platform === "meta") {
        days = await fetchMetaSpendDays(
          connection,
          target.external_campaign_id,
        );
      } else if (platform === "tiktok") {
        days = await fetchTikTokSpendDays(
          connection,
          target.external_campaign_id,
        );
      } else if (platform === "snapchat") {
        days = await fetchSnapchatSpendDays(
          connection,
          target.external_campaign_id,
          snapchatTimeZoneCache,
        );
      } else if (platform === "google") {
        days = await fetchGoogleSpendDays(
          connection,
          target.external_campaign_id,
        );
      } else if (platform === "reddit") {
        days = await fetchRedditSpendDays(
          connection,
          target.external_campaign_id,
        );
      }
    } catch (err) {
      fetchError =
        err instanceof AdApiError || err instanceof AdNotConnectedError
          ? err.message
          : err instanceof Error
          ? err.message
          : String(err);
      // End-date enforcement is independent of spend fetch — continue with [].
      days = [];
    }

    if (
      spendConnection && ["meta", "snapchat", "tiktok"].includes(platform)
    ) {
      try {
        const { data: setRows, error: setError } = await supabase
          .from("ad_sets")
          .select("id,external_adset_id,stage,optimization_goal")
          .eq("campaign_id", target.id)
          .not("stage", "is", null);
        if (setError) {
          throw new Error(`stage_set_read_failed: ${setError.message}`);
        }
        const stageTargets = (setRows ?? []).flatMap(
          (set: Record<string, unknown>) => {
            const stage = String(set.stage ?? "");
            if (!["prospecting", "retarget", "abandoners"].includes(stage)) {
              return [];
            }
            return [{
              id: String(set.id),
              externalAdSetId: String(set.external_adset_id ?? ""),
              stage: stage as AdStageMetricTarget["stage"],
              optimizationGoal: String(set.optimization_goal ?? ""),
            }];
          },
        );
        stageMetrics = await fetchPaidSocialStageMetrics(
          spendConnection,
          platform as Platform,
          target.external_campaign_id,
          stageTargets,
          snapchatTimeZoneCache,
        );
      } catch (err) {
        stageMetricsError = err instanceof Error ? err.message : String(err);
      }
    }

    if (stageMetrics.length > 0) {
      const currency = String(target.provider_currency ?? "").trim()
        .toUpperCase();
      const syncedAt = new Date().toISOString();
      const { error: stageUpsertError } = await supabase
        .from("ad_stage_metrics_daily")
        .upsert(
          stageMetrics.map((metric) => ({
            campaign_id: target.id,
            platform,
            currency,
            synced_at: syncedAt,
            ...metric,
          })),
          { onConflict: "ad_set_id,metric_date" },
        );
      if (stageUpsertError) {
        stageMetricsError = stageUpsertError.message;
      } else {
        stageMetricsUpserted += stageMetrics.length;
      }
    }

    let draft: SpendSyncDecision;
    try {
      draft = decideSpendSync({ campaign: target, days });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const cumulative = await loadCumulativeSpendCents(supabase, target.id);
      if (target.status === "ACTIVE" && cumulative.ok) {
        const pauseResult = await pauseCampaignForReason(
          supabase,
          target,
          row.connection_id,
          (row.plan_version as { plan_id?: unknown } | null)?.plan_id,
          reason,
          cumulative.cents,
        );
        if (pauseResult.ok) paused += 1;
        results.push({
          campaign_id: target.id,
          ...(pauseResult.ok
            ? { paused: reason }
            : { pause_failed: pauseResult.detail }),
          total_spend_cents: cumulative.cents,
        });
      } else {
        results.push({
          campaign_id: target.id,
          error: cumulative.ok ? reason : cumulative.detail,
          retryable: true,
        });
        await touchSpendSyncWatermark(supabase, target.id);
      }
      continue;
    }
    let safeUpserts = draft.upserts;
    if (safeUpserts.length > 0) {
      const { data: observedRows, error: observedError } = await supabase
        .from("ad_spend_daily")
        .select("spend_date,spend_cents")
        .eq("campaign_id", target.id);
      if (observedError) {
        upsertError = observedError.message;
        safeUpserts = [];
      } else {
        safeUpserts = preserveObservedSpend(
          safeUpserts,
          (observedRows ?? []) as SpendDayRow[],
        );
      }
    }
    if (safeUpserts.length > 0) {
      const { error: upErr } = await supabase.from("ad_spend_daily").upsert(
        safeUpserts,
        { onConflict: "campaign_id,platform,spend_date" },
      );
      if (upErr) {
        // Preserve the write error but still evaluate end-date / cap pause.
        upsertError = upErr.message;
      } else {
        upserted += safeUpserts.length;
      }
    }

    const cumulative = await loadCumulativeSpendCents(supabase, target.id);
    if (!cumulative.ok) {
      results.push({
        campaign_id: target.id,
        error: cumulative.detail,
        retryable: true,
        ...(fetchError ? { fetch_error: fetchError } : {}),
        ...(upsertError ? { upsert_error: upsertError } : {}),
        ...(stageMetricsError
          ? { stage_metrics_error: stageMetricsError }
          : {}),
      });
      await touchSpendSyncWatermark(supabase, target.id);
      continue;
    }

    const settlementResult = spendConnection
      ? await reconcileStoppedCampaign(
        supabase,
        target,
        spendConnection,
        cumulative.cents,
      )
      : null;

    // Fail closed on any spend-fetch outage for capped ACTIVE campaigns:
    // stale ad_spend_daily must not keep delivery alive without a fresh read.
    if (
      fetchError &&
      target.status === "ACTIVE" &&
      providerCapCents(target) !== null
    ) {
      const pauseResult = await pauseCampaignForReason(
        supabase,
        target,
        row.connection_id,
        (row.plan_version as { plan_id?: unknown } | null)?.plan_id,
        "spend_fetch_failed",
        cumulative.cents,
      );
      if (!pauseResult.ok) {
        results.push({
          campaign_id: target.id,
          pause_failed: pauseResult.detail,
          fetch_error: fetchError,
          total_spend_cents: cumulative.cents,
          ...(settlementResult ?? {}),
          ...(upsertError ? { upsert_error: upsertError } : {}),
          ...(stageMetricsError
            ? { stage_metrics_error: stageMetricsError }
            : {}),
        });
        await touchSpendSyncWatermark(supabase, target.id);
        continue;
      }
      paused += 1;
      results.push({
        campaign_id: target.id,
        paused: "spend_fetch_failed",
        fetch_error: fetchError,
        total_spend_cents: cumulative.cents,
        ...(upsertError ? { upsert_error: upsertError } : {}),
        ...(stageMetricsError
          ? { stage_metrics_error: stageMetricsError }
          : {}),
      });
      continue;
    }

    const decision = decideSpendSync({
      campaign: target,
      days,
      cumulativeSpendCents: cumulative.cents,
    });

    if (decision.pause && target.status === "ACTIVE") {
      const pauseResult = await pauseCampaignForReason(
        supabase,
        target,
        row.connection_id,
        (row.plan_version as { plan_id?: unknown } | null)?.plan_id,
        decision.pause,
        decision.total_spend_cents,
      );
      if (!pauseResult.ok) {
        results.push({
          campaign_id: target.id,
          pause_failed: pauseResult.detail,
          total_spend_cents: decision.total_spend_cents,
          ...(fetchError ? { fetch_error: fetchError } : {}),
          ...(upsertError ? { upsert_error: upsertError } : {}),
          ...(stageMetricsError
            ? { stage_metrics_error: stageMetricsError }
            : {}),
        });
        await touchSpendSyncWatermark(supabase, target.id);
        continue;
      }
      paused += 1;
      results.push({
        campaign_id: target.id,
        paused: decision.pause,
        total_spend_cents: decision.total_spend_cents,
        ...(settlementResult ?? {}),
        days: decision.upserts.length,
        ...(fetchError ? { fetch_error: fetchError } : {}),
        ...(upsertError ? { upsert_error: upsertError } : {}),
        ...(stageMetricsError
          ? { stage_metrics_error: stageMetricsError }
          : {}),
      });
    } else if (fetchError || upsertError) {
      results.push({
        campaign_id: target.id,
        error: upsertError ?? fetchError,
        total_spend_cents: decision.total_spend_cents,
        ...(settlementResult ?? {}),
        ...(fetchError && upsertError ? { fetch_error: fetchError } : {}),
        ...(stageMetricsError
          ? { stage_metrics_error: stageMetricsError }
          : {}),
      });
      await touchSpendSyncWatermark(supabase, target.id);
    } else {
      results.push({
        campaign_id: target.id,
        total_spend_cents: decision.total_spend_cents,
        ...(settlementResult ?? {}),
        days: decision.upserts.length,
        stage_metric_days: stageMetrics.length,
        ...(stageMetricsError
          ? { stage_metrics_error: stageMetricsError }
          : {}),
      });
      // Rotate the 80-row sweep: every attempted row advances the watermark.
      await touchSpendSyncWatermark(supabase, target.id);
    }
  }

  return json({
    ok: true,
    scanned: (campaigns ?? []).length,
    upserted,
    stage_metrics_upserted: stageMetricsUpserted,
    paused,
    results,
  });
});
