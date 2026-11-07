// Issue #4271 phase 2 — the server half of the Tap to Pay release gate and what
// the Apple build added to door-tap-intent. Nothing reaches Stripe while the
// switch is off; money already taken is never gated.
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { createDoorTapIntentHandler } from "../index.ts";
import { createTerminalConnectionTokenHandler } from "../../terminal-connection-token/index.ts";
import { tapToPayReleased } from "../../_shared/doorPayServer.ts";
import { FakeDb, fakeStripe, post, PRICING_ROW } from "../../_shared/__tests__/doorPayFakes.ts";

const EVENT = "42710000-0000-4000-8000-0000000000a1";
const TIER = "42710000-0000-4000-8000-0000000000a2";
const BRAND = "42710000-0000-4000-8000-0000000000a3";
const ACTOR = "42710000-0000-4000-8000-0000000000a4";
const REQ = "42710000-0000-4000-8000-0000000000a5";
const INTENT = "42710000-0000-4000-8000-0000000000a6";

function makeDb(
  release: { iphone: boolean; android: boolean } | { error: string },
  tables: (table: string, action: string, filters: Array<[string, string, unknown]>) => unknown = () => null,
  brandAddress: string | null = "1 Main St",
  brandPermitted = true,
) {
  return new FakeDb(
    (op) => {
      if (op.table === "brands") {
        return {
          data: {
            id: BRAND, name: "Door Brand", address: brandAddress, city: "Austin",
            country_code: "US", payment_country: "US", payment_provider: "stripe",
            stripe_connect_id: "acct_door1", stripe_charges_enabled: true,
          },
          error: null,
        };
      }
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
      if (op.table === "door_tap_intents" && op.action === "insert") {
        return { data: { id: INTENT }, error: null };
      }
      return { data: tables(op.table, op.action, op.filters), error: null };
    },
    (name) => {
      if (name === "biz_tap_to_pay_release") {
        return "error" in release
          ? { data: null, error: { message: release.error } }
          : { data: release, error: null };
      }
      if (name === "issue_4271_can_take_door_payment") return { data: true, error: null };
      if (name === "issue_4271_can_take_brand_door_payment") return { data: brandPermitted, error: null };
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
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    },
  );
}

const auth = () => Promise.resolve(ACTOR);
const createBody = (platform?: string) => ({
  action: "create", eventId: EVENT, eventDateId: null, clientRequestId: REQ,
  lines: [{ ticketTypeId: TIER, quantity: 1 }], buyerPhone: null,
  ...(platform === undefined ? {} : { platform }),
});

async function refused(res: Response, stripeCalls: unknown[]): Promise<void> {
  assertEquals(res.status, 400);
  assertEquals(await res.json(), { error: "tap_not_available", reason: "not_released" });
  assertEquals(stripeCalls.length, 0);
}

Deno.test("#4271 B1 create on iPhone with the switch off is refused and Stripe is never called", async () => {
  const stripe = fakeStripe();
  const res = await createDoorTapIntentHandler({
    serviceClient: () => makeDb({ iphone: false, android: true }),
    userIdFromAuthHeader: auth,
    stripe: () => stripe.client,
  })(post(createBody("ios")));
  await refused(res, stripe.calls);
});

Deno.test("#4271 B1 create on Android reads the Android switch, not the iPhone one", async () => {
  const stripe = fakeStripe();
  const res = await createDoorTapIntentHandler({
    serviceClient: () => makeDb({ iphone: true, android: false }),
    userIdFromAuthHeader: auth,
    stripe: () => stripe.client,
  })(post(createBody("android")));
  await refused(res, stripe.calls);
});

Deno.test("#4271 B1 create with no platform, or an unknown one, is refused the same way", async () => {
  for (const platform of [undefined, "web", "IOS"]) {
    const stripe = fakeStripe();
    const res = await createDoorTapIntentHandler({
      serviceClient: () => makeDb({ iphone: true, android: true }),
      userIdFromAuthHeader: auth,
      stripe: () => stripe.client,
    })(post(createBody(platform)));
    await refused(res, stripe.calls);
  }
});

