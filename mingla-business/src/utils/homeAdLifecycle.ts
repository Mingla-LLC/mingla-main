/**
 * toward #3697 — pure policy for the Host Home Ads rail.
 *
 * The API already returns one row per immutable plan. Home still deduplicates
 * defensively because a partially rolled out server must never create two
 * controls for the same provider group. Currency amounts are deliberately not
 * combined here; presentation keeps each provider currency separate.
 */

import type { HostAdCampaign } from "../services/hostAdCampaignService";
import { currencyCodeOrNull } from "./currency";

export type HomeAdDestructiveAction = "cancel" | "end";

const NETWORK_LABELS: Readonly<Record<string, string>> = {
  meta: "Facebook & Instagram",
  tiktok: "TikTok",
  google: "Google",
  snapchat: "Snapchat",
};

const ATTENTION_COPY: Readonly<Record<string, string>> = {
  "Track review": "The network is still reviewing this ad",
  "View schedule": "Open the ad to review its schedule",
  "View results": "Open the ad to review its results",
  Resume: "This ad is paused and ready to resume",
  // #4238 rework 3 (tester P2-2): "Fix issue" is the server's catch-all for
  // every needs-attention state (rejected, a failed start, settling…). It
  // used to read "Your payment method needs updating", which was untrue for
  // all of them but one. The true reason comes from homeAdAttentionReason.
  "View report": "Open the ad to review its report",
};

export function homeAdNetworkLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  return NETWORK_LABELS[normalized] ?? normalized
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function homeAdNetworkList(values: readonly string[]): string {
  return [...new Set(values.map(homeAdNetworkLabel))].join(" · ");
}

export function homeAdTileSpan(count: number): number {
  if (count <= 1) return 12;
  if (count === 2) return 6;
  if (count === 3) return 4;
  return 3;
}

export function homeAdAttentionCopy(nextAction: string): string {
  return ATTENTION_COPY[nextAction] ?? "Open the ad to see what's needed";
}

const REJECTED_STATES = new Set(["platform_rejected", "staff_rejected"]);

/** The creative or plan was turned down (the same test the ad detail uses). */
export function homeAdRejected(campaign: HostAdCampaign): boolean {
  const state = (campaign.plan_state ?? "").toLowerCase();
  return REJECTED_STATES.has(state) ||
    (campaign.creative?.review_status ?? "").toUpperCase().includes("REJECT");
}

/**
 * #4238 rework 3 (tester P2-2): the true reason a Home tile needs a look,
 * from the plan's own state (the ad detail reads the same field). Never a
 * payment message unless the plan's payment really failed.
 */
export function homeAdAttentionReason(campaign: HostAdCampaign): string {
  if (homeAdRejected(campaign)) return "An app didn't approve this ad";
  switch ((campaign.plan_state ?? "").toLowerCase()) {
    case "changes_requested":
      return "Mingla asked for a change before it runs";
    case "payment_failed":
      return "The payment for this ad didn't go through";
    case "partially_ready":
    case "partially_live":
    case "creation_failed_retryable":
    case "creation_failed_terminal":
      return "Some apps couldn't start this ad";
    case "stop_requested":
    case "settling":
    case "settlement_attention_required":
      return "This ad is ending; Mingla is settling its money";
    default:
      return homeAdAttentionCopy(campaign.next_action);
  }
}

const HOME_LIFECYCLE_PRIORITY: Record<HostAdCampaign["lifecycle"], number> = {
  needs_attention: 0,
  live: 1,
  paused: 2,
  scheduled: 3,
  in_review: 4,
  ended: 5,
};

export function homeAdHasProviderSpend(campaign: HostAdCampaign): boolean {
  return campaign.spend_by_currency.some((row) => Number(row.spend_cents) > 0);
}

/** Cancel is available before provider spend; End permanently replaces it after spend. */
export function homeAdDestructiveAction(
  campaign: HostAdCampaign,
): HomeAdDestructiveAction | null {
  if (campaign.lifecycle === "ended") return null;
  return homeAdHasProviderSpend(campaign) ? "end" : "cancel";
}

export function homeAdCanPause(campaign: HostAdCampaign): boolean {
  return campaign.lifecycle === "live";
}

export function homeAdStatusLabel(campaign: HostAdCampaign): string {
  switch (campaign.lifecycle) {
    case "needs_attention":
      return homeAdRejected(campaign) ? "Not approved" : "Needs attention";
    case "in_review":
      return "In review";
    case "scheduled":
      return "Scheduled";
    case "live":
      return "Live";
    case "paused":
      return "Paused";
    case "ended":
      return "Ended";
  }
}

/**
 * Keep Home operational rather than historical: ended plans stay in Ads, not
 * on the dashboard. Attention comes first, then delivery, then resumable or
 * upcoming work. Newer rows win inside the same lifecycle.
 */
export function selectHomeAdCampaigns(
  campaigns: readonly HostAdCampaign[],
  limit = 4,
): HostAdCampaign[] {
  const byPlan = new Map<string, HostAdCampaign>();
  for (const campaign of campaigns) {
    if (campaign.lifecycle === "ended") continue;
    const key = campaign.plan_version_id ?? campaign.id;
    const existing = byPlan.get(key);
    if (
      existing === undefined ||
      Date.parse(campaign.updated_at ?? campaign.created_at ?? "") >
        Date.parse(existing.updated_at ?? existing.created_at ?? "")
    ) {
      byPlan.set(key, campaign);
    }
  }

  return [...byPlan.values()]
    .sort((left, right) => {
      const lifecycleDelta =
        HOME_LIFECYCLE_PRIORITY[left.lifecycle] -
        HOME_LIFECYCLE_PRIORITY[right.lifecycle];
      if (lifecycleDelta !== 0) return lifecycleDelta;
      return (
        Date.parse(right.updated_at ?? right.created_at ?? "") -
        Date.parse(left.updated_at ?? left.created_at ?? "")
      );
    })
    .slice(0, Math.max(0, limit));
}


export type HomeAdCurrencyRow = { currency: string; spent: number; budget: number };

/** Per-currency spent and budget of one ad, in Ads credit (what the apps spend). */
export const campaignCurrencies = (
  campaign: HostAdCampaign,
): { currency: string; spent: number; budget: number }[] => {
  const currency = currencyCodeOrNull(campaign.currency);
  const budget = campaign.cap_cents ?? campaign.lifetime_budget_cents ?? 0;
  if (currency !== null && campaign.host_spend_equivalent_cents !== null) {
    return [{
      currency,
      spent: campaign.host_spend_equivalent_cents,
      budget,
    }];
  }
  const byCurrency = campaign.spend_by_currency.map((row) => ({
    currency: row.currency.toUpperCase(),
    spent: row.spend_cents,
    budget: row.currency.toUpperCase() === currency ? budget : 0,
  }));
  if (byCurrency.length > 0) return byCurrency;
  return currency === null ? [] : [{ currency, spent: 0, budget }];
};
