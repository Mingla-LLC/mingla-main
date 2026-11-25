/**
 * #4490 spec 08 §11 T2 (N146): the Orders queue lists only orders a kitchen
 * should make. An unpaid or failed guest checkout, a Till payment carrier, a
 * held Till round and a tab settlement never appear as New.
 *
 * FAILS-ON-REVERT: drop the three filters in fetchVenueOrders and O1-T2a fails.
 */

const calls: Array<[string, unknown[]]> = [];

jest.mock("../../services/supabase", () => {
  const builder: Record<string, unknown> = {};
  const chain = (name: string) => (...args: unknown[]) => {
    calls.push([name, args]);
    return builder;
  };
  for (const name of ["select", "eq", "gte", "not", "or", "order", "limit"]) builder[name] = chain(name);
  builder.returns = () => Promise.resolve({ data: [], error: null });
  return { supabase: { from: (...args: unknown[]) => { calls.push(["from", args]); return builder; } } };
});

import { fetchVenueOrders } from "../useVenueOrders";

describe("O1-T2 the queue filter", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("O1-T2a excludes held rounds and carriers, tab settlements, and unpaid online checkouts", async () => {
    await fetchVenueOrders("brand-1", "venue-1");
    expect(calls).toContainEqual(["not", ["fulfillment_status", "in", "(held,payment_only)"]]);
    expect(calls).toContainEqual(["or", ["metadata->>tab_settlement.is.null,metadata->>tab_settlement.neq.true"]]);
    expect(calls).toContainEqual(["or", ["money_path.eq.venue_collected,payment_status.in.(paid,partial_refund,refunded)"]]);
    expect(calls).toContainEqual(["eq", ["venue_id", "venue-1"]]);
  });

  it("O1-T2b the brand-wide read uses the same filter", async () => {
    await fetchVenueOrders("brand-1", null);
    expect(calls.filter(([n]) => n === "or")).toHaveLength(2);
    expect(calls.some(([n, a]) => n === "eq" && a[0] === "venue_id")).toBe(false);
  });
});
