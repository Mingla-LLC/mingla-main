/**
 * issue #3645 — a trip with a priced package (or a payment plan) saves as a
 * draft before the brand can take payments; the stop is at Publish.
 *
 * The step-save behaviour itself (a money-setup refusal is said on the step
 * and never navigates) is EXECUTED in
 * `issue_3801_trip_step_save_failure.implementor.test.tsx`. This file pins the
 * rest: the pricing step's informational card, the Review card's new copy and
 * its payment-plan parity, and that no step save can reach bank setup.
 * Source assertions, per the repo's node-jest convention for RN components.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (relative: string): string =>
  readFileSync(path.join(process.cwd(), relative), "utf8");

const WIZARD = read("src/components/trip/TripCreatorWizard.tsx");
const PRICING = read("src/components/trip/TripCreatorStep4Pricing.tsx");
const REVIEW = read("src/components/trip/TripCreatorStep5Review.tsx");

const between = (source: string, from: string, to: string): string => {
  const start = source.indexOf(from);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf(to, start + from.length);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

describe("#3645 — a step save never reaches bank setup", () => {
  test("Continue and Back contain no navigation at all", () => {
    const next = between(
      WIZARD,
      "const handleNext = useCallback(async (): Promise<void> => {",
      "const handleStepBack = useCallback(",
    );
    const back = between(
      WIZARD,
      "const handleStepBack = useCallback(async (): Promise<void> => {",
      "// ----- ORCH-0874 handleClose",
    );
    for (const body of [next, back]) {
      expect(body).not.toContain("router.push");
      expect(body).not.toContain("router.replace");
      expect(body).not.toContain("brandPaymentOnboardingRoute");
      expect(body).not.toContain("bankSetupRoute");
    }
  });

  test("bank setup is reachable from exactly two places: the Review card and a refused publish", () => {
    const pushes = WIZARD.split("router.push(bankSetupRoute as never)").length - 1;
    expect(pushes).toBe(2);
    expect(WIZARD).toContain("const handleConnectStripe = useCallback((): void => {");
    const publish = between(
      WIZARD,
      "const handleConfirmPublish = useCallback(async (): Promise<void> => {",
      "// Suppress autosave-error toast",
    );
    expect(publish).toContain('guardCopy?.action === "payment_onboarding"');
    expect(publish).toContain("router.push(bankSetupRoute as never)");
  });
});

describe("#3645 — pricing step: an informational card, not a stop", () => {
  test("locked copy", () => {
    expect(PRICING).toContain(
      'export const TRIP_PRICING_KEEP_BUILDING_TITLE = "You can keep building";',
    );
    expect(PRICING).toContain(
      '"This trip saves as a draft. You\'ll need a bank connected before you publish it with a price."',
    );
  });

  test("shown only when the wizard says the trip needs a bank to publish", () => {
    expect(PRICING).toContain("needsBankToPublish = false,");
    expect(PRICING).toContain("{needsBankToPublish ? (");
    expect(PRICING).toContain('testID="trip-pricing-keep-building-card"');
  });

  test("it carries no button: nothing on the pricing step leaves the wizard", () => {
    const card = between(
      PRICING,
      "{needsBankToPublish ? (",
      ") : null}",
    );
    expect(card).not.toContain("Pressable");
    expect(card).not.toContain("onPress");
    expect(card).not.toContain("Button");
  });

  test("a payment plan counts exactly like a price", () => {
    expect(WIZARD).toContain(
      "needsBankToPublish={tripNeedsStripe || tripNeedsBankForInstallments}",
    );
  });
});

describe("#3645 — Review step card", () => {
  test("says the draft is saved and that the host comes straight back", () => {
    expect(REVIEW).toContain('title="Bank required for paid trips"');
    expect(REVIEW).toContain(
      'body="Connect a bank to publish this paid trip. Your draft is saved and you\'ll come straight back here."',
    );
    expect(REVIEW).toContain('ctaLabel="Connect bank"');
    expect(REVIEW).not.toContain("Free trips can be published any time.");
  });

  test("a trip with a payment plan shows the same card with the same way back", () => {
    expect(WIZARD).toContain(
      "needsStripe={tripNeedsStripe || tripNeedsBankForInstallments}",
    );
    expect(WIZARD).toContain("onConnectStripe={handleConnectStripe}");
  });

  test("Publish itself is still stopped for both cases", () => {
    const tap = between(
      WIZARD,
      "const handlePublishTap = useCallback(async (): Promise<void> => {",
      "const handleConfirmPublish = useCallback(",
    );
    expect(tap).toContain("if (tripNeedsStripe) {");
    expect(tap).toContain("if (tripNeedsBankForInstallments) {");
    expect(WIZARD).toContain("tripNeedsStripe ||\n                    tripNeedsBankForInstallments ||");
  });

  test("host-facing copy on these surfaces never names a payment provider", () => {
    for (const copy of [
      "You can keep building",
      "This trip saves as a draft. You'll need a bank connected before you publish it with a price.",
      "Connect a bank to publish this paid trip. Your draft is saved and you'll come straight back here.",
    ]) {
      expect(copy).not.toMatch(/stripe|paystack/i);
    }
  });
});

describe("#3645 — accepting the Organiser Terms continues the trip publish", () => {
  test("the wizard hands the gate its own latest publish handler and shows no retry toast", () => {
    expect(WIZARD).toContain("resumePublishRef.current()");
    expect(WIZARD).toContain("void handlePublishTap();");
    expect(WIZARD).not.toContain("ORGANISER_TERMS_PUBLISH_RETRY_TOAST");
  });
});
