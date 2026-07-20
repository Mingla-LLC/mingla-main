/**
 * issue #1014 [free-only publish / money fails close] — implementor happy-path
 * regression, trip leg (SPEC §7 T-13, trip wizard).
 *
 * `business_publish_trip_draft` (post-#1014 migration) leaves a paid trip on a
 * currency-less brand to trigger (c)'s strict path → the RPC surfaces
 * `event_currency_required` on error.message → tripsService passes it as
 * `rawMessage` → TripCreatorStep5Review.mapPublishErrorToState must map it to
 * the actionable Step-5 banner copy (the proactive StripeBlockedCard next to
 * it carries the Connect CTA), NEVER the raw token / generic default.
 *
 * Source-grep pattern (publishErrorMapper.adversarial.test.ts precedent — the
 * component imports react-native and cannot be imported under node-env jest).
 *
 * fails-on-revert: deleting the `event_currency_required` case from the
 * mapper switch turns these assertions red.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "@jest/globals";

const SOURCE = readFileSync(
  join(__dirname, "..", "TripCreatorStep5Review.tsx"),
  "utf8",
);

describe("issue #1014 — trip publish error mapping for event_currency_required", () => {
  test("the mapper carries an event_currency_required case", () => {
    expect(SOURCE).toContain('case "event_currency_required":');
  });

  test("the case maps to the locked actionable copy, pointing at Step 5", () => {
    const caseIdx = SOURCE.indexOf('case "event_currency_required":');
    expect(caseIdx).toBeGreaterThan(-1);
    const caseBlock = SOURCE.slice(caseIdx, caseIdx + 600);
    expect(caseBlock).toContain(
      "Connect your bank to set a payout currency before publishing a paid trip. Free trips publish any time.",
    );
    expect(caseBlock).toContain("pointsToStep: 5");
  });

  test("the switch still discriminates on rawMessage (ORCH-0859 P0001 contract)", () => {
    // Postgrest returns code=P0001 for unqualified RAISE; the literal lives in
    // message. Reverting the discriminator would dead-end EVERY mapped reason.
    expect(SOURCE).toContain("switch (rawMessage) {");
  });

  test("the pre-existing ORCH-1075 cases are untouched", () => {
    expect(SOURCE).toContain('case "stripe_charges_disabled":');
    expect(SOURCE).toContain('case "offering_date_past":');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// issue #1014 REWORK (tester F-1, SPEC-AMENDMENT #2) — APPEND-ONLY extension.
//
// A currency-less brand pricing a PAID trip at Step 4 fires trigger (d)'s
// `event_currency_required` during AUTOSAVE (updateTripPricing /
// createTripPricingTier) — before publish ever runs. Pre-rework, the wizard's
// handleNext/handleStepBack catches mapped EVERY autosave failure to
// "Couldn't save your changes. Check your connection and try again." — a
// misleading dead end with no payments route.
//
// Contract: both autosave catches run the caught error through
// resolvePaidPublishGuardCopy FIRST; a stripe_onboarding-action copy surfaces
// the locked body + routes to the payments onboarding (mirroring
// handleConfirmPublish); only unrecognized errors keep the connection toast.
//
// fails-on-revert: deleting the resolver call / the guard branch from the
// catches turns these assertions red.
// ─────────────────────────────────────────────────────────────────────────────

const WIZARD_SOURCE = readFileSync(
  join(__dirname, "..", "TripCreatorWizard.tsx"),
  "utf8",
);

describe("issue #1014 rework — autosave catches map money-setup guards (F-1)", () => {
  test("the wizard imports the guard resolver alongside the onboarding route", () => {
    expect(WIZARD_SOURCE).toContain("resolvePaidPublishGuardCopy");
    expect(WIZARD_SOURCE).toContain("brandStripeOnboardingRoute");
  });

  test("BOTH autosave catches (handleNext + handleStepBack) run the resolver", () => {
    const calls = WIZARD_SOURCE.split(
      "resolvePaidPublishGuardCopy(autosaveErrCode)",
    ).length - 1;
    expect(calls).toBe(2);
  });

  test("the stripe_onboarding branch surfaces the locked copy and routes to payments", () => {
    const firstCatch = WIZARD_SOURCE.indexOf(
      "resolvePaidPublishGuardCopy(autosaveErrCode)",
    );
    expect(firstCatch).toBeGreaterThan(-1);
    const branch = WIZARD_SOURCE.slice(firstCatch, firstCatch + 700);
    expect(branch).toContain('guardCopy.action === "stripe_onboarding"');
    expect(branch).toContain("message: guardCopy.body");
    expect(branch).toContain(
      "router.push(brandStripeOnboardingRoute(trip.brandId)",
    );
  });

  test("unrecognized autosave errors keep the connection toast (both catches)", () => {
    const toasts = WIZARD_SOURCE.split(
      "Couldn't save your changes. Check your connection and try again.",
    ).length - 1;
    expect(toasts).toBe(2);
  });
});

describe("issue #1014 rework — tripsService pricing writes stop fabricating USD (F-2)", () => {
  const SERVICE_SOURCE = readFileSync(
    join(__dirname, "..", "..", "..", "services", "tripsService.ts"),
    "utf8",
  );

  test("no `?? \"USD\"` currency fabrication remains anywhere in tripsService", () => {
    expect(SERVICE_SOURCE).not.toContain('?? "USD"');
  });

  test("both pricing reads pass NULL through (trigger (d) is authoritative)", () => {
    const nulls = SERVICE_SOURCE.split(
      "as string | null) ?? null",
    ).length - 1;
    // createTripDraft (original #1014 leg) + updateTripPricing +
    // createTripPricingTier (rework F-2 legs).
    expect(nulls).toBeGreaterThanOrEqual(3);
  });
});
