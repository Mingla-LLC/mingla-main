// META-ORCH-1161 Sub-C §7.1 — regression test: buyer purchase-confirmation PUSH
// fires WITHOUT duplicating the email.
//
// Proves:
//   (1) fireBuyerPurchaseConfirmationPush POSTs to notify-dispatch v2 with
//       category_key='buyer_purchase_confirmation', the buyer's user_id, and
//       contact:null — contact:null is THE mechanism that makes the v2 dispatcher
//       skip the email channel (email is owned by ticket-confirmation-dispatch),
//       so no double-email. Idempotency_key is buyer_purchase_confirmation:{orderId}.
//   (2) a buyer with NO account (buyer_user_id null) → NO dispatch (no push/in-app
//       recipient; the email owner still reaches them separately).
//
// fails-on-revert: delete the fetch dispatch in fireBuyerPurchaseConfirmationPush
// → test (1) sees zero captured POSTs and FAILS. Change contact:null to an email →
// the contact:null assertion FAILS (would re-introduce the double-email).
//
// Run: deno test --allow-env supabase/functions/_shared/__tests__/meta_orch_1161_subc_purchase_push.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fireBuyerPurchaseConfirmationPush } from "../businessNotifyTriggers.ts";

const ORDER_ID = "order-1161";
const EVENT_ID = "event-1161";
const BRAND_ID = "brand-1161";
const BUYER_USER_ID = "buyer-1161";

function makeFakeSupabase(opts: { buyerUserId: string | null; brandName: string }) {
  return {
    from(table: string) {
      if (table === "orders") {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle() {
                    return Promise.resolve({
                      data: { buyer_user_id: opts.buyerUserId },
                      error: null,
                    });
                  },
                };
              },
            };
          },
        };
      }
      if (table === "brands") {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle() {
                    return Promise.resolve({
                      data: { name: opts.brandName },
                      error: null,
                    });
                  },
                };
              },
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
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

Deno.test("purchase finalize fires a buyer push with contact:null (no double-email)", async () => {
  Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  const captured: Array<{ url: string; body: Record<string, unknown> }> = [];
  const restore = installFetchCapture(captured);
  try {
    await fireBuyerPurchaseConfirmationPush(
      makeFakeSupabase({ buyerUserId: BUYER_USER_ID, brandName: "Lantern" }),
      {
        orderId: ORDER_ID,
        eventId: EVENT_ID,
        brandId: BRAND_ID,
        eventTitle: "Jazz Night",
        startAtIso: "2026-06-22T20:00:00Z",
      },
    );
  } finally {
    restore();
  }

  assertEquals(captured.length, 1, "exactly one notify-dispatch POST expected");
  const { url, body } = captured[0];
  assert(url.endsWith("/functions/v1/notify-dispatch"), `unexpected url ${url}`);
  assertEquals(body.category_key, "buyer_purchase_confirmation");
  assertEquals(body.user_id, BUYER_USER_ID);
  // contact:null is the no-double-email guarantee (email channel records skipped).
  assertEquals(body.contact, null);
  assertEquals(body.idempotency_key, `buyer_purchase_confirmation:${ORDER_ID}`);
  const payload = body.payload as Record<string, unknown>;
  assertEquals(payload.brand_name, "Lantern");
  assertEquals(payload.event_title, "Jazz Night");
});

Deno.test("no-account buyer → no push dispatch (email owner reaches them)", async () => {
  Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  const captured: Array<{ url: string; body: Record<string, unknown> }> = [];
  const restore = installFetchCapture(captured);
  try {
    await fireBuyerPurchaseConfirmationPush(
      makeFakeSupabase({ buyerUserId: null, brandName: "Lantern" }),
      { orderId: ORDER_ID, eventId: EVENT_ID, brandId: BRAND_ID, eventTitle: "Jazz Night" },
    );
  } finally {
    restore();
  }
  assertEquals(captured.length, 0, "no dispatch for a no-account buyer");
});
