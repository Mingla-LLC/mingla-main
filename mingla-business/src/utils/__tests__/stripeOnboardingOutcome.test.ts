import { describe, expect, test } from "@jest/globals";

import {
  classifyStripeOnboardingOutcome,
  deriveStripeOnboardingEntryState,
  getEffectiveBrandStripeStatus,
  isActionableStripeRestriction,
  isTerminalStripeRestriction,
} from "../stripeOnboardingOutcome";

describe("stripeOnboardingOutcome", () => {
  test("prefers live Stripe status over cached brand status", () => {
    expect(
      getEffectiveBrandStripeStatus({
        cachedStatus: "onboarding",
        liveStatus: "restricted",
      }),
    ).toBe("restricted");
  });

  test("falls back to cached brand status when live refresh has not loaded", () => {
    expect(
      getEffectiveBrandStripeStatus({
        cachedStatus: "onboarding",
        liveStatus: undefined,
      }),
    ).toBe("onboarding");
  });

  test("classifies actionable restricted requirements as needs-information", () => {
    expect(
      classifyStripeOnboardingOutcome({
        status: "restricted",
        requirements: {
          disabled_reason: "requirements.past_due",
          past_due: ["business_profile.url"],
        },
      }),
    ).toBe("needs-information");
  });

  test("does not let cached active bypass live restricted requirements", () => {
    expect(
      deriveStripeOnboardingEntryState({
        cachedStatus: "active",
        liveStatus: "restricted",
        liveStatusLoaded: true,
        requirements: {
          disabled_reason: "requirements.past_due",
          past_due: ["business_profile.url"],
        },
      }),
    ).toBe("needs-information");
  });

  test("allows cached active to render success only after live active confirms it", () => {
    expect(
      deriveStripeOnboardingEntryState({
        cachedStatus: "active",
        liveStatus: null,
        liveStatusLoaded: false,
      }),
    ).toBe("checking-status");

    expect(
      deriveStripeOnboardingEntryState({
        cachedStatus: "active",
        liveStatus: "active",
        liveStatusLoaded: true,
      }),
    ).toBe("already-active");
  });

  test("classifies requested capabilities as needs-information", () => {
    expect(
      isActionableStripeRestriction({
        disabled_reason: "action_required.requested_capabilities",
      }),
    ).toBe(true);
  });

  test("classifies terminal Stripe rejections as failed-stripe", () => {
    const requirements = { disabled_reason: "rejected.fraud" };
    expect(isTerminalStripeRestriction(requirements)).toBe(true);
    expect(
      classifyStripeOnboardingOutcome({
        status: "restricted",
        requirements,
      }),
    ).toBe("failed-stripe");
  });
});
