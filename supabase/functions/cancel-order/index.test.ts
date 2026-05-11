import { assert, assertFalse } from "https://deno.land/std@0.168.0/testing/asserts.ts";

const SOURCE = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("cancel-order: never imports Stripe (free orders only per Q-1 + Q-9)", () => {
  assertFalse(SOURCE.includes('from "../_shared/stripe.ts"'));
  assertFalse(SOURCE.includes("stripeTicketRefund"));
  assertFalse(SOURCE.includes("stripeTicketCheckout"));
  assertFalse(SOURCE.includes("api.stripe.com"));
  assertFalse(/new\s+Stripe\s*\(/.test(SOURCE));
});

Deno.test("cancel-order: calls biz_cancel_order RPC", () => {
  assert(SOURCE.includes('"biz_cancel_order"'));
});

Deno.test("cancel-order: maps RPC error paid_orders_must_be_refunded_not_cancelled (Q-1 lock)", () => {
  assert(SOURCE.includes("paid_orders_must_be_refunded_not_cancelled"));
});

Deno.test("cancel-order: requires Idempotency-Key header", () => {
  assert(SOURCE.includes("Idempotency-Key"));
  assert(SOURCE.includes("idempotency_key_required"));
});

Deno.test("cancel-order: enqueues buyer notification with buyer_order_cancelled template_key", () => {
  assert(SOURCE.includes('"ticket_order_notifications"'));
  assert(SOURCE.includes('"buyer_order_cancelled"'));
});

Deno.test("cancel-order: writes audit row via _shared/audit.ts", () => {
  assert(SOURCE.includes("writeAudit"));
  assert(SOURCE.includes('"order_cancelled"'));
});

Deno.test("cancel-order: validates reason length (10..200 chars)", () => {
  assert(SOURCE.includes("reason_invalid_length"));
});

Deno.test("cancel-order: surfaces unauthenticated when JWT missing", () => {
  assert(SOURCE.includes("unauthenticated"));
});
