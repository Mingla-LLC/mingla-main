/**
 * ORCH-1335 — predicate permutations for isChipInPayoutReady (§5.a File 1).
 *
 * Pure logic, no React/JSX → runs under the DEFAULT jest.config.cjs (node/ts-jest).
 * CI-enforced fails-on-revert: weakening the predicate to always-true, dropping the
 * Paystack branch, or trusting the cache instead of the passed fresh status flips
 * these assertions.
 */
import { isChipInPayoutReady } from "../chipInPayoutReadiness";
import type { Brand, BrandStripeStatus } from "../../types/brand";

type BrandLike = Pick<Brand, "paymentProvider" | "paystackSubaccountCode">;

describe("isChipInPayoutReady — Stripe rail (default provider)", () => {
  it("returns true when fresh Stripe status is active", () => {
    expect(isChipInPayoutReady({ paymentProvider: "stripe" }, "active")).toBe(true);
  });

  it("returns true when provider is undefined (default rail is Stripe) and active", () => {
    expect(isChipInPayoutReady({ paymentProvider: undefined }, "active")).toBe(true);
  });

  it.each<BrandStripeStatus>(["onboarding", "restricted", "not_connected"])(
    "returns false when Stripe status is %s (not active)",
    (status) => {
      expect(isChipInPayoutReady({ paymentProvider: "stripe" }, status)).toBe(false);
    },
  );

  it("returns false while the status is still loading (undefined) — no false-positive", () => {
    expect(isChipInPayoutReady({ paymentProvider: "stripe" }, undefined)).toBe(false);
  });

  it("returns false when the status is null", () => {
    expect(isChipInPayoutReady({ paymentProvider: "stripe" }, null)).toBe(false);
  });
});

describe("isChipInPayoutReady — Paystack rail (NGN)", () => {
  it("returns true when the Paystack subaccount is present, regardless of Stripe status", () => {
    expect(
      isChipInPayoutReady(
        { paymentProvider: "paystack", paystackSubaccountCode: "ACCT_x" },
        "not_connected",
      ),
    ).toBe(true);
  });

  it.each<string | undefined>([undefined, "", "  "])(
    "returns false when the Paystack subaccount is blank (%p) even if Stripe status is active",
    (code) => {
      expect(
        isChipInPayoutReady(
          { paymentProvider: "paystack", paystackSubaccountCode: code },
          "active",
        ),
      ).toBe(false);
    },
  );

  it("Paystack rail never borrows Stripe readiness (blank subaccount → false)", () => {
    // Adversarial: Stripe is fully active, but this brand settles via Paystack
    // with no subaccount → the server gate (paystack_subaccount_code) would NOT
    // collect, so the banner must not claim ready.
    const brand: BrandLike = {
      paymentProvider: "paystack",
      paystackSubaccountCode: undefined,
    };
    expect(isChipInPayoutReady(brand, "active")).toBe(false);
  });
});

describe("isChipInPayoutReady — null/undefined brand", () => {
  it("returns false for a null brand", () => {
    expect(isChipInPayoutReady(null, "active")).toBe(false);
  });

  it("returns false for an undefined brand", () => {
    expect(isChipInPayoutReady(undefined, "active")).toBe(false);
  });
});
