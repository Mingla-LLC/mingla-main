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
) {
  return new FakeDb(
    (op) => {
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
