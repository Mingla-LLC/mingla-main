import type { BrandStripeStatus } from "../store/currentBrandStore";

export type StripeOnboardingOutcome =
  | "complete-active"
  | "complete-verifying"
  | "needs-information"
  | "failed-stripe"
  | "session-expired";

export type StripeOnboardingEntryState =
  | "idle"
  | "checking-status"
  | "already-active"
  | "complete-verifying"
  | "needs-information"
  | "failed-stripe"
  | "session-expired";

export interface StripeRequirementsShape {
  disabled_reason?: string | null;
  currently_due?: readonly string[] | null;
  past_due?: readonly string[] | null;
}

const TERMINAL_RESTRICTION_REASONS = new Set([
  "rejected.fraud",
  "rejected.listed",
  "rejected.other",
  "rejected.terms_of_service",
]);

const ACTIONABLE_RESTRICTION_REASONS = new Set([
  "requirements.past_due",
  "action_required.requested_capabilities",
]);

const PENDING_REVIEW_REASONS = new Set([
  "requirements.pending_verification",
]);

export function getEffectiveBrandStripeStatus(args: {
  liveStatus?: BrandStripeStatus | null;
  cachedStatus?: BrandStripeStatus | null;
}): BrandStripeStatus {
  return args.liveStatus ?? args.cachedStatus ?? "not_connected";
}

export function deriveStripeOnboardingEntryState(args: {
  cachedStatus?: BrandStripeStatus | null;
  liveStatus?: BrandStripeStatus | null;
  liveStatusLoaded: boolean;
  requirements?: StripeRequirementsShape | null;
}): StripeOnboardingEntryState {
  if (args.cachedStatus !== "active") return "idle";

  if (!args.liveStatusLoaded || args.liveStatus == null) {
    return "checking-status";
  }

  const outcome = classifyStripeOnboardingOutcome({
    status: args.liveStatus,
    requirements: args.requirements,
  });

  return outcome === "complete-active" ? "already-active" : outcome;
}

function hasDueRequirements(requirements: StripeRequirementsShape | null | undefined): boolean {
  return (
    (requirements?.currently_due?.length ?? 0) > 0 ||
    (requirements?.past_due?.length ?? 0) > 0
  );
}

export function isTerminalStripeRestriction(
  requirements: StripeRequirementsShape | null | undefined,
): boolean {
  const disabledReason = requirements?.disabled_reason;
  return disabledReason != null && TERMINAL_RESTRICTION_REASONS.has(disabledReason);
}

export function isActionableStripeRestriction(
  requirements: StripeRequirementsShape | null | undefined,
): boolean {
  const disabledReason = requirements?.disabled_reason;
  if (isStripePendingVerification(requirements)) return false;
  return (
    hasDueRequirements(requirements) ||
    (disabledReason != null && ACTIONABLE_RESTRICTION_REASONS.has(disabledReason))
  );
}

export function isStripePendingVerification(
  requirements: StripeRequirementsShape | null | undefined,
): boolean {
  const disabledReason = requirements?.disabled_reason;
  return (
    disabledReason != null &&
    PENDING_REVIEW_REASONS.has(disabledReason) &&
    !hasDueRequirements(requirements)
  );
}

export function classifyStripeOnboardingOutcome(args: {
  status?: BrandStripeStatus | null;
  requirements?: StripeRequirementsShape | null;
}): StripeOnboardingOutcome {
  if (args.status === "active") return "complete-active";
  if (args.status === "onboarding") return "complete-verifying";
  if (args.status === "restricted") {
    if (isTerminalStripeRestriction(args.requirements)) return "failed-stripe";
    if (isStripePendingVerification(args.requirements)) return "complete-verifying";
    if (isActionableStripeRestriction(args.requirements)) return "needs-information";
    return "needs-information";
  }
  return "session-expired";
}
