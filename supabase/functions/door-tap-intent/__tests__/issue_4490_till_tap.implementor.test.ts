// #4490 spec 08 O2 — door-tap-intent scope "till" with a mocked Stripe:
//   create: card_present direct charge on the connected account for the
//           carrier's total (never the body's), automatic capture, application
//           fee = the carrier's Mingla fees, metadata carries
//           mingla_venue_order_id (the carrier), idempotency till_tap:<req>.
//   complete: records only a succeeded PaymentIntent, through
//           issue_4490_till_tap_record (card brand and last four only).
//   cancel: Stripe first (till_tap_cancel:<req>), then the Till payment.
//   sweep:  Till rows are cancelled with till_tap_sweep_cancel:<intentId> and
//           the seller is told; event rows are read by their own query.
//   Event scope requests never reach the till handlers.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { createDoorTapIntentHandler } from "../index.ts";
import {
  type DbOp,
  FakeDb,
  fakeStripe,
  post,
} from "../../_shared/__tests__/doorPayFakes.ts";

const VENUE = "44900700-0000-4000-8000-0000000000a1";
const BRAND = "44900700-0000-4000-8000-0000000000b1";
const SALE = "44900700-0000-4000-8000-0000000000c1";
const PAYMENT = "44900700-0000-4000-8000-0000000000d1";
const CARRIER = "44900700-0000-4000-8000-0000000000d2";
const ACTOR = "44900700-0000-4000-8000-0000000000e1";
const REQ = "44900700-0000-4000-8000-0000000000e2";
const INTENT = "44900700-0000-4000-8000-0000000000e3";

function makeDb(
  opts: {
    canSell?: boolean;
    intent?: Record<string, unknown> | null;
    sweepRows?: unknown[];
  } = {},
) {
  return new FakeDb(
    (op: DbOp) => {
      if (op.table === "venue_till_payments") {
        if (
          op.filters.some(([, c]) => c === "id") &&
          JSON.stringify(op).includes("venue_till_sales") === false
        ) {
          return {
            data: {
              id: PAYMENT,
              sale_id: SALE,
              method: "tap",
              state: "pending",
              carrier_order_id: CARRIER,
              taken_by_user_id: ACTOR,
              venue_till_sales: { venue_id: VENUE },
            },
            error: null,
          };
        }
        return { data: { venue_till_sales: { venue_id: VENUE } }, error: null };
      }
      if (op.table === "venue_till_sales") {
        return {
          data: {
            id: SALE,
            venue_id: VENUE,
            brand_id: BRAND,
            check_label: "Ada",
          },
          error: null,
        };
      }
      if (op.table === "venue_orders" && op.action === "select") {
        return {
          data: {
            id: CARRIER,
            total_cents: 2350,
            currency: "GBP",
            stripe_account_id: "acct_till1",
            mingla_fee_cents: 32,
            platform_service_fee_cents: 63,
            provider: "stripe",
          },
          error: null,
        };
      }
      if (op.table === "brands") {
        return {
          data: {
            id: BRAND,
            name: "Till Brand",
            address: "1 High St",
            city: "London",
            country_code: "GB",
            payment_country: "GB",
            payout_country: "GB",
            payment_provider: "stripe",
            stripe_connect_id: "acct_till1",
            stripe_charges_enabled: true,
            tap_location_address: {
              line1: "1 High St",
              city: "London",
              postal_code: "N1 1AA",
              country: "GB",
            },
          },
          error: null,
        };
      }
      if (op.table === "venue_listings") {
        return {
          data: {
            address: "1 High St",
            city: "London",
            country_code: "GB",
            brand_id: BRAND,
          },
          error: null,
        };
      }
      if (op.table === "brand_terminal_locations" && op.action === "select") {
        return { data: null, error: null };
      }
      if (op.table === "door_tap_intents" && op.action === "select") {
        if (
          op.filters.some(([f, c]) => f === "not.is" && c === "till_payment_id")
        ) {
          return { data: opts.sweepRows ?? [], error: null };
        }
        if (op.filters.some(([f]) => f === "not.is")) {
          return { data: [], error: null };
        }
        if (op.filters.some(([, c]) => c === "stripe_payment_intent_id")) {
          return { data: opts.intent ?? null, error: null };
        }
        return { data: null, error: null };
      }
      if (op.table === "door_tap_intents" && op.action === "insert") {
        return { data: { id: INTENT }, error: null };
      }
      if (op.table === "door_tap_intents" && op.action === "update") {
        return { data: [{ id: INTENT }], error: null };
      }
      return { data: null, error: null };
    },
    (name) => {
      if (name === "issue_4490_can_sell") {
        return { data: opts.canSell ?? true, error: null };
      }
      if (name === "biz_tap_to_pay_release") {
        return { data: { iphone: true, android: true }, error: null };
      }
      if (name === "issue_4490_till_tap_record") {
        return {
          data: { paymentId: PAYMENT, state: "paid", replayed: false },
          error: null,
        };
      }
      if (name === "issue_4490_till_card_cancel") {
        return {
          data: { paymentId: PAYMENT, state: "cancelled", sale: { id: SALE } },
          error: null,
        };
      }
      if (name === "issue_4490_till_card_close") {
        return { data: true, error: null };
      }
      return { data: null, error: null };
    },
  );
}

