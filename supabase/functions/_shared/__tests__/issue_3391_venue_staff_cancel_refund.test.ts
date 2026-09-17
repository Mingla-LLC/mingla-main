// ISSUE-3391 — a venue cancelling a PAID booking refunds the guest in full.
//
// Drives the REAL `handleVenueStaffCancel` and the REAL #1221 runner
// (`runSourceRefundOperation`) against a recording service client, with the
// provider wire stubbed at `fetch` — the Stripe SDK and the Paystack adapter
// both speak through it, so what is asserted is the request each provider
// would actually receive.
//
//   V1  a malformed id is refused before any database call.
//   V2  every refusal literal the RPC raises maps to its HTTP status, and a
//       refused cancel never leases, runs, or reads a refund.
//   V3  Stripe: the lease is taken BEFORE any provider call; exactly one full
//       refund on the CONNECTED account with the attempt's idempotency key and
//       refund_application_fee=false; exactly one application-fee refund of
//       Mingla's fee with its own key; both legs recorded processed.
//   V4  Paystack: reconcile-first, then exactly one refund for the full amount
//       in naira with the attempt's merchant note; the fee leg is the ledger
//       allocation.
//   V5  a retry replays: no provider call at all, same refund back.
//   V6  a runner failure keeps the cancel and hands the refund to the sweep.
//   V7  the kill switch: no lease, no provider call.
//   V8  the edge function routes `actor: "venue"` here, AS THE HOST, and the
//       guest path's prepare-before-run order is untouched.
//   V9  every refusal literal in the migration's RPC has an HTTP mapping.
//   N1  the guest's cancellation notice says the refund is on its way, with the
//       right glyph; SMS stays GSM-7; an ordinary cancel keeps its old copy.
//
// FAILS-ON-REVERT: dropping the lease call turns V3's order assertion RED;
// passing refund_application_fee=true or a per-request key turns V3 RED;
// removing the `actor === "venue"` route turns V8 RED; removing the refund
// branch from the template turns N1 RED.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  handleVenueStaffCancel,
  VENUE_STAFF_CANCEL_ERROR_STATUS,
  venueStaffCancelErrorCode,
} from "../venueStaffCancelRefund.ts";
import {
  renderCategoryMessage,
  venueCancelRefundAmount,
} from "../notifyTemplates.ts";

const RESERVATION_ID = "5e3b1c7a-9d2f-4a6b-8c1d-3391aa000001";
const REFUND_ID = "7a1d2c3b-4e5f-4a6b-9c8d-3391bb000002";
const SESSION_ID = "9c8d7e6f-5a4b-4c3d-8e2f-3391cc000003";
const BRAND_ID = "1b2c3d4e-5f6a-4b7c-8d9e-3391dd000004";

type Call = { kind: string; name: string; args?: unknown };

function operationRow(
  provider: "stripe" | "paystack",
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const stripe = provider === "stripe";
  return {
    id: REFUND_ID,
    source_type: "venue_reservation",
    source_id: SESSION_ID,
    subject_id: RESERVATION_ID,
    brand_id: BRAND_ID,
    refund_kind: "venue_staff_cancel",
    provider,
    currency: stripe ? "USD" : "NGN",
    original_charge_cents: stripe ? 5000 : 2500000,
    original_application_fee_cents: stripe ? 500 : 250000,
    buyer_refund_requested_cents: stripe ? 5000 : 2500000,
    fee_reversal_required_cents: stripe ? 500 : 250000,
    buyer_state: "queued",
    fee_state: "queued",
    financial_state: "pending",
    active_buyer_attempt_no: 0,
    active_fee_attempt_no: 0,
    provider_payment_reference: stripe ? "pi_3391venue" : "mingla_resv_3391",
    provider_account_reference: stripe ? "acct_3391venue" : null,
    stripe_application_fee_id: null,
    provider_refund_id: null,
    requested_at: "2027-07-06T10:00:00.000Z",
    updated_at: "2027-07-06T10:00:00.000Z",
    processed_at: null,
    ops_status: "none",
    attention_generation: 0,
    ...overrides,
  };
}

function preparedSummary(provider: "stripe" | "paystack", replayed = false) {
  const row = operationRow(provider);
  return {
    cancelled: true,
    replayed,
    refund: {
      refund_id: REFUND_ID,
      refund_kind: "venue_staff_cancel",
      buyer_state: "queued",
      amount_cents: row.buyer_refund_requested_cents,
      currency: row.currency,
    },
  };
}