Deno.test("#4271 B1 create with the switch on reaches Stripe", async () => {
  const stripe = fakeStripe();
  const res = await createDoorTapIntentHandler({
    serviceClient: () => makeDb({ iphone: true, android: false }),
    userIdFromAuthHeader: auth,
    stripe: () => stripe.client,
  })(post(createBody("ios")));
  assertEquals(res.status, 200);
  assertEquals(stripe.calls.some((c) => c.method === "paymentIntents.create"), true);
});

Deno.test("#4271 B1 location is refused while the switch is off, and makes no Stripe Location", async () => {
  const stripe = fakeStripe();
  const res = await createDoorTapIntentHandler({
    serviceClient: () => makeDb({ iphone: false, android: false }),
    userIdFromAuthHeader: auth,
    stripe: () => stripe.client,
  })(post({ action: "location", eventId: EVENT, platform: "ios" }));
  await refused(res, stripe.calls);
});

Deno.test("#4271 B1 connection token is refused while the switch is off", async () => {
  const stripe = fakeStripe();
  const res = await createTerminalConnectionTokenHandler({
    serviceClient: () => makeDb({ iphone: false, android: false }),
    userIdFromAuthHeader: auth,
    stripe: () => stripe.client,
  })(post({ eventId: EVENT, platform: "ios" }));
  await refused(res, stripe.calls);
});

Deno.test("#4271 B1 connection token with no platform is refused", async () => {
  const stripe = fakeStripe();
  const res = await createTerminalConnectionTokenHandler({
    serviceClient: () => makeDb({ iphone: true, android: true }),
    userIdFromAuthHeader: auth,
    stripe: () => stripe.client,
  })(post({ eventId: EVENT }));
  await refused(res, stripe.calls);
});

Deno.test("#4271 B1 a failed switch lookup reads as off", async () => {
  assertEquals(
    await tapToPayReleased(makeDb({ error: "boom" }), BRAND, "ios"),
    false,
  );
});

Deno.test("#4271 B1 money already taken is never gated: complete and cancel still work with the switch off", async () => {
  const stripe = fakeStripe();
  const db = makeDb({ iphone: false, android: false }, (table, action) => {
    if (table === "door_tap_intents" && action === "select") {
      return {
        id: INTENT, event_id: EVENT, client_request_id: REQ,
        stripe_account_id: "acct_door1", status: "created", order_id: null,
      };
    }
    return null;
  });
  const res = await createDoorTapIntentHandler({
    serviceClient: () => db, userIdFromAuthHeader: auth, stripe: () => stripe.client,
  })(post({ action: "cancel", paymentIntentId: "pi_door1", clientRequestId: REQ }));
  assertEquals(res.status, 200);
  assertEquals(db.rpcs.some((r) => r.name === "biz_tap_to_pay_release"), false);
});

const ON = { iphone: true, android: true };

Deno.test("#4271 B3 location by brand reuses the stored Location first, even with no brand address", async () => {
  const stripe = fakeStripe();
  const db = makeDb(ON, (table) => table === "brand_terminal_locations" ? { stripe_location_id: "tml_saved" } : null, null);
  const res = await createDoorTapIntentHandler({
    serviceClient: () => db, userIdFromAuthHeader: auth, stripe: () => stripe.client,
  })(post({ action: "location", brandId: BRAND, platform: "ios" }));
  assertEquals(await res.json(), { locationId: "tml_saved" });
  assertEquals(stripe.calls.some((c) => c.method === "terminal.locations.create"), false);
  assertEquals(db.rpcs.some((r) => r.name === "issue_4271_can_take_brand_door_payment"), true);
});

Deno.test("#4271 B3 location by brand makes one from the brand's own address, or says it is missing", async () => {
  const stripe = fakeStripe();
  const made = await createDoorTapIntentHandler({
    serviceClient: () => makeDb(ON), userIdFromAuthHeader: auth, stripe: () => stripe.client,
  })(post({ action: "location", brandId: BRAND, platform: "ios" }));
  assertEquals((await made.json()).locationId, "tml_door1");
  const location = stripe.calls.find((c) => c.method === "terminal.locations.create")!;
  assertEquals((location.params as { address: { line1: string } }).address.line1, "1 Main St");

  const noAddress = await createDoorTapIntentHandler({
    serviceClient: () => makeDb(ON, () => null, null), userIdFromAuthHeader: auth, stripe: () => fakeStripe().client,
  })(post({ action: "location", brandId: BRAND, platform: "ios" }));
  assertEquals(await noAddress.json(), { error: "tap_not_available", reason: "address_missing" });
});

