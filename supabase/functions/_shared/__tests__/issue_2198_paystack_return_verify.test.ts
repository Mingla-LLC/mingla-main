// issue #2198 [paystack-return-verify] — the buyer's RETURN LEG from Paystack.
//
// WHAT HAPPENED IN PRODUCTION. A guest paid ₦100 by bank transfer on a live NGN
// event (2026-08-18, session 06fd4518-…, order 56471853-…). Paystack charged
// them at 01:41:05. `charge.success` reached us at 01:45:11 — 4m 06s later —
// and only then was the order created. For those four minutes the buyer stared
// at "Confirming your tickets… Payment received." having already paid.
//
// The cause: `ticket-checkout-create` sends the guest back to
// `…/confirm?cs=paystack&csi=…&bst=…`, but neither `ticket-checkout-confirm`
// nor `ticket-checkout-status` contained a single reference to Paystack. The
// return leg never asked Paystack whether the payment succeeded — it only
// waited for the webhook, which was therefore the ONLY completion path.
//
// WHY IT IS WRITTEN THIS WAY. These drive the REAL `ticket-checkout-confirm`
// handler (captured through the ORCH-1205 serve shim) against a fully stubbed
// network. Nothing is mocked at the module boundary: what is asserted is what
// actually reaches the wire — whether Paystack was asked, whether the shared
// finalize RPC ran, and how many times.
//
// Run (repo root):
//   SUPABASE_URL=https://example-test.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=test-service-role-key-not-real \
//   PAYSTACK_MODE=test PAYSTACK_SECRET_KEY_TEST=sk_test_issue2198_return_secret \
//   deno test --import-map=supabase/functions/_shared/__tests__/_importmap.test.json \
//     --allow-read --allow-env --allow-net \
//     supabase/functions/_shared/__tests__/issue_2198_paystack_return_verify.test.ts
//
// FAILS-ON-REVERT: delete the `resolvePaystackTicketReturn(...)` block from
// `supabase/functions/ticket-checkout-confirm/index.ts` (restore the straight
// fall-through to the Stripe slow-path) and confirm returns
// `{ status: "pending", order: null }` for a fully-paid Paystack session —
// case 1 (webhook suppressed), case 3 (one order), case 4 (mismatch) and
// case 5 (terminal reason) all go RED. Case 2 (forged parameter) goes red the
// other way if the resolver ever starts trusting `?cs=paystack` instead of the
// server's provider-attempt row.
//
// Owner: mingla-implementor. Issue: #2198.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { getCapturedHandler } from "./_serveShim.ts";

const SUPA_URL = "https://example-test.supabase.co";
const SECRET = "sk_test_issue2198_return_secret";

const SESSION_ID = "06fd4518-b4aa-48c8-b528-7f36f33dcbce"; // the live session
const ORDER_ID = "56471853-07f8-4ed3-94c8-d83cd5260ad5"; // the live order
const EVENT_ID = "e2198000-1111-4222-8333-444444444444";
const BRAND_ID = "b2198000-1111-4222-8333-444444444444";
const ATTEMPT_ID = "a2198000-1111-4222-8333-444444444444";
const TICKET_ID = "t2198000-1111-4222-8333-444444444444";
const BUYER_TOKEN = "buyer-status-token-issue-2198";
/** `mingla_{sessionId}` — exactly what ticket-checkout-create persists. */
const REFERENCE = `mingla_${SESSION_ID}`;
/** The all-in NGN total in kobo, as persisted on the session at create. */
const TOTAL_KOBO = 10000;

Deno.env.set("SUPABASE_URL", SUPA_URL);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key-not-real");
Deno.env.set("PAYSTACK_MODE", "test");
Deno.env.set("PAYSTACK_SECRET_KEY_TEST", SECRET);
Deno.env.set(
  "app.qr_token_pepper",
  "issue-2198-qr-token-pepper-value-long-enough",
);

await import("../../ticket-checkout-confirm/index.ts");
const HANDLER = getCapturedHandler();

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

/** A Paystack ticket session as it sits the instant the guest returns. */
async function paystackSessionRow(
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  return {
    id: SESSION_ID,
    status: "awaiting_web_redirect",
    order_id: null,
    event_id: EVENT_ID,
    brand_id: BRAND_ID,
    total_cents: TOTAL_KOBO,
    currency: "NGN",
    buyer_status_token_hash: await sha256Hex(BUYER_TOKEN),
    // A Paystack brand has NO connected account and NO Stripe Checkout Session.
    stripe_checkout_session_id: null,
    stripe_account_id: null,
    // The Paystack reference rides in the PI slot (text column, UNIQUE).
    stripe_payment_intent_id: REFERENCE,
    ...overrides,
  };
}

