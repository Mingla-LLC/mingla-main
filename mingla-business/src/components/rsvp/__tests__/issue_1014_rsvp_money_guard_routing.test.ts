/**
 * issue #1014 [free-only publish / money fails close] — implementor happy-path
 * regression, RSVP leg (SPEC §7 T-13 RSVP + T-14 chip-in dead-toast fix).
 *
 * Pre-#1014, RsvpCreatorWizard's publish catch DELIBERATELY skipped guard
 * copies whose action is "stripe_onboarding" ("RSVP only ever raises
 * offering_date_past" — false since ORCH-1291's chip-in bank gate), so BOTH
 * the chip-in `stripe_charges_disabled` AND the new `event_currency_required`
 * dead-ended in the generic "Could not save this publish." toast.
 *
 * New contract (SPEC §4.5.2): stripe_onboarding-action copies show the locked
 * body AND route to the provider-neutral payments onboarding
 * (onOpenStripeOnboard — wired by both RSVP routes); other guard copies keep
 * the When-step jump.
 *
 * Source-grep pattern (publishErrorMapper.adversarial.test.ts precedent — the
 * wizard imports react-native and cannot be imported under node-env jest).
 *
 * fails-on-revert: restoring the old skip (or deleting the routing branch)
 * turns these assertions red.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "@jest/globals";

const SOURCE = readFileSync(
  join(__dirname, "..", "RsvpCreatorWizard.tsx"),
  "utf8",
);

describe("issue #1014 — RSVP publish catch routes money-setup guards", () => {
  test("stripe_onboarding-action copies toast the locked body AND route to payments onboarding", () => {
    const branchIdx = SOURCE.indexOf(
      'guardCopy !== null && guardCopy.action === "stripe_onboarding"',
    );
    expect(branchIdx).toBeGreaterThan(-1);
    const branch = SOURCE.slice(branchIdx, branchIdx + 300);
    expect(branch).toContain("handleShowToast(guardCopy.body)");
    expect(branch).toContain("onOpenStripeOnboard?.()");
  });

  test("the pre-#1014 dead-toast skip of stripe_onboarding copies is gone", () => {
    expect(SOURCE).not.toContain(
      'guardCopy.action !== "stripe_onboarding"',
    );
  });

  test("the stale 'RSVP only ever raises offering_date_past' comment is deleted", () => {
    expect(SOURCE).not.toContain("RSVP only ever raises offering_date_past");
  });

  test("non-money guard copies keep the When-step jump", () => {
    const idx = SOURCE.indexOf('guardCopy !== null && guardCopy.action === "stripe_onboarding"');
    const after = SOURCE.slice(idx, idx + 900);
    expect(after).toContain("setShowStepErrors(true)");
    expect(after).toContain("setCurrentStep(1)");
  });

  test("the publish callback depends on onOpenStripeOnboard (no stale closure)", () => {
    // The dependency array of handleConfirmPublish must include the route
    // callback now that the catch invokes it.
    const catchIdx = SOURCE.indexOf(
      'guardCopy !== null && guardCopy.action === "stripe_onboarding"',
    );
    const depsRegion = SOURCE.slice(catchIdx, catchIdx + 2200);
    expect(depsRegion).toContain("onOpenStripeOnboard,");
  });
});