const auth = () => Promise.resolve(ACTOR);

Deno.test("O2-T1 till create: card_present direct charge for the carrier total, fee from the carrier, carrier in metadata", async () => {
  const db = makeDb();
  const stripe = fakeStripe();
  const res = await createDoorTapIntentHandler({
    serviceClient: () => db,
    userIdFromAuthHeader: auth,
    stripe: () => stripe.client,
  })(
    post({
      action: "create",
      scope: "till",
      platform: "ios",
      venueId: VENUE,
      paymentId: PAYMENT,
      clientRequestId: REQ,
      amount: 1,
      totalCents: 1,
    }),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.totalCents, 2350);
  const pi = stripe.calls.find((c) => c.method === "paymentIntents.create")!;
  const params = pi.params as Record<string, unknown>;
  assertEquals(params.amount, 2350);
  assertEquals(params.payment_method_types, ["card_present"]);
  assertEquals(params.capture_method, "automatic");
  assertEquals(params.application_fee_amount, 95);
  const metadata = params.metadata as Record<string, string>;
  assertEquals(metadata.mingla_venue_order_id, CARRIER);
  assertEquals(metadata.mingla_till_payment_id, PAYMENT);
  assertEquals(metadata.mingla_door_tap, undefined);
  assertEquals(pi.options, {
    stripeAccount: "acct_till1",
    idempotencyKey: `till_tap:${REQ}`,
  });
  const insert = db.opsOn("door_tap_intents", "insert")[0].payload as Record<
    string,
    unknown
  >;
  assertEquals(insert.event_id, null);
  assertEquals(insert.till_payment_id, PAYMENT);
  assertEquals(insert.lines, [{ kind: "till_payment", paymentId: PAYMENT }]);
  // The carrier learns its PaymentIntent so the webhook and the finalizer match.
  const carrierUpdate = db.opsOn("venue_orders", "update")[0].payload as Record<
    string,
    unknown
  >;
  assertEquals(carrierUpdate.stripe_payment_intent_id, "pi_door1");
});

Deno.test("O2-T2 till create: someone who may not sell at the venue is refused before Stripe", async () => {
  const db = makeDb({ canSell: false });
  const stripe = fakeStripe();
  const res = await createDoorTapIntentHandler({
    serviceClient: () => db,
    userIdFromAuthHeader: auth,
    stripe: () => stripe.client,
  })(
    post({
      action: "create",
      scope: "till",
      platform: "ios",
      venueId: VENUE,
      paymentId: PAYMENT,
      clientRequestId: REQ,
    }),
  );
  assertEquals(res.status, 400);
  assertEquals(stripe.calls.length, 0);
});

Deno.test("O2-T3 till complete records only a succeeded PaymentIntent, with brand and last four", async () => {
  const intent = {
    id: INTENT,
    till_payment_id: PAYMENT,
    client_request_id: REQ,
    stripe_account_id: "acct_till1",
    status: "created",
    created_by: ACTOR,
  };
  const pending = fakeStripe({
    retrievePi: (id) => ({
      id,
      status: "requires_payment_method",
      metadata: { mingla_till_payment_id: PAYMENT },
    }),
  });
  const db1 = makeDb({ intent });
  const refused = await createDoorTapIntentHandler({
    serviceClient: () => db1,
    userIdFromAuthHeader: auth,
    stripe: () => pending.client,
  })(
    post({
      action: "complete",
      scope: "till",
      paymentIntentId: "pi_door1",
      clientRequestId: REQ,
    }),
  );
  assertEquals(refused.status, 409);
  assertEquals(
    db1.rpcs.filter((r) => r.name === "issue_4490_till_tap_record").length,
    0,
  );
  const paid = fakeStripe({
    retrievePi: (id) => ({
      id,
      status: "succeeded",
      amount_received: 2350,
      metadata: { mingla_till_payment_id: PAYMENT },
      latest_charge: {
        id: "ch_1",
        payment_method_details: {
          card_present: {
            brand: "visa",
            last4: "4242",
            fingerprint: "never-stored",
          },
        },
      },
    }),
  });
  const db2 = makeDb({ intent });
  const ok = await createDoorTapIntentHandler({
    serviceClient: () => db2,
    userIdFromAuthHeader: auth,
    stripe: () => paid.client,
  })(
    post({
      action: "complete",
      scope: "till",
      paymentIntentId: "pi_door1",
      clientRequestId: REQ,
    }),
  );
  assertEquals(ok.status, 200);
  const rec = db2.rpcs.find((r) => r.name === "issue_4490_till_tap_record")!;
  assertEquals(rec.args, {
    p_payment_intent_id: "pi_door1",
    p_charge_id: "ch_1",
    p_amount: 2350,
    p_card_brand: "visa",
    p_last4: "4242",
  });
});

