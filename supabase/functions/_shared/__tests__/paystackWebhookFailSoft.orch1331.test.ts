// ORCH-1331 T-8 (SC-7, CONSTITUTIONAL) — fail-soft RUNTIME proof against the
// REAL paystack-webhook handler.
//
// I-PROPOSED-1331-PARTNER-SPLIT-FAIL-SOFT: when the partner-split engine
// throws (ANY stage — here the engine's very first DB read is forced to 500),
// the charge.success webhook behaves IDENTICALLY to pre-ORCH behavior:
//   * order finalizes (biz_ticket_checkout_finalize called),
//   * confirmation dispatches (ticket-confirmation-dispatch POSTed),
//   * ack is HTTP 200 {received:true},
//   * the inbox row is marked processed=true with error=null,
//   * and the split fan-out ran strictly AFTER the confirmation dispatch.
//
// HOW: paystack-webhook calls serve() at module load with no import.meta.main
// guard, so the std http/server import is aliased to the capture shim via
// _importmap.test.json (ORCH-1205 pattern). globalThis.fetch is stubbed to
// route every network surface (Paystack verify, Supabase REST, edge-fn
// dispatch) deterministically — NO live Paystack calls (LIVE mode, real
// money). The split engine's orders read (select=id,currency,stripe_
// application_fee_amount_cents) responds 500, forcing the engine to THROW
// inside the fan-out — the exact SC-7 adversarial condition.
//
// FAILS-ON-REVERT: deleting the dedicated try/catch around
// handlePaystackPartnerSplit in paystack-webhook/index.ts lets the forced
// throw escape → the handler promise rejects / processed=true never lands →
// this test goes RED. (Verified by true line deletion — see the
// implementation report's Regression Test section.)
//
// Run (repo root):
//   SUPABASE_URL=https://example-test.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=test-service-role-key-not-real \
//   deno test --import-map=supabase/functions/_shared/__tests__/_importmap.test.json \
//     --allow-read --allow-env --allow-net \
//     supabase/functions/_shared/__tests__/paystackWebhookFailSoft.orch1331.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

import { getCapturedHandler, resetCapturedHandler } from "./_serveShim.ts";

const SUPA_URL = "https://example-test.supabase.co";
const SECRET = "sk_test_orch1331_fail_soft_secret";
const REFERENCE = "MGL-T8-REF-1";
const ORDER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

Deno.env.set("SUPABASE_URL", SUPA_URL);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key-not-real");
Deno.env.set("PAYSTACK_MODE", "test");
Deno.env.set("PAYSTACK_SECRET_KEY_TEST", SECRET);
Deno.env.set(
  "app.qr_token_pepper",
  "orch1331-test-pepper-0123456789abcdef0123456789abcdef",
);

// ---------- fetch stub ----------
interface HitLog {
  order: string[];
  markProcessedPayloads: Array<Record<string, unknown>>;
  splitOrderReadHit: boolean;
  confirmationDispatched: boolean;
  finalizeCalled: boolean;
}

