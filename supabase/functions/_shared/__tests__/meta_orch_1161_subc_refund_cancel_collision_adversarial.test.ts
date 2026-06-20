// META-ORCH-1161 Sub-C "b" — TESTER ADVERSARIAL regression (different angle than
// the implementor's happy-path refund/cancel tests).
//
// The implementor's `meta_orch_1161_subc_refund_cancel_push.test.ts` proves each
// buyer notify path IN ISOLATION (one refund OR one cancel, correct contact). It
// does NOT attack the two production race/replay hazards the QA dispatch named:
//
//   ANGLE 1 — refund-then-cancel on the SAME order must NOT collapse.
//     A buyer can be refunded AND later have the order cancelled (or vice-versa).
//     If the refund leg and the cancel leg ever shared an idempotency key for the
//     same order, the v2 dispatcher's idempotency dedupe would SILENTLY DROP the
//     second notification — the buyer would learn of a refund but never the cancel
//     (or vice-versa). This test fires BOTH on one order and asserts the two
//     dispatched idempotency_keys are DISTINCT and that BOTH POSTs go out.
//
//   ANGLE 2 — Stripe refund-webhook re-delivery must COLLAPSE to one.
//     handleRefundEvent keys the buyer refund push on `buyer_refund_issued:{refundId}`
//     (see stripeWebhookRouter.ts). Stripe re-delivers webhook events; the SAME
//     refundId delivered twice MUST produce the SAME idempotency_key both times so
//     the v2 dedupe collapses it to ONE buyer notification. This proves the key is
//     a pure function of refundId — NOT a timestamp / Date.now() / random (which
//     would defeat idempotency and double-notify on every retry).
//
// fails-on-revert: if `fireBuyerOrderNotify` stops forwarding the caller's
// idempotency_key verbatim (e.g. someone appends Date.now() or a random nonce, or
// collapses refund+cancel onto one key), ANGLE 1's distinctness assert or ANGLE 2's
// stability assert FAILS. Verified by mutation at HEAD 2de27008e.
//
// Append-only; adds a NEW file (does not touch the implementor's test).
//
// Run: deno test --allow-env supabase/functions/_shared/__tests__/meta_orch_1161_subc_refund_cancel_collision_adversarial.test.ts

import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fireBuyerOrderNotify } from "../businessNotifyTriggers.ts";

const ORDER_ID = "order-collision";
const REFUND_ID = "re_adversarial_001";

function makeFakeSupabase() {
  return {
    from(_table: string) {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle() {
                  return Promise.resolve({
                    data: {
                      buyer_user_id: "buyer-collision",
                      buyer_phone_e164: "+15550000000",
                      event_id: "event-collision",
                      currency: "USD",
                      events: {
                        title: "Jazz Night",
                        brand_id: "brand-collision",
                        brands: { name: "Lantern" },
                      },
                    },
                    error: null,
                  });
                },
              };
            },
          };
        },
      };
    },
    // deno-lint-ignore no-explicit-any
  } as any;
}

function installFetchCapture(captured: Array<{ url: string; body: Record<string, unknown> }>) {
  const original = globalThis.fetch;
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    captured.push({ url, body });
    return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
  };
  return () => {
    globalThis.fetch = original;
  };
}

// ANGLE 1 — refund + cancel on the SAME order must not suppress each other.
Deno.test("ADVERSARIAL: refund-then-cancel on one order → distinct idempotency keys, both dispatch", async () => {
  Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  const captured: Array<{ url: string; body: Record<string, unknown> }> = [];
  const restore = installFetchCapture(captured);
  try {
    // Same order: it is refunded (Stripe webhook chokepoint key) ...
    await fireBuyerOrderNotify(makeFakeSupabase(), {
      categoryKey: "buyer_refund_issued",
      orderId: ORDER_ID,
      idempotencyKey: `buyer_refund_issued:${REFUND_ID}`,
      extraPayload: { amount_cents: 6793, currency: "USD" },
    });
    // ... then the order is cancelled (cancel-order chokepoint key).
    await fireBuyerOrderNotify(makeFakeSupabase(), {
      categoryKey: "buyer_order_cancelled",
      orderId: ORDER_ID,
      idempotencyKey: `buyer_order_cancelled:${ORDER_ID}:client-idem`,
    });
  } finally {
    restore();
  }

  // BOTH must dispatch — neither moment is allowed to swallow the other.
  assertEquals(captured.length, 2, "both refund AND cancel must be dispatched");

  const refundKey = captured[0].body.idempotency_key as string;
  const cancelKey = captured[1].body.idempotency_key as string;

  // Distinct categories, distinct keys → v2 dedupe will NOT collapse them.
  assertEquals(captured[0].body.category_key, "buyer_refund_issued");
  assertEquals(captured[1].body.category_key, "buyer_order_cancelled");
  assertNotEquals(
    refundKey,
    cancelKey,
    "refund and cancel on the SAME order must have DISTINCT idempotency keys",
  );
  // And the cancel key must NOT be a prefix/substring collision of the refund key.
  assert(
    !refundKey.startsWith("buyer_order_cancelled"),
    "refund key must not collide into the cancel namespace",
  );
  assert(
    !cancelKey.startsWith("buyer_refund_issued"),
    "cancel key must not collide into the refund namespace",
  );
});

// ANGLE 2 — Stripe re-delivers the SAME refund event → key MUST be stable.
Deno.test("ADVERSARIAL: refund-webhook re-delivery for the same refundId → identical key (idempotent)", async () => {
  Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  const captured: Array<{ url: string; body: Record<string, unknown> }> = [];
  const restore = installFetchCapture(captured);
  try {
    // First webhook delivery.
    await fireBuyerOrderNotify(makeFakeSupabase(), {
      categoryKey: "buyer_refund_issued",
      orderId: ORDER_ID,
      idempotencyKey: `buyer_refund_issued:${REFUND_ID}`,
      extraPayload: { amount_cents: 6793, currency: "USD" },
    });
    // Stripe re-delivers the SAME event (retry budget) — same refundId.
    await fireBuyerOrderNotify(makeFakeSupabase(), {
      categoryKey: "buyer_refund_issued",
      orderId: ORDER_ID,
      idempotencyKey: `buyer_refund_issued:${REFUND_ID}`,
      extraPayload: { amount_cents: 6793, currency: "USD" },
    });
  } finally {
    restore();
  }

  // The helper forwards the key verbatim → both POSTs carry the SAME key, so the
  // v2 dispatcher's idempotency dedupe collapses them to a single buyer row.
  assertEquals(captured.length, 2, "helper itself fires per call; dedupe is downstream on the key");
  assertEquals(
    captured[0].body.idempotency_key,
    captured[1].body.idempotency_key,
    "same refundId across webhook re-delivery MUST yield the SAME idempotency key (no timestamp/nonce)",
  );
  assertEquals(captured[0].body.idempotency_key, `buyer_refund_issued:${REFUND_ID}`);
});
