// ===========================================================================
// Issue #1790 (SPEC #1788 P-28, P-49.3, P-51) — the webhook branches, executed.
//
// Hermetic: a fake Supabase client captures every RPC and table call. No
// network, no Stripe, no Paystack. The assertions are on the WIRE — what was
// actually sent to the database — not on a transcript of intentions.
// ===========================================================================

import {
  assert,
  assertRejects,
  assertStrictEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  handleVenueOrderPaystackCharge,
  handleVenueOrderStripeEvent,
  isVenueOrderPaystackReference,
  isVenueOrderStripeEvent,
  VENUE_ORDER_PAYSTACK_PREFIX,
  venueOrderIdFromStripeEvent,
  venueOrderPaystackReference,
} from "../venueOrderWebhook.ts";

interface Capture {
  rpc: Array<{ name: string; args: Record<string, unknown> }>;
  updates: Array<{ table: string; values: Record<string, unknown>; filters: string[] }>;
}

// deno-lint-ignore no-explicit-any
function fakeClient(opts: {
  rpcResult?: unknown;
  rpcError?: { message: string } | null;
  rows?: Record<string, unknown> | null;
}): { client: any; capture: Capture } {
  const capture: Capture = { rpc: [], updates: [] };
  const builder = (table: string) => {
    const filters: string[] = [];
    const self: Record<string, unknown> = {};
    const chain = (key: string) => (col: string, val?: unknown) => {
      filters.push(`${key}:${col}=${String(val)}`);
      return self;
    };
    self.select = () => self;
    self.eq = chain("eq");
    self.is = chain("is");
    self.not = chain("not");
    self.maybeSingle = () => Promise.resolve({ data: opts.rows ?? null, error: null });
    self.single = () => Promise.resolve({ data: opts.rows ?? null, error: null });
    self.update = (values: Record<string, unknown>) => {
      capture.updates.push({ table, values, filters });
      return self;
    };
    return self;
  };
  const client = {
    from: (table: string) => builder(table),
    rpc: (name: string, args: Record<string, unknown>) => {
      capture.rpc.push({ name, args });
      return Promise.resolve({
        data: opts.rpcResult ?? null,
        error: opts.rpcError ?? null,
      });
    },
  };
  return { client, capture };
}

const ORDER_ID = "aaaaaaaa-1790-4aaa-8aaa-aaaaaaaaaaaa";

