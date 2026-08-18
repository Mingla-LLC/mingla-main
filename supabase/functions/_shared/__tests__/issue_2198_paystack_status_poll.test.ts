// issue #2198 [paystack-return-verify] — the NATIVE half of the same defect.
//
// `mingla-business/src/payments/nativeCheckoutFlow.native.ts` opens Paystack in
// an in-app browser and then polls `ticket-checkout-status` 17 times at 1.5s
// (`PAYSTACK_POLL_MAX_ATTEMPTS` / `PAYSTACK_POLL_INTERVAL_MS`) — a ~25 second
// budget — before giving up with "We couldn't confirm your payment yet."
//
// The live bank-transfer webhook took 4m 06s. So on the exact channel the
// evidence came from, the native buyer's poll budget expired roughly nine times
// over on a FULLY PAID charge, and the app told them their payment could not be
// confirmed. `ticket-checkout-status` contained no reference to Paystack; it
// answered `{ order: null }` on every one of those 17 calls.
//
// This drives the REAL `ticket-checkout-status` handler through the ORCH-1205
// serve shim against a stubbed network, and asserts the FIRST poll resolves.
//
// Run (repo root):
//   SUPABASE_URL=https://example-test.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=test-service-role-key-not-real \
//   PAYSTACK_MODE=test PAYSTACK_SECRET_KEY_TEST=sk_test_issue2198_status_secret \
//   deno test --import-map=supabase/functions/_shared/__tests__/_importmap.test.json \
//     --allow-read --allow-env --allow-net \
//     supabase/functions/_shared/__tests__/issue_2198_paystack_status_poll.test.ts
//
// FAILS-ON-REVERT: delete the `resolvePaystackTicketReturn(...)` block from
// `supabase/functions/ticket-checkout-status/index.ts` and the first two cases
// go RED — status answers `{ status: "awaiting_web_redirect", order: null }`
// for a paid charge, which is precisely the 25-second dead end.
//
// Owner: mingla-implementor. Issue: #2198.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { getCapturedHandler } from "./_serveShim.ts";

const SUPA_URL = "https://example-test.supabase.co";
const SECRET = "sk_test_issue2198_status_secret";

const SESSION_ID = "06fd4518-b4aa-48c8-b528-7f36f33dcbce";
const ORDER_ID = "56471853-07f8-4ed3-94c8-d83cd5260ad5";
const EVENT_ID = "e2198000-1111-4222-8333-444444444444";
const ATTEMPT_ID = "a2198000-1111-4222-8333-444444444444";
const TICKET_ID = "t2198000-1111-4222-8333-444444444444";
const BUYER_TOKEN = "buyer-status-token-issue-2198";
const REFERENCE = `mingla_${SESSION_ID}`;
const TOTAL_KOBO = 10000;

Deno.env.set("SUPABASE_URL", SUPA_URL);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key-not-real");
Deno.env.set("PAYSTACK_MODE", "test");
Deno.env.set("PAYSTACK_SECRET_KEY_TEST", SECRET);
Deno.env.set(
  "app.qr_token_pepper",
  "issue-2198-qr-token-pepper-value-long-enough",
);

await import("../../ticket-checkout-status/index.ts");
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

async function paystackSessionRow(
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  return {
    id: SESSION_ID,
    status: "awaiting_web_redirect",
    order_id: null,
    event_id: EVENT_ID,
    total_cents: TOTAL_KOBO,
    currency: "NGN",
    buyer_status_token_hash: await sha256Hex(BUYER_TOKEN),
    revoked_at: null,
    reversal_state: "none",
    stripe_payment_intent_id: REFERENCE,
    ...overrides,
  };
}

interface Wire {
  verifyCalls: number;
  finalizeCalls: number;
  dispatchCalls: number;
}