/** A recording service client. `claim` decides what the lease RPC returns. */
function serviceClient(opts: {
  calls: Call[];
  claim: Array<Record<string, unknown>> | "error";
  finalRow: Record<string, unknown> | null;
}) {
  class Query {
    constructor(private table: string) {}
    select(columns?: string) {
      opts.calls.push({ kind: "select", name: this.table, args: columns });
      return this;
    }
    eq() {
      return this;
    }
    is() {
      return this;
    }
    not() {
      return this;
    }
    in() {
      return this;
    }
    upsert() {
      return this;
    }
    single() {
      return Promise.resolve({ data: { id: "outbox-3391" }, error: null });
    }
    maybeSingle() {
      if (this.table === "source_refunds") {
        return Promise.resolve({ data: opts.finalRow, error: null });
      }
      if (this.table === "reservations") {
        return Promise.resolve({
          data: {
            consumer_user_id: null,
            guest_email: "guest-3391@example.test",
            guest_phone_e164: "+12015553391",
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    }
    then(resolve: (value: { data: unknown[]; error: null }) => unknown) {
      return Promise.resolve(resolve({ data: [], error: null }));
    }
  }
  return {
    rpc(name: string, args: Record<string, unknown>) {
      opts.calls.push({ kind: "rpc", name, args });
      if (name === "issue_3391_claim_source_refund_operation") {
        return Promise.resolve(
          opts.claim === "error"
            ? { data: null, error: { message: "boom" } }
            : { data: opts.claim, error: null },
        );
      }
      if (name === "ensure_source_refund_attempt") {
        const leg = String(args.p_leg_type);
        return Promise.resolve({
          data: {
            attempt_no: 1,
            idempotency_key: leg === "buyer_refund"
              ? `source_refund_buyer:${REFUND_ID}:1`
              : `source_refund_fee:${REFUND_ID}:1`,
            merchant_note: leg === "buyer_refund" &&
                String(args.p_refund_id) === REFUND_ID
              ? `mingla_source_refund:${REFUND_ID}:1`
              : null,
            provider_operation_id: null,
            reconcile_only: false,
          },
          error: null,
        });
      }
      if (name === "record_source_refund_provider_event") {
        return Promise.resolve({
          data: { source_refund_event_id: 33, attention_generation: 0 },
          error: null,
        });
      }
      return Promise.resolve({ data: {}, error: null });
    },
    from(table: string) {
      opts.calls.push({ kind: "from", name: table });
      return new Query(table);
    },
  };
}

type WireCall = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
};

async function withProviderWire(
  respond: (call: WireCall) => Response,
  run: (wire: WireCall[]) => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  const saved = new Map<string, string | undefined>();
  const env: Record<string, string> = {
    SOURCE_REFUNDS_POST_DISABLED: "false",
    MINGLA_STRIPE_MODE: "test",
    STRIPE_RAK_TICKET_REFUND_TEST: "rk_test_issue3391",
    PAYSTACK_MODE: "test",
    PAYSTACK_SECRET_KEY_TEST: "sk_test_issue3391",
  };
  for (const [key, value] of Object.entries(env)) {
    saved.set(key, Deno.env.get(key));
    Deno.env.set(key, value);
  }
  const wire: WireCall[] = [];
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const request = input instanceof Request
      ? input
      : new Request(String(input), init);
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => (headers[key] = value));
    const call = {
      method: request.method,
      url: request.url,
      headers,
      body: await request.clone().text(),
    };
    wire.push(call);
    return respond(call);
  }) as typeof fetch;
  try {
    await run(wire);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of saved) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "request-id": "req_3391" },
  });
}

Deno.test("V1 a malformed reservation id is refused before any database call", async () => {
  const calls: Call[] = [];
  const result = await handleVenueStaffCancel(
    { reservationId: "not-a-uuid" },
    {
      userRpc: (name, args) => {
        calls.push({ kind: "user_rpc", name, args });
        return Promise.resolve({ data: null, error: null });
      },
      service: serviceClient({ calls, claim: [], finalRow: null }),
    },
  );
  assertEquals(result.status, 400);
  assertEquals(calls.length, 0);
});

