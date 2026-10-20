/**
 * toward #3697 — the ad_campaigns columns a plan-bound provider create must
 * persist, derived ONLY from the frozen plan and its provider allocation.
 *
 * The database guard `ad_campaign_plan_binding_guard` rejects any campaign
 * row whose owner_kind / brand_id / currency / budget / fx / connection
 * differs from the plan it is bound to. A provider create succeeds BEFORE
 * this insert, so a mismatch here strands real provider objects and forces a
 * rollback. Production 2026-10-20: a Mingla-owned plan promoting a Host's
 * event page persisted brand_id = the event's brand (resolved from the page
 * slug) while the plan's brand_id is NULL, so the guard refused every row.
 *
 * Rule: once a plan is bound, the plan is the only authority for ownership.
 * The destination's brand is never the campaign's owner.
 */

export type BoundPlanOwnership = {
  owner_kind: "mingla" | "host";
  brand_id: string | null;
};

export type BoundPlanAllocation = {
  host_currency: string | null;
  provider_currency: string;
  host_budget_cents: number | string;
  provider_budget_cents: number | string;
  fx_snapshot_id: string | null;
};

export type BoundPlanMoney = {
  plan_version_id: string;
  plan_hash: string;
  /** NULL for Mingla-owned plans: there is no Host currency to honour. */
  host_currency: string | null;
  provider_currency: string;
  host_budget_cents: number;
  provider_budget_cents: number;
  provider_delivery_budget_cents: number;
  fx_snapshot_id: string | null;
};

/** The money/binding columns, equal to what the plan guard recomputes. */
export function boundPlanMoney(input: {
  plan: BoundPlanOwnership;
  allocation: BoundPlanAllocation;
  planVersionId: string;
  planHash: string;
  providerDeliveryBudgetCents: number;
}): BoundPlanMoney {
  const { plan, allocation } = input;
  return {
    plan_version_id: input.planVersionId,
    plan_hash: input.planHash,
    host_currency: plan.owner_kind === "mingla" || allocation.host_currency == null
      ? null
      : String(allocation.host_currency),
    provider_currency: String(allocation.provider_currency),
    host_budget_cents: Number(allocation.host_budget_cents),
    provider_budget_cents: Number(allocation.provider_budget_cents),
    provider_delivery_budget_cents: input.providerDeliveryBudgetCents,
    fx_snapshot_id: allocation.fx_snapshot_id
      ? String(allocation.fx_snapshot_id)
      : null,
  };
}

/**
 * The display/billing currency column. A Mingla-owned plan bills in the
 * selected provider account's currency (the currency trigger enforces it);
 * a Host plan bills in the Host's currency.
 */
export function boundPlanCampaignCurrency(
  plan: BoundPlanOwnership,
  allocation: BoundPlanAllocation,
): string {
  return plan.owner_kind === "mingla" || allocation.host_currency == null
    ? String(allocation.provider_currency)
    : String(allocation.host_currency);
}

/**
 * brand_id for the ad_campaigns insert. A bound plan's brand_id is final
 * (NULL for every Mingla-owned plan, whatever page it promotes). Only an
 * unbound call (validate-only) falls back to the destination's brand.
 */
export async function campaignPersistBrandId(
  bound: BoundPlanOwnership | null,
  pageType: string,
  resolveDestinationBrandId: () => Promise<string | null>,
): Promise<string | null> {
  if (bound) return bound.brand_id ?? null;
  if (pageType === "marketing") return null;
  return await resolveDestinationBrandId();
}