Deno.test("#4271 B3 a brand-scoped caller without door permission is refused before Stripe", async () => {
  const stripe = fakeStripe();
  const location = await createDoorTapIntentHandler({
    serviceClient: () => makeDb(ON, () => null, "1 Main St", false), userIdFromAuthHeader: auth, stripe: () => stripe.client,
  })(post({ action: "location", brandId: BRAND, platform: "ios" }));
  assertEquals((await location.json()).error, "door_access_denied");
  const token = await createTerminalConnectionTokenHandler({
    serviceClient: () => makeDb(ON, () => null, "1 Main St", false), userIdFromAuthHeader: auth, stripe: () => stripe.client,
  })(post({ brandId: BRAND, platform: "ios" }));
  assertEquals((await token.json()).error, "door_access_denied");
  assertEquals(stripe.calls.length, 0);
});

Deno.test("#4271 B3 connection token by brand is on the connected account, and the gate still applies", async () => {
  const stripe = fakeStripe();
  const db = makeDb(ON, (table) => table === "brand_terminal_locations" ? { stripe_location_id: "tml_saved" } : null);
  const res = await createTerminalConnectionTokenHandler({
    serviceClient: () => db, userIdFromAuthHeader: auth, stripe: () => stripe.client,
  })(post({ brandId: BRAND, platform: "ios" }));
  assertEquals(await res.json(), { secret: "pst_test_door", locationId: "tml_saved" });
  const token = stripe.calls.find((c) => c.method === "terminal.connectionTokens.create")!;
  assertEquals(token.params, { location: "tml_saved" });
  assertEquals(token.options, { stripeAccount: "acct_door1" });

  const off = fakeStripe();
  const refused2 = await createTerminalConnectionTokenHandler({
    serviceClient: () => makeDb({ iphone: false, android: false }), userIdFromAuthHeader: auth, stripe: () => off.client,
  })(post({ brandId: BRAND, platform: "ios" }));
  await refused(refused2, off.calls);

  const noPlatform = fakeStripe();
  const refused3 = await createDoorTapIntentHandler({
    serviceClient: () => makeDb(ON), userIdFromAuthHeader: auth, stripe: () => noPlatform.client,
  })(post({ action: "location", brandId: BRAND }));
  await refused(refused3, noPlatform.calls);
});

// ---- B13 ------------------------------------------------------------------
const STALE = {
  id: INTENT, brand_id: BRAND, event_id: EVENT, stripe_payment_intent_id: "pi_door1",
  stripe_account_id: "acct_door1", created_by: ACTOR, events: { title: "Door night" },
};

