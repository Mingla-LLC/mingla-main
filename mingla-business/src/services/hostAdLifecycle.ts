import type { HostAdCampaign } from "./hostAdCampaignService";
import type { HostAdDraft, HostAdPlanAggregate } from "./hostAdPlanService";

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
  nextAction: string;
  route: string;
  reason: string | null;
  updatedAt: string | null;
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
              "Creative in progress",
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
    nextAction: "Continue draft",
    route: `/(tabs)/marketing/ads/create?draft_id=${draft.id}`,
    reason: `Saved at ${draft.current_step.replaceAll("_", " ")}`,
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
      ? { name: "Creative selected", kind: "video", previewUrl: null }
      : null,
    currency: aggregate.version.host_currency,
    capCents: aggregate.version.host_budget_cents,
    spendCents: 0,
    spendByCurrency: [],
    primaryResultLabel: "results",
    primaryResultCount: 0,
    costPerResultCents: null,
    nextAction: planNextAction(aggregate.plan.state),
    route: `/(tabs)/marketing/ads/create?plan_id=${aggregate.plan.id}`,
    reason: typeof reason === "string" ? reason : null,
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
    nextAction: campaign.next_action,
    route: `/(tabs)/marketing/ads/${campaign.id}`,
    reason: campaign.creative?.review_status?.toUpperCase().includes("REJECT")
      ? "Provider rejected the creative"
      : null,
    updatedAt: campaign.updated_at ?? campaign.created_at,
  };
}

export function buildHostAdList(input: {
  drafts: HostAdDraft[];
  plans: HostAdPlanAggregate[];
  campaigns: HostAdCampaign[];
}): HostAdListItem[] {
  const representedPlanIds = new Set(input.plans.map((item) => item.plan.id));
  return [
    ...input.drafts
      .filter(
        (draft) =>
          draft.plan_id === null || !representedPlanIds.has(draft.plan_id),
      )
      .map(draftItem),
    ...input.plans.map(planItem),
    ...input.campaigns.map(campaignItem),
  ].sort((left, right) =>
    String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")),
  );
}

export function hostAdMatchesFilter(
  item: HostAdListItem,
  filter: HostAdFilter,
): boolean {
  return filter === "all" || item.lifecycle === filter;
}
