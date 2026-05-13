/**
 * marketingReportService — aggregates per-campaign deliverability + click
 * data for the campaign report screen (Sub-ORCH-0815-C-1).
 *
 * Reads `marketing_messages` + `marketing_clicks` filtered by campaign_id
 * (RLS-gated to brand members) and rolls them into a single shape the
 * report screen consumes.
 *
 * Open-rate is intentionally absent from this report — opens require a
 * Resend webhook ingest path which is a separate, later ORCH. Click data
 * IS available (we own `/m/<tracking_id>` and write `clicked_at`).
 */

import { supabase } from "../supabase";
import type { MarketingCampaignRow, MessageStatus } from "../../types/marketing";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, label: string): void {
  if (!UUID_RE.test(value)) {
    throw new Error(`${label}: expected UUID, got ${JSON.stringify(value)}`);
  }
}

export interface RecipientStats {
  total: number;
  queued: number;
  sent: number;
  delivered: number;
  preview_skipped: number;
  failed: number;
  unsubscribed: number;
  clicked: number;
}

export interface TopLink {
  destination_url: string;
  clicks: number;
}

export interface ClickStats {
  total_clicks: number;
  unique_clickers: number;
  top_links: TopLink[];
}

export interface PerRecipientRow {
  id: string;
  recipient_email: string | null;
  status: MessageStatus;
  sent_at: string | null;
  click_count: number;
  failure_reason: string | null;
}

export interface CampaignReport {
  campaign: MarketingCampaignRow;
  recipientStats: RecipientStats;
  clickStats: ClickStats;
  recipients: PerRecipientRow[];
}

const STATUS_KEYS: MessageStatus[] = [
  "queued",
  "sent",
  "delivered",
  "opened",
  "clicked",
  "bounced",
  "failed",
  "unsubscribed",
  "preview_skipped",
];

export async function getCampaignReport(
  campaignId: string,
): Promise<CampaignReport> {
  assertUuid(campaignId, "getCampaignReport.campaign_id");

  // 1) Campaign row (RLS-gated).
  const { data: campaignData, error: campaignErr } = await supabase
    .from("marketing_campaigns")
    .select(
      "id, account_id, brand_id, audience_id, template_id, name, channel, channel_payload, status, scheduled_for, sent_at, recipient_count, created_at, updated_at",
    )
    .eq("id", campaignId)
    .maybeSingle();
  if (campaignErr) throw campaignErr;
  if (campaignData === null) {
    throw new Error("Campaign not found or access denied.");
  }

  // 2) All marketing_messages for this campaign.
  const { data: messageData, error: messageErr } = await supabase
    .from("marketing_messages")
    .select(
      "id, recipient_email, status, sent_at, click_count, failure_reason",
    )
    .eq("campaign_id", campaignId)
    .order("sent_at", { ascending: false, nullsFirst: false })
    .limit(500);
  if (messageErr) throw messageErr;
  const messages = (messageData ?? []) as unknown as PerRecipientRow[];

  // 3) All marketing_clicks for this campaign.
  const { data: clickData, error: clickErr } = await supabase
    .from("marketing_clicks")
    .select("destination_url, clicked_at, message_id")
    .eq("campaign_id", campaignId)
    .limit(2000);
  if (clickErr) throw clickErr;
  const clicks = (clickData ?? []) as unknown as Array<{
    destination_url: string;
    clicked_at: string | null;
    message_id: string | null;
  }>;

  // Recipient stats aggregation.
  const counts: Record<string, number> = {};
  for (const key of STATUS_KEYS) counts[key] = 0;
  for (const msg of messages) counts[msg.status] = (counts[msg.status] ?? 0) + 1;

  const recipientStats: RecipientStats = {
    total: messages.length,
    queued: counts.queued ?? 0,
    sent: counts.sent ?? 0,
    delivered: counts.delivered ?? 0,
    preview_skipped: counts.preview_skipped ?? 0,
    failed: counts.failed ?? 0,
    unsubscribed: counts.unsubscribed ?? 0,
    clicked: counts.clicked ?? 0,
  };

  // Click stats aggregation.
  const linkCounts = new Map<string, number>();
  const uniqueClickerMessageIds = new Set<string>();
  let totalClicks = 0;
  for (const click of clicks) {
    if (click.clicked_at === null) continue;
    totalClicks += 1;
    linkCounts.set(
      click.destination_url,
      (linkCounts.get(click.destination_url) ?? 0) + 1,
    );
    if (click.message_id !== null) uniqueClickerMessageIds.add(click.message_id);
  }
  const topLinks: TopLink[] = Array.from(linkCounts.entries())
    .map(([destination_url, count]) => ({ destination_url, clicks: count }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 5);

  const clickStats: ClickStats = {
    total_clicks: totalClicks,
    unique_clickers: uniqueClickerMessageIds.size,
    top_links: topLinks,
  };

  return {
    campaign: campaignData as unknown as MarketingCampaignRow,
    recipientStats,
    clickStats,
    recipients: messages,
  };
}