/** The provider attempt `ticket-checkout-create` wrote — the server's own truth. */
function paystackAttemptRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: ATTEMPT_ID,
    provider: "paystack",
    flow: "paystack_redirect",
    provider_reference: REFERENCE,
    state: "ready",
    ...overrides,
  };
}

interface Wire {
  /** Every Paystack verify GET, in order. */
  verifyCalls: string[];
  /** Every biz_ticket_checkout_finalize POST. */
  finalizeCalls: number;
  /** Every ticket-confirmation-dispatch POST (buyer email + SMS fan-out). */
  dispatchCalls: number;
  /** PATCHes that mark the session failed (the fail-closed mark). */
  sessionFailedPatches: number;
  /** Audit rows written. */
  auditActions: unknown[];
}

interface StubOptions {
  session: Record<string, unknown>;
  /** null → the attempts table has no row for this session. */
  attempt: Record<string, unknown> | null;
  /** The `data` object Paystack's verify returns. */
  verifyData: Record<string, unknown>;
  /** When true the verify endpoint 500s (provider unreachable). */
  verifyThrows?: boolean;
  /**
   * Mutates the session row in place on a successful finalize, exactly as the
   * RPC does — so any later read (a webhook, a second poll) sees `order_id`.
   */
  finalizeMintsOrder?: boolean;
}

function installFetchStub(opts: StubOptions): { wire: Wire; restore: () => void } {
  const wire: Wire = {
    verifyCalls: [],
    finalizeCalls: 0,
    dispatchCalls: 0,
    sessionFailedPatches: 0,
    auditActions: [],
  };
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
    const rawBody = typeof init?.body === "string" ? init.body : "";

    // ---- Paystack ----
    if (url.startsWith("https://api.paystack.co/transaction/verify/")) {
      wire.verifyCalls.push(url);
      if (opts.verifyThrows) {
        return Promise.resolve(
          jsonOk({ status: false, message: "service unavailable" }, 503),
        );
      }
      return Promise.resolve(jsonOk({
        status: true, // the API CALL worked …
        message: "Verification successful",
        data: opts.verifyData, // … data.status is the TRANSACTION truth
      }));
    }

    // ---- buyer confirmation fan-out (email + SMS) ----
    if (url.startsWith(`${SUPA_URL}/functions/v1/ticket-confirmation-dispatch`)) {
      wire.dispatchCalls += 1;
      return Promise.resolve(jsonOk({ ok: true }));
    }

    // ---- PostgREST ----
    if (url.startsWith(`${SUPA_URL}/rest/v1/ticket_checkout_provider_attempts`)) {
      return Promise.resolve(jsonOk(opts.attempt === null ? [] : [opts.attempt]));
    }
    if (url.startsWith(`${SUPA_URL}/rest/v1/ticket_checkout_sessions`)) {
      if (method === "GET") return Promise.resolve(jsonOk([opts.session]));
      if (rawBody.includes('"failed"')) wire.sessionFailedPatches += 1;
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (url.startsWith(`${SUPA_URL}/rest/v1/event_rsvp_contributions`)) {
      return Promise.resolve(jsonOk([])); // not a chip-in reference
    }
    if (url.startsWith(`${SUPA_URL}/rest/v1/rpc/biz_ticket_checkout_finalize`)) {
      wire.finalizeCalls += 1;
      if (opts.finalizeMintsOrder !== false) opts.session.order_id = ORDER_ID;
      return Promise.resolve(jsonOk({ outcome: "finalized", orderId: ORDER_ID }));
    }
    if (url.startsWith(`${SUPA_URL}/rest/v1/tickets`)) {
      return Promise.resolve(jsonOk([{
        id: TICKET_ID,
        ticket_type_id: "tt-2198",
        qr_code: "mgl:2198:qr",
        status: "valid",
        ticket_types: { name: "General Admission" },
      }]));
    }
    if (url.startsWith(`${SUPA_URL}/rest/v1/orders`)) {
      return Promise.resolve(jsonOk([{ tax_amount_cents: 0 }]));
    }
    if (url.startsWith(`${SUPA_URL}/rest/v1/audit_log`)) {
      try {
        wire.auditActions.push(JSON.parse(rawBody));
      } catch { /* shape is not what this test measures */ }
      return Promise.resolve(new Response(null, { status: 201 }));
    }

    // Everything else (api-health, ad-conversion internals) — inert success.
    return Promise.resolve(jsonOk({}));
  };
  return { wire, restore: () => { globalThis.fetch = realFetch; } };
}

