/**
 * ORCH-0946 — buyer-web sold-out gate regression tests.
 *
 * Bug: `tierToTicketStub` and `ticketRowToTicketStub` previously set
 * `capacity` to total tier capacity (`quantityTotal` / `quantity_total`)
 * which never decreases. The sold-out gate at
 * `mingla-business/app/checkout-trip/[tripEventId]/index.tsx:237-239` and
 * the event-side mirror at `app/checkout/[eventId]/index.tsx:173-176` then
 * never triggered, so the buyer could tap "+" all the way to the payment
 * screen on a sold-out tier and only failed at the final 409
 * `ticket_capacity_exceeded`.
 *
 * Fix: anon-callable `pg_public_ticket_types_remaining(event_id)` RPC
 * threads remaining-bookable-count through to the mappers, which now
 * prefer remaining over total when sold-out gating.
 *
 * Two regression tests covering ORCH-0840 Step 0.5 gate (a) happy-path +
 * (b) adversarial. fails-on-revert verified manually by reverting
 * `tier.ticketsRemaining ?? tier.quantityTotal` back to `tier.quantityTotal`
 * in `app/checkout-trip/[tripEventId]/index.tsx` and re-running this file.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { TripPricingTier } from "../tripsService";

// Re-derive the trip-side mapper here (same logic as
// `app/checkout-trip/[tripEventId]/index.tsx:65`) so the test is fully
// hermetic and doesn't depend on RN module resolution.
const tierToCapacityForGate = (tier: TripPricingTier): number | null =>
  tier.isUnlimited ? null : (tier.ticketsRemaining ?? tier.quantityTotal);

const tier = (patch: Partial<TripPricingTier> = {}): TripPricingTier => ({
  id: "tier-1",
  eventId: "event-1",
  ticketTypeId: "tt-1",
  tierName: "Standard",
  tierMetadata: {},
  priceCents: 5000,
  currency: "USD",
  quantityTotal: 55,
  ticketsRemaining: null,
  isUnlimited: false,
  installmentSchedule: null,
  ...patch,
});

// =====================================================================
// (a) HAPPY-PATH REGRESSION — sold-out tier surfaces capacity=0 to the
// gate at index.tsx:237-239 (which then renders the "Sold out" EmptyState).
// =====================================================================
describe("ORCH-0946 sold-out gate (happy path)", () => {
  test("sold-out tier (remaining=0, total=55) maps to capacity=0", () => {
    const t = tier({ quantityTotal: 55, ticketsRemaining: 0 });
    expect(tierToCapacityForGate(t)).toBe(0);
  });

  test("aggregate sold-out detection fires when every non-unlimited tier has remaining=0", () => {
    const tiers = [
      tier({ id: "a", quantityTotal: 55, ticketsRemaining: 0 }),
      tier({ id: "b", quantityTotal: 20, ticketsRemaining: 0 }),
    ];
    const allSoldOut = tiers.every(
      (x) => !x.isUnlimited && (tierToCapacityForGate(x) ?? 0) <= 0,
    );
    expect(allSoldOut).toBe(true);
  });

  test("the trip-side mapper uses ticketsRemaining (not quantityTotal) for capacity", () => {
    const file = readFileSync(
      path.resolve(
        __dirname,
        "../../../app/checkout-trip/[tripEventId]/index.tsx",
      ),
      "utf-8",
    );
    expect(file).toMatch(
      /capacity:\s*tier\.ticketsRemaining\s*\?\?\s*tier\.quantityTotal/,
    );
    expect(file).not.toMatch(/capacity:\s*tier\.quantityTotal,/);
  });
});

// =====================================================================
// (b) ADVERSARIAL REGRESSION — different angles than (a):
//   - unlimited tier never reports sold-out even when remaining=0 leaks
//   - partial-sold tier caps gate at remaining, not at total
//   - ticketsRemaining=null (RPC degraded) falls back to quantityTotal
//     so a partial-sold trip still bookable, never a false sold-out
//   - server-side RPC SQL invariants hold (status filter + GREATEST guard)
// =====================================================================
describe("ORCH-0946 sold-out gate (adversarial)", () => {
  test("unlimited tier stays unbounded (capacity=null) even with stale remaining=0", () => {
    const t = tier({
      isUnlimited: true,
      quantityTotal: null,
      ticketsRemaining: 0,
    });
    expect(tierToCapacityForGate(t)).toBeNull();
    const isSoldOut = !t.isUnlimited && (tierToCapacityForGate(t) ?? 0) <= 0;
    expect(isSoldOut).toBe(false);
  });

  test("partial-sold tier caps QuantityRow + at remaining, not at total", () => {
    const t = tier({ quantityTotal: 55, ticketsRemaining: 3 });
    expect(tierToCapacityForGate(t)).toBe(3);
    expect(tierToCapacityForGate(t)).not.toBe(55);
  });

  test("RPC-degraded tier (ticketsRemaining=null) falls back to quantityTotal — no false sold-out, no crash", () => {
    const t = tier({ quantityTotal: 55, ticketsRemaining: null });
    expect(tierToCapacityForGate(t)).toBe(55);
    const isSoldOut = !t.isUnlimited && (tierToCapacityForGate(t) ?? 0) <= 0;
    expect(isSoldOut).toBe(false);
  });

  test("migration RPC counts only status IN (valid, used, transferred) and clamps remaining >= 0", () => {
    const file = readFileSync(
      path.resolve(
        __dirname,
        "../../../../supabase/migrations/20260724000006_orch_0946_public_ticket_types_remaining.sql",
      ),
      "utf-8",
    );
    expect(file).toMatch(/status\s+IN\s*\(\s*'valid',\s*'used',\s*'transferred'\s*\)/);
    expect(file).toMatch(/GREATEST\(\s*tt\.quantity_total\s*-\s*COALESCE\(s\.sold,\s*0\),\s*0\s*\)/);
    expect(file).toMatch(/GRANT EXECUTE ON FUNCTION public\.pg_public_ticket_types_remaining\(uuid\) TO anon, authenticated/);
  });

  test("event-side public read overwrites capacity with remaining for non-unlimited tickets", () => {
    const file = readFileSync(
      path.resolve(__dirname, "../publicEventsService.ts"),
      "utf-8",
    );
    expect(file).toMatch(/fetchTicketTypesRemaining/);
    expect(file).toMatch(/return \{ \.\.\.s, capacity: remaining \}/);
    expect(file).toMatch(/if \(s\.isUnlimited\) return s/);
  });
});
