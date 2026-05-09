import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { deriveParentReconciliation } from "./placeIntelParentReconciliation.ts";

Deno.test("deriveParentReconciliation finalizes Raleigh-style drift from child truth", () => {
  const result = deriveParentReconciliation(
    {
      status: "running",
      total_count: 1540,
      processed_count: 1522,
      succeeded_count: 1273,
      failed_count: 249,
      cost_so_far_usd: 5.0164,
    },
    [
      ...Array.from({ length: 1288 }, () => ({ status: "completed", cost_usd: 0.002 })),
      ...Array.from({ length: 252 }, () => ({ status: "failed", cost_usd: 0 })),
    ],
    "2026-05-08T00:00:00.000Z",
  );

  assertEquals(result.finalized, true);
  assertEquals(result.reason, "reconciled_from_children");
  assertEquals(result.totalChildren, 1540);
  assertEquals(result.terminalChildren, 1540);
  assertEquals(result.completedChildren, 1288);
  assertEquals(result.failedChildren, 252);
  assertEquals(result.nonterminalChildren, 0);
  assertEquals(result.updatePayload?.processed_count, 1540);
  assertEquals(result.updatePayload?.succeeded_count, 1288);
  assertEquals(result.updatePayload?.failed_count, 252);
  assertEquals(result.updatePayload?.status, "complete");
});

Deno.test("deriveParentReconciliation refuses to finalize while any child is nonterminal", () => {
  const result = deriveParentReconciliation(
    {
      status: "running",
      total_count: 3,
      processed_count: 2,
      succeeded_count: 1,
      failed_count: 1,
      cost_so_far_usd: 0.1,
    },
    [
      { status: "completed", cost_usd: 0.1 },
      { status: "failed", cost_usd: 0 },
      { status: "pending", cost_usd: 0 },
    ],
    "2026-05-08T00:00:00.000Z",
  );

  assertEquals(result.finalized, false);
  assertEquals(result.reason, "children_not_terminal");
  assertEquals(result.nonterminalChildren, 1);
  assertEquals(result.updatePayload, undefined);
});

Deno.test("deriveParentReconciliation preserves cancellation final status", () => {
  const result = deriveParentReconciliation(
    {
      status: "cancelling",
      total_count: 2,
      processed_count: 0,
      succeeded_count: 0,
      failed_count: 0,
      cost_so_far_usd: 0,
    },
    [
      { status: "cancelled", cost_usd: 0 },
      { status: "failed", cost_usd: 0 },
    ],
    "2026-05-08T00:00:00.000Z",
  );

  assertEquals(result.finalized, true);
  assertEquals(result.updatePayload?.status, "cancelled");
  assertEquals(result.updatePayload?.processed_count, 2);
  assertEquals(result.updatePayload?.failed_count, 1);
});
