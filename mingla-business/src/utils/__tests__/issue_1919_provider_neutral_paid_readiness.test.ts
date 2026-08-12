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

    expect(events).toContain('supabase.rpc("pg_brand_can_collect"');
    expect(events).toContain('supabase.rpc("pg_brands_can_collect"');
    expect(events).toContain("if (!isPaid) return true;");
    expect(events).toContain("if (error !== null) return false;");
    expect(events).toContain("if (error !== null) return new Set<string>();");
    expect(experiences).toContain('supabase.rpc("pg_brand_can_collect"');
    expect(experiences).toContain("if (!isPaid) return true;");
    expect(experiences).toContain("if (error !== null) return false;");
    expect(trips).toContain('supabase.rpc("pg_brand_can_collect"');
    expect(trips).toContain("if (!isPaid) return true;");
    expect(trips).toContain("if (error !== null) return false;");

    for (const reader of [events, experiences, trips]) {
      expect(reader).not.toContain('supabase.rpc("pg_brand_can_charge"');
      expect(reader).not.toContain('supabase.rpc("pg_brands_can_charge"');
    }
  });
});
