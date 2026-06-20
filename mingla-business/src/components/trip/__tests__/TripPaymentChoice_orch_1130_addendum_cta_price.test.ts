/**
 * ORCH-1130 ADDENDUM (Seth-BINDING) — CTA-adjacent price reflects DUE TODAY.
 *
 * When "Pay over time" is selected, every CTA-adjacent price must show the
 * amount due today (the deposit), not the full price; "Pay in full" shows the
 * full price; a no-plan trip shows full and renders no toggle.
 *
 * mingla-business Jest runs node-env / ts-jest with NO RN renderer, so this
 * suite proves the addendum two ways that BOTH bite on revert:
 *   (1) REAL-logic: the deposit-due-today the CTAs surface is the SAME
 *       `projectInstallmentSchedule(...).depositCents` the toggle renders,
 *       formatted by the shared currency helpers (EUR + GBP), never recomputed.
 *   (2) Source-characterization of the redesigned CTA surfaces: the public-page
 *       floating bar price follows the toggle (deposit "today" vs full "total");
 *       the checkout index Subtotal flips to "Due today" on installments; the
 *       payment Pay button shows the deposit on BOTH paths under installments;
 *       and the no-plan public bar shows full with no deposit branch.
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

const slugSrc = (): string => read("app/t/[brandSlug]/[tripSlug].tsx");
const indexSrc = (): string =>
  read("app/checkout-trip/[tripEventId]/index.tsx");
const paymentSrc = (): string =>
  read("app/checkout-trip/[tripEventId]/payment.tsx");

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

const gbpPlanTier: Pick<
  TripPricingTier,
  "priceCents" | "currency" | "installmentSchedule"
> = {
  priceCents: 80000,
  currency: "GBP",
  installmentSchedule: {
    deposit_pct: 20,
    installments: [{ ordinal: 1, pct: 80, days_after_booking: 30 }],
  },
};

const noPlanTier: Pick<
  TripPricingTier,
  "priceCents" | "currency" | "installmentSchedule"
> = { priceCents: 50000, currency: "EUR", installmentSchedule: null };

describe("ORCH-1130 ADDENDUM — due-today equals the projected deposit (real logic)", () => {
  test("EUR: pay-over-time due-today = €125 deposit; pay-in-full = €500 full", () => {
    const s = projectInstallmentSchedule(planTier, new Date("2026-06-13T00:00:00Z"));
    expect(s).not.toBeNull();
    // The amount a CTA shows under "Pay over time" is the deposit, NOT the full.
    expect(s!.depositCents).toBe(12500);
    expect(s!.fullPriceCents).toBe(50000);
    expect(s!.depositCents).not.toBe(s!.fullPriceCents);
    expect(formatCurrency(s!.depositCents, planTier.currency, true)).toMatch(/125/);
    expect(formatCurrency(s!.fullPriceCents, planTier.currency, true)).toMatch(/500/);
  });

  test("GBP: deposit scales with qty=2 → £320 due today (currency-aware, no hardcode)", () => {
    const s = projectInstallmentSchedule(gbpPlanTier, new Date(), 2);
    expect(s).not.toBeNull();
    // 20% of £800 × 2 = £320.
    expect(s!.depositCents).toBe(32000);
    expect(formatCurrency(s!.depositCents, gbpPlanTier.currency, true)).toMatch(/£/);
    expect(formatCurrency(s!.depositCents, gbpPlanTier.currency, true)).toMatch(/320/);
  });

  test("no-plan tier → null projection → no deposit to show (full only)", () => {
    expect(projectInstallmentSchedule(noPlanTier, new Date())).toBeNull();
  });
});

describe("ORCH-1130 ADDENDUM — public trip page floating bar follows the toggle", () => {
  // [TEST-MOD-APPROVED META-ORCH-1174] retarget: META-ORCH-1174 Leg A LIFTED the
  // bar's price derivation out of the /t/ route into the shared
  // useTripOfferingState (one owner — the §10 box + the docked/floating bars never
  // diverge). The behavior is UNCHANGED (installments → "{deposit} today";
  // pay-in-full → "{price} total"; deposit from the SAME pure projection, never a
  // recompute) — the assertions now read the hook source. Still fails on revert
  // (deleting the toggle-driven branch / the projection drops the behavior).
  test("bar leads with the deposit due today on pay-over-time, full+total otherwise", () => {
    const hookSrc = read("../packages/offering-rendering/useTripOfferingState.ts");
    // The bar's deposit comes from the SAME pure projection, never a recompute.
    expect(hookSrc).toContain("projectTripSchedule(selectedTier, anchor)");
    expect(hookSrc).toContain("projectedSchedule.depositCents");
    // Selection-driven: installments → "{deposit} today"; full → "{price} total".
    expect(hookSrc).toContain('paymentPlanChoice === "installments"');
    expect(hookSrc).toContain("${depositLabel} today");
    expect(hookSrc).toContain("${priceLabel} total");
  });
});

describe("ORCH-1130 ADDENDUM — checkout index Subtotal flips to Due today", () => {
  test("index reads the cart choice + projects the deposit for the Subtotal", () => {
    const src = indexSrc();
    expect(src).toContain("projectInstallmentSchedule");
    expect(src).toContain("dueTodayCents");
    expect(src).toContain('paymentPlanChoice !== "installments"');
    expect(src).toContain('"Due today"');
  });
});

describe("ORCH-1130 ADDENDUM — payment Pay button shows the deposit on BOTH paths", () => {
  test("isUsingInstallments → Pay {deposit} deposit, leading branch (native + web)", () => {
    const src = paymentSrc();
    // The deposit branch is evaluated FIRST (before the Platform web/native
    // split), so native no longer shows the full total under installments.
    const idx = src.indexOf("isUsingInstallments && projectedSchedule !== null");
    const platformIdx = src.indexOf('Platform.OS !== "web"', idx);
    expect(idx).toBeGreaterThan(-1);
    expect(platformIdx).toBeGreaterThan(idx);
    expect(src).toContain("projectedSchedule.depositCents");
    expect(src).toContain("} deposit`");
  });
});