Deno.test("O2-T4 till cancel: Stripe first with its own key, then the Till payment", async () => {
  const intent = {
    id: INTENT,
    till_payment_id: PAYMENT,
    client_request_id: REQ,
    stripe_account_id: "acct_till1",
    status: "created",
    created_by: ACTOR,
  };
  const stripe = fakeStripe({
    retrievePi: (id) => ({ id, status: "requires_payment_method" }),
  });
  const db = makeDb({ intent });
  const res = await createDoorTapIntentHandler({
    serviceClient: () => db,
    userIdFromAuthHeader: auth,
    stripe: () => stripe.client,
  })(
    post({
      action: "cancel",
      scope: "till",
      paymentIntentId: "pi_door1",
      clientRequestId: REQ,
    }),
  );
  assertEquals(res.status, 200);
  const cancel = stripe.calls.find((c) =>
    c.method === "paymentIntents.cancel"
  )!;
  assertEquals(
    (cancel.options as Record<string, string>).idempotencyKey,
    `till_tap_cancel:${REQ}`,
  );
  assert(
    db.rpcs.some((r) =>
      r.name === "issue_4490_till_card_cancel" &&
      r.args.p_payment_id === PAYMENT
    ),
  );
});

Deno.test("O2-T5 sweep: an unfinished Till tap is cancelled at Stripe first, then the payment, and the seller is told", async () => {
  const notified: Array<Record<string, unknown>> = [];
  const stripe = fakeStripe({
    retrievePi: (id) => ({ id, status: "requires_payment_method" }),
  });
  const db = makeDb({
    sweepRows: [{
      id: INTENT,
      brand_id: BRAND,
      till_payment_id: PAYMENT,
      stripe_payment_intent_id: "pi_door1",
      stripe_account_id: "acct_till1",
      created_by: ACTOR,
      status: "created",
    }],
  });
  const req = new Request("https://example.test/fn", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer svc",
    },
    body: JSON.stringify({ action: "sweep_unfinished" }),
  });
  const res = await createDoorTapIntentHandler({
    serviceClient: () => db,
    userIdFromAuthHeader: auth,
    stripe: () => stripe.client,
    serviceRoleKey: () => "svc",
    notify: (
      n,
    ) => (notified.push(n as unknown as Record<string, unknown>),
      Promise.resolve(undefined as never)),
  })(req);
  assertEquals(res.status, 200);
  const cancel = stripe.calls.find((c) =>
    c.method === "paymentIntents.cancel"
  )!;
  assertEquals(
    (cancel.options as Record<string, string>).idempotencyKey,
    `till_tap_sweep_cancel:${INTENT}`,
  );
  assert(db.rpcs.some((r) => r.name === "issue_4490_till_card_close"));
  assertEquals(notified.length, 1);
  assertEquals(notified[0].type, "business.venue_till_tap_not_completed");
  // The event sweep reads event rows only.
  const eventReads = db.opsOn("door_tap_intents", "select").filter((o) =>
    o.filters.some(([f, c]) => f === "not.is" && c === "event_id")
  );
  assertEquals(eventReads.length, 2);
});

Deno.test("O2-T6 the Till's reader token is for sellers at the venue, on the same Location the sale names", async () => {
  const { createTerminalConnectionTokenHandler } = await import(
    "../../terminal-connection-token/index.ts"
  );
  const stripe = fakeStripe();
  const db = makeDb();
  const res = await createTerminalConnectionTokenHandler({
    serviceClient: () => db,
    userIdFromAuthHeader: auth,
    stripe: () => stripe.client,
  } as never)(post({ scope: "till", venueId: VENUE, platform: "ios" }));
  assertEquals(res.status, 200);
  const token = stripe.calls.find((c) =>
    c.method === "terminal.connectionTokens.create"
  )!;
  assertEquals((token.params as Record<string, string>).location, "tml_door1");
  assertEquals(
    (token.options as Record<string, string>).stripeAccount,
    "acct_till1",
  );
  const refused = await createTerminalConnectionTokenHandler({
    serviceClient: () => makeDb({ canSell: false }),
    userIdFromAuthHeader: auth,
    stripe: () => fakeStripe().client,
  } as never)(post({ scope: "till", venueId: VENUE, platform: "ios" }));
  assertEquals(refused.status, 400);
});