function sweepHarness(options: {
  row?: Record<string, unknown>;
  status?: string;
  key?: string;
  cancelThrows?: boolean;
} = {}) {
  const rowState: Record<string, unknown> = {
    status: "created", outcome_seen_at: null, unfinished_notified_at: null, ...STALE, ...(options.row ?? {}),
  };
  const db = new FakeDb(
    (op) => {
      if (op.table !== "door_tap_intents") return { data: null, error: null };
      if (op.action === "update") {
        Object.assign(rowState, op.payload as Record<string, unknown>);
        return { data: null, error: null };
      }
      const passes = op.filters.every(([kind, column, value]) => {
        if (kind === "eq") return rowState[column] === value;
        if (kind === "is") return rowState[column] === value;
        return true;
      });
      return { data: passes ? [rowState] : [], error: null };
    },
    (name) =>
      name === "biz_door_tap_record"
        ? { data: { orderId: "o1", ticketIds: [] }, error: null }
        : { data: null, error: { message: `unexpected rpc ${name}` } },
  );
  const stripe = fakeStripe({
    retrievePi: (id: string) => ({
      id, status: options.status ?? "requires_payment_method", amount: 2090, amount_received: 2090,
    }),
  });
  const pushes: Array<Record<string, unknown>> = [];
  const handler = createDoorTapIntentHandler({
    serviceClient: () => db,
    userIdFromAuthHeader: () => Promise.resolve(null),
    stripe: () => stripe.client,
    serviceRoleKey: () => "service-key",
    notify: ((input: Record<string, unknown>) => {
      pushes.push(input);
      return Promise.resolve();
    }) as never,
  });
  const run = () =>
    handler(new Request("http://x/door-tap-intent", {
      method: "POST",
      headers: { authorization: `Bearer ${options.key ?? "service-key"}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "sweep_unfinished" }),
    }));
  return { db, stripe, pushes, run, rowState };
}

Deno.test("#4271 B13 an unseen stale intent is cancelled at Stripe, then the host gets one push", async () => {
  const h = sweepHarness();
  const res = await h.run();
  assertEquals((await res.json()).swept, { recorded: 0, notified: 1, skipped: 0, failed: 0 });
  const cancel = h.stripe.calls.find((c) => c.method === "paymentIntents.cancel")!;
  assertEquals((cancel.options as { idempotencyKey: string }).idempotencyKey, `door_tap_sweep_cancel:${INTENT}`);
  assertEquals(h.rowState.status, "cancelled");
  assertEquals(h.pushes.length, 1);
  assertEquals(h.pushes[0].userId, ACTOR);
  assertEquals(h.pushes[0].type, "business.door_tap_not_completed");
  assertEquals(
    h.pushes[0].body,
    "A Tap to Pay sale for Door night wasn't approved. No money was taken. Open door sales to take it again.",
  );
});

Deno.test("#4271 final P3 the sweep only reads intents older than 15 minutes, past the app's ready limit", async () => {
  const h = sweepHarness();
  const before = Date.now();
  await h.run();
  const read = h.db.ops.find((op) => op.table === "door_tap_intents" && op.action === "select");
  const cutoff = read?.filters.find(([kind, column]) => kind === "lt" && column === "created_at")?.[2];
  assertEquals(typeof cutoff, "string");
  const ageMs = before - Date.parse(String(cutoff));
  assertEquals(ageMs >= 15 * 60 * 1000 - 1000 && ageMs <= 15 * 60 * 1000 + 60_000, true, `cutoff age ${ageMs}`);
});

Deno.test("#4271 B13 a seen intent is left alone", async () => {
  const h = sweepHarness({ row: { outcome_seen_at: "2026-11-05T00:00:00Z" } });
  await h.run();
  assertEquals(h.pushes.length, 0);
  assertEquals(h.stripe.calls.some((c) => c.method === "paymentIntents.cancel"), false);
});

// [TEST-MOD #4271 retest 4 P3-C] A recorded payment nobody saw now gets one
// paid push (it used to get none); it is still never told the sale failed.
Deno.test("#4271 B13 a payment that succeeded is recorded and nobody is told it failed", async () => {
  const h = sweepHarness({ status: "succeeded" });
  const res = await h.run();
  assertEquals((await res.json()).swept.recorded, 1);
  assertEquals(h.db.rpcs.some((r) => r.name === "biz_door_tap_record"), true);
  assertEquals(h.pushes.map((p) => p.type), ["business.door_tap_paid_unseen"]);
  assertEquals(h.pushes.some((p) => p.type === "business.door_tap_not_completed"), false);
  assertEquals(h.stripe.calls.some((c) => c.method === "paymentIntents.cancel"), false);
});

Deno.test("#4271 retest 4 P3-C: a paid tap nobody saw end tells the host it was paid, once", async () => {
  const h = sweepHarness({ status: "succeeded" });
  await h.run();
  await h.run();
  assertEquals(h.pushes.length, 1);
  assertEquals(h.pushes[0].userId, ACTOR);
  assertEquals(h.pushes[0].title, "Door card payment went through");
  assertEquals(
    h.pushes[0].body,
    "A Tap to Pay payment for Door night went through. It's recorded in door sales. Don't take this payment again.",
  );
  assertEquals(h.pushes[0].idempotencyKey, `door_tap_paid_unseen:${INTENT}`);
  assertEquals(h.pushes[0].deepLink, `mingla-business://event/${EVENT}/door`);
});

Deno.test("#4271 retest 4 P3-C: a sale recorded by the app or the webhook after the host closed is announced", async () => {
  // Closed on "We don't know yet": the webhook or finalize recorded it later; the
  // app never marked the outcome seen.
  const h = sweepHarness({ row: { status: "recorded" } });
  const res = await h.run();
  assertEquals((await res.json()).swept.notified, 1);
  assertEquals(h.pushes.map((p) => p.type), ["business.door_tap_paid_unseen"]);
  assertEquals(h.stripe.calls.length, 0);
  await h.run();
  assertEquals(h.pushes.length, 1);
});

Deno.test("#4271 retest 4 P3-C: a recorded sale the host saw is never announced again", async () => {
  const h = sweepHarness({ row: { status: "recorded", outcome_seen_at: "2026-11-06T00:00:00Z" } });
  await h.run();
  assertEquals(h.pushes.length, 0);
});

Deno.test("#4271 B13 a second sweep sends nothing", async () => {
  const h = sweepHarness();
  await h.run();
  await h.run();
  assertEquals(h.pushes.length, 1);
});

Deno.test("#4271 B13 a payment being processed is not cancelled or called failed", async () => {
  const h = sweepHarness({ status: "processing" });
  const res = await h.run();
  assertEquals((await res.json()).swept.skipped, 1);
  assertEquals(h.pushes.length, 0);
  assertEquals(h.rowState.status, "created");
});

Deno.test("#4271 B13 only the service role may sweep", async () => {
  const h = sweepHarness({ key: "someone-elses-token" } as never);
  const bad = sweepHarness();
  const res = await createDoorTapIntentHandler({
    serviceClient: () => bad.db,
    userIdFromAuthHeader: () => Promise.resolve(ACTOR),
    stripe: () => bad.stripe.client,
    serviceRoleKey: () => "service-key",
    notify: (() => Promise.resolve()) as never,
  })(new Request("http://x/door-tap-intent", {
    method: "POST",
    headers: { authorization: "Bearer a-host-jwt", "content-type": "application/json" },
    body: JSON.stringify({ action: "sweep_unfinished" }),
  }));
  assertEquals(res.status, 401);
  assertEquals(bad.stripe.calls.length, 0);
  assertEquals(h.pushes.length, 0);
});

Deno.test("#4271 B13 seen records it, with the same auth as cancel", async () => {
  const stripe = fakeStripe();
  const updates: unknown[] = [];
  const db = new FakeDb(
    (op) => {
      if (op.table === "door_tap_intents" && op.action === "select") {
        return { data: { id: INTENT, event_id: EVENT, client_request_id: REQ }, error: null };
      }
      if (op.action === "update") updates.push(op.payload);
      return { data: null, error: null };
    },
    () => ({ data: true, error: null }),
  );
  const handler = createDoorTapIntentHandler({
    serviceClient: () => db, userIdFromAuthHeader: auth, stripe: () => stripe.client,
  });
  const ok = await handler(post({ action: "seen", paymentIntentId: "pi_door1", clientRequestId: REQ }));
  assertEquals(await ok.json(), { status: "seen" });
  assertEquals(typeof (updates[0] as { outcome_seen_at: string }).outcome_seen_at, "string");

  const wrongSale = await handler(post({
    action: "seen", paymentIntentId: "pi_door1", clientRequestId: "42710000-0000-4000-8000-0000000000ff",
  }));
  assertEquals(wrongSale.status, 404);

  const denied = await createDoorTapIntentHandler({
    serviceClient: () => new FakeDb(
      () => ({ data: { id: INTENT, event_id: EVENT, client_request_id: REQ }, error: null }),
      () => ({ data: false, error: null }),
    ),
    userIdFromAuthHeader: auth,
    stripe: () => stripe.client,
  })(post({ action: "seen", paymentIntentId: "pi_door1", clientRequestId: REQ }));
  assertEquals((await denied.json()).error, "door_access_denied");
});
