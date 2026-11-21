// Issue #3281 S5 — refunding a spread add-on first takes it off the trip
// plan's open rows. When none of it was collected, refund-order and
// admin-refund-order answer without calling a provider; a plan that moved
// is a 409 the host retries.
import { assertEquals, assertThrows } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  addOnRefundRpcError,
  planRemovalOnlyResponse,
} from "../../_shared/refundServerLines.ts";

const removal = {
  refund_id: null,
  order_id: "32815000-0000-4000-8500-0000000000c1",
  amount_cents: 0,
  currency: "USD",
  removed_from_plan_cents: 30000,
  plan_removal_only: true,
  proposed_new_payment_status: "paid",
  is_full_refund: false,
  lines: [],
  reason: "Transfer no longer needed",
  idempotent_replay: false,
};

Deno.test("#3281 S5 a plan-only removal answers without a provider refund", () => {
  assertEquals(planRemovalOnlyResponse(removal), {
    refund_id: null,
    order_id: removal.order_id,
    amount_cents: 0,
    currency: "USD",
    status: "removed_from_plan",
    removed_from_plan_cents: 30000,
    new_payment_status: "paid",
    idempotent_replay: false,
  });
  assertEquals(planRemovalOnlyResponse({ ...removal, idempotent_replay: true })?.idempotent_replay, true);
});

Deno.test("#3281 S5 an ordinary refund result is never read as a plan removal", () => {
  assertEquals(planRemovalOnlyResponse({ refund_id: "r1", amount_cents: 30000 }), null);
  assertEquals(planRemovalOnlyResponse({ ...removal, plan_removal_only: "true" }), null);
});

Deno.test("#3281 S5 a malformed plan removal fails closed", () => {
  for (const bad of [
    { ...removal, removed_from_plan_cents: 0 },
    { ...removal, removed_from_plan_cents: "30000" },
    { ...removal, amount_cents: 100 },
  ]) {
    assertThrows(() => planRemovalOnlyResponse(bad));
  }
});

Deno.test("#3281 S5 plan refusals map to 409, never a 5xx", () => {
  for (const code of ["add_on_plan_open_use_cancel", "add_on_plan_changed", "balance_payment_in_flight"]) {
    assertEquals(addOnRefundRpcError(`ERROR: ${code}`), { code, status: 409, detail: `ERROR: ${code}` });
  }
  assertEquals(addOnRefundRpcError("line_overrefund: x"), null);
});
