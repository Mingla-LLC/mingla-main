import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  brandPaymentOnboardingRoute,
  normalizeProviderNeutralPaidPublishGuardReason,
  resolveProviderNeutralPaidPublishGuardCopy,
} from "../paidPublishGuards";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const businessFile = (relativePath: string): string =>
  readFileSync(join(REPO_ROOT, "mingla-business", relativePath), "utf8");

describe("issue #1919 provider-neutral Business readiness", () => {
  test.each([
    "stripe_charges_disabled",
    "payment_collection_unavailable",
  ])("normalizes %s to the canonical semantic and truthful UI", (wireReason) => {
    expect(normalizeProviderNeutralPaidPublishGuardReason(wireReason)).toBe(
      "payment_collection_unavailable",
    );
    expect(resolveProviderNeutralPaidPublishGuardCopy(wireReason)).toEqual({
      reason: "payment_collection_unavailable",
      title: "Finish your payment setup",
      body: "You can’t publish a paid listing until this brand’s payout account is ready. Finish payment setup, then try again.",
      actionLabel: "Finish payment setup",
      action: "payment_onboarding",
    });
  });

  test("canonical input wins when a decorated transition message contains both tokens", () => {
    expect(
      normalizeProviderNeutralPaidPublishGuardReason(
        "stripe_charges_disabled: payment_collection_unavailable",
      ),
    ).toBe("payment_collection_unavailable");
    expect(brandPaymentOnboardingRoute("brand-1919")).toBe(
      "/brand/brand-1919/payments/onboard",
    );
  });

  test("Event, Trip, and Experience proactive gates share payoutGateStatus", () => {
    const event = businessFile("src/components/event/EventCreatorWizard.tsx");
    expect(event).toContain("payoutGateStatus");
    expect(event).toContain(
      "const stripeStatus: BrandStripeStatus = payoutGateStatus(brand);",
    );
    for (const path of [
      "src/components/trip/TripCreatorWizard.tsx",
      "src/components/experience/ExperienceCreatorWizard.tsx",
    ]) {
      const source = businessFile(path);
      expect(source).toContain("payoutGateStatus");
      expect(source).toContain("stripeStatus: payoutGateStatus(brand)");
    }
    const tripRoute = businessFile("app/trip/[id]/edit.tsx");
    expect(tripRoute).toContain(
      "paymentProvider: currentBrand.paymentProvider",
    );
    expect(tripRoute).toContain(
      "paystackSubaccountCode: currentBrand.paystackSubaccountCode ?? null",
    );
  });

  test("all three Business buyer readers use collect authorities with paid fail-closed paths", () => {
    const events = businessFile("src/services/publicEventsService.ts");
    const experiences = businessFile("src/services/publicExperienceService.ts");
    const trips = businessFile("src/hooks/usePublicTripBySlug.ts");

    // [TEST-MOD #4518] — the three copies of this read became ONE owner
    // (`brandCanCollect.ts`). The pins below followed the code there. What
    // changed on purpose: a request that never got an answer is retried and
    // is no longer rendered as "the organizer is finishing payment setup";
    // a server "no", and a server error, still close paid supply.
    const owner = businessFile("src/services/brandCanCollect.ts");
    expect(owner).toContain('supabase.rpc("pg_brand_can_collect"');
    expect(owner).toContain("if (!isPaid) return true;");
    expect(owner).toContain('if (!isTransportFailure(error)) return "no";');
    expect(owner).toContain('answer !== "no"');
    for (const reader of [events, experiences, trips]) {
      expect(reader).toContain("resolveOfferingBookable(");
      expect(reader).not.toContain('supabase.rpc("pg_brand_can_collect"');
    }
    expect(events).toContain('supabase.rpc("pg_brands_can_collect"');
    expect(events).toContain(
      "return isTransportFailure(error) ? new Set<string>(brandIds) : new Set<string>();",
    );

    for (const reader of [events, experiences, trips]) {
      expect(reader).not.toContain('supabase.rpc("pg_brand_can_charge"');
      expect(reader).not.toContain('supabase.rpc("pg_brands_can_charge"');
    }
  });
});
