/**
 * marketingOverviewService — Phase B Overview tab data source (ORCH-0863).
 *
 * Live-aggregation strategy per investigation §5 + SPEC §6.1.4: at current
 * scale (~50 messages, ~11 campaigns) Postgres returns each rollup in
 * sub-10ms. Migration to a matview is additive — when scale warrants it,
 * the hook can pivot without component churn.
 *
 * Funnel formulas (BINDING — pinned by SPEC §6.1.4):
 *   sent      = COUNT(messages WHERE status IN ('sent','delivered','clicked','preview_skipped'))
 *   delivered = COUNT(messages WHERE status IN ('delivered','clicked'))
 *   clicked   = COUNT(DISTINCT message_id from marketing_clicks WHERE clicked_at IS NOT NULL)
 *   failed    = COUNT(messages WHERE status IN ('failed','bounced'))
 *
 * Constitution #9 — no fabricated data. Revenue + "Opened" metric omitted
 * (no UTM-to-campaign attribution, no Resend webhook ingest path). Enforced
 * by I-PROPOSED-MKT-OVERVIEW-NO-REVENUE-FABRICATION + strict-grep gate.
 */

import { supabase } from "../supabase";
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
export function rollupFunnel(
  statuses: ReadonlyArray<MessageStatus>,
  uniqueClickedMessageIds: number,
): MarketingOverviewFunnel {
  let sent = 0;
  let delivered = 0;
  let failed = 0;
  for (const s of statuses) {
    if (s === "sent" || s === "delivered" || s === "clicked" || s === "preview_skipped") {
      sent += 1;
    }
    if (s === "delivered" || s === "clicked") {
      delivered += 1;
    }
    if (s === "failed" || s === "bounced") {
      failed += 1;
    }
  }
  return { sent, delivered, clicked: uniqueClickedMessageIds, failed };
}

export interface GetMarketingOverviewInput {
  account_id: string;
}

export async function getMarketingOverview(
  input: GetMarketingOverviewInput,
): Promise<MarketingOverviewSnapshot> {
  assertUuid(input.account_id, "getMarketingOverview.account_id");

  const windowStartIso = new Date(Date.now() - WINDOW_DAYS * MS_PER_DAY).toISOString();

  // Query 1 — list the account's campaigns within the window (used for both
  // the campaigns_sent_count headline AND as a campaign_id whitelist for the
  // message + click rollups below). Pulling rows once is cheaper than two
  // separate count queries.
  const { data: windowCampaignsData, error: windowCampaignsErr } = await supabase
    .from("marketing_campaigns")
    .select("id, status, sent_at, created_at")
    .eq("account_id", input.account_id)
    .gte("created_at", windowStartIso);
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
  const { data: recentData, error: recentErr } = await supabase
    .from("marketing_campaigns")
    .select(
      "id, name, status, sent_at, scheduled_for, recipient_count, created_at",
    )
    .eq("account_id", input.account_id)
    .order("sent_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(RECENT_CAMPAIGN_LIMIT);
  if (recentErr) throw recentErr;
  const recentCampaigns = (recentData ?? []) as unknown as MarketingOverviewRecentCampaign[];

  // Short-circuit when there are no windowed campaigns: funnel + clicks are
  // both zero and the 3 follow-up queries would return nothing useful.
  if (windowCampaignIds.length === 0) {
    return {
      window_days: WINDOW_DAYS,
      campaigns_sent_count: campaignsSentCount,
      funnel: { sent: 0, delivered: 0, clicked: 0, failed: 0 },
      recent_campaigns: recentCampaigns,
    };
  }

  // Query 3 — message status histogram for windowed campaigns.
  const { data: messageData, error: messageErr } = await supabase
    .from("marketing_messages")
    .select("status")
    .in("campaign_id", windowCampaignIds)
    .gte("created_at", windowStartIso);
  if (messageErr) throw messageErr;
  const messageStatuses = ((messageData ?? []) as Array<{ status: MessageStatus }>).map(
    (m) => m.status,
  );

  // Query 4 — distinct message_id from marketing_clicks WHERE clicked_at NOT NULL.
  // Bounded by .limit() to match marketingReportService precedent at line 110.
  const { data: clickData, error: clickErr } = await supabase
    .from("marketing_clicks")
    .select("message_id")
    .in("campaign_id", windowCampaignIds)
    .not("clicked_at", "is", null)
    .limit(CLICK_QUERY_LIMIT);
  if (clickErr) throw clickErr;
  const uniqueClickedMessageIds = new Set<string>();
  for (const row of (clickData ?? []) as Array<{ message_id: string | null }>) {
    if (row.message_id !== null) uniqueClickedMessageIds.add(row.message_id);
  }

  return {
    window_days: WINDOW_DAYS,
    campaigns_sent_count: campaignsSentCount,
    funnel: rollupFunnel(messageStatuses, uniqueClickedMessageIds.size),
    recent_campaigns: recentCampaigns,
  };
}
