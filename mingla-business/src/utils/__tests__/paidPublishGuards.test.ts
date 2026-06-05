import { describe, expect, test } from "@jest/globals";

import {
  brandStripeOnboardingRoute,
  detectPaidPublishGuardReason,
  paidPublishGuardCopy,
  resolvePaidPublishGuardCopy,
} from "../paidPublishGuards";

/**
 * ORCH-1075 [Paid-publish integrity guards] — business-app catch-site
 * regression test. Proves the two RPC rejection reasons (Guard A:
 * stripe_charges_disabled; Guard B: offering_date_past) map to the LOCKED copy
 * + the correct route, from BOTH RPC surfaces:
 *   - publish RPCs RAISE the reason → it arrives on `error.message`
 *   - edit RPCs return {ok:false, reason} → it arrives on `data.reason`
 *
 * fails-on-revert: if the reason→copy map or the route helper is reverted, the
 * locked-string assertions below fail. The tester adds the adversarial angle.
 */
describe("paidPublishGuards — reason detection", () => {
  test("detects stripe_charges_disabled as an exact reason (edit RPC data.reason)", () => {
    expect(detectPaidPublishGuardReason("stripe_charges_disabled")).toBe(
      "stripe_charges_disabled",
    );
  });

  test("detects offering_date_past as an exact reason (edit RPC data.reason)", () => {
    expect(detectPaidPublishGuardReason("offering_date_past")).toBe(
      "offering_date_past",
    );
  });

  test("detects stripe_charges_disabled inside a decorated RAISE message (publish RPC)", () => {
    // Postgres/PostgREST may wrap a RAISE EXCEPTION 'reason' string.
    expect(
      detectPaidPublishGuardReason(
        'database error: stripe_charges_disabled (P0001)',
      ),
    ).toBe("stripe_charges_disabled");
  });

  test("detects offering_date_past inside a decorated RAISE message (publish RPC)", () => {
    expect(
      detectPaidPublishGuardReason("ERROR: offering_date_past"),
    ).toBe("offering_date_past");
  });

  test("returns null for unrelated reasons (no over-reach)", () => {
    expect(detectPaidPublishGuardReason("price_change_with_sales")).toBeNull();
    expect(detectPaidPublishGuardReason("experience_price_invalid")).toBeNull();
    expect(detectPaidPublishGuardReason("trip_end_before_start")).toBeNull();
    expect(detectPaidPublishGuardReason("")).toBeNull();
    expect(detectPaidPublishGuardReason(null)).toBeNull();
    expect(detectPaidPublishGuardReason(undefined)).toBeNull();
  });
});

describe("paidPublishGuards — locked copy (SPEC §3.7)", () => {
  test("stripe_charges_disabled → Finish your payment setup → stripe_onboarding action", () => {
    const copy = paidPublishGuardCopy("stripe_charges_disabled");
    expect(copy.title).toBe("Finish your payment setup");
    expect(copy.body).toBe(
      "You can't publish a paid listing until your bank payouts are switched on. It takes a couple of minutes.",
    );
    expect(copy.actionLabel).toBe("Finish bank setup");
    expect(copy.action).toBe("stripe_onboarding");
  });

  test("offering_date_past → Pick a future date → edit_date action", () => {
    const copy = paidPublishGuardCopy("offering_date_past");
    expect(copy.title).toBe("Pick a future date");
    expect(copy.body).toBe(
      "This date has already passed. Choose a date that's still ahead so people can book it.",
    );
    expect(copy.actionLabel).toBe("Edit date");
    expect(copy.action).toBe("edit_date");
  });

  test("resolvePaidPublishGuardCopy returns null for unrelated strings", () => {
    expect(resolvePaidPublishGuardCopy("price_change_with_sales")).toBeNull();
    expect(resolvePaidPublishGuardCopy(undefined)).toBeNull();
  });

  test("resolvePaidPublishGuardCopy maps both surfaces to the same copy", () => {
    const fromError = resolvePaidPublishGuardCopy(
      "ERROR: stripe_charges_disabled",
    );
    const fromReason = resolvePaidPublishGuardCopy("stripe_charges_disabled");
    expect(fromError).not.toBeNull();
    expect(fromError?.title).toBe("Finish your payment setup");
    expect(fromReason?.title).toBe("Finish your payment setup");
  });
});

describe("paidPublishGuards — onboarding route", () => {
  test("routes to the brand's Stripe Connect onboarding (the real entry)", () => {
    expect(brandStripeOnboardingRoute("brand-123")).toBe(
      "/brand/brand-123/payments/onboard",
    );
  });
});
