// ISSUE-1326 — venue-reservation-confirm Paystack (NG) fast-path RUNTIME proof.
//
// Pre-1326, confirm could only verify STRIPE (stripe_payment_intent_id /
// stripe_account_id). A Paystack-routed reservation has NEITHER, so confirm fell
// straight to `{ status: "pending" }` FOREVER — the native app polled ~25s then
// showed "your reservation will appear shortly" and it never did.
//
// This drives the REAL venue-reservation-confirm handler (captured via the
// ORCH-1205 serve-shim import map) against a fully-stubbed network: the Paystack
// verify GET succeeds, the SHARED finalize RPC mints, and confirm returns
// { status: "completed", reservationId }. Proves the fast poll now resolves.
//
// Run (repo root):
//   SUPABASE_URL=https://example-test.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=test-service-role-key-not-real \
//   deno test --import-map=supabase/functions/_shared/__tests__/_importmap.test.json \
//     --allow-read --allow-env --allow-net \
//     supabase/functions/_shared/__tests__/issue_1326_confirm_paystack.test.ts
//
// FAILS-ON-REVERT: deleting the Paystack branch in venue-reservation-confirm/
// index.ts makes the handler return { status: "pending" } (no reservationId) →
// this test's completed/reservationId assertions go RED.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { getCapturedHandler, resetCapturedHandler } from "./_serveShim.ts";

const SUPA_URL = "https://example-test.supabase.co";
const SECRET = "sk_test_issue1326_confirm_secret";
const REFERENCE = "mingla_resv_11111111-2222-3333-4444-555555555555_zzz";
const SESSION_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const RESERVATION_ID = "99999999-8888-7777-6666-555555555555";
const BUYER_TOKEN = "buyer-status-token-issue-1326";
const AMOUNT_KOBO = 537500;

Deno.env.set("SUPABASE_URL", SUPA_URL);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key-not-real");
Deno.env.set("PAYSTACK_MODE", "test");
Deno.env.set("PAYSTACK_SECRET_KEY_TEST", SECRET);

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function jsonOk(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface HitLog {
  verifyHit: boolean;
  finalizeHit: boolean;
}

function installFetchStub(session: Record<string, unknown>, log: HitLog) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (
    input: Request | URL | string,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string"
      ? input
      : (input instanceof URL ? input.href : input.url);
    const method = (init?.method ??
      (input instanceof Request ? input.method : "GET")).toUpperCase();

    // Paystack verify — the ONLY paystack surface confirm touches.
    if (url.startsWith("https://api.paystack.co/transaction/verify/")) {
      log.verifyHit = true;
      return Promise.resolve(jsonOk({
        status: true,
        message: "Verification successful",
        data: {
          status: "success",
          amount: AMOUNT_KOBO,
          currency: "NGN",
          channel: "card",
          id: 4242,
          paid_at: "2026-07-28T10:00:00.000Z",
        },
      }));
    }

    // The reservation session read (select=* ...) → the pending Paystack session.
    if (url.startsWith(`${SUPA_URL}/rest/v1/reservation_checkout_sessions`)) {
      if (method === "GET") return Promise.resolve(jsonOk([session]));
      // PATCH (fail-mark / attribution) — not hit on the happy path; 204.
      return Promise.resolve(new Response(null, { status: 204 }));
    }

    // The SHARED idempotent finalize RPC → mints the reservation (TABLE shape).
    if (
      url.startsWith(`${SUPA_URL}/rest/v1/rpc/pg_finalize_guest_reservation`)
    ) {
      log.finalizeHit = true;
      return Promise.resolve(jsonOk([{
        reservation: { id: RESERVATION_ID },
        session_id: SESSION_ID,
      }]));
    }

    // Everything else (ad-conversion fire internals, audit, api-health) — inert
    // success; all fail-open in the confirm/finalize path.
    return Promise.resolve(jsonOk({}));
  };
  return () => {
    globalThis.fetch = realFetch;
  };
}

Deno.test({
  name:
    "confirm · Paystack session + verified success → SHARED finalize mints → { completed, reservationId } (not pending forever)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    resetCapturedHandler();
    const session = {
      id: SESSION_ID,
      brand_id: "bbbbbbbb-1111-2222-3333-444444444444",
      reserved_for: "2026-08-01T19:00:00.000Z",
      party_size: 2,
      buyer_name: "Ada Test",
      buyer_email: "ada@example.com",
      buyer_phone_e164: "+2348000000000",
      occasion: null,
      guest_notes: null,
      amount_cents: AMOUNT_KOBO,
      currency: "NGN",
      stripe_payment_intent_id: null,
      stripe_checkout_session_id: null,
      stripe_account_id: null,
      paystack_reference: REFERENCE,
      created_via: "app",
      consumer_user_id: null,
      guest_cancel_token: "cancel-tok-1",
      buyer_status_token_hash: await sha256Hex(BUYER_TOKEN),
      status: "pending",
      reservation_id: null,
      attribution_click_id: null,
    };
    const log: HitLog = { verifyHit: false, finalizeHit: false };
    const restore = installFetchStub(session, log);
    try {
      await import("../../venue-reservation-confirm/index.ts");
      const handler = getCapturedHandler();
      assert(handler !== null, "venue-reservation-confirm handler captured");

      const res = await handler!(
        new Request("https://edge.test/venue-reservation-confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reservationDraftId: SESSION_ID,
            buyerStatusToken: BUYER_TOKEN,
          }),
        }),
      );

      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body.status, "completed");
      assertEquals(body.reservationId, RESERVATION_ID);
      assert(log.verifyHit, "Paystack verify was called");
      assert(log.finalizeHit, "the shared pg_finalize_guest_reservation ran");
    } finally {
      restore();
    }
  },
});
