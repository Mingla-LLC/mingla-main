/**
 * issue #4522 rework (tester F8) — the balance preview allocates a flexible
 * payment exactly as issue_4522_begin_flex_payment does: largest remainder
 * across packages, never more than a package owes, so every amount from the
 * minimum to the whole balance previews a conserved schedule.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  rebalanceTripPlan,
  type TripBalanceScheduleRow,
} from "../tripBalance.ts";

const row = (
  id: string,
  planLineId: string,
  amountMinor: number,
): TripBalanceScheduleRow => ({
  installmentId: id,
  dueAt: "2027-02-10T08:00:00+00:00",
  amountMinor,
  addonPortionMinor: 0,
  planLineId,
  status: "scheduled",
});

const rows = [
  row("r1", "a0000000-0000-4000-8000-000000000001", 10_000),
  row("r2", "a0000000-0000-4000-8000-000000000002", 10_000),
  row("r3", "a0000000-0000-4000-8000-000000000003", 100),
];

Deno.test("F8: 20,099 of 20,100 across 10,000 / 10,000 / 100 previews 1 left", () => {
  const after = rebalanceTripPlan(rows, 20_099, 100);
  assertEquals(after.reduce((sum, r) => sum + r.amountMinor, 0), 1);
  assertEquals(after.every((r) => r.amountMinor > 0), true);
});

Deno.test("F8: every amount conserves money and no package goes negative", () => {
  for (let paid = 100; paid < 20_100; paid += 1) {
    const after = rebalanceTripPlan(rows, paid, 100);
    const left = after.reduce((sum, r) => sum + r.amountMinor, 0);
    if (left !== 20_100 - paid || after.some((r) => r.amountMinor <= 0)) {
      throw new Error(`paid ${paid}: left ${left}`);
    }
  }
});
