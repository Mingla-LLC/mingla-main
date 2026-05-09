import {
  ACTIVE_STRIPE_BANNER_TITLE,
  getBrandProfileStripeBannerCopy,
  getBrandProfileStripeOperationsSub,
  getStripeCountryLockedCopy,
  getStripeCountryReplaceableCopy,
  isStripeCountryPickerLocked,
} from "../brandStripeUiState";
import { getEffectiveBrandStripeStatus } from "../stripeOnboardingOutcome";

describe("brandStripeUiState", () => {
  it("keeps the country picker editable before an account exists or while incomplete", () => {
    expect(isStripeCountryPickerLocked({ status: "not_connected" })).toBe(
      false,
    );
    expect(
      isStripeCountryPickerLocked({
        stripeAccountId: "acct_old",
        status: "restricted",
        detailsSubmitted: false,
        chargesEnabled: false,
        payoutsEnabled: false,
      }),
    ).toBe(false);
  });

  it("locks country after active/completed or money-enabled Stripe state", () => {
    expect(
      isStripeCountryPickerLocked({
        stripeAccountId: "acct_old",
        status: "active",
      }),
    ).toBe(true);
    expect(
      isStripeCountryPickerLocked({
        stripeAccountId: "acct_old",
        detailsSubmitted: true,
      }),
    ).toBe(true);
    expect(
      isStripeCountryPickerLocked({
        stripeAccountId: "acct_old",
        payoutsEnabled: true,
      }),
    ).toBe(true);
  });

  it("returns the required country replacement and locked copy", () => {
    expect(ACTIVE_STRIPE_BANNER_TITLE).toBe("You're connected to Stripe");
    expect(getStripeCountryReplaceableCopy("US")).toBe(
      "You can still change country because Stripe setup is not complete. We'll create a new Stripe setup for US.",
    );
    expect(getStripeCountryLockedCopy("GB")).toBe(
      "Stripe is connected for GB. To use a different country or currency, create a new brand.",
    );
  });

  it("suppresses stale profile verifying copy when live Stripe status is active", () => {
    const effectiveStatus = getEffectiveBrandStripeStatus({
      cachedStatus: "onboarding",
      liveStatus: "active",
    });

    expect(effectiveStatus).toBe("active");
    expect(getBrandProfileStripeBannerCopy(effectiveStatus)).toBeNull();
    expect(getBrandProfileStripeOperationsSub(effectiveStatus)).toBe("Active");
  });

  it("keeps profile verifying copy only when effective status is onboarding", () => {
    const effectiveStatus = getEffectiveBrandStripeStatus({
      cachedStatus: "onboarding",
      liveStatus: undefined,
    });

    expect(getBrandProfileStripeBannerCopy(effectiveStatus)).toEqual({
      title: "Onboarding submitted — verifying",
      sub: "We'll email you when Stripe finishes verifying your details.",
    });
    expect(getBrandProfileStripeOperationsSub(effectiveStatus)).toBe(
      "Onboarding…",
    );
  });
});
