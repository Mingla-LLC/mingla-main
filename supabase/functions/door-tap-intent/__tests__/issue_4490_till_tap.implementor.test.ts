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
//
// TEST-MOD-APPROVED #4490 (08-O2 fix 1): the fake answers the new Till release
// switch read (issue_4490_till_enabled, on unless a test turns it off) and can
// fail the sweep's Till read; the O2F1 tests below are new (O2-T1: the switch
// closes create / location / the reader token for every role while cancel,
// complete and seen stay open; O2-T5: the sweep before the #4490 migrations).
//
// TEST-MOD-APPROVED #4490 (08-O3 fix 5): the fake answers the new "is this
// request id already another Till payment's" read (option reusedBy); one test
// appended at the end (O3F5-T1). Nothing else changed.
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
    tillOn?: boolean;
    sweepError?: { code: string; message: string };
    reusedBy?: string;
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
          op.filters.some(([f, c]) => f === "not.eq" && c === "till_payment_id")
        ) {
          return {
            data: opts.reusedBy ? { till_payment_id: opts.reusedBy } : null,
            error: null,
          };
        }
        if (
          op.filters.some(([f, c]) => f === "not.is" && c === "till_payment_id")
        ) {
          if (opts.sweepError) return { data: null, error: opts.sweepError };
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
      if (name === "issue_4490_till_enabled") {
        return { data: opts.tillOn ?? true, error: null };
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

// ---------------------------------------------------------------------------
// #4490 08-O2 fix 1
// ---------------------------------------------------------------------------
Deno.test("O2F1-T1a till create and location: with the Till off every role gets till_not_enabled, before rights and Stripe", async () => {
  for (const canSell of [true, false]) {
    const db = makeDb({ tillOn: false, canSell });
    const stripe = fakeStripe();
    const handler = createDoorTapIntentHandler({
      serviceClient: () => db,
      userIdFromAuthHeader: auth,
      stripe: () => stripe.client,
    });
    const create = await handler(post({
      action: "create",
      scope: "till",
      platform: "ios",
      venueId: VENUE,
      paymentId: PAYMENT,
      clientRequestId: REQ,
    }));
    assertEquals(create.status, 422);
    assertEquals((await create.json()).error, "till_not_enabled");
    const location = await handler(post({
      action: "location",
      scope: "till",
      platform: "ios",
      venueId: VENUE,
    }));
    assertEquals(location.status, 422);
    assertEquals((await location.json()).error, "till_not_enabled");
    assertEquals(stripe.calls.length, 0);
    assertEquals(db.rpcs.filter((r) => r.name === "issue_4490_can_sell").length, 0);
    assertEquals(db.opsOn("door_tap_intents", "insert").length, 0);
  }
});

Deno.test("O2F1-T1b the Till reader token: with the Till off every role gets till_not_enabled and no token", async () => {
  const { createTerminalConnectionTokenHandler } = await import(
    "../../terminal-connection-token/index.ts"
  );
  for (const canSell of [true, false]) {
    const stripe = fakeStripe();
    const res = await createTerminalConnectionTokenHandler({
      serviceClient: () => makeDb({ tillOn: false, canSell }),
      userIdFromAuthHeader: auth,
      stripe: () => stripe.client,
    } as never)(post({ scope: "till", venueId: VENUE, platform: "ios" }));
    assertEquals(res.status, 422);
    assertEquals((await res.json()).error, "till_not_enabled");
    assertEquals(stripe.calls.length, 0);
  }
});

Deno.test("O2F1-T1c money already moving is never stranded by the switch: cancel, complete and seen still work with the Till off", async () => {
  const intent = {
    id: INTENT,
    till_payment_id: PAYMENT,
    client_request_id: REQ,
    stripe_account_id: "acct_till1",
    status: "created",
    created_by: ACTOR,
  };
  const cancelDb = makeDb({ tillOn: false, intent });
  const cancelled = await createDoorTapIntentHandler({
    serviceClient: () => cancelDb,
    userIdFromAuthHeader: auth,
    stripe: () => fakeStripe({ retrievePi: (id) => ({ id, status: "requires_payment_method" }) }).client,
  })(post({ action: "cancel", scope: "till", paymentIntentId: "pi_door1", clientRequestId: REQ }));
  assertEquals(cancelled.status, 200);
  assertEquals((await cancelled.json()).status, "cancelled");
  assert(cancelDb.rpcs.some((r) => r.name === "issue_4490_till_card_cancel"));

  const completeDb = makeDb({ tillOn: false, intent });
  const completed = await createDoorTapIntentHandler({
    serviceClient: () => completeDb,
    userIdFromAuthHeader: auth,
    stripe: () =>
      fakeStripe({
        retrievePi: (id) => ({
          id,
          status: "succeeded",
          amount: 2350,
          amount_received: 2350,
          metadata: { mingla_till_payment_id: PAYMENT },
          latest_charge: { id: "ch_1", payment_method_details: { card_present: { brand: "visa", last4: "4242" } } },
        }),
      }).client,
  })(post({ action: "complete", scope: "till", paymentIntentId: "pi_door1", clientRequestId: REQ }));
  assertEquals(completed.status, 200);
  assert(completeDb.rpcs.some((r) => r.name === "issue_4490_till_tap_record"));

  const seenDb = makeDb({ tillOn: false, intent });
  const seen = await createDoorTapIntentHandler({
    serviceClient: () => seenDb,
    userIdFromAuthHeader: auth,
    stripe: () => fakeStripe().client,
  })(post({ action: "seen", scope: "till", paymentIntentId: "pi_door1", clientRequestId: REQ }));
  assertEquals(seen.status, 200);
  for (const db of [cancelDb, completeDb, seenDb]) {
    assertEquals(db.rpcs.filter((r) => r.name === "issue_4490_till_enabled").length, 0);
  }
});

const sweepRequest = () =>
  new Request("https://example.test/fn", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer svc" },
    body: JSON.stringify({ action: "sweep_unfinished" }),
  });

Deno.test("O2F1-T5 sweep before the #4490 migrations: a missing till_payment_id column is no Till rows, not a failure; any other error still counts", async () => {
  const run = async (sweepError: { code: string; message: string }) => {
    const res = await createDoorTapIntentHandler({
      serviceClient: () => makeDb({ sweepError }),
      userIdFromAuthHeader: auth,
      stripe: () => fakeStripe().client,
      serviceRoleKey: () => "svc",
      notify: () => Promise.resolve(undefined as never),
    })(sweepRequest());
    assertEquals(res.status, 200);
    return (await res.json()).swept as Record<string, number>;
  };
  const missing = await run({
    code: "42703",
    message: "column door_tap_intents.till_payment_id does not exist",
  });
  assertEquals(missing.failed, 0);
  const other = await run({ code: "57014", message: "canceling statement due to statement timeout" });
  assertEquals(other.failed, 1);
  // A 42703 about another column is a real failure, not the deploy gap.
  const otherColumn = await run({ code: "42703", message: "column door_tap_intents.buyer_name does not exist" });
  assertEquals(otherColumn.failed, 1);
});

Deno.test("O3F5-T1 till create: a request id already used for ANOTHER Till payment is refused 409 till_request_reused before anything is written or sent to Stripe", async () => {
  const db = makeDb({ reusedBy: "44900700-0000-4000-8000-0000000000d9" });
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
  assertEquals([res.status, (await res.json()).error], [
    409,
    "till_request_reused",
  ]);
  assertEquals(db.opsOn("door_tap_intents", "insert").length, 0);
  assertEquals(
    stripe.calls.filter((c) => c.method === "paymentIntents.create").length,
    0,
  );
});
