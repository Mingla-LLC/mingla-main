/**
 * marketingOverviewService — Phase B Overview tab data source (ORCH-0863).
 *
 * Live-aggregation strategy per investigation §5 + SPEC §6.1.4: at current
 * scale (~50 messages, ~11 campaigns) Postgres returns each rollup in
 * sub-10ms. Migration to a matview is additive — when scale warrants it,
 * the hook can pivot without component churn.
 *
 * Funnel formulas (BINDING — pinned by SPEC §6.1.4):
 *   accepted  = COUNT(messages WHERE status IN ('sent','delivered','opened','clicked','unsubscribed','preview_skipped'))
 *   delivered = COUNT(messages WHERE delivered_at IS NOT NULL)   -- #2510
 *
 * #2510 — `delivered` used to be COUNT(status IN ('delivered','clicked')).
 * Nothing ever wrote `delivered`, so that tile was simply the CLICK count
 * under a Delivered label, and the We Go Again organiser was shown
 * "DELIVERED 3 (1.5%)" for a campaign where 189 emails were accepted.
 *   clicked   = COUNT(DISTINCT message_id from marketing_clicks WHERE clicked_at IS NOT NULL)
 *   failed    = COUNT(messages WHERE status IN ('failed','bounced'))
 *
 * Constitution #9 — no fabricated data. Revenue + "Opened" metric omitted
 * (no UTM-to-campaign attribution, no Resend webhook ingest path). Enforced
 * by I-PROPOSED-MKT-OVERVIEW-NO-REVENUE-FABRICATION + strict-grep gate.
 */

import { supabase } from "../supabase";
// META-ORCH-1235 — settle-guarantee for the marketing overview full-screen
// skeleton gate (marketing/index.tsx).
import { withTimeout, DATA_FETCH_TIMEOUT_MS } from "../../utils/withTimeout";
import type {
  MarketingOverviewFunnel,
  MarketingOverviewRecentCampaign,
  MarketingOverviewSnapshot,
  MessageStatus,
} from "../../types/marketing";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, label: string): void {
  if (!UUID_RE.test(value)) {
    throw new Error(`${label}: expected UUID, got ${JSON.stringify(value)}`);
  }
}

const WINDOW_DAYS = 30;
const MS_PER_DAY = 86_400_000;
const RECENT_CAMPAIGN_LIMIT = 3;
const METRIC_PAGE_SIZE = 500;
const CAMPAIGN_ID_CHUNK_SIZE = 100;

/**
 * Internal helper — reduce a list of message-status rows into the 4 funnel
 * buckets per the binding formulas above. Exported for unit testing.
 */
/** #2510 — a row the provider accepted, whatever happened to it afterwards. */
const ACCEPTED: ReadonlySet<string> = new Set([
  "sent",
  "delivered",
  // `opened` is NEW here and is the only addition #2510 makes: the ingest
  // writes it, and without it the headline would FALL as opens arrived.
  "opened",
  "clicked",
  "preview_skipped",
]);
// `unsubscribed` and `queued` stay OUT, per the orthogonal-states rule pinned
// by marketingOverviewService.test.ts. That rule is not part of this issue and
// widening it here would be scope creep with its own blast radius.

export interface FunnelRow {
  id?: string;
  status: MessageStatus;
  delivered_at?: string | null;
  opened_at?: string | null;
  delivery_tracking_eligible_at?: string | null;
  open_tracking_eligible_at?: string | null;
}

export interface FunnelHealth {
  delivery_healthy: boolean;
  open_healthy: boolean;
}

