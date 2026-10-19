// Issue #3872 PR 1 (money truth, F4) — refund edges use the server-priced lines.
//
// MINGLA-INVARIANT: I-3872-REFUND-EDGES-USE-SERVER-LINES | issue #3872 | refund-order and admin-refund-order never use a client amount_cents for money; the Stripe tax reversal and the buyer's refund notice use the lines the refund RPC priced on the server.
//
// Fails before #3872: `_shared/refundServerLines.ts` does not exist, both edges
// required a client amount_cents, and the tax reversal mapped the request lines.

import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { isRefundLineRequest, serverRefundLines } from "../refundServerLines.ts";

Deno.test("a refund line needs an order line and a positive quantity; amount_cents is optional", () => {
  assert(isRefundLineRequest({ order_line_item_id: "oli_1", quantity: 1 }));
  assert(isRefundLineRequest({ order_line_item_id: "oli_1", quantity: 2, amount_cents: 2000 }));
  assert(!isRefundLineRequest({ order_line_item_id: "", quantity: 1 }));
  assert(!isRefundLineRequest({ order_line_item_id: "oli_1", quantity: 0 }));
  assert(!isRefundLineRequest({ order_line_item_id: "oli_1", quantity: 1.5 }));
  assert(!isRefundLineRequest({ order_line_item_id: "oli_1", quantity: 1, amount_cents: -5 }));
  assert(!isRefundLineRequest(null));
});

Deno.test("serverRefundLines reads the RPC's priced lines, not the request's", () => {
  const pending = {
    amount_cents: 2500000,
    lines: [
      { order_line_item_id: "oli_b", quantity: 1, amount_cents: 2500000 },
      { order_line_item_id: "", quantity: 1, amount_cents: 1 },
    ],
  };
  assertEquals(serverRefundLines(pending), [
    { order_line_item_id: "oli_b", quantity: 1, amount_cents: 2500000 },
  ]);
  assertEquals(serverRefundLines({}), []);
});

for (const fn of ["refund-order", "admin-refund-order"]) {
  const src = await Deno.readTextFile(new URL(`../../${fn}/index.ts`, import.meta.url));
  Deno.test(`${fn}: the tax reversal and buyer notice use serverRefundLines(pending)`, () => {
    assert(src.includes("const isRefundLine = isRefundLineRequest;"), "request lines accept a missing amount");
    assert(src.includes("line_items: serverRefundLines(pending).map((line) => ({"), "tax reversal uses server lines");
    assert(!/line_items:\s*\(?lines\b/.test(src), "tax reversal must not map the request lines");
    if (fn === "refund-order") {
      assert(src.includes("refund_lines: serverRefundLines(pending),"), "notice uses server lines");
      assert(src.includes('msg.includes("refund_exceeds_remaining")'), "the new ceiling maps to a 422");
    }
  });
}
