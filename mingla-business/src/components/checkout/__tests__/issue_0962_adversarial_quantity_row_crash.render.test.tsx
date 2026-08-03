// issue #962 [pre-bank-currency-degbp] — TESTER ADVERSARIAL render-proof
// (different angle from the implementor's F6 render test). F6 asserted the
// rendered TEXT ("—" / "Free" / "$65.00"). This suite attacks CRASH-SAFETY: a
// PAID tier with NO established currency must mount WITHOUT throwing the
// `RangeError: Currency code is invalid` of the ORCH-1152 class — i.e. the fix
// must reach the "—" branch and NEVER hand a fabricated/blank code to
// Intl.NumberFormat via formatCurrency. react-test-renderer throws synchronously
// from render() on a commit-time throw, so a mount that does NOT throw IS the
// no-crash proof.
//
// It mounts the REAL mingla-business <QuantityRow> WRAPPER → the shared
// @mingla/offering-rendering row (the wrapper is the path that used to inject
// `fallbackCurrency="GBP"`), and uses NGN (₦) for the has-currency case — a
// DIFFERENT code than F6's USD, also exercising the #1180 en-NG symbol path.
//
// FAILS-ON-REVERT: restore the package default `fallbackCurrency = "GBP"` OR
// re-add `fallbackCurrency="GBP"` on the wrapper → the null-currency priced tier
// renders "£65.00" and the getByText("—") / no-£ assertions FAIL. Append-only.

import React from "react";
import { render, screen } from "@testing-library/react-native";

import { QuantityRow } from "../QuantityRow";
import type { TicketStub } from "../../../store/draftEventStore";

const pricedTier = (over: Partial<TicketStub> = {}): TicketStub =>
  ({
    id: over.id ?? "tt_adv",
    name: over.name ?? "General Admission",
    priceGbp: over.priceGbp ?? 65,
    priceAllInGbp: over.priceAllInGbp,
    currency: over.currency, // undefined ⇒ unset (pre-bank brand)
    capacity: over.capacity ?? 100,
    isFree: over.isFree ?? false,
    isUnlimited: over.isUnlimited ?? false,
    visibility: over.visibility ?? "public",
    displayOrder: 0,
    approvalRequired: false,
    passwordProtected: false,
  }) as TicketStub;

describe("issue #962 adversarial — QuantityRow crash-safety on an unset currency", () => {
  it("MOUNTS a null-currency PAID tier WITHOUT throwing a RangeError (crash-guard)", () => {
    // The commit-time-throw proof: if the null currency reached
    // Intl.NumberFormat with an invalid code, react-test-renderer would throw
    // synchronously here. It must not.
    expect(() =>
      render(
        <QuantityRow
          ticket={pricedTier({ priceGbp: 65 })}
          quantity={1}
          onQuantityChange={() => {}}
        />,
      ),
    ).not.toThrow();

    // And the rendered price is the hide-symbol dash, never a fabricated £.
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.queryByText(/£/)).toBeNull();
    expect(screen.queryByText("£65.00")).toBeNull();
  });

  it("still HONORS a real currency (NGN → ₦), proving the fix is de-GBP not hide-all", () => {
    render(
      <QuantityRow
        ticket={pricedTier({ priceGbp: 65, currency: "NGN" })}
        quantity={1}
        onQuantityChange={() => {}}
      />,
    );
    expect(screen.getByText("₦65.00")).toBeTruthy();
    expect(screen.queryByText("—")).toBeNull();
    expect(screen.queryByText(/£/)).toBeNull();
  });

  it("still renders 'Free' for a free tier with no currency (no formatter reached)", () => {
    render(
      <QuantityRow
        ticket={pricedTier({ priceGbp: null, isFree: true })}
        quantity={1}
        onQuantityChange={() => {}}
      />,
    );
    expect(screen.getByText("Free")).toBeTruthy();
    expect(screen.queryByText("—")).toBeNull();
    expect(screen.queryByText(/£/)).toBeNull();
  });
});