function installFetchStub(opts: {
  session: Record<string, unknown>;
  attempt: Record<string, unknown> | null;
  verifyData: Record<string, unknown>;
}): { wire: Wire; restore: () => void } {
  const wire: Wire = { verifyCalls: 0, finalizeCalls: 0, dispatchCalls: 0 };
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

    if (url.startsWith("https://api.paystack.co/transaction/verify/")) {
      wire.verifyCalls += 1;
      return Promise.resolve(jsonOk({
        status: true,
        message: "Verification successful",
        data: opts.verifyData,
      }));
    }
    if (
      url.startsWith(`${SUPA_URL}/functions/v1/ticket-confirmation-dispatch`)
    ) {
      wire.dispatchCalls += 1;
      return Promise.resolve(jsonOk({ ok: true }));
    }
    if (
      url.startsWith(`${SUPA_URL}/rest/v1/ticket_checkout_provider_attempts`)
    ) {
      return Promise.resolve(
        jsonOk(opts.attempt === null ? [] : [opts.attempt]),
      );
    }
    if (url.startsWith(`${SUPA_URL}/rest/v1/ticket_checkout_sessions`)) {
      if (method === "GET") return Promise.resolve(jsonOk([opts.session]));
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (url.startsWith(`${SUPA_URL}/rest/v1/event_rsvp_contributions`)) {
      return Promise.resolve(jsonOk([]));
    }
    if (
      url.startsWith(`${SUPA_URL}/rest/v1/rpc/biz_ticket_checkout_finalize`)
    ) {
      wire.finalizeCalls += 1;
      opts.session.order_id = ORDER_ID;
      return Promise.resolve(
        jsonOk({ outcome: "finalized", orderId: ORDER_ID }),
      );
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
    return Promise.resolve(jsonOk({}));
  };
  return {
    wire,
    restore: () => {
      globalThis.fetch = realFetch;
    },
  };
}

function statusRequest(): Request {
  return new Request("https://edge.test/ticket-checkout-status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      checkoutSessionId: SESSION_ID,
      buyerStatusToken: BUYER_TOKEN,
    }),
  });
}

/**
 * issue #2216 crossing — see the sibling suite's note. The native rail returns
 * the SAME ticket shape through the SAME `attachQrImageDataUrls` owner, and a
 * guest resolved instantly onto a blank pass is no better off than one who
 * waited four minutes for a good one. Nothing is stubbed: the QR really renders.
 */
const assertRenderedQr = (ticket: Record<string, unknown>): void => {
  const dataUrl = String(ticket?.qrImageDataUrl ?? "");
  assert(
    dataUrl.startsWith("data:image/png;base64,"),
    `qrImageDataUrl is not a PNG data URI (got ${
      JSON.stringify(dataUrl.slice(0, 40))
    })`,
  );
  assert(
    dataUrl.includes("base64,iVBORw0KGgo"),
    "qrImageDataUrl does not decode to a PNG",
  );
  assert(
    dataUrl.length > 500,
    `qrImageDataUrl is too short to be a rendered QR (${dataUrl.length} chars)`,
  );
};

function paidBankTransfer(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    status: "success",
    reference: REFERENCE,
    amount: TOTAL_KOBO,
    currency: "NGN",
    channel: "bank_transfer",
    id: 4620183957,
    paid_at: "2026-08-18T01:41:05.000Z",
    ...overrides,
  };
}

Deno.test({
  name:
    "#2198 · native poll #1 · paid bank transfer → status verifies and returns the order (not 17 empty polls)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    assert(HANDLER !== null, "ticket-checkout-status handler captured");
    const { wire, restore } = installFetchStub({
      session: await paystackSessionRow(),
      attempt: {
        id: ATTEMPT_ID,
        provider: "paystack",
        flow: "paystack_redirect",
        provider_reference: REFERENCE,
        state: "ready",
      },
      verifyData: paidBankTransfer(),
    });
    try {
      const res = await HANDLER!(statusRequest());
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body.status, "paid");
      assertEquals(body.order?.orderId, ORDER_ID);
      assertEquals(body.order?.tickets?.length, 1);
      assertEquals(body.order?.currency, "NGN");
      // #2216 crossing — the native guest's pass is scannable too.
      assertRenderedQr(body.order.tickets[0]);
      assertEquals(wire.verifyCalls, 1);
      assertEquals(wire.finalizeCalls, 1);
      assertEquals(wire.dispatchCalls, 1);
    } finally {
      restore();
    }
  },
});

