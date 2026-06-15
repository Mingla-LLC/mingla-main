/**
 * ORCH-1130 [public trip page payment-structure + installments UX redesign] —
 * happy-path regression (implementor-owned).
 *
 * Repo harness note: mingla-business Jest runs node-env / ts-jest with NO RN
 * renderer (no react-test-renderer / RTL). So this suite proves the redesign
 * two ways that BOTH bite on revert:
 *   (1) REAL-logic: the currency amounts the segmented toggle renders flow
 *       through the shared `formatCurrency` (EUR + GBP, never hardcoded), and
 *       the projection math (deposit/installment cents) that feeds the toggle.
 *   (2) Source-characterization of the redesigned surfaces: the segmented
 *       toggle exists with radiogroup a11y + both options; the schedule is
 *       selector-gated (under "Pay over time"); null-on-null parity; the public
 *       page no longer repeats the hero; and the consumer/native paths thread
 *       an explicit payment_plan_choice (DISC-1130-A consent fix).
 *
 * The tester writes a SEPARATE adversarial suite on a different angle.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import path from "path";

import { formatCurrency } from "../../../utils/currency";
import { projectInstallmentSchedule } from "../../../utils/installmentScheduleProjection";
import type { TripPricingTier } from "../../../services/tripsService";

const read = (rel: string): string =>
  readFileSync(path.join(process.cwd(), rel), "utf8");

const choiceSrc = (): string => read("src/components/trip/TripPaymentChoice.tsx");
const flowSrc = (): string => read("src/components/trip/TripCheckoutFlow.tsx");
const cartSrc = (): string =>
  read("src/components/checkout/CartContext.tsx");
const paymentSrc = (): string =>
  read("app/checkout-trip/[tripEventId]/payment.tsx");
const slugSrc = (): string => read("app/t/[brandSlug]/[tripSlug].tsx");

// The live test trip: €500, 25% deposit + 50%@+30d + 25%@+60d (INVESTIGATE F-3).
const planTier: Pick<
  TripPricingTier,
  "priceCents" | "currency" | "installmentSchedule"
> = {
  priceCents: 50000,
  currency: "EUR",
  installmentSchedule: {
    deposit_pct: 25,
    installments: [
      { ordinal: 1, pct: 50, days_after_booking: 30 },
      { ordinal: 2, pct: 25, days_after_booking: 60 },
    ],
  },
};

const noPlanTier: Pick<
  TripPricingTier,
  "priceCents" | "currency" | "installmentSchedule"
> = { priceCents: 50000, currency: "EUR", installmentSchedule: null };

describe("ORCH-1130 — currency-aware amounts feed the toggle (real logic)", () => {
  test("projection gives the €500 / €125 deposit / €250 + €125 ladder", () => {
    const s = projectInstallmentSchedule(planTier, new Date("2026-06-12T00:00:00Z"));
    expect(s).not.toBeNull();
    expect(s!.fullPriceCents).toBe(50000);
    expect(s!.depositCents).toBe(12500); // 25% of €500
    expect(s!.installments.map((i) => i.amountCents)).toEqual([25000, 12500]);
  });

  test("no-plan tier projects null → toggle is suppressed (null-on-null)", () => {
    expect(projectInstallmentSchedule(noPlanTier, new Date())).toBeNull();
  });

  test("formatCurrency renders EUR and GBP without hardcoding a glyph", () => {
    expect(formatCurrency(50000, "EUR", true)).toMatch(/500/);
    expect(formatCurrency(50000, "EUR", true)).toMatch(/€/);
    expect(formatCurrency(2000000, "GBP", true)).toMatch(/£/);
  });
});

describe("ORCH-1130 — TripPaymentChoice is the segmented toggle (FORK 1)", () => {
  test("null-on-null: returns null when schedule is null", () => {
    expect(choiceSrc()).toMatch(/if\s*\(\s*schedule\s*===\s*null\s*\)\s*return null/);
  });

  test("two segments: Pay in full + Pay over time, radiogroup a11y", () => {
    const src = choiceSrc();
    expect(src).toContain('accessibilityRole="radiogroup"');
    // exactly two radio segments (count JSX-attribute usages on indented lines,
    // not the JSDoc reference at top-of-file).
    const radioAttrs = (
      src.match(/^\s+accessibilityRole="radio"/gm) ?? []
    ).length;
    expect(radioAttrs).toBe(2);
    expect(src).toContain("Pay in full");
    expect(src).toContain("Pay over time");
  });

  test("selected state is 3 channels (border + fill + dot), never color-alone", () => {
    const src = choiceSrc();
    expect(src).toContain("segmentSelected");
    expect(src).toContain("dotSelected");
    expect(src).toContain("dotInner");
  });

  test("the InstallmentScheduleDisplay ladder is gated under the over-time option", () => {
    const src = choiceSrc();
    expect(src).toContain("InstallmentScheduleDisplay");
    // the schedule render is inside the `isInstallments` branch, behind the flag.
    expect(src).toContain("showScheduleWhenInstallments");
  });
});

describe("ORCH-1130 — TripCheckoutFlow public page rebuild", () => {
  test("hero dupe is GONE: no `by {brand` byline and no tripTitle heading", () => {
    const src = flowSrc();
    expect(src).not.toContain("by {brand.name}");
    expect(src).not.toContain("brandByline");
    expect(src).not.toContain("tripTitle");
  });

  test("no-plan trip renders the quiet recap; plan trip renders the toggle", () => {
    const src = flowSrc();
    expect(src).toContain("recapHelper");
    expect(src).toContain("<TripPaymentChoice");
  });

  test("public page threads the choice into checkout as a route param", () => {
    const src = slugSrc();
    // [TEST-MOD-APPROVED ORCH-1138] assertion-drift refresh: ORCH-1138 rebuilt
    // the /t/ route so the split-CTA path passes the tapped `choice` (falling
    // back to the toggle's `paymentPlanChoice`). Behavior is unchanged — the
    // buyer's explicit pay-full/pay-over-time choice is still threaded as the
    // `plan` route param; only the source expression evolved. Still fails on
    // revert (deleting the param drops the choice → no `params: { plan:`).
    expect(src).toContain("params: { plan: choice ?? paymentPlanChoice }");
    // plan trips disambiguate the bar price with the word "total".
    expect(src).toContain("total");
  });
});

describe("ORCH-1130 — funnel collapse + CartContext relocation", () => {
  test("CartContext carries the choice, default full", () => {
    const src = cartSrc();
    expect(src).toContain("paymentPlanChoice: TripPaymentPlanChoice");
    expect(src).toContain('paymentPlanChoice: "full"');
    expect(src).toContain("SET_PAYMENT_PLAN_CHOICE");
  });

  test("Review & pay step is 2 OF 2 and reuses the shared selector pre-filled from cart", () => {
    const src = paymentSrc();
    expect(src).toContain("totalSteps={2}");
    expect(src).toContain("<TripPaymentChoice");
    expect(src).toContain("value={paymentPlanChoice}");
    // qty stepper present on the order-summary card.
    expect(src).toContain("Increase");
    expect(src).toContain("Decrease");
  });
});
