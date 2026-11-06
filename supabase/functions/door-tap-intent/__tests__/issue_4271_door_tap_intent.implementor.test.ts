// Issue #4271 — door-tap-intent + terminal-connection-token + the webhook
// backstop, implementor happy path.
//   create: a card_present direct charge on the brand's account, server priced,
//           Mingla's flat fee as application_fee_amount, idempotent on the
//           client request id; Nigeria (Paystack) is refused.
//   complete: records only after Stripe says the PaymentIntent succeeded.
//   connection token: on the connected account, scoped to one stored Location.
//   webhook: payment_intent.succeeded with mingla_door_tap records the sale.
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { recordDoorCodeDecline } from "../../_shared/doorTapWebhook.ts";
import { createDoorTapIntentHandler } from "../index.ts";
import { createTerminalConnectionTokenHandler } from "../../terminal-connection-token/index.ts";
import {
  handleDoorTapStripeEvent,
  isDoorTapStripeEvent,
} from "../../_shared/doorTapWebhook.ts";
import {
  type DbOp,
  FakeDb,
  fakeStripe,
  post,
  PRICING_ROW,
} from "../../_shared/__tests__/doorPayFakes.ts";

const EVENT = "42710000-0000-4000-8000-0000000000a1";
const TIER = "42710000-0000-4000-8000-0000000000a2";
const BRAND = "42710000-0000-4000-8000-0000000000a3";
const ACTOR = "42710000-0000-4000-8000-0000000000a4";
const REQ = "42710000-0000-4000-8000-0000000000a5";
const INTENT = "42710000-0000-4000-8000-0000000000a6";

function brandRow(provider = "stripe", country = "US") {
  return {
    brand_id: BRAND,
    brands: {
      id: BRAND, name: "Door Brand", address: "1 Main St", city: "Austin",
      country_code: country, payment_country: country, payment_provider: provider,
      stripe_connect_id: "acct_door1", stripe_charges_enabled: true,
      payout_hold_cutover_at: null,
    },
  };
}

function makeDb(options: {
  pricing?: Record<string, unknown>;
  provider?: string;
  storedLocation?: string | null;
  intentRow?: Record<string, unknown> | null;
  existing?: Record<string, unknown> | null;
  eventsReadFails?: boolean;
} = {}) {
  return new FakeDb(
    (op: DbOp) => {
      if (op.table === "events" && options.eventsReadFails) {
        return { data: null, error: { message: "canceling statement due to statement timeout" } };
      }
      if (op.table === "events") {
        const row = brandRow(options.provider ?? "stripe");
        return {
          data: { ...row, brands: { ...row.brands, stripe_charges_enabled: true } },
          error: null,
        };
      }
      if (op.table === "brand_terminal_locations" && op.action === "select") {
        return {
          data: options.storedLocation ? { stripe_location_id: options.storedLocation } : null,
          error: null,
        };
      }
      if (op.table === "door_tap_intents" && op.action === "select") {
        const byPi = op.filters.some(([, c]) => c === "stripe_payment_intent_id");
        return { data: byPi ? options.intentRow ?? null : options.existing ?? null, error: null };
      }
      if (op.table === "door_tap_intents" && op.action === "insert") {
        return { data: { id: INTENT }, error: null };
      }
      return { data: null, error: null };
    },
    (name) => {
      if (name === "biz_tap_to_pay_release") return { data: { iphone: true, android: true }, error: null };
      if (name === "issue_4271_can_take_door_payment") return { data: true, error: null };
      if (name === "issue_4271_door_quote_lines") {
        return {
          data: {
            brandId: BRAND, currency: "USD", subtotalCents: 2000,
            lines: [{ ticketTypeId: TIER, name: "Door entry", quantity: 1, unitCents: 2000 }],
          },
          error: null,
        };
      }
      if (name === "resolve_event_pricing_inputs") {
        return { data: [{ ...PRICING_ROW, ...(options.pricing ?? {}) }], error: null };
      }
      if (name === "biz_door_tap_record") {
        return {
          data: { orderId: "order-1", ticketIds: ["t-1"], receiptQueued: false, replayed: false },
          error: null,
        };
      }
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    },
  );
}

const auth = () => Promise.resolve(ACTOR);