Deno.test("V2 each refusal maps to its status and nothing is leased, run or read", async () => {
  const expected: Array<[string, number]> = [
    ["not_authenticated", 401],
    ["not_authorized", 403],
    ["reservation_not_found", 404],
    ["not_a_paid_reservation", 409],
    ["already_refunded", 409],
    ["seated_no_auto_refund", 409],
    ["cancel_not_allowed", 409],
    ["payout_in_flight", 409],
    ["application_fee_unrecorded", 409],
    ["payment_reference_missing", 409],
  ];
  for (const [literal, status] of expected) {
    const calls: Call[] = [];
    let ran = 0;
    const result = await handleVenueStaffCancel(
      { reservationId: RESERVATION_ID, reason: "Kitchen fire" },
      {
        userRpc: () =>
          Promise.resolve({ data: null, error: { message: literal } }),
        service: serviceClient({ calls, claim: [], finalRow: null }),
        postsEnabled: () => true,
        runOperation: () => {
          ran++;
          return Promise.resolve();
        },
      },
    );
    assertEquals(result.status, status, literal);
    assertEquals(result.body, { error: literal });
    assertEquals(calls, [], `${literal} touched the service client`);
    assertEquals(ran, 0);
  }
  const unknown = await handleVenueStaffCancel(
    { reservationId: RESERVATION_ID },
    {
      userRpc: () =>
        Promise.resolve({
          data: null,
          error: { message: "deadlock detected" },
        }),
      service: serviceClient({ calls: [], claim: [], finalRow: null }),
    },
  );
  assertEquals(unknown.status, 500);
  assertEquals(unknown.body, { error: "cancel_failed" });
});

Deno.test("V3 Stripe: leased first, one full connected-account refund and one fee refund, both keyed", async () => {
  const calls: Call[] = [];
  const events: string[] = [];
  let userCall: { name: string; args: Record<string, unknown> } | null = null;
  await withProviderWire((call) => {
    events.push(`wire:${call.method} ${new URL(call.url).pathname}`);
    const path = new URL(call.url).pathname;
    if (call.method === "GET" && path === "/v1/payment_intents/pi_3391venue") {
      return json({
        id: "pi_3391venue",
        object: "payment_intent",
        latest_charge: { id: "ch_3391venue", object: "charge" },
      });
    }
    if (call.method === "GET" && path === "/v1/charges/ch_3391venue") {
      return json({
        id: "ch_3391venue",
        object: "charge",
        amount: 5000,
        currency: "usd",
        application_fee: "fee_3391venue",
      });
    }
    if (
      call.method === "GET" && path === "/v1/application_fees/fee_3391venue"
    ) {
      return json({
        id: "fee_3391venue",
        object: "application_fee",
        account: "acct_3391venue",
        charge: "ch_3391venue",
        amount: 500,
        currency: "usd",
      });
    }
    if (call.method === "POST" && path === "/v1/refunds") {
      return json({
        id: "re_3391venue",
        object: "refund",
        amount: 5000,
        status: "succeeded",
      });
    }
    if (
      call.method === "POST" &&
      path === "/v1/application_fees/fee_3391venue/refunds"
    ) {
      return json({ id: "fr_3391venue", object: "fee_refund", amount: 500 });
    }
    return json(
      { error: { message: `unexpected ${call.method} ${path}` } },
      500,
    );
  }, async (wire) => {
    const service = serviceClient({
      calls,
      claim: [operationRow("stripe")],
      finalRow: operationRow("stripe", {
        buyer_state: "processed",
        fee_state: "processed",
        financial_state: "reconciled",
        processed_at: "2027-07-06T10:00:05.000Z",
      }),
    });
    const tracked = {
      ...service,
      rpc(name: string, args: Record<string, unknown>) {
        events.push(`rpc:${name}`);
        return service.rpc(name, args);
      },
    };
    const result = await handleVenueStaffCancel(
      { reservationId: RESERVATION_ID, reason: "Kitchen fire" },
      {
        userRpc: (name, args) => {
          userCall = { name, args };
          return Promise.resolve({
            data: preparedSummary("stripe"),
            error: null,
          });
        },
        service: tracked,
        workerId: "venue-staff-cancel:test",
      },
    );

    // The cancel ran AS THE HOST, through the refund-owning RPC.
    assertEquals(userCall, {
      name: "biz_venue_cancel_paid_reservation",
      args: { p_reservation_id: RESERVATION_ID, p_reason: "Kitchen fire" },
    });

    // Lease before the first provider byte.
    const lease = events.indexOf(
      "rpc:issue_3391_claim_source_refund_operation",
    );
    const firstWire = events.findIndex((event) => event.startsWith("wire:"));
    assert(
      lease >= 0 && firstWire > lease,
      `lease must precede the wire: ${events}`,
    );

    const refunds = wire.filter((call) =>
      call.method === "POST" && new URL(call.url).pathname === "/v1/refunds"
    );
    assertEquals(refunds.length, 1, "exactly one buyer refund");
    const refundBody = new URLSearchParams(refunds[0].body);
    assertEquals(refundBody.get("payment_intent"), "pi_3391venue");
    assertEquals(refundBody.get("amount"), "5000");
    assertEquals(refundBody.get("refund_application_fee"), "false");
    assertEquals(refunds[0].headers["stripe-account"], "acct_3391venue");
    assertEquals(
      refunds[0].headers["idempotency-key"],
      `source_refund_buyer:${REFUND_ID}:1`,
    );

    const feeRefunds = wire.filter((call) =>
      call.method === "POST" &&
      new URL(call.url).pathname ===
        "/v1/application_fees/fee_3391venue/refunds"
    );
    assertEquals(feeRefunds.length, 1, "exactly one application-fee refund");
    assertEquals(new URLSearchParams(feeRefunds[0].body).get("amount"), "500");
    assertEquals(
      feeRefunds[0].headers["idempotency-key"],
      `source_refund_fee:${REFUND_ID}:1`,
    );
    // The fee refund is the PLATFORM's object, never sent as the venue.
    assertEquals(feeRefunds[0].headers["stripe-account"], undefined);

    const recorded = calls.filter((call) =>
      call.name === "record_source_refund_provider_event"
    ).map((call) => {
      const args = call.args as Record<string, unknown>;
      return [args.p_leg_type, args.p_next_state, args.p_amount_observed_cents];
    });
    assertEquals(recorded, [
      ["buyer_refund", "processed", 5000],
      ["application_fee_reversal", "processed", 500],
    ]);

    assertEquals(result.status, 200);
    assertEquals(result.body.runner, "ran");
    assertEquals(result.body.cancelled, true);
    assertEquals(result.body.replayed, false);
    const refund = result.body.refund as Record<string, unknown>;
    assertEquals(refund.refund_id, REFUND_ID);
    assertEquals(refund.refund_kind, "venue_staff_cancel");
    assertEquals(refund.buyer_state, "processed");
    assertEquals(refund.amount_cents, 5000);
    assertEquals(refund.public_message_code, "refund_processed");
  });
});

