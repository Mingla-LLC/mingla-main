// Issue #3281 S4 — hosts (refund-order) and admins (admin-refund-order) may
// refund add-on lines on their own through the optional `addOnLines` field.
// Absent, the refund RPC receives exactly the ticket lines it always did.
import { assertEquals, assertStrictEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  addOnRefundRpcError,
  parseAddOnRefundLines,
  refundRpcLines,
} from "../../_shared/refundServerLines.ts";
import { addOnReceiptName } from "../../_shared/buyerConfirmationPayload.ts";

const ticket = { order_line_item_id: "11111111-1111-4111-8111-111111111111", quantity: 1 };
const addOn = { order_add_on_line_item_id: "22222222-2222-4222-8222-222222222222", quantity: 2 };

Deno.test("#3281 S4 absent addOnLines leaves the RPC lines untouched", () => {
  const lines = [ticket];
  const parsed = parseAddOnRefundLines(undefined);
  assertEquals(parsed, []);
  assertStrictEquals(refundRpcLines(lines, parsed ?? []), lines);
  assertStrictEquals(refundRpcLines(lines, parseAddOnRefundLines(null) ?? []), lines);
  assertStrictEquals(refundRpcLines(lines, parseAddOnRefundLines([]) ?? []), lines);
});

Deno.test("#3281 S4 add-on lines ride after the ticket lines", () => {
  const parsed = parseAddOnRefundLines([{ ...addOn, extra: "dropped" }]);
  assertEquals(parsed, [addOn]);
  assertEquals(refundRpcLines([ticket], parsed ?? []), [ticket, addOn]);
  assertEquals(refundRpcLines([], parsed ?? []), [addOn]);
});

Deno.test("#3281 S4 malformed addOnLines are refused, never half-read", () => {
  for (const bad of [
    "x",
    { order_add_on_line_item_id: addOn.order_add_on_line_item_id, quantity: 1 },
    [{ order_add_on_line_item_id: "", quantity: 1 }],
    [{ order_add_on_line_item_id: addOn.order_add_on_line_item_id, quantity: 0 }],
    [{ order_add_on_line_item_id: addOn.order_add_on_line_item_id, quantity: 1.5 }],
    [{ order_add_on_line_item_id: addOn.order_add_on_line_item_id, quantity: "1" }],
    [null],
  ]) {
    assertStrictEquals(parseAddOnRefundLines(bad), null);
  }
});

Deno.test("#3281 S4 add-on refusals map before the ticket-line codes they contain", () => {
  assertEquals(
    addOnRefundRpcError("add_on_line_overrefund: line=x requested=2 existing=1 capacity=2")?.code,
    "add_on_line_overrefund",
  );
  assertEquals(addOnRefundRpcError("add_on_line_not_found: x")?.code, "add_on_line_not_found");
  assertEquals(addOnRefundRpcError("add_on_refunds_off")?.code, "add_on_refunds_off");
  assertStrictEquals(addOnRefundRpcError("line_overrefund: line=x"), null);
});

Deno.test("#3281 S4 both refund functions send the add-on lines and map their refusals", async () => {
  for (const fn of ["../index.ts", "../../admin-refund-order/index.ts"]) {
    const src = await Deno.readTextFile(new URL(fn, import.meta.url));
    assertEquals(src.includes("p_lines: refundRpcLines(lines, addOnLines)"), true, fn);
    assertEquals(src.includes("parseAddOnRefundLines(body.addOnLines)"), true, fn);
    assertEquals(src.indexOf("addOnRefundRpcError(errorMessage)") < src.indexOf('msg.includes("line_overrefund")'), true, fn);
  }
});

Deno.test("#3281 S4 a receipt labels each add-on", () => {
  assertEquals(addOnReceiptName("Friday dinner"), "Add-on: Friday dinner");
});