export function rollupFunnel(
  rows: ReadonlyArray<FunnelRow>,
  uniqueClickedMessageIds: number,
  health: FunnelHealth = { delivery_healthy: true, open_healthy: true },
): MarketingOverviewFunnel {
  let sent = 0;
  let delivered = 0;
  let opened = 0;
  let deliveryEligible = 0;
  let trackedDelivered = 0;
  let failed = 0;
  for (const row of rows) {
    // `opened` and `clicked` were MISSING from the accepted set, so the
    // headline fell as engagement rose — the more people read a campaign, the
    // fewer it claimed to have sent.
    if (ACCEPTED.has(row.status)) sent += 1;
    // Delivery is an EVENT now, not a guess from status.
    if (row.delivery_tracking_eligible_at != null) {
      deliveryEligible += 1;
      if (row.delivered_at != null) delivered += 1;
    }
    if (row.open_tracking_eligible_at != null && row.delivered_at != null) {
      trackedDelivered += 1;
      if (row.opened_at != null) opened += 1;
    }
    if (row.status === "failed" || row.status === "bounced") failed += 1;
  }
  return {
    sent,
    delivered,
    opened,
    trackedDelivered,
    clicked: uniqueClickedMessageIds,
    failed,
    // No delivery event has ever arrived for these campaigns — delivered and
    // opened are UNKNOWN, and the screen must not draw them as 0.
    hasDeliveryCoverage: health.delivery_healthy && deliveryEligible > 0,
    hasOpenCoverage: health.open_healthy && trackedDelivered > 0,
    deliveryHealthy: health.delivery_healthy,
    openHealthy: health.open_healthy,
  };
}

async function loadWindowCampaigns(
  brandId: string,
  windowStartIso: string,
): Promise<
  Array<{
    id: string;
    status: string;
    sent_at: string | null;
    created_at: string;
  }>
> {
  const rows: Array<{
    id: string;
    status: string;
    sent_at: string | null;
    created_at: string;
  }> = [];
  for (let from = 0; ; from += METRIC_PAGE_SIZE) {
    const { data, error } = await withTimeout(
      supabase
        .from("marketing_campaigns")
        .select("id, status, sent_at, created_at")
        .eq("brand_id", brandId)
        .gte("created_at", windowStartIso)
        .order("id", { ascending: true })
        .range(from, from + METRIC_PAGE_SIZE - 1),
      DATA_FETCH_TIMEOUT_MS,
      "getMarketingOverview:campaigns",
    );
    if (error) throw error;
    const page = (data ?? []) as typeof rows;
    rows.push(...page);
    if (page.length < METRIC_PAGE_SIZE) return rows;
  }
}

async function loadWindowMessages(
  campaignIds: string[],
  windowStartIso: string,
): Promise<FunnelRow[]> {
  const rows: FunnelRow[] = [];
  for (
    let offset = 0;
    offset < campaignIds.length;
    offset += CAMPAIGN_ID_CHUNK_SIZE
  ) {
    const ids = campaignIds.slice(offset, offset + CAMPAIGN_ID_CHUNK_SIZE);
    for (let from = 0; ; from += METRIC_PAGE_SIZE) {
      const { data, error } = await withTimeout(
        supabase
          .from("marketing_messages")
          .select(
            "id,status,delivered_at,opened_at,delivery_tracking_eligible_at,open_tracking_eligible_at",
          )
          .in("campaign_id", ids)
          .gte("created_at", windowStartIso)
          .order("id", { ascending: true })
          .range(from, from + METRIC_PAGE_SIZE - 1),
        DATA_FETCH_TIMEOUT_MS,
        "getMarketingOverview:messages",
      );
      if (error) throw error;
      const page = (data ?? []) as unknown as FunnelRow[];
      rows.push(...page);
      if (page.length < METRIC_PAGE_SIZE) break;
    }
  }
  return rows;
}

async function loadClickedMessageIds(
  campaignIds: string[],
): Promise<Set<string>> {
  const result = new Set<string>();
  for (
    let offset = 0;
    offset < campaignIds.length;
    offset += CAMPAIGN_ID_CHUNK_SIZE
  ) {
    const ids = campaignIds.slice(offset, offset + CAMPAIGN_ID_CHUNK_SIZE);
    for (let from = 0; ; from += METRIC_PAGE_SIZE) {
      const { data, error } = await withTimeout(
        supabase
          .from("marketing_clicks")
          .select("id,message_id")
          .in("campaign_id", ids)
          .not("clicked_at", "is", null)
          .order("id", { ascending: true })
          .range(from, from + METRIC_PAGE_SIZE - 1),
        DATA_FETCH_TIMEOUT_MS,
        "getMarketingOverview:clicks",
      );
      if (error) throw error;
      const page = (data ?? []) as Array<{
        id: string;
        message_id: string | null;
      }>;
      for (const row of page)
        if (row.message_id !== null) result.add(row.message_id);
      if (page.length < METRIC_PAGE_SIZE) break;
    }
  }
  return result;
}

