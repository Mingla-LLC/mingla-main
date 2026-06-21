/**
 * ORCH-1180 [trip-cart-installment-aware] — happy-path regression
 * (implementor-owned).
 *
 * Proves the per-package "pay over time" choice the §10 box selects now reaches
 * the cart-level CartContext.paymentPlanChoice the whole checkout reads, across
 * BOTH drop points that were broken:
 *   FIX A — the public page Reserve collapses the selected lines into the cart
 *           choice (was passing `undefined` → fell back to a stale route param).
 *   FIX B — the checkout cart seed parses each line's paymentPlanChoice and lets
 *           the lines JSON override a stale scalar `plan` param.
 *
 * mingla-business Jest runs node-env / ts-jest (no RN renderer), so this proves
 * the redesign two ways that BOTH bite on revert:
 *   (1) REAL-logic: the extracted pure helpers (collapse + parse + resolve).
 *   (2) Source-characterization: the public page + checkout index actually CALL
 *       the helpers (so the wiring can't silently revert to `undefined`/drop).
 *
 * The tester writes a SEPARATE adversarial suite on a different angle.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import path from "path";

import {
  collapseTripPlanChoice,
  parseSeededTripLines,
  resolveSeededCartPlanChoice,
} from "../tripCartPlanChoice";

const read = (rel: string): string =>
  readFileSync(path.join(process.cwd(), rel), "utf8");

const slugSrc = (): string => read("app/t/[brandSlug]/[tripSlug].tsx");
const checkoutIndexSrc = (): string =>
  read("app/checkout-trip/[tripEventId]/index.tsx");

describe("ORCH-1180 FIX A — public page Reserve collapses the plan choice", () => {
  test("a selected line on a plan → the cart-level choice is 'installments'", () => {
    const lines = [
      { ticketTypeId: "vip", quantity: 1, paymentPlanChoice: "installments" as const },
    ];
    expect(collapseTripPlanChoice(lines)).toBe("installments");
  });

  test("the public page Reserve calls collapseTripPlanChoice (not undefined)", () => {
    const src = slugSrc();
    expect(src).toContain("collapseTripPlanChoice(offeringState.selectedLines)");
    // and forwards the SAME selected lines as the JSON `lines` param.
    expect(src).toContain("offeringState.selectedLines,");
  });
});

describe("ORCH-1180 FIX B — checkout cart seed reads the per-line choice", () => {
  test("parse reads an optional paymentPlanChoice per row", () => {
    const json = JSON.stringify([
      { ticketTypeId: "a", quantity: 2, paymentPlanChoice: "installments" },
    ]);
    const parsed = parseSeededTripLines(json);
    expect(parsed).toEqual([
      { ticketTypeId: "a", quantity: 2, paymentPlanChoice: "installments" },
    ]);
  });

  test("a seeded line carrying 'installments' → the cart choice is 'installments'", () => {
    const seeded = parseSeededTripLines(
      JSON.stringify([{ ticketTypeId: "a", quantity: 1, paymentPlanChoice: "installments" }]),
    );
    // even if the scalar plan param defaulted to "full", the lines JSON wins.
    expect(resolveSeededCartPlanChoice(seeded, "full")).toBe("installments");
  });

  test("the checkout index calls the parse + resolve helpers + sets the cart choice", () => {
    const src = checkoutIndexSrc();
    expect(src).toContain("parseSeededTripLines(params.lines)");
    expect(src).toContain(
      "resolveSeededCartPlanChoice(seededLinesParam, planParam)",
    );
    // the resolved choice is what seeds CartContext.paymentPlanChoice.
    expect(src).toContain("setPaymentPlanChoice(");
  });
});

describe("ORCH-1180 the cart is then AWARE — deposit branch fires on 'installments'", () => {
  // The checkout index's dueTodayCents memo (the "cart is aware" proof) is gated
  // on paymentPlanChoice === "installments". Once Fix A/B set that, the existing
  // projectInstallmentSchedule deposit branch + schedule + Pay-button deposit
  // label all fire. Characterize that gate so it can't silently drop.
  test("dueTodayCents is non-null ONLY under the installments cart choice", () => {
    const src = checkoutIndexSrc();
    expect(src).toContain('if (paymentPlanChoice !== "installments"');
    expect(src).toContain("projectInstallmentSchedule(");
    expect(src).toContain("projected.depositCents");
  });
});
