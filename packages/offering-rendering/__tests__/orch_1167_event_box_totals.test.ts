// ORCH-1167 [event-page-canonical] — implementor-owned happy-path regression.
//
// The inline ticket box's running total MUST be the SERVER all-in (priceAllInGbp),
// never the bare base (priceGbp) — WYSIWYP (ORCH-1147 / I-PROPOSED-1167-ALLIN-PRICE-
// IN-TICKET-BOX). This is a BEHAVIORAL test: it imports the pure totals module
// (RN-free) and asserts Σ(all-in × qty) to the cent — SC-3 (T-04).
//
// FAILS-ON-REVERT (proven by TRUE LINE DELETION in the implementation report):
//   In packages/offering-rendering/eventBoxTotals.ts, delete the all-in coalesce
//   line `const price = ticket.priceAllInGbp ?? ticket.priceGbp;` and substitute
//   the bare base `ticket.priceGbp` → the "uses all-in, not bare base" assertion
//   below FAILS (it would compute 80 from base 30+20 ×qty instead of 130 from
//   all-in 50+30 ×qty). Restore → PASS.

import {
  computeRunningTotal,
  totalSelectedQuantity,
  ticketUnitAllIn,
  type TicketLike,
} from "../eventBoxTotals";

const paidTier = (
  id: string,
  base: number,
  allIn: number | null,
): TicketLike => ({ id, isFree: false, priceGbp: base, priceAllInGbp: allIn });

describe("ORCH-1167 inline ticket-box running total (WYSIWYP all-in)", () => {
  it("T-04: total = Σ(priceAllInGbp × qty), NOT the bare base", () => {
    // Two tiers: VIP base 40 / all-in 50, GA base 25 / all-in 30.
    const tickets: TicketLike[] = [
      paidTier("vip", 40, 50),
      paidTier("ga", 25, 30),
    ];
    // qty: 2 VIP + 1 GA.
    const quantities = { vip: 2, ga: 1 };
    // All-in: 50×2 + 30×1 = 130. Base would be 40×2 + 25×1 = 105 (WRONG).
    expect(computeRunningTotal(tickets, quantities)).toBe(130);
    expect(computeRunningTotal(tickets, quantities)).not.toBe(105);
  });

  it("falls back to base ONLY when a tier has no all-in (free / RPC miss)", () => {
    // GA has no all-in → contributes its base (25). VIP all-in 50.
    const tickets: TicketLike[] = [
      paidTier("vip", 40, 50),
      paidTier("ga", 25, null),
    ];
    expect(computeRunningTotal(tickets, { vip: 1, ga: 1 })).toBe(75); // 50 + 25
    // It NEVER fabricates a markup on the no-all-in tier (uses base, not >base).
    expect(ticketUnitAllIn(tickets[1]!)).toBe(25);
  });

  it("free tiers contribute 0 and an empty selection totals 0", () => {
    const free: TicketLike = {
      id: "free",
      isFree: true,
      priceGbp: null,
      priceAllInGbp: null,
    };
    expect(ticketUnitAllIn(free)).toBe(0);
    expect(computeRunningTotal([free], { free: 3 })).toBe(0);
    expect(computeRunningTotal([paidTier("vip", 40, 50)], {})).toBe(0);
  });

  it("totalSelectedQuantity sums all selected tiers", () => {
    expect(totalSelectedQuantity({})).toBe(0);
    expect(totalSelectedQuantity({ vip: 2, ga: 1, x: 0 })).toBe(3);
  });
});
