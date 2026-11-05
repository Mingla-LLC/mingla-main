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
