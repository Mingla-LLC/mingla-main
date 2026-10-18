/**
 * Issue #3697 v1.4 — fail-closed plan binding for provider-native video copies.
 *
 * Bunny is the canonical, non-impression media source. Meta, Google, TikTok and
 * Snapchat copies are billable/provider-mutating launch work, so preparation
 * may begin only after the exact immutable plan is funded, reviewed when
 * required, and launch-confirmed. Keep this validator pure so every mismatch is
 * regression-testable without provider or database I/O.
 */

export type CreativePreparationPlan = {
  id: string;
  owner_kind: "mingla" | "host";
  brand_id: string | null;
  current_version_id: string | null;
  state: string;
};

export type CreativePreparationVersion = {
  id: string;
  plan_id: string;
  plan_hash: string;
  canonical_plan: Record<string, unknown>;
};

export type CreativePreparationAllocation = {
  platform: string;
  connection_id: string;
};

export type CreativePreparationConnection = {
  id: string;
};

export type CreativePreparationBinding = {
  plan: CreativePreparationPlan | null;
  version: CreativePreparationVersion | null;
  allocation: CreativePreparationAllocation | null;
  connection: CreativePreparationConnection | null;
  confirmationPresent: boolean;
  requestedPlanVersionId: string;
  requestedPlanHash: string;
  requestedCreativeId: string;
  requestedPlatform: string;
  requestedLane: "consumer" | "business";
  requestedBrandId: string;
};

const PREPARATION_STATES = new Set([
  "creating_paused_objects",
  "creation_failed_retryable",
]);

/** Returns the stable rejection detail, or null when the binding is exact. */
export function creativePreparationBindingError(
  binding: CreativePreparationBinding,
): string | null {
  const { plan, version, allocation, connection } = binding;
  if (!version || version.id !== binding.requestedPlanVersionId) {
    return "plan_version_hash_mismatch";
  }
  if (version.plan_hash !== binding.requestedPlanHash) {
    return "plan_version_hash_mismatch";
  }
  if (!plan || plan.id !== version.plan_id) return "plan_not_found";
  if (plan.current_version_id !== version.id) return "plan_version_stale";
  if (!PREPARATION_STATES.has(plan.state)) {
    return "plan_not_launch_confirmed";
  }
  if (!binding.confirmationPresent) return "plan_confirmation_missing";
  if (plan.owner_kind === "mingla") {
    if (binding.requestedLane !== "consumer") return "plan_lane_mismatch";
    if (binding.requestedBrandId) return "plan_brand_mismatch";
  } else {
    if (binding.requestedLane !== "business") return "plan_lane_mismatch";
    if (
      !plan.brand_id || plan.brand_id !== binding.requestedBrandId
    ) return "plan_brand_mismatch";
  }
  if (
    version.canonical_plan.creative_library_id !==
      binding.requestedCreativeId
  ) return "plan_creative_mismatch";
  if (
    !allocation || allocation.platform !== binding.requestedPlatform
  ) return "plan_platform_not_allocated";
  if (!connection || allocation.connection_id !== connection.id) {
    return "plan_connection_mismatch";
  }
  return null;
}