Deno.test("V4 Paystack: reconcile first, then one full naira refund with the attempt's note", async () => {
  const calls: Call[] = [];
  await withProviderWire((call) => {
    const url = new URL(call.url);
    if (
      call.method === "GET" &&
      url.pathname === "/transaction/verify/mingla_resv_3391"
    ) {
      return json({
        status: true,
        data: {
          id: 3391001,
          reference: "mingla_resv_3391",
          status: "success",
          currency: "NGN",
          amount: 2500000,
        },
      });
    }
    if (call.method === "GET" && url.pathname === "/refund") {
      return json({ status: true, data: [] });
    }
    if (call.method === "POST" && url.pathname === "/refund") {
      return json({
        status: true,
        data: {
          id: 99331,
          amount: 2500000,
          status: "pending",
          currency: "NGN",
          transaction: 3391001,
        },
      });
    }
    return json({ status: false, message: `unexpected ${url.pathname}` }, 500);
  }, async (wire) => {
    const result = await handleVenueStaffCancel(
      { reservationId: RESERVATION_ID },
      {
        userRpc: () =>
          Promise.resolve({ data: preparedSummary("paystack"), error: null }),
        service: serviceClient({
          calls,
          claim: [operationRow("paystack")],
          finalRow: operationRow("paystack", {
            buyer_state: "provider_pending",
            fee_state: "processed",
          }),
        }),
      },
    );
    const posts = wire.filter((call) => call.method === "POST");
    assertEquals(posts.length, 1, "exactly one Paystack refund");
    const firstPost = wire.findIndex((call) => call.method === "POST");
    const listing = wire.findIndex((call) =>
      call.method === "GET" && new URL(call.url).pathname === "/refund"
    );
    assert(listing >= 0 && listing < firstPost, "reconcile before create");
    const body = JSON.parse(posts[0].body);
    assertEquals(body, {
      transaction: "mingla_resv_3391",
      amount: 2500000,
      currency: "NGN",
      merchant_note: `mingla_source_refund:${REFUND_ID}:1`,
    });

    const recorded = calls.filter((call) =>
      call.name === "record_source_refund_provider_event"
    ).map((call) => {
      const args = call.args as Record<string, unknown>;
      return [args.p_leg_type, args.p_next_state, args.p_amount_observed_cents];
    });
    assertEquals(recorded, [
      ["buyer_refund", "provider_pending", 2500000],
      ["application_fee_reversal", "processed", 250000],
    ]);
    assertEquals(result.status, 202);
    assertEquals(result.body.runner, "ran");
    assertEquals(
      (result.body.refund as Record<string, unknown>).currency,
      "NGN",
    );
  });
});