Deno.test("#4271 tap create makes a server-priced card_present direct charge", async () => {
  const db = makeDb();
  const stripe = fakeStripe();
  const res = await createDoorTapIntentHandler({
    serviceClient: () => db, userIdFromAuthHeader: auth, stripe: () => stripe.client,
  })(post({
    action: "create", platform: "ios", eventId: EVENT, eventDateId: null, clientRequestId: REQ,
    lines: [{ ticketTypeId: TIER, quantity: 1 }], buyerPhone: null,
  }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, {
    paymentIntentId: "pi_door1",
    clientSecret: "pi_door1_secret_x",
    totalCents: 2090,
    subtotalCents: 2000,
    feeCents: 90,
    currency: "USD",
    stripeAccountId: "acct_door1",
    locationId: "tml_door1",
  });
  const pi = stripe.calls.find((c) => c.method === "paymentIntents.create")!;
  const params = pi.params as Record<string, unknown>;
  assertEquals(params.payment_method_types, ["card_present"]);
  assertEquals(params.capture_method, "automatic");
  assertEquals(params.amount, 2090);
  assertEquals(params.application_fee_amount, 90);
  assertEquals((params.metadata as Record<string, string>).mingla_door_tap, "1");
  assertEquals((params.metadata as Record<string, string>).mingla_door_tap_intent_id, INTENT);
  assertEquals(pi.options, { stripeAccount: "acct_door1", idempotencyKey: `door_tap:${REQ}` });
  const location = stripe.calls.find((c) => c.method === "terminal.locations.create")!;
  assertEquals((location.options as Record<string, string>).stripeAccount, "acct_door1");
  assertEquals(
    ((location.params as Record<string, unknown>).address as Record<string, string>).postal_code,
    "78701",
  );
  const stored = db.opsOn("door_tap_intents", "update")[0].payload as Record<string, unknown>;
  assertEquals(stored.stripe_payment_intent_id, "pi_door1");
});

Deno.test("#4271 retest T6: tap refuses a tax added on top at checkout, before any charge", async () => {
  const db = makeDb({ pricing: { pass_tax: true, pricing_region: "US" } });
  const stripe = fakeStripe();
  const res = await createDoorTapIntentHandler({
    serviceClient: () => db, userIdFromAuthHeader: auth, stripe: () => stripe.client,
  })(post({
    action: "create", platform: "ios", eventId: EVENT, eventDateId: null, clientRequestId: REQ,
    lines: [{ ticketTypeId: TIER, quantity: 1 }], buyerPhone: null,
  }));
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "door_tax_added_at_checkout");
  assertEquals(stripe.calls.filter((c) => c.method === "paymentIntents.create").length, 0);
});

Deno.test("#4271 tap create replays the same PaymentIntent for the same request", async () => {
  const db = makeDb({
    existing: {
      id: INTENT, stripe_payment_intent_id: "pi_prev", stripe_account_id: "acct_door1",
      stripe_location_id: "tml_door1", total_cents: 2090, currency: "USD",
    },
  });
  const stripe = fakeStripe();
  const body = await (await createDoorTapIntentHandler({
    serviceClient: () => db, userIdFromAuthHeader: auth, stripe: () => stripe.client,
  })(post({
    action: "create", platform: "ios", eventId: EVENT, clientRequestId: REQ,
    lines: [{ ticketTypeId: TIER, quantity: 1 }],
  }))).json();
  assertEquals(body.paymentIntentId, "pi_prev");
  assert(!stripe.calls.some((c) => c.method === "paymentIntents.create"));
});

Deno.test("#4271 tap is not offered to a Paystack brand", async () => {
  const db = makeDb({ provider: "paystack" });
  const stripe = fakeStripe();
  const res = await createDoorTapIntentHandler({
    serviceClient: () => db, userIdFromAuthHeader: auth, stripe: () => stripe.client,
  })(post({
    action: "create", platform: "ios", eventId: EVENT, clientRequestId: REQ,
    lines: [{ ticketTypeId: TIER, quantity: 1 }],
  }));
  assertEquals((await res.json()).error, "tap_not_available");
  assertEquals(stripe.calls.length, 0);
});

const INTENT_ROW = {
  id: INTENT, event_id: EVENT, client_request_id: REQ, stripe_account_id: "acct_door1",
};

Deno.test("#4271 tap complete records nothing until Stripe says succeeded", async () => {
  const db = makeDb({ intentRow: INTENT_ROW });
  const stripe = fakeStripe({
    retrievePi: (id) => ({ id, status: "requires_payment_method", metadata: { mingla_door_tap_intent_id: INTENT } }),
  });
  const res = await createDoorTapIntentHandler({
    serviceClient: () => db, userIdFromAuthHeader: auth, stripe: () => stripe.client,
  })(post({ action: "complete", paymentIntentId: "pi_door1", clientRequestId: REQ }));
  assertEquals(res.status, 409);
  assertEquals((await res.json()).error, "payment_not_succeeded");
  assert(!db.rpcs.some((r) => r.name === "biz_door_tap_record"));
});

