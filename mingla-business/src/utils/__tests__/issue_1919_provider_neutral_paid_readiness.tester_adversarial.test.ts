import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  brandPaymentOnboardingRoute,
  resolveProviderNeutralPaidPublishGuardCopy,
} from "../paidPublishGuards";

const ROOT = join(__dirname, "..", "..", "..", "..");
const read = (path: string): string => readFileSync(join(ROOT, "mingla-business", path), "utf8");

describe("issue #1919 tester adversarial Business contract", () => {
  test("decorated legacy and canonical failures converge without leaking Stripe UI", () => {
    for (const raw of [
      "PostgREST P0001: stripe_charges_disabled detail=redacted",
      "payment_collection_unavailable",
      "stripe_charges_disabled payment_collection_unavailable",
    ]) {
      const copy = resolveProviderNeutralPaidPublishGuardCopy(raw);
      expect(copy).toEqual({
        reason: "payment_collection_unavailable",
        title: "Finish your payment setup",
        body: "You can’t publish a paid listing until this brand’s payout account is ready. Finish payment setup, then try again.",
        actionLabel: "Finish payment setup",
        action: "payment_onboarding",
      });
      expect(JSON.stringify(copy)).not.toMatch(/stripe|connect|bank setup/i);
    }
    expect(brandPaymentOnboardingRoute("brand/id with spaces")).toBe(
      "/brand/brand/id with spaces/payments/onboard",
    );
  });

  test("all six standard offering presentation boundaries use the scoped adapter", () => {
    const boundaries = [
      "src/components/event/EventCreatorWizard.tsx",
      "app/event/[id]/edit.tsx",
      "src/components/trip/TripCreatorWizard.tsx",
      "src/components/trip/EditPublishedTripScreen.tsx",
      "src/components/experience/ExperienceCreatorWizard.tsx",
      "app/trip/[id]/edit.tsx",
    ];
    const combined = boundaries.map(read).join("\n");
    expect(combined).toContain("resolveProviderNeutralPaidPublishGuardCopy");
    expect(combined).toContain("brandPaymentOnboardingRoute");
    expect(combined).not.toContain('router.push(brandStripeOnboardingRoute');
  });

  test("Trip and Experience cannot regress to a raw Stripe proactive carrier", () => {
    for (const path of [
      "src/components/trip/TripCreatorWizard.tsx",
      "src/components/experience/ExperienceCreatorWizard.tsx",
    ]) {
      const source = read(path);
      expect(source).toContain("stripeStatus: payoutGateStatus(brand)");
      expect(source).not.toMatch(/stripeStatus:\s*brand\.stripeStatus/);
    }
  });

  test("excluded payment flows remain outside the scoped normalization seam", () => {
    for (const path of [
      "src/components/rsvp/RsvpCreatorWizard.tsx",
      "src/components/venue/VenueSettingsModule.tsx",
    ]) {
      expect(read(path)).not.toContain("resolveProviderNeutralPaidPublishGuardCopy");
    }
  });
});