function jsonOk(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function installFetchStub(log: HitLog): () => void {
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
    log.order.push(`${method} ${url}`);

    // Paystack verify — the ONLY paystack surface this flow touches.
    if (url.startsWith("https://api.paystack.co/transaction/verify/")) {
      return Promise.resolve(jsonOk({
        status: true,
        message: "Verification successful",
        data: {
          status: "success",
          amount: 5000,
          currency: "NGN",
          channel: "card",
          id: 424242,
          paid_at: "2026-07-11T10:00:00.000Z",
        },
      }));
    }

    if (url.startsWith(`${SUPA_URL}/rest/v1/payment_webhook_events`)) {
      if (method === "GET") {
        // Existing unprocessed inbox row (retry path — avoids the insert leg).
        // postgrest-js maybeSingle expects the ARRAY shape ([] → null).
        return Promise.resolve(jsonOk([{
          id: "evtrow-1",
          processed: false,
          retry_count: 0,
          retries_exhausted: false,
        }]));
      }
      if (method === "PATCH") {
        const bodyText = typeof init?.body === "string" ? init.body : "{}";
        try {
          log.markProcessedPayloads.push(JSON.parse(bodyText));
        } catch {
          log.markProcessedPayloads.push({ unparseable: bodyText });
        }
        return Promise.resolve(new Response(null, { status: 204 }));
      }
    }

    if (url.startsWith(`${SUPA_URL}/rest/v1/event_rsvp_contributions`)) {
      return Promise.resolve(jsonOk([])); // not a chip-in reference (no row)
    }

    if (url.startsWith(`${SUPA_URL}/rest/v1/ticket_checkout_sessions`)) {
      return Promise.resolve(jsonOk([{
        id: "sess-1",
        status: "processing_payment",
        order_id: null,
        total_cents: 5000,
        currency: "NGN",
      }]));
    }

    if (url.startsWith(`${SUPA_URL}/rest/v1/rpc/biz_ticket_checkout_finalize`)) {
      log.finalizeCalled = true;
      return Promise.resolve(jsonOk({ orderId: ORDER_ID }));
    }

    if (url.startsWith(`${SUPA_URL}/functions/v1/ticket-confirmation-dispatch`)) {
      log.confirmationDispatched = true;
      return Promise.resolve(jsonOk({ ok: true }));
    }

    if (url.startsWith(`${SUPA_URL}/rest/v1/orders`)) {
      // Two distinct order reads share the table:
      //   * the buyer-push read (select=event_id,events(...)) → succeed;
      //   * the SPLIT ENGINE's fee read (select=id,currency,stripe_
      //     application_fee_amount_cents) → FORCED 500 (the T-8 throw).
      if (url.includes("stripe_application_fee_amount_cents")) {
        log.splitOrderReadHit = true;
        return Promise.resolve(jsonOk(
          { message: "orch1331 forced split-path failure" },
          500,
        ));
      }
      return Promise.resolve(jsonOk([{
        event_id: "eeeeeeee-1111-2222-3333-444444444444",
        events: { title: "T-8 Event", brand_id: null },
      }]));
    }

    // Everything else (audit writes, api-health log, push internals) — inert
    // success; all of those surfaces are best-effort in the webhook.
    return Promise.resolve(jsonOk({}));
  };
  return () => {
    globalThis.fetch = realFetch;
  };
}

async function hmacSha512Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.test({
  name:
    "T-8 (SC-7) · split engine forced to THROW → webhook contract byte-stable: finalize + confirmation + 200 ack + processed=true, split ran AFTER dispatch",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    resetCapturedHandler();
    const log: HitLog = {
      order: [],
      markProcessedPayloads: [],
      splitOrderReadHit: false,
      confirmationDispatched: false,
      finalizeCalled: false,
    };
    const restore = installFetchStub(log);
    try {
      // Import AFTER the fetch stub is installed; serve() is shim-captured.
      await import("../../paystack-webhook/index.ts");
      const handler = getCapturedHandler();
      assert(handler !== null, "paystack-webhook handler captured via shim");

      const rawBody = JSON.stringify({
        event: "charge.success",
        data: {
          reference: REFERENCE,
          status: "success",
          amount: 5000,
          currency: "NGN",
          channel: "card",
        },
      });
      const signature = await hmacSha512Hex(SECRET, rawBody);
      const res = await handler!(
        new Request("https://edge.test/paystack-webhook", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-paystack-signature": signature,
          },
          body: rawBody,
        }),
      );

      // 1. Ack contract — identical to pre-ORCH behavior.
      assertEquals(res.status, 200, "ack is 200 despite the split throw");
      const body = await res.json();
      assertEquals(body.received, true);
      assertEquals(body.reference, REFERENCE);

      // 2. The money path ran to completion.
      assert(log.finalizeCalled, "biz_ticket_checkout_finalize was called");
      assert(
        log.confirmationDispatched,
        "ticket-confirmation-dispatch was POSTed",
      );

      // 3. The split path genuinely RAN and genuinely THREW (forced 500) —
      //    this is what makes the test adversarial rather than vacuous.
      assert(
        log.splitOrderReadHit,
        "the split engine's fee read was reached (the forced-throw site)",
      );

      // 4. processed=true, error=null — the throw NEVER became processingError.
      const processedPatch = log.markProcessedPayloads.find(
        (p) => p.processed === true,
      );
      assert(
        processedPatch !== undefined,
        "inbox row marked processed=true",
      );
      assertEquals(
        processedPatch!.error ?? null,
        null,
        "processingError stays null — the split failure is invisible to the inbox",
      );

      // 5. Ordering — the split fan-out ran strictly AFTER the confirmation
      //    dispatch (SPEC §4.6: MUST NOT run before dispatchTicketConfirmation).
      const dispatchIdx = log.order.findIndex((l) =>
        l.includes("/functions/v1/ticket-confirmation-dispatch")
      );
      const splitIdx = log.order.findIndex((l) =>
        l.includes("stripe_application_fee_amount_cents")
      );
      assert(dispatchIdx >= 0 && splitIdx >= 0, "both surfaces were hit");
      assert(
        splitIdx > dispatchIdx,
        `split fan-out (${splitIdx}) must run after confirmation dispatch (${dispatchIdx})`,
      );
    } finally {
      restore();
    }
  },
});