function confirmRequest(): Request {
  return new Request("https://edge.test/ticket-checkout-confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      checkoutSessionId: SESSION_ID,
      buyerStatusToken: BUYER_TOKEN,
    }),
  });
}

/** A verified, successful, correctly-priced bank-transfer charge. */
function paidBankTransfer(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    status: "success",
    reference: REFERENCE,
    amount: TOTAL_KOBO,
    currency: "NGN",
    channel: "bank_transfer", // the channel from the live evidence
    id: 4620183957,
    paid_at: "2026-08-18T01:41:05.000Z",
    gateway_response: "Approved",
    ...overrides,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// 1. THE ACCEPTANCE CASE: with the webhook suppressed ENTIRELY, the buyer
//    still receives tickets — in one round trip, not four minutes.
// ───────────────────────────────────────────────────────────────────────────
Deno.test({
  name:
    "#2198 · webhook SUPPRESSED · paid bank transfer → confirm verifies with Paystack and returns the tickets",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    assert(HANDLER !== null, "ticket-checkout-confirm handler captured");
    const { wire, restore } = installFetchStub({
      session: await paystackSessionRow(),
      attempt: paystackAttemptRow(),
      verifyData: paidBankTransfer(),
    });
    try {
      const res = await HANDLER!(confirmRequest());
      assertEquals(res.status, 200);
      const body = await res.json();

      // The whole point: NOT "pending".
      assertEquals(body.status, "paid");
      assertEquals(body.order?.orderId, ORDER_ID);
      assertEquals(body.order?.tickets?.length, 1);
      assertEquals(body.order?.tickets?.[0]?.ticketId, TICKET_ID);

      // Paystack was actually asked, at the stored reference.
      assertEquals(wire.verifyCalls.length, 1);
      assert(
        wire.verifyCalls[0].endsWith(`/transaction/verify/${REFERENCE}`),
        `verified the stored provider_reference, got ${wire.verifyCalls[0]}`,
      );
      // The SHARED finalize ran exactly once. No webhook was involved.
      assertEquals(wire.finalizeCalls, 1);
      // The buyer's email + SMS were dispatched by the path that minted.
      assertEquals(wire.dispatchCalls, 1);
    } finally {
      restore();
    }
  },
});

// ───────────────────────────────────────────────────────────────────────────
// 2. NEVER TRUST THE CLIENT. Two shapes of "a guest hand-writes ?cs=paystack".
// ───────────────────────────────────────────────────────────────────────────
Deno.test({
  name:
    "#2198 · forged ?cs=paystack on a session that never went to Paystack → no verify, no finalize, no order",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    assert(HANDLER !== null, "handler captured");
    const { wire, restore } = installFetchStub({
      // A perfectly ordinary session that never claimed a Paystack attempt.
      session: await paystackSessionRow({ stripe_payment_intent_id: null }),
      attempt: null,
      verifyData: paidBankTransfer(),
    });
    try {
      const res = await HANDLER!(confirmRequest());
      const body = await res.json();
      assertEquals(body.status, "pending");
      assertEquals(body.order, null);
      // The query parameter bought the guest nothing: Paystack was never even
      // asked, because provider identity comes from the server's attempt row.
      assertEquals(wire.verifyCalls.length, 0);
      assertEquals(wire.finalizeCalls, 0);
      assertEquals(wire.dispatchCalls, 0);
    } finally {
      restore();
    }
  },
});

Deno.test({
  name:
    "#2198 · forged ?cs=paystack on an UNPAID Paystack session → Paystack says not-success → no order",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    assert(HANDLER !== null, "handler captured");
    const { wire, restore } = installFetchStub({
      session: await paystackSessionRow(),
      attempt: paystackAttemptRow(),
      // The guest opened the payment page and never paid.
      verifyData: {
        status: "ongoing",
        reference: REFERENCE,
        amount: TOTAL_KOBO,
        currency: "NGN",
      },
    });
    try {
      const res = await HANDLER!(confirmRequest());
      const body = await res.json();
      assertEquals(body.status, "pending");
      assertEquals(body.order, null);
      assertEquals(wire.verifyCalls.length, 1); // asked …
      assertEquals(wire.finalizeCalls, 0); // … and believed the answer
      assertEquals(wire.dispatchCalls, 0);
    } finally {
      restore();
    }
  },
});

