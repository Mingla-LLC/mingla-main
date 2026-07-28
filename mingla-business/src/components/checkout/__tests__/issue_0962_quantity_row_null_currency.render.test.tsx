// issue #962 [pre-bank-currency-degbp] F6 — the shared QuantityRow must NOT
// fabricate a currency symbol for a priced tier whose currency is unset.
//
// THE PATH UNDER TEST — a pre-bank brand (default_currency = NULL) had two GBP
// sources on the ticket row: the bare `fallbackCurrency="GBP"` on the
// mingla-business wrapper AND the package default `fallbackCurrency = "GBP"`.
// With both removed (wrapper prop dropped; package default → null), a priced
// tier with no established currency renders "—" (no symbol) — formatCurrency is
// NEVER called with a fabricated code. Free tiers still render "Free"; a tier
// WITH a real currency still formats normally.
//
// This MOUNTS the REAL mingla-business <QuantityRow> wrapper → the shared
// @mingla/offering-rendering row (react-test-renderer + testing-library),
// same harness as orch_1147r2_selection_allin.render.test.tsx.
//
// FAILS-ON-REVERT (true line-deletion, proven in the implementation report):
//   restore `fallbackCurrency = "GBP"` (package default) OR re-add
//   `fallbackCurrency="GBP"` on the wrapper → the null-currency priced tier
//   renders "£65.00" and the `getByText("—")` assertion FAILS. Append-only.

import React from "react";
import { render, screen } from "@testing-library/react-native";

import { QuantityRow } from "../QuantityRow";
import type { TicketStub } from "../../../store/draftEventStore";

// A priced tier (£/$ irrelevant — the point is there is NO established currency).
// currency is left undefined to model a pre-bank brand's draft ticket.
const nullCurrencyTicket = (over: Partial<TicketStub> = {}): TicketStub =>
  ({
    id: over.id ?? "tt_1",
    name: over.name ?? "General Admission",
    priceGbp: over.priceGbp ?? 65,
    priceAllInGbp: over.priceAllInGbp,
    currency: over.currency, // undefined ⇒ unset
    capacity: over.capacity ?? 100,
    isFree: over.isFree ?? false,
    isUnlimited: over.isUnlimited ?? false,
    visibility: over.visibility ?? "public",
    displayOrder: 0,
    approvalRequired: false,
    passwordProtected: false,
  }) as TicketStub;

describe("issue #962 — QuantityRow hides the symbol when currency is unset", () => {
  it("renders '—' for a priced tier with no currency (never a fabricated £)", () => {
    render(
      <QuantityRow
        ticket={nullCurrencyTicket({ priceGbp: 65 })}
        quantity={1}
        onQuantityChange={() => {}}
      />,
    );
    // The price shows the hide-symbol dash — the home.tsx `—` canon.
    expect(screen.getByText("—")).toBeTruthy();
    // No fabricated currency symbol / formatted amount appears.
    expect(screen.queryByText(/£/)).toBeNull();
    expect(screen.queryByText(/\$/)).toBeNull();
    expect(screen.queryByText("£65.00")).toBeNull();
  });

  it("still renders 'Free' for a free tier with no currency", () => {
    render(
      <QuantityRow
        ticket={nullCurrencyTicket({ priceGbp: null, isFree: true })}
        quantity={1}
        onQuantityChange={() => {}}
      />,
    );
    expect(screen.getByText("Free")).toBeTruthy();
    expect(screen.queryByText("—")).toBeNull();
  });

  it("still formats normally when the tier HAS a real currency", () => {
    render(
      <QuantityRow
        ticket={nullCurrencyTicket({ priceGbp: 65, currency: "USD" })}
        quantity={1}
        onQuantityChange={() => {}}
      />,
    );
    // A set currency is honored (the fix is de-GBP, not hide-everything).
    expect(screen.getByText("$65.00")).toBeTruthy();
    expect(screen.queryByText("—")).toBeNull();
  });
});