Deno.test("V5 a retry replays the same refund and calls no provider", async () => {
  const calls: Call[] = [];
  await withProviderWire(
    () => json({ error: "no provider call expected" }, 500),
    async (wire) => {
      const result = await handleVenueStaffCancel(
        { reservationId: RESERVATION_ID },
        {
          userRpc: () =>
            Promise.resolve({
              data: preparedSummary("stripe", true),
              error: null,
            }),
          service: serviceClient({
            calls,
            // Already reconciled: the lease RPC refuses to hand it out again.
            claim: [],
            finalRow: operationRow("stripe", {
              buyer_state: "processed",
              fee_state: "processed",
              financial_state: "reconciled",
            }),
          }),
        },
      );
      assertEquals(wire.length, 0, "a replay must never reach a provider");
      assertEquals(result.body.replayed, true);
      assertEquals(result.body.runner, "settled");
      assertEquals(
        (result.body.refund as Record<string, unknown>).refund_id,
        REFUND_ID,
      );
      assertEquals(
        calls.filter((call) => call.name === "ensure_source_refund_attempt")
          .length,
        0,
      );
    },
  );
});

Deno.test("V6 a runner failure keeps the cancel and hands the refund to the sweep", async () => {
  const calls: Call[] = [];
  const result = await handleVenueStaffCancel(
    { reservationId: RESERVATION_ID },
    {
      userRpc: () =>
        Promise.resolve({ data: preparedSummary("stripe"), error: null }),
      service: serviceClient({
        calls,
        claim: [operationRow("stripe")],
        finalRow: operationRow("stripe", { buyer_state: "failed_retryable" }),
      }),
      postsEnabled: () => true,
      runOperation: () =>
        Promise.reject(new Error("stripe_unavailable:socket hang up")),
    },
  );
  const retry = calls.find((call) =>
    call.name === "schedule_source_refund_retry"
  );
  assertEquals(
    (retry?.args as Record<string, unknown>)?.p_safe_reason_code,
    "stripe_unavailable",
  );
  assertEquals(result.status, 202);
  assertEquals(result.body.cancelled, true);
  assertEquals(result.body.runner, "deferred");
});

Deno.test("V7 with refund posts disabled nothing is leased and no provider is called", async () => {
  const calls: Call[] = [];
  let ran = 0;
  const result = await handleVenueStaffCancel(
    { reservationId: RESERVATION_ID },
    {
      userRpc: () =>
        Promise.resolve({ data: preparedSummary("stripe"), error: null }),
      service: serviceClient({
        calls,
        claim: [operationRow("stripe")],
        finalRow: operationRow("stripe"),
      }),
      postsEnabled: () => false,
      runOperation: () => {
        ran++;
        return Promise.resolve();
      },
    },
  );
  assertEquals(ran, 0);
  assertEquals(
    calls.some((call) =>
      call.name === "issue_3391_claim_source_refund_operation"
    ),
    false,
  );
  assertEquals(result.body.runner, "posts_disabled");
  assertEquals(result.status, 202);
});

