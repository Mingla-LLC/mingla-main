import type { HostAdCampaign } from "./hostAdCampaignService";
import type { HostAdDraft, HostAdPlanAggregate } from "./hostAdPlanService";
import {
  hostAdReviewReason,
  hostAdStepLabel,
} from "../components/marketing/ads/hostAdCopy";
import { formatHostAdMoneyCents } from "../components/marketing/ads/hostAdMoney";

export type HostAdLifecycle =
  | "draft"
  | "in_review"
  | "scheduled"
  | "live"
  | "paused"
  | "needs_attention"
  | "ended";

export type HostAdFilter = "all" | HostAdLifecycle;

export type HostAdListItem = {
  id: string;
  kind: "draft" | "plan" | "campaign";
  lifecycle: HostAdLifecycle;
  name: string;
  platforms: string[];
  destination: string | null;
  creative: {
    name: string;
    kind: string;
    previewUrl: string | null;
  } | null;
  currency: string | null;
  capCents: number | null;
  spendCents: number | null;
  spendByCurrency: { currency: string; spend_cents: number }[];
  primaryResultLabel: string;
  primaryResultCount: number;
  costPerResultCents: number | null;
  resultsValueCents: Record<string, number>;
  nextAction: string;
  route: string;
  reason: string | null;
  updatedAt: string | null;
  /** #4238: a plainer status than the lifecycle bucket, when there is one. */
  statusLabel?: string;
  /** #4238 wave D: why a paused ad is paused (server reason code). */
  pauseReason?: string | null;
  /** #4238 wave D: when the ad started (for "still learning"). */
  startedAt?: string | null;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function planLifecycle(state: string): HostAdLifecycle {
  if (state === "staff_review_required") return "in_review";
  if (
    [
      "changes_requested",
      "creation_failed_retryable",
      "creation_failed_terminal",
      "payment_failed",
    ].includes(state)
  ) {
    return "needs_attention";
  }
  return "draft";
}

function planNextAction(state: string): string {
  if (state === "ready_for_funding") return "Add credit";
  if (state === "staff_review_required") return "Track review";
  if (state === "changes_requested") return "Fix request";
  if (state === "payment_failed") return "Fix payment";
  if (state.startsWith("creation_failed")) return "Resume setup";
  if (state === "staff_approved" || state === "funded_held") return "Launch";
  return "Continue";
}

function draftItem(draft: HostAdDraft): HostAdListItem {
  const state = record(draft.draft_state) ?? {};
  const creativeState = record(state.creative);
  const creativeRow = record(creativeState?.creativeRow);
  const destinations = Array.isArray(state.destinations)
    ? state.destinations
    : [];
  const destination = record(destinations[0]);
  return {
    id: draft.id,
    kind: "draft",
    lifecycle: "draft",
    name: stringValue(state.name) ?? "Untitled ad draft",
    platforms: Array.isArray(state.selected_platforms)
      ? state.selected_platforms.map(String)
      : [],
    destination:
      stringValue(destination?.title) ??
      stringValue(destination?.name) ??
      stringValue(destination?.url),
    creative:
      creativeRow || creativeState
        ? {
            name:
              stringValue(creativeRow?.name) ??
              stringValue(creativeState?.name) ??
              "Video in progress",
            kind:
              stringValue(creativeRow?.kind) ??
              stringValue(creativeState?.kind) ??
              "media",
            previewUrl:
              stringValue(creativeState?.posterUrl) ??
              stringValue(creativeState?.publicUrl),
          }
        : null,
    currency: null,
    capCents: null,
    spendCents: null,
    spendByCurrency: [],
    primaryResultLabel: "results",
    primaryResultCount: 0,
    costPerResultCents: null,
    resultsValueCents: {},
    nextAction: "Continue draft",
    route: `/(tabs)/marketing/ads/create?draft_id=${draft.id}`,
    reason: `Saved at: ${hostAdStepLabel(draft.current_step)}`,
    updatedAt: draft.updated_at,
  };
}

function planItem(aggregate: HostAdPlanAggregate): HostAdListItem {
  const canonical = aggregate.version.canonical_plan;
  const destination = record(canonical.destination);
  const creativeId = stringValue(canonical.creative_library_id);
  const reason =
    aggregate.reviews[0]?.reason ?? aggregate.plan.review_reasons[0] ?? null;
  return {
    id: aggregate.plan.id,
    kind: "plan",
    lifecycle: planLifecycle(aggregate.plan.state),
    name: stringValue(canonical.name) ?? "Saved ad plan",
    platforms: aggregate.provider_allocations.map((allocation) =>
      String(allocation.platform),
    ),
    destination:
      stringValue(destination?.title) ??
      stringValue(destination?.name) ??
      stringValue(destination?.dest_url) ??
      stringValue(destination?.url),
    creative: creativeId
      ? { name: "Video chosen", kind: "video", previewUrl: null }
      : null,
    currency: aggregate.version.host_currency,
    capCents: aggregate.version.host_budget_cents,
    // #4238: a plan row has not launched (a launched plan shows as its
    // campaign), so it has no spend to show: "NGN 1,500,000.00 budget".
    spendCents: null,
    spendByCurrency: [],
    primaryResultLabel: "results",
    primaryResultCount: 0,
    costPerResultCents: null,
    resultsValueCents: {},
    nextAction: planNextAction(aggregate.plan.state),
    // #4238: approved (or funded) and waiting for LAUNCH is not a draft.
    ...(aggregate.plan.state === "staff_approved" ||
      aggregate.plan.state === "funded_held"
      ? { statusLabel: "Ready to start" }
      : {}),
    route: `/(tabs)/marketing/ads/create?plan_id=${aggregate.plan.id}`,
    reason: typeof reason === "string" ? hostAdReviewReason(reason) : null,
    updatedAt: aggregate.plan.updated_at,
  };
}

function campaignItem(campaign: HostAdCampaign): HostAdListItem {
  return {
    id: campaign.id,
    kind: "campaign",
    lifecycle: campaign.lifecycle,
    name: campaign.name,
    platforms: campaign.platforms,
    destination: campaign.destination.url,
    creative: campaign.creative
      ? {
          name: campaign.creative.name,
          kind: campaign.creative.kind,
          previewUrl: campaign.creative.preview_url,
        }
      : null,
    currency: campaign.currency,
    capCents: campaign.cap_cents,
    spendCents: campaign.host_spend_equivalent_cents,
    spendByCurrency: campaign.spend_by_currency,
    primaryResultLabel: campaign.primary_result_label,
    primaryResultCount: campaign.primary_result_count,
    costPerResultCents: campaign.cost_per_result_cents,
    resultsValueCents: campaign.results_value_cents ?? {},
    nextAction: campaign.next_action,
    route: `/(tabs)/marketing/ads/${campaign.id}`,
    reason: campaign.creative?.review_status?.toUpperCase().includes("REJECT")
      ? "An app turned down your video"
      : null,
    updatedAt: campaign.updated_at ?? campaign.created_at,
    pauseReason:
      typeof (campaign as { pause_reason?: unknown }).pause_reason === "string"
        ? ((campaign as { pause_reason?: string }).pause_reason as string)
        : null,
    startedAt: campaign.starts_at ?? campaign.created_at,
  };
}

export function buildHostAdList(input: {
  drafts: HostAdDraft[];
  plans: HostAdPlanAggregate[];
  campaigns: HostAdCampaign[];
  /** #4238: plans already created on the apps (live, ended, …). */
  launchedPlanIds?: readonly string[];
  /** #4238: plan version id → plan id, to tie a campaign to its plan. */
  planIdByVersionId?: Readonly<Record<string, string>>;
}): HostAdListItem[] {
  // A draft is hidden when its plan already shows as its own row, or when
  // that plan already has a campaign or was launched: the draft is finished.
  const versionToPlan = input.planIdByVersionId ?? {};
  const hiddenPlanIds = new Set<string>([
    ...input.plans.map((item) => item.plan.id),
    ...(input.launchedPlanIds ?? []),
    ...input.campaigns.flatMap((campaign) => {
      const planId = campaign.plan_version_id
        ? versionToPlan[campaign.plan_version_id]
        : undefined;
      return planId ? [planId] : [];
    }),
  ]);
  return [
    ...input.drafts
      .filter(
        (draft) => draft.plan_id === null || !hiddenPlanIds.has(draft.plan_id),
      )
      .map(draftItem),
    ...input.plans.map(planItem),
    ...input.campaigns.map(campaignItem),
  ].sort((left, right) =>
    String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")),
  );
}

/**
 * #4238: the money line on an Ads list row, written like the Results card
 * ("NGN 42,000.00 of NGN 100,000.00 spent"). Spend is the Host-currency
 * equivalent; a zero or missing budget is hidden, never written as
 * "NGN 0.00 cap". When spend is only known in the apps' own currencies, it
 * is shown in those ("USD 137.00").
 */
export function hostAdListRowMoney(
  item: Pick<HostAdListItem, "currency" | "capCents" | "spendCents" | "spendByCurrency">,
): string {
  const budget =
    item.capCents !== null && item.capCents > 0
      ? formatHostAdMoneyCents(item.capCents, item.currency)
      : null;
  const spent =
    item.currency !== null && item.spendCents !== null
      ? formatHostAdMoneyCents(item.spendCents, item.currency)
      : null;
  if (spent) return budget ? `${spent} of ${budget} spent` : `${spent} spent`;
  const providerSpend = item.spendByCurrency
    .filter((row) => Number(row.spend_cents) > 0)
    .flatMap((row) => {
      const money = formatHostAdMoneyCents(row.spend_cents, row.currency);
      return money ? [money] : [];
    })
    .join(" · ");
  if (budget && item.currency !== null) {
    return providerSpend
      ? `${budget} budget · ${providerSpend} spent on the apps`
      : `${budget} budget`;
  }
  if (providerSpend) return `${providerSpend} spent on the apps`;
  return "Budget set before launch";
}

/**
 * #4238: plan states before anything was created on the apps. Nothing can
 * have been spent yet, so the money line names only the budget.
 */
export const HOST_AD_PRE_LAUNCH_PLAN_STATES: ReadonlySet<string> = new Set([
  "draft",
  "validating",
  "ready_for_funding",
  "funding_pending",
  "funded_held",
  "staff_review_required",
  "staff_approved",
  "changes_requested",
  "staff_rejected",
  "payment_failed",
  "expired",
  "cancelled_before_create",
]);

/**
 * #4238: the top money line on an ad's page, in the same "NGN 1,500,000.00"
 * style as the Ads list and the Results card. An ad that hasn't launched
 * reads "NGN 1,500,000.00 budget", never "Spent NGN 0.00 of …".
 */
export function hostAdDetailMoneyLine(input: {
  spentCents: number | null;
  capCents: number;
  currency: string;
  planState: string | null;
}): string {
  const budget = formatHostAdMoneyCents(input.capCents, input.currency) ?? "";
  const launched =
    input.planState === null || !HOST_AD_PRE_LAUNCH_PLAN_STATES.has(input.planState);
  if (!launched && (input.spentCents === null || input.spentCents === 0)) {
    return `${budget} budget`;
  }
  const spent =
    input.spentCents !== null
      ? formatHostAdMoneyCents(input.spentCents, input.currency)
      : null;
  return spent
    ? `Spent ${spent} of your ${budget} budget`
    : `${budget} set aside · we can't show spend in your currency yet`;
}

export function hostAdMatchesFilter(
  item: HostAdListItem,
  filter: HostAdFilter,
): boolean {
  return filter === "all" || item.lifecycle === filter;
}