Deno.test("#4271 tap complete records a succeeded payment", async () => {
  const db = makeDb({ intentRow: INTENT_ROW });
  const stripe = fakeStripe({
    retrievePi: (id) => ({
      id, status: "succeeded", amount: 2090, amount_received: 2090,
      metadata: { mingla_door_tap_intent_id: INTENT },
      latest_charge: {
        id: "ch_door1",
        payment_method_details: { card_present: { brand: "visa", last4: "4242" } },
      },
    }),
  });
  const res = await createDoorTapIntentHandler({
    serviceClient: () => db, userIdFromAuthHeader: auth, stripe: () => stripe.client,
  })(post({ action: "complete", paymentIntentId: "pi_door1", clientRequestId: REQ }));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).orderId, "order-1");
  const call = db.rpcs.find((r) => r.name === "biz_door_tap_record")!;
  assertEquals(call.args, {
    p_payment_intent_id: "pi_door1",
    p_charge_id: "ch_door1",
    p_amount_received_cents: 2090,
    p_card_brand: "visa",
    p_card_last4: "4242",
  });
  const retrieve = stripe.calls.find((c) => c.method === "paymentIntents.retrieve")!;
  assertEquals(retrieve.options, { stripeAccount: "acct_door1" });
});

Deno.test("#4271 tap location creates the brand's Location before the first sale", async () => {
  const db = makeDb();
  const stripe = fakeStripe();
  const res = await createDoorTapIntentHandler({
    serviceClient: () => db, userIdFromAuthHeader: auth, stripe: () => stripe.client,
  })(post({ action: "location", platform: "ios", eventId: EVENT }));
  assertEquals(await res.json(), { locationId: "tml_door1" });
  assertEquals(db.opsOn("brand_terminal_locations", "upsert").length, 1);
});

Deno.test("#4271 tap cancel cancels an unpaid PaymentIntent and refuses a paid one", async () => {
  const unpaid = makeDb({ intentRow: { ...INTENT_ROW, status: "created", order_id: null } });
  const stripe = fakeStripe({ retrievePi: (id) => ({ id, status: "requires_payment_method" }) });
  const res = await createDoorTapIntentHandler({
    serviceClient: () => unpaid, userIdFromAuthHeader: auth, stripe: () => stripe.client,
  })(post({ action: "cancel", paymentIntentId: "pi_door1", clientRequestId: REQ }));
  assertEquals(await res.json(), { status: "cancelled" });
  const cancel = stripe.calls.find((c) => c.method === "paymentIntents.cancel")!;
  assertEquals(cancel.options, {
    stripeAccount: "acct_door1", idempotencyKey: `door_tap_cancel:${REQ}`,
  });

  const paidStripe = fakeStripe({ retrievePi: (id) => ({ id, status: "succeeded" }) });
  const paid = await createDoorTapIntentHandler({
    serviceClient: () => makeDb({ intentRow: { ...INTENT_ROW, status: "created", order_id: null } }),
    userIdFromAuthHeader: auth, stripe: () => paidStripe.client,
  })(post({ action: "cancel", paymentIntentId: "pi_door1", clientRequestId: REQ }));
  assertEquals(paid.status, 409);
  assertEquals((await paid.json()).error, "payment_succeeded");
  assert(!paidStripe.calls.some((c) => c.method === "paymentIntents.cancel"));
});

Deno.test("#4271 connection token is made on the connected account at a stored Location", async () => {
  const db = makeDb({ storedLocation: "tml_saved" });
  const stripe = fakeStripe();
  const res = await createTerminalConnectionTokenHandler({
    serviceClient: () => db, userIdFromAuthHeader: auth, stripe: () => stripe.client,
  })(post({ eventId: EVENT, platform: "ios" }));
  assertEquals(await res.json(), { secret: "pst_test_door", locationId: "tml_saved" });
  assert(!stripe.calls.some((c) => c.method === "terminal.locations.create"));
  const token = stripe.calls.find((c) => c.method === "terminal.connectionTokens.create")!;
  assertEquals(token.params, { location: "tml_saved" });
  assertEquals(token.options, { stripeAccount: "acct_door1" });
});

