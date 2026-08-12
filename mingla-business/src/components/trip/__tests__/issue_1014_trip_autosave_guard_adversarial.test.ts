/**
 * issue #1014 RETEST — TESTER ADVERSARIAL suite for the F-1/F-2 rework
 * (commit 4e8267be6): trip autosave catches map money-setup guards.
 *
 * Attacks angles the implementor's appended source-pins do not:
 *   1. RUNTIME resolver contract with the EXACT strings the catch feeds it
 *      (e.message): unrecognized autosave errors resolve null (connection
 *      toast stays reachable — no over-broad mapping), decorated trigger
 *      raises resolve to the payments action, and offering_date_past resolves
 *      to edit_date — which the catch's `action === "stripe_onboarding"` gate
 *      must NOT route to payments (the no-misfire contract).
 *   2. ORDER pin: in BOTH catches the guard resolver runs BEFORE the
 *      connection-toast fallback (guard-first; counting occurrences alone
 *      would pass even if the toast fired first).
 *   3. GATE pin: BOTH guard branches (not just the first) gate on
 *      `action === "stripe_onboarding"`, and BOTH carry the guard reason as
 *      the banner code (never "autosave_failed" for a mapped guard).
 *
 * fails-on-revert: deleting the guard branches from the two autosave catches
 * in TripCreatorWizard.tsx turns the order/gate pins red (verified by true
 * line deletion alongside the implementor's revert).
 *
 * CI: auto-registered by the issue-1014 workflow's jest job (issue_1014_*
 * pattern; mingla-business/src/** path filter).
 */

import { readFileSync } from "fs";
import { join } from "path";

// [TEST-MOD-APPROVED #1919] Preserve the #1014 currency/date scenarios while
// asserting the standard Trip caller's new provider-neutral adapter/action.
import { resolveProviderNeutralPaidPublishGuardCopy } from "../../../utils/paidPublishGuards";

const WIZARD_SOURCE = readFileSync(
  join(__dirname, "..", "TripCreatorWizard.tsx"),
  "utf8",
);

describe("issue #1014 RETEST — runtime resolver contract for the autosave catch inputs", () => {
  it("unrecognized autosave errors resolve null → the connection toast stays reachable", () => {
    expect(resolveProviderNeutralPaidPublishGuardCopy("Network request failed")).toBeNull();
    expect(
      resolveProviderNeutralPaidPublishGuardCopy("updateTripPricing: event not found for id=x"),
    ).toBeNull();
    expect(resolveProviderNeutralPaidPublishGuardCopy("tier_price_change_with_sales")).toBeNull();
    expect(resolveProviderNeutralPaidPublishGuardCopy("")).toBeNull();
  });

  it("a decorated trigger raise (the real Step-4 shape) maps to the payments action", () => {
    const copy = resolveProviderNeutralPaidPublishGuardCopy("P0001: event_currency_required");
    expect(copy?.action).toBe("payment_onboarding");
    expect(copy?.body).toContain("Free listings publish any time.");
  });

  it("offering_date_past resolves edit_date — the catch gate must not send it to payments", () => {
    const copy = resolveProviderNeutralPaidPublishGuardCopy("offering_date_past");
    expect(copy).not.toBeNull();
    expect(copy?.action).toBe("edit_date");
    expect(copy?.action).not.toBe("payment_onboarding");
  });
});

describe("issue #1014 RETEST — catch structure pins (order + gate, BOTH catches)", () => {
  const resolverToken = "resolveProviderNeutralPaidPublishGuardCopy(autosaveErrCode)";
  const toastToken =
    "Couldn't save your changes. Check your connection and try again.";

  const catchWindows = (): string[] => {
    const windows: string[] = [];
    let idx = WIZARD_SOURCE.indexOf(resolverToken);
    while (idx !== -1) {
      windows.push(WIZARD_SOURCE.slice(idx, idx + 1100));
      idx = WIZARD_SOURCE.indexOf(resolverToken, idx + resolverToken.length);
    }
    return windows;
  };

  it("exactly two autosave catches run the resolver", () => {
    expect(catchWindows()).toHaveLength(2);
  });

  it("ORDER: in each catch the guard branch precedes the connection-toast fallback", () => {
    for (const w of catchWindows()) {
      const gate = w.indexOf('guardCopy.action === "payment_onboarding"');
      const toast = w.indexOf(toastToken);
      expect(gate).toBeGreaterThan(-1);
      expect(toast).toBeGreaterThan(-1);
      expect(gate).toBeLessThan(toast);
    }
  });

  it("GATE: each catch routes ONLY stripe_onboarding-action copies, with the guard reason as banner code", () => {
    for (const w of catchWindows()) {
      expect(w).toContain('guardCopy.action === "payment_onboarding"');
      expect(w).toContain("code: guardCopy.reason");
      expect(w).toContain("router.push(brandPaymentOnboardingRoute(trip.brandId)");
    }
  });
});
