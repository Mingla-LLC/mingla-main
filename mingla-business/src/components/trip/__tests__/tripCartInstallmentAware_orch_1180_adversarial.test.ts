/**
 * ORCH-1180 [trip-cart-installment-aware] — adversarial suite (implementor-owned,
 * different angle from the happy regression).
 *
 * Attacks the collapse + seed-resolve logic at the edges that protect the existing
 * gates:
 *   (a) ALL lines "full" → choice "full" (NOT "auto") so NO installment rows are
 *       minted — i-proposed-pay-in-full-opt-out-no-installment-rows.
 *   (b) MIXED (one line installments, one full) → the whole cart goes
 *       "installments" (the documented session-wide-choice behavior).
 *   (c) a `lines` JSON that carries paymentPlanChoice but a STALE scalar plan=full
 *       → Fix B still sets the cart to "installments" (lines JSON is the source of
 *       truth — this is the literal ORCH-1180 root cause).
 * Plus malformed-input hardening so a bad param can never force a plan / crash.
 *
 * Synthetic fixtures only (0/8 live brands set plans).
 */

import { describe, expect, test } from "@jest/globals";

import {
  collapseTripPlanChoice,
  parseSeededTripLines,
  resolveSeededCartPlanChoice,
  type SeededTripLine,
} from "../tripCartPlanChoice";

describe("ORCH-1180 adversarial (a) — pay-in-full opt-out: no plan rows", () => {
  test("ALL lines 'full' → collapse yields exactly 'full', never 'auto'", () => {
    const lines = [
      { ticketTypeId: "a", quantity: 1, paymentPlanChoice: "full" as const },
      { ticketTypeId: "b", quantity: 2, paymentPlanChoice: "full" as const },
    ];
    const choice = collapseTripPlanChoice(lines);
    expect(choice).toBe("full");
    expect(choice).not.toBe("auto");
  });

  test("lines with NO plan field (plain full-price) → 'full'", () => {
    const lines: SeededTripLine[] = [
      { ticketTypeId: "a", quantity: 1 },
      { ticketTypeId: "b", quantity: 1 },
    ];
    expect(collapseTripPlanChoice(lines)).toBe("full");
  });

  test("empty selection → 'full' (never 'auto', never a plan)", () => {
    expect(collapseTripPlanChoice([])).toBe("full");
  });

  test("seed resolve with no installments line honors a 'full' scalar param", () => {
    const seeded = parseSeededTripLines(
      JSON.stringify([{ ticketTypeId: "a", quantity: 1, paymentPlanChoice: "full" }]),
    );
    expect(resolveSeededCartPlanChoice(seeded, "full")).toBe("full");
  });
});

describe("ORCH-1180 adversarial (b) — mixed selection → whole cart goes plan", () => {
  test("one line installments + one line full → collapse yields 'installments'", () => {
    const lines = [
      { ticketTypeId: "a", quantity: 1, paymentPlanChoice: "full" as const },
      { ticketTypeId: "b", quantity: 1, paymentPlanChoice: "installments" as const },
    ];
    expect(collapseTripPlanChoice(lines)).toBe("installments");
  });

  test("seed resolve: a mixed lines JSON → cart-level 'installments'", () => {
    const seeded = parseSeededTripLines(
      JSON.stringify([
        { ticketTypeId: "a", quantity: 1, paymentPlanChoice: "full" },
        { ticketTypeId: "b", quantity: 1, paymentPlanChoice: "installments" },
      ]),
    );
    expect(resolveSeededCartPlanChoice(seeded, "full")).toBe("installments");
  });
});

describe("ORCH-1180 adversarial (c) — lines JSON overrides a STALE scalar param", () => {
  test("plan=full scalar BUT a line is installments → cart is 'installments'", () => {
    // The literal ORCH-1180 root cause: the box toggle never updated the scalar
    // route plan, so plan=full arrived stale. The lines JSON must win.
    const seeded = parseSeededTripLines(
      JSON.stringify([
        { ticketTypeId: "vip", quantity: 1, paymentPlanChoice: "installments" },
      ]),
    );
    expect(resolveSeededCartPlanChoice(seeded, "full")).toBe("installments");
  });

  test("no lines carry a choice → the scalar param is honored unchanged", () => {
    const seeded = parseSeededTripLines(
      JSON.stringify([{ ticketTypeId: "a", quantity: 1 }]),
    );
    // a route that DID set plan=installments (e.g. single-tier split CTA) still works.
    expect(resolveSeededCartPlanChoice(seeded, "installments")).toBe("installments");
    expect(resolveSeededCartPlanChoice(seeded, "full")).toBe("full");
  });
});

describe("ORCH-1180 parse hardening — malformed input can't force a plan / crash", () => {
  test("undefined / empty string → []", () => {
    expect(parseSeededTripLines(undefined)).toEqual([]);
    expect(parseSeededTripLines("")).toEqual([]);
  });

  test("non-JSON → [] (no throw)", () => {
    expect(parseSeededTripLines("{not json")).toEqual([]);
  });

  test("non-array JSON → []", () => {
    expect(parseSeededTripLines(JSON.stringify({ ticketTypeId: "a", quantity: 1 }))).toEqual(
      [],
    );
  });

  test("rows with bad/zero quantity or missing id are dropped", () => {
    const parsed = parseSeededTripLines(
      JSON.stringify([
        { ticketTypeId: "a", quantity: 0 },
        { ticketTypeId: "b", quantity: -3, paymentPlanChoice: "installments" },
        { quantity: 1, paymentPlanChoice: "installments" },
        { ticketTypeId: "ok", quantity: 2 },
      ]),
    );
    expect(parsed).toEqual([{ ticketTypeId: "ok", quantity: 2 }]);
  });

  test("an UNKNOWN paymentPlanChoice value is dropped (line stays plain full)", () => {
    const parsed = parseSeededTripLines(
      JSON.stringify([
        { ticketTypeId: "a", quantity: 1, paymentPlanChoice: "auto" },
        { ticketTypeId: "b", quantity: 1, paymentPlanChoice: 42 },
      ]),
    );
    expect(parsed).toEqual([
      { ticketTypeId: "a", quantity: 1 },
      { ticketTypeId: "b", quantity: 1 },
    ]);
    // a garbage choice must NOT collapse the cart into a plan.
    expect(resolveSeededCartPlanChoice(parsed, "full")).toBe("full");
  });

  test("quantity is floored (no fractional seeded qty)", () => {
    const parsed = parseSeededTripLines(
      JSON.stringify([{ ticketTypeId: "a", quantity: 2.9, paymentPlanChoice: "installments" }]),
    );
    expect(parsed).toEqual([
      { ticketTypeId: "a", quantity: 2, paymentPlanChoice: "installments" },
    ]);
  });
});