Deno.test("#4271 connection token refuses a Paystack brand", async () => {
  const db = makeDb({ provider: "paystack" });
  const stripe = fakeStripe();
  const res = await createTerminalConnectionTokenHandler({
    serviceClient: () => db, userIdFromAuthHeader: auth, stripe: () => stripe.client,
  })(post({ eventId: EVENT, platform: "ios" }));
  assertEquals((await res.json()).error, "tap_not_available");
});

Deno.test("#4271 webhook backstop records a door tap once Stripe says succeeded", async () => {
  const db = makeDb();
  const event = {
    id: "evt_1",
    type: "payment_intent.succeeded",
    account: "acct_door1",
    data: {
      object: {
        id: "pi_door1", status: "succeeded", amount_received: 2090,
        latest_charge: "ch_door1",
        metadata: { mingla_door_tap: "1", mingla_brand_id: BRAND },
      },
    },
  };
  assert(isDoorTapStripeEvent(event));
  assert(!isDoorTapStripeEvent({ ...event, data: { object: { metadata: {} } } }));
  assertEquals(await handleDoorTapStripeEvent(db, event), BRAND);
  assertEquals(db.rpcs[0].name, "biz_door_tap_record");
  assertEquals(db.rpcs[0].args.p_charge_id, "ch_door1");

  const failing = new FakeDb(() => ({ data: null }), () => ({
    data: null, error: { message: "boom" },
  }));
  await assertRejects(() => handleDoorTapStripeEvent(failing, event));
});

Deno.test("#4271 retest T12: a declined card notes the door code and never breaks the webhook", async () => {
  const calls: Array<[string, unknown]> = [];
  const client = (error: { message: string } | null) => ({
    rpc: (name: string, args: unknown) => {
      calls.push([name, args]);
      return Promise.resolve({ error });
    },
  });
  const event = (metadata: Record<string, string>) => ({
    id: "evt_1",
    type: "payment_intent.payment_failed",
    data: { object: { metadata } },
  });
  await recordDoorCodeDecline(client(null), event({ mingla_checkout_session_id: "session-1" }));
  assertEquals(calls, [["issue_4271_door_pay_code_mark_declined", { p_checkout_session_id: "session-1" }]]);
  // An intent that isn't a checkout: nothing to note.
  calls.length = 0;
  await recordDoorCodeDecline(client(null), event({}));
  assertEquals(calls.length, 0);
  // A failed note is logged; the ticket handling still runs.
  await recordDoorCodeDecline(client({ message: "boom" }), event({ mingla_checkout_session_id: "session-1" }));
  const router = await Deno.readTextFile(new URL("../../_shared/stripeWebhookRouter.ts", import.meta.url));
  const hook = router.indexOf("await recordDoorCodeDecline(supabase, event);");
  assert(hook > 0 && hook < router.indexOf("brandId = await handleTicketCheckoutPaymentIntent(supabase, event);", hook));
});

Deno.test("#4271 retest 4 P3-D: a failed brand read is a retryable server error, never tap_not_available", async () => {
  const db = makeDb({ eventsReadFails: true });
  const stripe = fakeStripe();
  const res = await createDoorTapIntentHandler({
    serviceClient: () => db, userIdFromAuthHeader: auth, stripe: () => stripe.client,
  })(post({
    action: "create", platform: "ios", eventId: EVENT, clientRequestId: REQ,
    lines: [{ ticketTypeId: TIER, quantity: 1 }],
  }));
  assertEquals(res.status, 500);
  assertEquals((await res.json()).error, "server_error");
  assertEquals(stripe.calls.length, 0);
  // The same read failing for the connection token is retryable too.
  const token = await createTerminalConnectionTokenHandler({
    serviceClient: () => makeDb({ eventsReadFails: true }), userIdFromAuthHeader: auth, stripe: () => fakeStripe().client,
  })(post({ eventId: EVENT, platform: "ios" }));
  assertEquals(token.status, 500);
  assertEquals((await token.json()).error, "server_error");
});

Deno.test("#4271 retest 4 P3-D: an event that isn't there is still tap_not_available", async () => {
  const db = new FakeDb(
    (op: DbOp) => (op.table === "events" ? { data: null, error: null } : { data: null, error: null }),
    (name) => (name === "issue_4271_can_take_door_payment" ? { data: true, error: null } : { data: null, error: null }),
  );
  const res = await createDoorTapIntentHandler({
    serviceClient: () => db, userIdFromAuthHeader: auth, stripe: () => fakeStripe().client,
  })(post({
    action: "create", platform: "ios", eventId: EVENT, clientRequestId: REQ,
    lines: [{ ticketTypeId: TIER, quantity: 1 }],
  }));
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "tap_not_available");
});
