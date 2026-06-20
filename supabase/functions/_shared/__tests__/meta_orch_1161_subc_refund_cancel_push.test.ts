// META-ORCH-1161 Sub-C §7.x — regression test: refund / order-cancelled buyer
// PUSH+in-app(+SMS) fires WITHOUT duplicating the email.
//
// Proves fireBuyerOrderNotify:
//   (1) POSTs to notify-dispatch v2 with the right category + contact = the buyer
//       PHONE (NOT email) — phone-only contact is what makes the v2 email channel
//       skip (no double-email; email is owned by ticket-confirmation-dispatch),
//       while push/in-app/sms still fire (these categories are SMS-eligible),
//   (2) skips entirely when the buyer has neither an account nor a phone (no
//       push/in-app/sms recipient — email owner handles that buyer).
//
// fails-on-revert: delete the dispatch fetch → (1) captures zero POSTs and FAILS.
//
// Run: deno test --allow-env supabase/functions/_shared/__tests__/meta_orch_1161_subc_refund_cancel_push.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fireBuyerOrderNotify } from "../businessNotifyTriggers.ts";

const ORDER_ID = "order-rc";

function makeFakeSupabase(opts: { buyerUserId: string | null; buyerPhone: string | null }) {
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
                      buyer_user_id: opts.buyerUserId,
                      buyer_phone_e164: opts.buyerPhone,
                      event_id: "event-rc",
                      currency: "USD",
                      events: { title: "Jazz Night", brand_id: "brand-rc", brands: { name: "Lantern" } },
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

Deno.test("refund buyer notify uses phone contact (no double-email)", async () => {
  Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  const captured: Array<{ url: string; body: Record<string, unknown> }> = [];
  const restore = installFetchCapture(captured);
  try {
    await fireBuyerOrderNotify(makeFakeSupabase({ buyerUserId: "u1", buyerPhone: "+15551234567" }), {
      categoryKey: "buyer_refund_issued",
      orderId: ORDER_ID,
      idempotencyKey: `buyer_refund_issued:re_123`,
      extraPayload: { amount_cents: 6793, currency: "USD" },
    });
  } finally {
    restore();
  }
  assertEquals(captured.length, 1);
  const { body } = captured[0];
  assertEquals(body.category_key, "buyer_refund_issued");
  assertEquals(body.user_id, "u1");
  // Phone contact (NOT email) → v2 email channel skips; no double-email.
  assertEquals(body.contact, "+15551234567");
  assertEquals(String(body.contact).includes("@"), false);
  assertEquals(body.idempotency_key, "buyer_refund_issued:re_123");
});

Deno.test("order-cancelled buyer notify fires for phone-only (anon guest) buyer", async () => {
  Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  const captured: Array<{ url: string; body: Record<string, unknown> }> = [];
  const restore = installFetchCapture(captured);
  try {
    await fireBuyerOrderNotify(makeFakeSupabase({ buyerUserId: null, buyerPhone: "+15559998888" }), {
      categoryKey: "buyer_order_cancelled",
      orderId: ORDER_ID,
      idempotencyKey: `buyer_order_cancelled:${ORDER_ID}:idem`,
    });
  } finally {
    restore();
  }
  assertEquals(captured.length, 1);
  assertEquals(captured[0].body.category_key, "buyer_order_cancelled");
  assertEquals(captured[0].body.user_id, null);
  assertEquals(captured[0].body.contact, "+15559998888");
});

Deno.test("no account and no phone → no dispatch", async () => {
  Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  const captured: Array<{ url: string; body: Record<string, unknown> }> = [];
  const restore = installFetchCapture(captured);
  try {
    await fireBuyerOrderNotify(makeFakeSupabase({ buyerUserId: null, buyerPhone: null }), {
      categoryKey: "buyer_refund_issued",
      orderId: ORDER_ID,
      idempotencyKey: "k",
    });
  } finally {
    restore();
  }
  assertEquals(captured.length, 0);
});
