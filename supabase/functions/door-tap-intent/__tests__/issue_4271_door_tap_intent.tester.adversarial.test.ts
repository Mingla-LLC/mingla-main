// Issue #4271 — door-tap-intent TESTER adversarial suite. Different angles from
// the implementor's happy path:
//   * complete refuses EVERY non-succeeded PaymentIntent status Stripe can
//     report (processing, requires_capture, requires_action, canceled, ...),
//     and a succeeded PaymentIntent that belongs to a different intent row
//     (metadata mismatch) — none of them reaches biz_door_tap_record.
//   * complete with the wrong clientRequestId for a real PaymentIntent, and
//     complete by a caller without the payment permission, never even ask
//     Stripe and never record.
//   * complete is idempotent: a second complete returns the same order the
//     database replays, and never creates a PaymentIntent.
//   * cancel refuses an intent already recorded locally without touching
//     Stripe; cancel of a canceled PaymentIntent does not cancel twice.
//   * create prices on the server: a phone-sent amount / fee / currency is
//     ignored in the PaymentIntent, and a caller without the permission is
//     refused before any Stripe call.
//
// FAILS-ON-REVERT (verified by the tester): replace the
// `pi?.status !== "succeeded"` guard in handleComplete with `false` -> the
// non-succeeded and metadata-mismatch tests fail.
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
  PRICING_ROW,
} from "../../_shared/__tests__/doorPayFakes.ts";

const EVENT = "42719000-0000-4000-8000-0000000000f1";
const TIER = "42719000-0000-4000-8000-0000000000f2";
const BRAND = "42719000-0000-4000-8000-0000000000f3";
const ACTOR = "42719000-0000-4000-8000-0000000000f4";
const REQ = "42719000-0000-4000-8000-0000000000f5";
const OTHER_REQ = "42719000-0000-4000-8000-0000000000f6";
const INTENT = "42719000-0000-4000-8000-0000000000f7";
const OTHER_INTENT = "42719000-0000-4000-8000-0000000000f8";

function makeDb(options: {
  canTake?: boolean;
  intentRow?: Record<string, unknown> | null;
  recordResult?: Record<string, unknown>;
} = {}) {
  return new FakeDb(
    (op: DbOp) => {
      if (op.table === "events") {
        return {
          data: {
            brand_id: BRAND,
            brands: {
              id: BRAND, name: "Door Brand", address: "1 Main St", city: "Austin",
              country_code: "US", payment_country: "US", payment_provider: "stripe",
              stripe_connect_id: "acct_door1", stripe_charges_enabled: true,
              payout_hold_cutover_at: null,
            },
          },
          error: null,
        };
      }
      if (op.table === "brand_terminal_locations" && op.action === "select") {
        return { data: { stripe_location_id: "tml_saved" }, error: null };
      }
      if (op.table === "door_tap_intents" && op.action === "select") {
        const byPi = op.filters.some(([, c]) => c === "stripe_payment_intent_id");
        return { data: byPi ? options.intentRow ?? null : null, error: null };
      }
      if (op.table === "door_tap_intents" && op.action === "insert") {
        return { data: { id: INTENT }, error: null };
      }
      return { data: null, error: null };
    },
    (name) => {
      if (name === "issue_4271_can_take_door_payment") {
        return { data: options.canTake ?? true, error: null };
      }
      if (name === "issue_4271_door_quote_lines") {
        return {
          data: {
            brandId: BRAND, currency: "USD", subtotalCents: 2000,
            lines: [{ ticketTypeId: TIER, name: "Door entry", quantity: 1, unitCents: 2000 }],
          },
          error: null,
        };
      }
      if (name === "resolve_event_pricing_inputs") return { data: [PRICING_ROW], error: null };
      if (name === "biz_door_tap_record") {
        return {
          data: options.recordResult ??
            { orderId: "order-1", ticketIds: ["t-1"], receiptQueued: false, replayed: false },
          error: null,
        };
      }
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    },
  );
}

const INTENT_ROW = {
  id: INTENT, event_id: EVENT, client_request_id: REQ, stripe_account_id: "acct_door1",
  status: "created", order_id: null,
};

function run(db: FakeDb, stripe: ReturnType<typeof fakeStripe>, body: unknown) {
  return createDoorTapIntentHandler({
    serviceClient: () => db,
    userIdFromAuthHeader: () => Promise.resolve(ACTOR),
    stripe: () => stripe.client,
  })(post(body));
}

Deno.test("#4271 tester: complete refuses every PaymentIntent status that is not succeeded", async () => {
  for (const status of [
    "requires_payment_method", "requires_confirmation", "requires_action",
    "processing", "requires_capture", "canceled", undefined,
  ]) {
    const db = makeDb({ intentRow: INTENT_ROW });
    const stripe = fakeStripe({
      retrievePi: (id) => ({
        id, status, amount: 2140, amount_received: 2140,
        metadata: { mingla_door_tap_intent_id: INTENT },
      }),
    });
    const res = await run(db, stripe, { action: "complete", paymentIntentId: "pi_door1", clientRequestId: REQ });
    assertEquals(res.status, 409, `status ${status} must be refused`);
    assertEquals((await res.json()).error, "payment_not_succeeded");
    assert(!db.rpcs.some((r) => r.name === "biz_door_tap_record"), `status ${status} was recorded`);
  }
});

