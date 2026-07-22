/**
 * ORCH-1076 Stream B — trip proactive Stripe banner + disabled Publish + toast
 * (SPEC §9 T-17/T-18/T-19) and regressions T-23 (no edit-to-paid banner) /
 * T-24 (reactive ORCH-1075 catch intact).
 *
 * Repo harness note: Node-env Jest, no RN renderer (cannot import RN
 * components). These tests source-characterize the trip review (banner gated on
 * needsStripe, defaults to hidden) and the wizard wiring (compute, disable,
 * pre-check toast, reactive catch) + the EditPublishedTripScreen.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import path from "path";

const read = (rel: string): string =>
  readFileSync(path.join(process.cwd(), rel), "utf8");

const reviewSource = (): string =>
  read("src/components/trip/TripCreatorStep5Review.tsx");
const wizardSource = (): string =>
  read("src/components/trip/TripCreatorWizard.tsx");
const editSource = (): string =>
  read("src/components/trip/EditPublishedTripScreen.tsx");

describe("ORCH-1076 — trip review banner (T-17 / T-18)", () => {
  test("T-17 banner is gated on needsStripe and carries the trip copy + CTA", () => {
    const src = reviewSource();
    expect(src).toContain("import { StripeBlockedCard }");
    expect(src).toContain("{needsStripe ? (");
    expect(src).toContain('title="Bank required for paid trips"');
    expect(src).toContain(
      "Connect a bank to publish this paid trip. Free trips can be published any time.",
    );
    expect(src).toContain('ctaLabel="Connect bank"');
    expect(src).toContain('testID="trip-step5-stripe-blocked"');
  });

  test("T-18 needsStripe defaults to false → banner hidden for existing callers", () => {
    const src = reviewSource();
    expect(src).toContain("needsStripe = false");
    expect(src).toContain("needsStripe?: boolean;");
  });

  test("the proactive banner renders BELOW the reactive publishError, ABOVE preview", () => {
    const src = reviewSource();
    const errorIdx = src.indexOf("publishError !== null ?");
    const stripeIdx = src.indexOf("{needsStripe ? (");
    const previewIdx = src.indexOf("styles.previewWrap");
    expect(errorIdx).toBeGreaterThan(-1);
    expect(stripeIdx).toBeGreaterThan(errorIdx);
    expect(previewIdx).toBeGreaterThan(stripeIdx);
  });
});

describe("ORCH-1076 — trip wizard gate + disabled Publish + toast (T-19)", () => {
  test("computes tripNeedsStripe from the paid resolver + brand.stripeStatus", () => {
    const src = wizardSource();
    expect(src).toContain("offeringNeedsStripeToPublish");
    expect(src).toContain("tripDraftIsPaid(step4Draft)");
    expect(src).toContain("stripeStatus: brand.stripeStatus ?? null");
  });

  test("dock Publish is disabled when tripNeedsStripe", () => {
    const src = wizardSource();
    // [TEST-MOD-APPROVED ORCH-1062] DRIFT UPDATE (intended, cited): the dock
    // Publish disabled clause gained `!tripLocationValid` (ORCH-1118 trip-location
    // Mapbox gate) and `!packagesValidation.ok` (META-ORCH-1174 Leg B2 multi-
    // package validity) and is now multi-line formatted (TripCreatorWizard.tsx
    // :1637-1642). tripNeedsStripe is still a disabling term (ORCH-1076 Stream B).
    // Assert the exact current gate at the same (all-terms) strength.
    expect(src).toMatch(
      /disabled=\{\s*submitting\s*\|\|\s*tripNeedsStripe\s*\|\|\s*!tripLocationValid\s*\|\|\s*!packagesValidation\.ok\s*\}/,
    );
  });

  test("handlePublishTap pre-checks tripNeedsStripe → toast, no confirm dialog", () => {
    const src = wizardSource();
    const tapIdx = src.indexOf("const handlePublishTap");
    // [TEST-MOD-APPROVED ORCH-1062] window widened 600→1400: ORCH-1118 inserted a
    // trip-location pre-check block (with a multi-line comment) BEFORE the
    // tripNeedsStripe pre-check, pushing `if (tripNeedsStripe)` past the old
    // 600-char window. The invariant (stripe toast + return BEFORE the confirm
    // dialog) is unchanged; the window just needs to reach it (the confirm call
    // now sits ~1390 chars in — after the location + packages pre-checks).
    const block = src.slice(tapIdx, tapIdx + 1600);
    expect(block).toContain("if (tripNeedsStripe)");
    expect(block).toContain("Connect a bank to publish this paid trip.");
    const toastIdx = block.indexOf("Connect a bank to publish this paid trip.");
    const returnIdx = block.indexOf("return;", toastIdx);
    const confirmIdx = block.indexOf("setPublishConfirmVisible(true)");
    expect(returnIdx).toBeGreaterThan(toastIdx);
    expect(confirmIdx).toBeGreaterThan(returnIdx);
  });

  test("onConnectStripe routes to the brand Stripe onboarding builder", () => {
    const src = wizardSource();
    expect(src).toContain("const handleConnectStripe");
    expect(src).toContain("brandStripeOnboardingRoute(trip.brandId)");
    expect(src).toContain("onConnectStripe={handleConnectStripe}");
  });

  test("the edit route threads stripeStatus into the wizard brand prop", () => {
    const src = read("app/trip/[id]/edit.tsx");
    expect(src).toContain("stripeStatus: currentBrand.stripeStatus ?? null");
  });
});

describe("ORCH-1076 — regressions", () => {
  test("T-23 EditPublishedTripScreen has NO proactive StripeBlockedCard", () => {
    const src = editSource();
    expect(src).not.toContain("StripeBlockedCard");
    expect(src).not.toContain("offeringNeedsStripeToPublish");
  });

  test("T-24 reactive ORCH-1075 catch still wired in the wizard", () => {
    const src = wizardSource();
    expect(src).toContain("mapPublishErrorToState");
    expect(src).toContain("stripe_charges_disabled");
    expect(src).toContain("brandStripeOnboardingRoute(trip.brandId)");
  });

  test("edit-to-paid reactive catch on EditPublishedTripScreen is unchanged", () => {
    const src = editSource();
    expect(src).toContain("stripe_charges_disabled");
    expect(src).toContain("brandStripeOnboardingRoute");
  });
});