export interface GetMarketingOverviewInput {
  brand_id: string;
}

export async function getMarketingOverview(
  input: GetMarketingOverviewInput,
): Promise<MarketingOverviewSnapshot> {
  // #2514 — brand is the scope. Keyed by account, this 30-day funnel summed
  // ACROSS every brand the operator belongs to, so a multi-brand operator's
  // "DELIVERED 3 (1.5%)" was not even a figure about one brand.
  assertUuid(input.brand_id, "getMarketingOverview.brand_id");

  const windowStartIso = new Date(
    Date.now() - WINDOW_DAYS * MS_PER_DAY,
  ).toISOString();

  // Query 1 — list the account's campaigns within the window (used for both
  // the campaigns_sent_count headline AND as a campaign_id whitelist for the
  // message + click rollups below). Pulling rows once is cheaper than two
  // separate count queries.
  // META-ORCH-1235 — bound each gating read so the overview skeleton settles.
  const windowCampaigns = await loadWindowCampaigns(
    input.brand_id,
    windowStartIso,
  );

  const campaignsSentCount = windowCampaigns.filter(
    (c) => c.status === "sent" && c.sent_at !== null,
  ).length;
  const windowCampaignIds = windowCampaigns.map((c) => c.id);

  // Query 2 — recent 3 campaigns (broader: not windowed; the operator wants
  // to see their most recent activity even if older than 30 days).
  const { data: recentData, error: recentErr } = await withTimeout(
    supabase
      .from("marketing_campaigns")
      .select(
        "id, name, status, sent_at, scheduled_for, recipient_count, created_at",
      )
      .eq("brand_id", input.brand_id)
      .order("sent_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(RECENT_CAMPAIGN_LIMIT),
    DATA_FETCH_TIMEOUT_MS,
    "getMarketingOverview:recent",
  );
  if (recentErr) throw recentErr;
  const recentCampaigns = (recentData ??
    []) as unknown as MarketingOverviewRecentCampaign[];

  // Short-circuit when there are no windowed campaigns: funnel + clicks are
  // both zero and the 3 follow-up queries would return nothing useful.
  if (windowCampaignIds.length === 0) {
    return {
      window_days: WINDOW_DAYS,
      campaigns_sent_count: campaignsSentCount,
      funnel: {
        sent: 0,
        delivered: 0,
        opened: 0,
        clicked: 0,
        failed: 0,
        trackedDelivered: 0,
        hasDeliveryCoverage: false,
        hasOpenCoverage: false,
        deliveryHealthy: true,
        openHealthy: true,
      },
      recent_campaigns: recentCampaigns,
    };
  }

  // Query 3 — message status histogram for windowed campaigns.
  const funnelRows = await loadWindowMessages(
    windowCampaignIds,
    windowStartIso,
  );

  // Query 4 — distinct message_id from marketing_clicks WHERE clicked_at NOT NULL.
  // Bounded by .limit() to match marketingReportService precedent at line 110.
  const uniqueClickedMessageIds =
    await loadClickedMessageIds(windowCampaignIds);
  const { data: healthData, error: healthError } = await withTimeout(
    supabase.rpc("mkt_campaign_email_event_health"),
    DATA_FETCH_TIMEOUT_MS,
    "getMarketingOverview:health",
  );
  if (healthError) throw healthError;
  const health = ((healthData ?? []) as unknown as FunnelHealth[])[0];
  if (health === undefined)
    throw new Error("Campaign email health unavailable.");

  return {
    window_days: WINDOW_DAYS,
    campaigns_sent_count: campaignsSentCount,
    funnel: rollupFunnel(funnelRows, uniqueClickedMessageIds.size, health),
    recent_campaigns: recentCampaigns,
  };
}
