/**
 * issue #1014 — TESTER ADVERSARIAL suite: guard-copy detector + locked copy.
 *
 * Attacks angles the implementor's happy-path append (paidPublishGuards.test.ts)
 * does not: decorated/wrapped server messages, token-precedence when multiple
 * guard tokens appear in one message, the case-sensitivity contract, hostile
 * non-token inputs, byte-pinned LOCKED copy for ALL THREE reasons, and the
 * provider-neutral payments route the wizards feed to onOpenStripeOnboard.
 *
 * fails-on-revert: deleting the `event_currency_required` detector branch (or
 * the locked copy entry) in src/utils/paidPublishGuards.ts turns the
 * decorated-message + copy-pin tests red (verified by true line deletion).
 *
 * CI: picked up by .github/workflows/issue-1014-free-publish-currency-tests.yml
 * (`npx jest issue_1014 paidPublishGuards` — the issue_1014 pattern).
 */

import {
  detectPaidPublishGuardReason,
  resolvePaidPublishGuardCopy,
  paidPublishGuardCopy,
  brandStripeOnboardingRoute,
} from "../paidPublishGuards";

describe("issue #1014 — detector vs decorated server messages", () => {
  it("matches the bare trigger/RPC token", () => {
    expect(detectPaidPublishGuardReason("event_currency_required")).toBe(
      "event_currency_required",
    );
  });

  it("matches PostgREST/psql-decorated raises (substring contract)", () => {
    // The publish path surfaces the RAISE through several wrappers; the
    // detector must find the token inside any of them.
    expect(
      detectPaidPublishGuardReason("P0001: event_currency_required"),
    ).toBe("event_currency_required");
    expect(
      detectPaidPublishGuardReason(
        'FunctionsHttpError: {"message":"event_currency_required"}',
      ),
    ).toBe("event_currency_required");
    expect(
      detectPaidPublishGuardReason(
        "error: event_currency_required (SQLSTATE P0001) at business_publish_event_draft",
      ),
    ).toBe("event_currency_required");
  });

  it("token precedence is declaration order — stripe gate wins a multi-token message", () => {
    // Both tokens in one string (paranoid wrapper case): the resolver returns
    // the FIRST declared reason. Both map to the same payments-onboard action,
    // so precedence is cosmetic — this pin forces a conscious decision if the
    // order ever changes.
    expect(
      detectPaidPublishGuardReason(
        "stripe_charges_disabled after event_currency_required",
      ),
    ).toBe("stripe_charges_disabled");
    expect(
      detectPaidPublishGuardReason(
        "event_currency_required then stripe_charges_disabled",
      ),
    ).toBe("stripe_charges_disabled");
  });

  it("case-sensitivity contract: server tokens are lowercase; uppercase does NOT match", () => {
    // Postgres RAISE tokens are lowercase by construction. The detector is
    // deliberately case-sensitive — pin it so nobody silently widens matching
    // (which would start catching prose like 'Event Currency Required' in
    // human-written error copy).
    expect(detectPaidPublishGuardReason("EVENT_CURRENCY_REQUIRED")).toBeNull();
    expect(detectPaidPublishGuardReason("Event_Currency_Required")).toBeNull();
  });

  it("hostile non-token inputs resolve to null (generic fallback path)", () => {
    expect(detectPaidPublishGuardReason("event currency required")).toBeNull();
    expect(detectPaidPublishGuardReason("currency_required")).toBeNull();
    expect(detectPaidPublishGuardReason("")).toBeNull();
    expect(detectPaidPublishGuardReason("   ")).toBeNull();
    expect(detectPaidPublishGuardReason(null)).toBeNull();
    expect(detectPaidPublishGuardReason(undefined)).toBeNull();
    expect(
      detectPaidPublishGuardReason("Could not save this publish. Try again."),
    ).toBeNull();
  });
});

describe("issue #1014 — LOCKED copy byte-pins (all three reasons)", () => {
  it("event_currency_required carries the exact locked copy + payments action", () => {
    expect(paidPublishGuardCopy("event_currency_required")).toEqual({
      reason: "event_currency_required",
      title: "Finish your payment setup",
      body: "Paid listings need a payout currency, and that comes from your payment setup. Free listings publish any time.",
      actionLabel: "Set up payments",
      action: "stripe_onboarding",
    });
  });

  it("the two pre-#1014 entries are byte-untouched", () => {
    expect(paidPublishGuardCopy("stripe_charges_disabled").action).toBe(
      "stripe_onboarding",
    );
    expect(paidPublishGuardCopy("stripe_charges_disabled").title).toBe(
      "Finish your payment setup",
    );
    expect(paidPublishGuardCopy("offering_date_past").action).toBe("edit_date");
  });

  it("resolvePaidPublishGuardCopy wires a decorated raise to the locked copy", () => {
    const copy = resolvePaidPublishGuardCopy(
      "P0001: event_currency_required",
    );
    expect(copy).not.toBeNull();
    expect(copy?.action).toBe("stripe_onboarding");
    expect(copy?.body).toContain("Free listings publish any time.");
  });

  it("the payments-onboard route is provider-neutral and brand-scoped", () => {
    expect(brandStripeOnboardingRoute("3c0f39f5-99f4-4f6c-a692-a10c78f9bd98")).toBe(
      "/brand/3c0f39f5-99f4-4f6c-a692-a10c78f9bd98/payments/onboard",
    );
  });
});