Deno.test({
  name:
    "#2198 · a forged success is impossible: the top-level `status: true` alone must not mint (data.status is the truth)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    assert(HANDLER !== null, "handler captured");
    // Paystack's own documentation is explicit: check `data.status==='success'`,
    // NOT the envelope's `status` — the envelope only says the API call worked.
    // (PaystackHQ/documentation receiving-payments/verifying-the-transaction.md)
    const { wire, restore } = installFetchStub({
      session: await paystackSessionRow(),
      attempt: paystackAttemptRow(),
      verifyData: {
        // NO `status` field at all inside data.
        reference: REFERENCE,
        amount: TOTAL_KOBO,
        currency: "NGN",
      },
    });
    try {
      const res = await HANDLER!(confirmRequest());
      const body = await res.json();
      assertEquals(body.status, "pending");
      assertEquals(body.order, null);
      assertEquals(wire.finalizeCalls, 0);
    } finally {
      restore();
    }
  },
});

// ───────────────────────────────────────────────────────────────────────────
// 3. EXACTLY ONE ORDER when verification AND the webhook both fire.
// ───────────────────────────────────────────────────────────────────────────
Deno.test({
  name:
    "#2198 · verify-then-finalize and webhook-then-finalize race → ONE order, ONE finalize that mints, ONE dispatch",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    assert(HANDLER !== null, "handler captured");
    const session = await paystackSessionRow();
    const { wire, restore } = installFetchStub({
      session,
      attempt: paystackAttemptRow(),
      verifyData: paidBankTransfer(),
    });
    try {
      // (a) The return leg wins the race and mints.
      const first = await HANDLER!(confirmRequest());
      const firstBody = await first.json();
      assertEquals(firstBody.status, "paid");
      assertEquals(firstBody.order?.orderId, ORDER_ID);
      assertEquals(wire.finalizeCalls, 1);

      // (b) The webhook lands 4 minutes later and routes through the SAME
      //     shared handler the webhook edge fn uses. The session now carries
      //     order_id, so it replays instead of minting a second order.
      const { handlePaystackChargeSuccess } = await import(
        "../paystackWebhookRouter.ts"
      );
      const { createClient } = await import(
        "https://esm.sh/@supabase/supabase-js@2"
      );
      const client = createClient(
        SUPA_URL,
        "test-service-role-key-not-real",
        { auth: { persistSession: false } },
      );
      const webhookResult = await handlePaystackChargeSuccess(
        client as never,
        { reference: REFERENCE },
        () => Promise.resolve(paidBankTransfer()),
      );
      assertEquals(webhookResult.status, "replayed");
      assertEquals(webhookResult.orderId, ORDER_ID);

      // (c) And a second buyer poll / refresh also replays.
      const third = await HANDLER!(confirmRequest());
      assertEquals((await third.json()).order?.orderId, ORDER_ID);

      // ONE mint across all three passes. The other two short-circuited on the
      // session's order_id — the existing idempotency, not a new mechanism.
      assertEquals(
        wire.finalizeCalls,
        1,
        "biz_ticket_checkout_finalize minted exactly once",
      );
      assertEquals(
        wire.dispatchCalls,
        1,
        "one confirmation dispatch → one email, one SMS",
      );
    } finally {
      restore();
    }
  },
});

// ───────────────────────────────────────────────────────────────────────────
// 4. AMOUNT / CURRENCY MUST MATCH — fail CLOSED.
// ───────────────────────────────────────────────────────────────────────────
Deno.test({
  name:
    "#2198 · verified amount ≠ session total → FAILS CLOSED (no order) and returns a bounded reason",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    assert(HANDLER !== null, "handler captured");
    const { wire, restore } = installFetchStub({
      session: await paystackSessionRow(),
      attempt: paystackAttemptRow(),
      // ₦1 paid against a ₦100 order.
      verifyData: paidBankTransfer({ amount: 100 }),
    });
    try {
      const res = await HANDLER!(confirmRequest());
      const body = await res.json();
      assertEquals(body.status, "failed");
      assertEquals(body.order, null);
      assertEquals(body.error, "paystack_payment_mismatch");
      assertEquals(wire.finalizeCalls, 0, "no order on a mismatch");
      assertEquals(wire.dispatchCalls, 0);
      assert(wire.sessionFailedPatches > 0, "the session was marked failed");
    } finally {
      restore();
    }
  },
});

Deno.test({
  name:
    "#2198 · verified currency ≠ NGN → FAILS CLOSED (no order)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    assert(HANDLER !== null, "handler captured");
    const { wire, restore } = installFetchStub({
      session: await paystackSessionRow(),
      attempt: paystackAttemptRow(),
      verifyData: paidBankTransfer({ currency: "GHS" }),
    });
    try {
      const res = await HANDLER!(confirmRequest());
      const body = await res.json();
      assertEquals(body.status, "failed");
      assertEquals(body.error, "paystack_payment_mismatch");
      assertEquals(wire.finalizeCalls, 0);
    } finally {
      restore();
    }
  },
});