Deno.test("#4271 tester: a succeeded PaymentIntent of another intent row is not recorded", async () => {
  const db = makeDb({ intentRow: INTENT_ROW });
  const stripe = fakeStripe({
    retrievePi: (id) => ({
      id, status: "succeeded", amount: 2140, amount_received: 2140,
      metadata: { mingla_door_tap_intent_id: OTHER_INTENT },
    }),
  });
  const res = await run(db, stripe, { action: "complete", paymentIntentId: "pi_door1", clientRequestId: REQ });
  assertEquals(res.status, 409);
  assert(!db.rpcs.some((r) => r.name === "biz_door_tap_record"));
});

Deno.test("#4271 tester: complete with the wrong request id or no permission never asks Stripe", async () => {
  for (const [label, db, req] of [
    ["wrong request id", makeDb({ intentRow: INTENT_ROW }), OTHER_REQ],
    ["no permission", makeDb({ intentRow: INTENT_ROW, canTake: false }), REQ],
  ] as const) {
    const stripe = fakeStripe({
      retrievePi: (id) => ({ id, status: "succeeded", metadata: { mingla_door_tap_intent_id: INTENT } }),
    });
    const res = await run(db, stripe, { action: "complete", paymentIntentId: "pi_door1", clientRequestId: req });
    assert(res.status === 400, `${label}: expected 400, got ${res.status}`);
    assertEquals(stripe.calls.length, 0, `${label}: Stripe was called`);
    assert(!db.rpcs.some((r) => r.name === "biz_door_tap_record"), `${label}: recorded`);
  }
});

Deno.test("#4271 tester: a second complete returns the replayed order and makes no PaymentIntent", async () => {
  const succeeded = (id: string) => ({
    id, status: "succeeded", amount: 2140, amount_received: 2140,
    metadata: { mingla_door_tap_intent_id: INTENT },
    latest_charge: { id: "ch_1", payment_method_details: { card_present: { brand: "visa", last4: "4242" } } },
  });
  const first = makeDb({ intentRow: INTENT_ROW });
  const s1 = fakeStripe({ retrievePi: succeeded });
  const a = await (await run(first, s1, { action: "complete", paymentIntentId: "pi_door1", clientRequestId: REQ })).json();
  const second = makeDb({
    intentRow: { ...INTENT_ROW, status: "recorded", order_id: "order-1" },
    recordResult: { orderId: "order-1", ticketIds: ["t-1"], receiptQueued: false, replayed: true },
  });
  const s2 = fakeStripe({ retrievePi: succeeded });
  const b = await (await run(second, s2, { action: "complete", paymentIntentId: "pi_door1", clientRequestId: REQ })).json();
  assertEquals(a.orderId, b.orderId);
  assertEquals(b.replayed, true);
  for (const s of [s1, s2]) {
    assert(!s.calls.some((c) => c.method === "paymentIntents.create"), "complete created a PaymentIntent");
  }
  const rec = first.rpcs.find((r) => r.name === "biz_door_tap_record")!;
  assertEquals(rec.args.p_amount_received_cents, 2140, "the recorded amount is Stripe's, not the phone's");
});

Deno.test("#4271 tester: cancel refuses a locally recorded sale without asking Stripe", async () => {
  const db = makeDb({ intentRow: { ...INTENT_ROW, status: "recorded", order_id: "order-1" } });
  const stripe = fakeStripe({ retrievePi: (id) => ({ id, status: "requires_payment_method" }) });
  const res = await run(db, stripe, { action: "cancel", paymentIntentId: "pi_door1", clientRequestId: REQ });
  assertEquals(res.status, 409);
  assertEquals((await res.json()).error, "payment_succeeded");
  assertEquals(stripe.calls.length, 0);
  assertEquals(db.opsOn("door_tap_intents", "update").length, 0);
});

Deno.test("#4271 tester: cancel of an already canceled PaymentIntent does not cancel again", async () => {
  const db = makeDb({ intentRow: INTENT_ROW });
  const stripe = fakeStripe({ retrievePi: (id) => ({ id, status: "canceled" }) });
  const res = await run(db, stripe, { action: "cancel", paymentIntentId: "pi_door1", clientRequestId: REQ });
  assertEquals(await res.json(), { status: "cancelled" });
  assert(!stripe.calls.some((c) => c.method === "paymentIntents.cancel"));
});

Deno.test("#4271 tester: create ignores a phone-sent amount and refuses without permission", async () => {
  const db = makeDb();
  const stripe = fakeStripe();
  const res = await run(db, stripe, {
    action: "create", eventId: EVENT, eventDateId: null, clientRequestId: REQ,
    lines: [{ ticketTypeId: TIER, quantity: 1, unitCents: 1 }],
    amount: 1, totalCents: 1, application_fee_amount: 0, currency: "ngn",
  });
  assertEquals(res.status, 200);
  const pi = stripe.calls.find((c) => c.method === "paymentIntents.create")!;
  const params = pi.params as Record<string, unknown>;
  assert((params.amount as number) >= 2000, `amount came from the phone: ${params.amount}`);
  assertEquals(params.currency, "usd");
  assertEquals(params.payment_method_types, ["card_present"]);
  assert((params.application_fee_amount as number) > 0, "Mingla's fee is missing");
  assertEquals((pi.options as Record<string, unknown>).stripeAccount, "acct_door1");

  const denied = makeDb({ canTake: false });
  const deniedStripe = fakeStripe();
  const no = await run(denied, deniedStripe, {
    action: "create", eventId: EVENT, clientRequestId: REQ,
    lines: [{ ticketTypeId: TIER, quantity: 1 }],
  });
  assertEquals(no.status, 400);
  assertEquals((await no.json()).error, "door_access_denied");
  assertEquals(deniedStripe.calls.length, 0);
  assertEquals(denied.opsOn("door_tap_intents", "insert").length, 0);
});
