/**
 * issue #3645 — the brand-creation Payouts card tells a Nigerian-rail brand the
 * truth: it can start selling now, and its money waits for a bank.
 *
 * Live test, 2026-10-13: on a brand that had just chosen Nigeria (and could
 * already collect with no bank) the card still said "Connect a bank before
 * collecting money…", contradicting sell-before-bank.
 *
 * The decision is executed here. That the card reads it off the canonical
 * brand row and shows the approved line is enforced by the strict-grep gate
 * .github/scripts/strict-grep/issue-3645-paid-drafts-stop-at-publish.mjs, group E-h.
 */

import { describe, expect, test } from "@jest/globals";

import { brandSellsBeforeBank } from "../brandPayout";

describe("#3645 brandSellsBeforeBank", () => {
  test("Nigerian rail, hold stamped, no bank: sells before bank", () => {
    expect(
      brandSellsBeforeBank({
        paymentProvider: "paystack",
        payoutHoldCutoverAt: "2026-10-13T05:40:00Z",
        paystackSubaccountCode: null,
        hasPaystackRecipient: false,
      }),
    ).toBe(true);
  });

  test("Nigerian rail with a bank already connected: no longer 'waits for a bank'", () => {
    expect(
      brandSellsBeforeBank({
        paymentProvider: "paystack",
        payoutHoldCutoverAt: "2026-10-13T05:40:00Z",
        hasPaystackRecipient: true,
      }),
    ).toBe(false);
    expect(
      brandSellsBeforeBank({
        paymentProvider: "paystack",
        paystackSubaccountCode: "ACCT_123",
      }),
    ).toBe(false);
  });

  test("Nigerian rail that cannot collect yet: not selling", () => {
    expect(
      brandSellsBeforeBank({
        paymentProvider: "paystack",
        payoutHoldCutoverAt: null,
        paystackSubaccountCode: null,
      }),
    ).toBe(false);
    expect(
      brandSellsBeforeBank({ paymentProvider: "paystack", payoutHoldCutoverAt: "" }),
    ).toBe(false);
  });

  test("card-rail brands keep the existing copy, whatever their state", () => {
    for (const stripeStatus of ["not_connected", "onboarding", "restricted", "active"] as const) {
      expect(brandSellsBeforeBank({ paymentProvider: "stripe", stripeStatus })).toBe(false);
    }
    expect(
      brandSellsBeforeBank({ paymentProvider: "stripe", chargesEnabled: true, payoutsEnabled: false }),
    ).toBe(false);
  });

  test("no brand yet (the inline-create path before the row exists)", () => {
    expect(brandSellsBeforeBank(null)).toBe(false);
    expect(brandSellsBeforeBank(undefined)).toBe(false);
  });
});