// ───────────────────────────────────────────────────────────────────────────
// 5. A REAL REASON, NOT A SPINNER — the #2188 mapper's input tokens.
// ───────────────────────────────────────────────────────────────────────────
Deno.test({
  name:
    "#2198 · Paystack says `failed` → terminal `paystack_charge_failed`, not an endless spinner",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    assert(HANDLER !== null, "handler captured");
    const { wire, restore } = installFetchStub({
      session: await paystackSessionRow(),
      attempt: paystackAttemptRow(),
      verifyData: {
        status: "failed",
        reference: REFERENCE,
        amount: TOTAL_KOBO,
        currency: "NGN",
        gateway_response: "Declined",
      },
    });
    try {
      const res = await HANDLER!(confirmRequest());
      const body = await res.json();
      assertEquals(body.status, "failed");
      assertEquals(body.error, "paystack_charge_failed");
      assertEquals(wire.finalizeCalls, 0);
    } finally {
      restore();
    }
  },
});

Deno.test({
  name:
    "#2198 · Paystack says `abandoned` → terminal `paystack_charge_abandoned`",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    assert(HANDLER !== null, "handler captured");
    const { restore } = installFetchStub({
      session: await paystackSessionRow(),
      attempt: paystackAttemptRow(),
      verifyData: { status: "abandoned", reference: REFERENCE },
    });
    try {
      const body = await (await HANDLER!(confirmRequest())).json();
      assertEquals(body.status, "failed");
      assertEquals(body.error, "paystack_charge_abandoned");
    } finally {
      restore();
    }
  },
});

// ───────────────────────────────────────────────────────────────────────────
// 6. RESILIENCE — an unreachable Paystack must not strand or mis-fail a buyer.
// ───────────────────────────────────────────────────────────────────────────
Deno.test({
  name:
    "#2198 · Paystack unreachable → `pending` (keep polling; the webhook backstop is still live), never `failed`",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    assert(HANDLER !== null, "handler captured");
    const { wire, restore } = installFetchStub({
      session: await paystackSessionRow(),
      attempt: paystackAttemptRow(),
      verifyData: paidBankTransfer(),
      verifyThrows: true,
    });
    try {
      const body = await (await HANDLER!(confirmRequest())).json();
      assertEquals(body.status, "pending");
      assertEquals(body.order, null);
      assertEquals(body.error, undefined);
      assertEquals(wire.finalizeCalls, 0);
    } finally {
      restore();
    }
  },
});

// ───────────────────────────────────────────────────────────────────────────
// 7. THE STRIPE RAIL IS UNTOUCHED. This is the regression the change must not
//    cause: every non-Paystack session must short-circuit before any I/O.
// ───────────────────────────────────────────────────────────────────────────
Deno.test({
  name:
    "#2198 · a STRIPE session never touches Paystack — the resolver short-circuits before any network call",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    assert(HANDLER !== null, "handler captured");
    const { wire, restore } = installFetchStub({
      session: await paystackSessionRow({
        stripe_payment_intent_id: null,
        stripe_account_id: null,
        currency: "GBP",
      }),
      attempt: paystackAttemptRow({
        provider: "stripe",
        flow: "stripe_checkout",
        provider_reference: null,
      }),
      verifyData: paidBankTransfer(),
    });
    try {
      const body = await (await HANDLER!(confirmRequest())).json();
      // Same answer as before the change: no PI + no account → pending.
      assertEquals(body.status, "pending");
      assertEquals(wire.verifyCalls.length, 0, "Paystack was never called");
      assertEquals(wire.finalizeCalls, 0);
    } finally {
      restore();
    }
  },
});

// ───────────────────────────────────────────────────────────────────────────
// 8. The fast-path still wins: when the webhook already minted, confirm must
//    return the order WITHOUT asking Paystack again.
// ───────────────────────────────────────────────────────────────────────────
Deno.test({
  name:
    "#2198 · webhook already minted → confirm returns the order without a redundant verify",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    assert(HANDLER !== null, "handler captured");
    const { wire, restore } = installFetchStub({
      session: await paystackSessionRow({ order_id: ORDER_ID, status: "paid" }),
      attempt: paystackAttemptRow(),
      verifyData: paidBankTransfer(),
    });
    try {
      const body = await (await HANDLER!(confirmRequest())).json();
      assertEquals(body.status, "paid");
      assertEquals(body.order?.orderId, ORDER_ID);
      assertEquals(wire.verifyCalls.length, 0);
      assertEquals(wire.finalizeCalls, 0);
    } finally {
      restore();
    }
  },
});
