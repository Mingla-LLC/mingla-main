import { describe, expect, it } from "vitest";
import { deriveBrandStripeStatus } from "./stripeConnectStatus";

describe("deriveBrandStripeStatus", () => {
  it("returns not_connected without account id", () => {
    expect(deriveBrandStripeStatus(null, false, false, {})).toBe("not_connected");
    expect(deriveBrandStripeStatus("", false, false, {})).toBe("not_connected");
  });

  it("returns restricted when disabled_reason set", () => {
    expect(
      deriveBrandStripeStatus("acct_1", false, false, {
        disabled_reason: "requirements.past_due",
      }),
    ).toBe("restricted");
  });

  it("returns active when charges_enabled", () => {
    expect(deriveBrandStripeStatus("acct_1", true, false, { currently_due: [] })).toBe(
      "active",
    );
  });

  it("returns onboarding when verification pending", () => {
    expect(
      deriveBrandStripeStatus("acct_1", false, false, {
        currently_due: ["individual.verification.document"],
      }),
    ).toBe("onboarding");
  });
});
