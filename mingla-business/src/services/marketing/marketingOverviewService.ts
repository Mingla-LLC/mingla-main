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
const CLICK_QUERY_LIMIT = 2000; // matches marketingReportService precedent

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
  status: MessageStatus;
  delivered_at?: string | null;
  opened_at?: string | null;
}

export function rollupFunnel(
  rows: ReadonlyArray<FunnelRow>,
  uniqueClickedMessageIds: number,
): MarketingOverviewFunnel {
  let sent = 0;
  let delivered = 0;
  let opened = 0;
  let failed = 0;
  for (const row of rows) {
    // `opened` and `clicked` were MISSING from the accepted set, so the
    // headline fell as engagement rose — the more people read a campaign, the
    // fewer it claimed to have sent.
    if (ACCEPTED.has(row.status)) sent += 1;
    // Delivery is an EVENT now, not a guess from status.
    if (row.delivered_at != null) delivered += 1;
    if (row.opened_at != null) opened += 1;
    if (row.status === "failed" || row.status === "bounced") failed += 1;
  }
  return {
    sent,
    delivered,
    opened,
    clicked: uniqueClickedMessageIds,
    failed,
    // No delivery event has ever arrived for these campaigns — delivered and
    // opened are UNKNOWN, and the screen must not draw them as 0.
    hasEventCoverage: delivered > 0 || opened > 0,
  };
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

  const windowStartIso = new Date(Date.now() - WINDOW_DAYS * MS_PER_DAY).toISOString();

  // Query 1 — list the account's campaigns within the window (used for both
  // the campaigns_sent_count headline AND as a campaign_id whitelist for the
  // message + click rollups below). Pulling rows once is cheaper than two
  // separate count queries.
  // META-ORCH-1235 — bound each gating read so the overview skeleton settles.
  const { data: windowCampaignsData, error: windowCampaignsErr } = await withTimeout(
    supabase
      .from("marketing_campaigns")
      .select("id, status, sent_at, created_at")
      .eq("brand_id", input.brand_id)
      .gte("created_at", windowStartIso),
    DATA_FETCH_TIMEOUT_MS,
    "getMarketingOverview:campaigns",
  );
  if (windowCampaignsErr) throw windowCampaignsErr;
  const windowCampaigns = (windowCampaignsData ?? []) as Array<{
    id: string;
    status: string;
    sent_at: string | null;
    created_at: string;
  }>;

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
  const recentCampaigns = (recentData ?? []) as unknown as MarketingOverviewRecentCampaign[];

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
        hasEventCoverage: false,
      },
      recent_campaigns: recentCampaigns,
    };
  }

  // Query 3 — message status histogram for windowed campaigns.
  const { data: messageData, error: messageErr } = await withTimeout(
    supabase
      .from("marketing_messages")
      .select("status, delivered_at, opened_at")
      .in("campaign_id", windowCampaignIds)
      .gte("created_at", windowStartIso),
    DATA_FETCH_TIMEOUT_MS,
    "getMarketingOverview:messages",
  );
  if (messageErr) throw messageErr;
  const funnelRows = (messageData ?? []) as unknown as FunnelRow[];

  // Query 4 — distinct message_id from marketing_clicks WHERE clicked_at NOT NULL.
  // Bounded by .limit() to match marketingReportService precedent at line 110.
  const { data: clickData, error: clickErr } = await withTimeout(
    supabase
      .from("marketing_clicks")
      .select("message_id")
      .in("campaign_id", windowCampaignIds)
      .not("clicked_at", "is", null)
      .limit(CLICK_QUERY_LIMIT),
    DATA_FETCH_TIMEOUT_MS,
    "getMarketingOverview:clicks",
  );
  if (clickErr) throw clickErr;
  const uniqueClickedMessageIds = new Set<string>();
  for (const row of (clickData ?? []) as Array<{ message_id: string | null }>) {
    if (row.message_id !== null) uniqueClickedMessageIds.add(row.message_id);
  }

  return {
    window_days: WINDOW_DAYS,
    campaigns_sent_count: campaignsSentCount,
    funnel: rollupFunnel(funnelRows, uniqueClickedMessageIds.size),
    recent_campaigns: recentCampaigns,
  };
}