Deno.test({
  name:
    "#2198 · native poll · a repeat poll after the mint replays the SAME order — no second finalize, no second email",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    assert(HANDLER !== null, "handler captured");
    const session = await paystackSessionRow();
    const { wire, restore } = installFetchStub({
      session,
      attempt: {
        id: ATTEMPT_ID,
        provider: "paystack",
        flow: "paystack_redirect",
        provider_reference: REFERENCE,
        state: "ready",
      },
      verifyData: paidBankTransfer(),
    });
    try {
      const first = await (await HANDLER!(statusRequest())).json();
      assertEquals(first.order?.orderId, ORDER_ID);
      // The client polls again 1.5s later (it already got its orderId, but a
      // slow render / retry can land another call).
      const second = await (await HANDLER!(statusRequest())).json();
      assertEquals(second.order?.orderId, ORDER_ID);
      assertRenderedQr(first.order.tickets[0]);
      assertRenderedQr(second.order.tickets[0]);
      assertEquals(wire.finalizeCalls, 1, "one mint across both polls");
      assertEquals(wire.dispatchCalls, 1, "one email, one SMS");
      assertEquals(wire.verifyCalls, 1, "the second poll took the fast-path");
    } finally {
      restore();
    }
  },
});

Deno.test({
  name:
    "#2198 · native poll · unpaid Paystack session → still `order: null`, and the guest is not handed value",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    assert(HANDLER !== null, "handler captured");
    const { wire, restore } = installFetchStub({
      session: await paystackSessionRow(),
      attempt: {
        id: ATTEMPT_ID,
        provider: "paystack",
        flow: "paystack_redirect",
        provider_reference: REFERENCE,
        state: "ready",
      },
      verifyData: { status: "ongoing", reference: REFERENCE },
    });
    try {
      const body = await (await HANDLER!(statusRequest())).json();
      assertEquals(body.order, null);
      assertEquals(body.status, "awaiting_web_redirect");
      assertEquals(wire.finalizeCalls, 0);
    } finally {
      restore();
    }
  },
});

Deno.test({
  name:
    "#2198 · native poll · a non-Paystack session never calls Paystack (the free / Stripe rails are unchanged)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    assert(HANDLER !== null, "handler captured");
    const { wire, restore } = installFetchStub({
      session: await paystackSessionRow({
        currency: "GBP",
        stripe_payment_intent_id: null,
        status: "requires_payment",
      }),
      attempt: null,
      verifyData: paidBankTransfer(),
    });
    try {
      const body = await (await HANDLER!(statusRequest())).json();
      assertEquals(body.order, null);
      assertEquals(body.status, "requires_payment");
      assertEquals(wire.verifyCalls, 0);
      assertEquals(wire.finalizeCalls, 0);
    } finally {
      restore();
    }
  },
});

Deno.test({
  name:
    "#2198 · native poll · a declined charge is terminal (`paystack_charge_failed`), so the app can stop polling",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    assert(HANDLER !== null, "handler captured");
    const { wire, restore } = installFetchStub({
      session: await paystackSessionRow(),
      attempt: {
        id: ATTEMPT_ID,
        provider: "paystack",
        flow: "paystack_redirect",
        provider_reference: REFERENCE,
        state: "ready",
      },
      verifyData: { status: "failed", reference: REFERENCE },
    });
    try {
      const body = await (await HANDLER!(statusRequest())).json();
      assertEquals(body.status, "failed");
      assertEquals(body.error, "paystack_charge_failed");
      assertEquals(body.order, null);
      assertEquals(wire.finalizeCalls, 0);
    } finally {
      restore();
    }
  },
});