function piSucceeded(over: Record<string, unknown> = {}) {
  return {
    id: "evt_1",
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: "pi_1790",
        amount: 4500,
        amount_received: 4500,
        currency: "gbp",
        metadata: { mingla_venue_order_id: ORDER_ID },
        latest_charge: { id: "ch_1790", balance_transaction: { id: "txn_1", fee: 145 } },
        ...over,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Discrimination. A venue order must be recognised BEFORE the ticket finalize
// path, and a ticket charge must never look like one.
// ---------------------------------------------------------------------------
Deno.test("P-28: Stripe discrimination is by the mingla_venue_order_id marker only", () => {
  assert(isVenueOrderStripeEvent(piSucceeded()));
  assertStrictEquals(venueOrderIdFromStripeEvent(piSucceeded()), ORDER_ID);

  // A ticket order, an RSVP contribution and a stay reservation all carry OTHER
  // markers and must fall through untouched.
  for (
    const metadata of [
      {},
      { mingla_checkout_session_id: "cs_1" },
      { mingla_purpose: "rsvp_contribution", contribution_id: "c1" },
      { mingla_purpose: "stay_reservation", stay_payment_attempt_id: "a1" },
      { mingla_venue_order_id: "" },
      { mingla_venue_order_id: 42 },
    ]
  ) {
    assert(
      !isVenueOrderStripeEvent(piSucceeded({ metadata })),
      `metadata ${JSON.stringify(metadata)} must NOT route to the venue-order arm`,
    );
  }
});

Deno.test("P-28: Paystack discrimination is by the mingla_vo_ reference prefix", () => {
  assert(isVenueOrderPaystackReference(`${VENUE_ORDER_PAYSTACK_PREFIX}abc_123`));
  assert(isVenueOrderPaystackReference(venueOrderPaystackReference(ORDER_ID)));
  assert(venueOrderPaystackReference(ORDER_ID).includes(ORDER_ID));
  for (
    const ref of [
      "mingla_resv_abc",
      "mingla_stay_abc",
      "mingla_abc",
      "",
      null,
      undefined,
      42,
    ]
  ) {
    assert(
      !isVenueOrderPaystackReference(ref),
      `${String(ref)} must NOT route to the venue-order arm`,
    );
  }
});

// ---------------------------------------------------------------------------
// The Stripe finalize. ONE database function does the work; this asserts the
// exact arguments it receives, because that is what the money depends on.
// ---------------------------------------------------------------------------
Deno.test("P-28/P-49.3: a succeeded PaymentIntent finalizes with its REAL provider fee", async () => {
  const { client, capture } = fakeClient({
    rpcResult: { matched: true, status: "finalized", brandId: "brand-1" },
  });
  const brandId = await handleVenueOrderStripeEvent(client, piSucceeded());
  assertStrictEquals(brandId, "brand-1");
  assertStrictEquals(capture.rpc.length, 1);
  const call = capture.rpc[0];
  assertStrictEquals(call.name, "pg_venue_order_finalize_payment");
  assertStrictEquals(call.args.p_order_id, ORDER_ID);
  assertStrictEquals(call.args.p_provider, "stripe");
  assertStrictEquals(call.args.p_paid_amount_cents, 4500);
  assertStrictEquals(call.args.p_currency, "GBP");
  assertStrictEquals(call.args.p_charge_id, "ch_1790");
  assertStrictEquals(call.args.p_payment_intent_id, "pi_1790");
  assertStrictEquals(call.args.p_provider_fee_cents, 145);
  assertStrictEquals(call.args.p_provider_balance_transaction_id, "txn_1");
});

Deno.test("P-49.3: an UNEXPANDED balance transaction yields a NULL fee, never a zero", async () => {
  // This is the whole point. `balance_transaction` is an id string unless
  // expanded. Recording it as 0 would over-release the venue by exactly the
  // processing cost; the order must WAIT for the real number instead.
  const { client, capture } = fakeClient({
    rpcResult: { matched: true, status: "finalized", brandId: "brand-1" },
  });
  await handleVenueOrderStripeEvent(
    client,
    piSucceeded({ latest_charge: { id: "ch_1790", balance_transaction: "txn_9" } }),
  );
  assertStrictEquals(capture.rpc[0].args.p_provider_fee_cents, null);
  assertStrictEquals(capture.rpc[0].args.p_provider_balance_transaction_id, "txn_9");

  const bare = fakeClient({ rpcResult: { matched: true, status: "finalized" } });
  await handleVenueOrderStripeEvent(
    bare.client,
    piSucceeded({ latest_charge: "ch_only" }),
  );
  assertStrictEquals(bare.capture.rpc[0].args.p_provider_fee_cents, null);
  assertStrictEquals(bare.capture.rpc[0].args.p_charge_id, "ch_only");
});

Deno.test("P-28: a hosted Checkout completion finalizes on the same RPC", async () => {
  const { client, capture } = fakeClient({
    rpcResult: { matched: true, status: "finalized", brandId: "brand-2" },
  });
  const brandId = await handleVenueOrderStripeEvent(client, {
    id: "evt_2",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_1790",
        amount_total: 4500,
        currency: "gbp",
        payment_intent: "pi_1790",
        metadata: { mingla_venue_order_id: ORDER_ID },
      },
    },
  });
  assertStrictEquals(brandId, "brand-2");
  assertStrictEquals(capture.rpc[0].args.p_paid_amount_cents, 4500);
  assertStrictEquals(capture.rpc[0].args.p_payment_intent_id, "pi_1790");
  // A Checkout Session carries no charge object, so the fee is unknown here too.
  assertStrictEquals(capture.rpc[0].args.p_provider_fee_cents, null);
});

