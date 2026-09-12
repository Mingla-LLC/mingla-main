/**
 * Issue #3258 (review follow-up) — "Check back later" was a button that
 * navigated, and it was hiding a genuinely blocking requirement.
 *
 * TWO DEFECTS, ONE TWO-LINE FIX
 *
 * 1. FALSE AFFORDANCE. Every CTA on `BrandStripeKycRemediationCard` is wired
 *    to `onResolve`, which re-opens Stripe onboarding. A button labelled
 *    "Check back later" that navigates NOW is a dead tap (Constitution
 *    rule 1) — the seller lands on a form with nothing left to fill in.
 *
 * 2. A CARD THAT DENIED ACTION WAS NEEDED. `pickKycRemediationCode` yields to
 *    a genuinely due field only when the disabled_reason's message has
 *    `ctaLabel === null`. While `listed` and `under_review` carried a CTA they
 *    kept top priority, so
 *    `{ disabled_reason: "listed", currently_due: ["external_account"] }`
 *    resolved to an INFO-severity "we'll let you know when it clears" card on
 *    an account that could not be paid out until a bank account was added.
 *    Setting the two CTAs to null makes the EXISTING yield rule handle this;
 *    no new branch was written for it, and these assertions are what proves
 *    that claim rather than asserting it.
 *
 * Everything below runs against the real exported table and the real picker.
 *
 * FAILS-ON-REVERT: restore `ctaLabel: "Check back later"` on either entry in
 * `../stripeKycRemediationMessages.ts` and both describes fail.
 */

import {
  getKycRemediationMessage,
  pickKycRemediationCode,
} from "../stripeKycRemediationMessages";

const NO_ACTION_REASONS = ["listed", "under_review"] as const;

describe("#3258 review — a reason with nothing to do carries no button", () => {
  it.each(NO_ACTION_REASONS)(
    "%s renders no CTA at all",
    (reason) => {
      const message = getKycRemediationMessage(reason);
      expect(message.ctaLabel).toBeNull();
      expect(message.ctaLabel).not.toBe("Check back later");
      // The copy itself is unchanged — only the false affordance is gone.
      expect(message.severity).toBe("info");
      expect(message.title.length).toBeGreaterThan(0);
    },
  );
});

describe("#3258 review — a genuinely due field now outranks the no-action reason", () => {
  it.each(NO_ACTION_REASONS)(
    "%s alongside a non-empty currently_due resolves to something actionable",
    (reason) => {
      const code = pickKycRemediationCode({
        disabled_reason: reason,
        currently_due: ["external_account"],
        past_due: [],
      });

      // The yield rule fires: the DUE field wins, not the reason.
      expect(code).toBe("external_account");

      const message = getKycRemediationMessage(code as string);
      // The two things the reviewer asked to be asserted.
      expect(message.severity).not.toBe("info");
      expect(message.ctaLabel).not.toBe("Check back later");
      // And positively: the card now asks for the thing that is blocking.
      expect(message.severity).toBe("blocking");
      expect(message.ctaLabel).toBe("Add bank account");
    },
  );

  it.each(NO_ACTION_REASONS)(
    "%s with past_due prefers the past_due field over currently_due",
    (reason) => {
      expect(
        pickKycRemediationCode({
          disabled_reason: reason,
          currently_due: ["external_account"],
          past_due: ["individual.verification.document"],
        }),
      ).toBe("individual.verification.document");
    },
  );

  it.each(NO_ACTION_REASONS)(
    "%s with NOTHING due keeps its own card — the yield is conditional, not a demotion",
    (reason) => {
      expect(
        pickKycRemediationCode({
          disabled_reason: reason,
          currently_due: [],
          past_due: [],
        }),
      ).toBe(reason);
    },
  );

  it("an actionable reason still outranks a due field, exactly as before", () => {
    // The yield is keyed on `ctaLabel === null`, so a reason that CAN be acted
    // on must keep top priority. This is the assertion that would catch the
    // two-line change being over-applied.
    expect(
      pickKycRemediationCode({
        disabled_reason: "requirements.past_due",
        currently_due: ["external_account"],
        past_due: [],
      }),
    ).toBe("requirements.past_due");
  });
});