Deno.test("V8 the edge function routes the venue actor here, as the host, without disturbing the guest path", async () => {
  const source = await Deno.readTextFile(
    new URL("../../venue-reservation-cancel/index.ts", import.meta.url),
  );
  const route = source.indexOf('body.actor === "venue"');
  const guestPrepare = source.indexOf(
    '"pg_prepare_my_venue_cancellation_refund"',
  );
  const guestRun = source.indexOf("await runSourceRefundOperation(");
  assert(route > 0, "venue actor route missing");
  assert(
    route < guestPrepare,
    "the host route must return before the guest path",
  );
  assert(
    guestPrepare < guestRun,
    "guest path must still prepare before it runs",
  );
  const hostBlock = source.slice(route, guestPrepare);
  assertStringIncludes(hostBlock, "userIdFromAuthHeader(req)");
  assertStringIncludes(hostBlock, "not_authenticated");
  assertStringIncludes(hostBlock, "handleVenueStaffCancel(");
  assertStringIncludes(hostBlock, "userClient(req).rpc(fn, args)");
  // The host path never mints or runs money itself.
  assert(!hostBlock.includes("serviceClient().rpc("));
  assert(!hostBlock.includes("runSourceRefundOperation"));
});

Deno.test("V9 every refusal the RPC can raise has an HTTP mapping", async () => {
  const migration = await Deno.readTextFile(
    new URL(
      "../../../migrations/20270710003391_issue_3391_venue_staff_cancel_refund.sql",
      import.meta.url,
    ),
  );
  const start = migration.indexOf(
    "CREATE OR REPLACE FUNCTION public.biz_venue_cancel_paid_reservation(",
  );
  const end = migration.indexOf(
    "COMMENT ON FUNCTION public.biz_venue_cancel_paid_reservation",
    start,
  );
  assert(start > 0 && end > start);
  const literals = [
    ...migration.slice(start, end).matchAll(/RAISE EXCEPTION '([a-z_]+)'/g),
  ].map((match) => match[1]);
  assert(
    literals.length >= 8,
    `expected the refusal literals, found ${literals}`,
  );
  for (const literal of literals) {
    assert(
      literal in VENUE_STAFF_CANCEL_ERROR_STATUS,
      `${literal} has no HTTP mapping`,
    );
    assertEquals(venueStaffCancelErrorCode(`ERROR: ${literal}`), literal);
  }
});

Deno.test("N1 the guest notice says the refund is on its way, with the right glyph", () => {
  const base = {
    brand_name: "The Bistro",
    reserved_for: "2027-07-10T19:30:00Z",
    cancelled_by: "venue",
  };
  const usd = renderCategoryMessage("buyer_reservation_cancelled", {
    ...base,
    refund_amount_cents: 5000,
    refund_currency: "USD",
  });
  assertEquals(
    usd.push.body,
    "The venue cancelled your reservation. Your $50.00 refund is on its way.",
  );
  assertStringIncludes(
    usd.email.body,
    "The venue cancelled your reservation. Your $50.00 refund is on its way.",
  );
  assertEquals(
    usd.sms,
    "The Bistro: The venue cancelled your reservation. Your $50.00 refund is on its way.",
  );

  const ngn = renderCategoryMessage("buyer_reservation_cancelled", {
    ...base,
    refund_amount_cents: 2500000,
    refund_currency: "NGN",
  });
  assertEquals(
    ngn.push.body,
    "The venue cancelled your reservation. Your ₦25,000.00 refund is on its way.",
  );
  assert(!ngn.push.body.includes("NGN"));
  // SMS is authored GSM-7 clean; "₦" is not in that alphabet.
  assertStringIncludes(ngn.sms, "Your NGN 25,000.00 refund is on its way.");
  assert(!ngn.sms.includes("₦"));

  assertEquals(
    venueCancelRefundAmount({
      ...base,
      refund_amount_cents: 5000,
      refund_currency: "GBP",
    }),
    "£50.00",
  );

  // An ordinary cancellation (no refund fields) keeps COPY §3.2 exactly.
  const plain = renderCategoryMessage("buyer_reservation_cancelled", {
    brand_name: "The Bistro",
    reserved_for: "2027-07-10T19:30:00Z",
  });
  assertStringIncludes(plain.email.body, "Questions? Contact the venue.");
  assert(!plain.push.body.includes("refund"));
  // A payload that is not a venue cancellation never claims a refund.
  assertEquals(
    venueCancelRefundAmount({
      refund_amount_cents: 5000,
      refund_currency: "USD",
    }),
    null,
  );
  assertEquals(
    venueCancelRefundAmount({
      ...base,
      refund_amount_cents: 0,
      refund_currency: "USD",
    }),
    null,
  );
});