Deno.test("a failed or cancelled PaymentIntent marks ONLY a pending row failed", async () => {
  for (const type of ["payment_intent.payment_failed", "payment_intent.canceled"]) {
    const { client, capture } = fakeClient({ rows: { brand_id: "brand-3" } });
    const brandId = await handleVenueOrderStripeEvent(client, {
      id: "evt_3",
      type,
      data: { object: { id: "pi_x", metadata: { mingla_venue_order_id: ORDER_ID } } },
    });
    assertStrictEquals(brandId, "brand-3");
    assertStrictEquals(capture.rpc.length, 0, "a failure must never call the finalize RPC");
    assertStrictEquals(capture.updates.length, 1);
    assertStrictEquals(capture.updates[0].values.payment_status, "failed");
    // A paid order is NEVER un-paid by a late failure event.
    assert(
      capture.updates[0].filters.includes("eq:payment_status=pending"),
      "the failure update must be scoped to a still-pending row",
    );
  }
});

Deno.test("evidence that is not a real amount or currency is REFUSED, not guessed", async () => {
  for (
    const bad of [
      { amount_received: "lots", amount: undefined },
      { currency: "pounds" },
      { currency: "" },
      { amount_received: Number.NaN, amount: Number.NaN },
    ]
  ) {
    const { client, capture } = fakeClient({ rpcResult: {} });
    await assertRejects(
      () => handleVenueOrderStripeEvent(client, piSucceeded(bad)),
      Error,
      "venue_order_provider_evidence_invalid",
    );
    assertStrictEquals(capture.rpc.length, 0);
  }
});

Deno.test("a finalize RPC failure PROPAGATES so the inbox retries", async () => {
  const { client } = fakeClient({
    rpcError: { message: "deadlock detected" },
  });
  await assertRejects(
    () => handleVenueOrderStripeEvent(client, piSucceeded()),
    Error,
    "venue_order_finalize_failed",
  );
});

// ---------------------------------------------------------------------------
// The Paystack finalize. Its verify response carries the REAL fee, so unlike
// the Stripe rail the payout fee snapshot lands immediately.
// ---------------------------------------------------------------------------
Deno.test("P-28: a verified Paystack charge finalizes with the fee Paystack reported", async () => {
  const { client, capture } = fakeClient({
    rows: { id: ORDER_ID, brand_id: "brand-ng" },
    rpcResult: { matched: true, status: "finalized" },
  });
  const result = await handleVenueOrderPaystackCharge(
    client,
    `${VENUE_ORDER_PAYSTACK_PREFIX}${ORDER_ID}_abc`,
    { amount: 250000, currency: "NGN", fees: 3750, id: 998877, status: "success" },
  );
  assertStrictEquals(result.matched, true);
  assertStrictEquals(result.status, "finalized");
  assertStrictEquals(result.brandId, "brand-ng");
  const call = capture.rpc[0];
  assertStrictEquals(call.args.p_provider, "paystack");
  assertStrictEquals(call.args.p_paid_amount_cents, 250000);
  assertStrictEquals(call.args.p_currency, "NGN");
  assertStrictEquals(call.args.p_provider_fee_cents, 3750);
  assertStrictEquals(call.args.p_charge_id, "998877");
});

Deno.test("an unknown Paystack reference is reported unmatched, never finalized", async () => {
  const { client, capture } = fakeClient({ rows: null });
  const result = await handleVenueOrderPaystackCharge(
    client,
    `${VENUE_ORDER_PAYSTACK_PREFIX}nope`,
    { amount: 100, currency: "NGN", fees: 1 },
  );
  assertStrictEquals(result.matched, false);
  assertStrictEquals(result.status, "not_found");
  assertStrictEquals(capture.rpc.length, 0);
});

Deno.test("a Paystack response with no `fees` yields a NULL fee, not a zero", async () => {
  const { client, capture } = fakeClient({
    rows: { id: ORDER_ID, brand_id: "brand-ng" },
    rpcResult: { matched: true, status: "finalized" },
  });
  await handleVenueOrderPaystackCharge(
    client,
    `${VENUE_ORDER_PAYSTACK_PREFIX}${ORDER_ID}_abc`,
    { amount: 250000, currency: "NGN", id: 1 },
  );
  assertStrictEquals(capture.rpc[0].args.p_provider_fee_cents, null);
});
