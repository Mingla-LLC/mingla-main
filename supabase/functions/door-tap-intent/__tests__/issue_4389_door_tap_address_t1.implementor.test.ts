// Issue #4389 — the host's T1 Tap to Pay address (brands.tap_location_address)
// must count at the door. Seen on Seth's iPhone (local log 04:12:27Z–04:13:31Z):
// with the address saved, Take a payment → Charge still answered
// address_missing, because door-tap-intent's EVENT paths (create, and location
// with an eventId) never passed it to terminalAddressFor; only the brand-only
// path read it.
// FAILS ON REVERT: drop `tapLocationAddress: tap.tapLocationAddress` from
// either event path → that test gets 400 address_missing.
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { createDoorTapIntentHandler } from "../index.ts";
import { type DbOp, FakeDb, fakeStripe, post, PRICING_ROW } from "../../_shared/__tests__/doorPayFakes.ts";

const TAP_ADDRESS = { line1: "1 Market St", city: "San Francisco", state: "CA", postal_code: "94105", country: "US" };

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
      id: BRAND, name: "Door Brand", address: null, city: null,
      country_code: country, payment_country: country, payment_provider: provider,
      stripe_connect_id: "acct_door1", stripe_charges_enabled: true,
      payout_hold_cutover_at: null,
      tap_location_address: TAP_ADDRESS,
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
  noTapAddress?: boolean;
} = {}) {
  return new FakeDb(
    (op: DbOp) => {
      if (op.table === "events" && options.eventsReadFails) {
        return { data: null, error: { message: "canceling statement due to statement timeout" } };
      }
      if (op.table === "events") {
        const row = brandRow(options.provider ?? "stripe");
        return {
          data: {
            ...row,
            brands: {
              ...row.brands,
              stripe_charges_enabled: true,
              tap_location_address: options.noTapAddress ? null : TAP_ADDRESS,
            },
          },
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
// No venue tax address and no usable brand address: only the T1 address can make the Location.
const NO_VENUE = { pricing: { venue_tax_address: null } };

const locationPostal = (stripe: ReturnType<typeof fakeStripe>): string => {
  const location = stripe.calls.find((c) => c.method === "terminal.locations.create")!;
  return ((location.params as Record<string, unknown>).address as Record<string, string>).postal_code;
};

Deno.test("#4389 door Charge (create) uses the host's T1 address", async () => {
  const db = makeDb(NO_VENUE);
  const stripe = fakeStripe();
  const res = await createDoorTapIntentHandler({
    serviceClient: () => db, userIdFromAuthHeader: auth, stripe: () => stripe.client,
  })(post({
    action: "create", platform: "ios", eventId: EVENT, eventDateId: null, clientRequestId: REQ,
    lines: [{ ticketTypeId: TIER, quantity: 1 }], buyerPhone: null,
  }));
  assertEquals(res.status, 200);
  assertEquals(locationPostal(stripe), "94105");
});

Deno.test("#4389 door location (with an event) uses the host's T1 address", async () => {
  const db = makeDb(NO_VENUE);
  const stripe = fakeStripe();
  const res = await createDoorTapIntentHandler({
    serviceClient: () => db, userIdFromAuthHeader: auth, stripe: () => stripe.client,
  })(post({ action: "location", platform: "ios", eventId: EVENT }));
  assertEquals(await res.json(), { locationId: "tml_door1" });
  assertEquals(locationPostal(stripe), "94105");
});

Deno.test("#4389 still address_missing when there is truly no address", async () => {
  const db = makeDb({ ...NO_VENUE, noTapAddress: true });
  const stripe = fakeStripe();
  const res = await createDoorTapIntentHandler({
    serviceClient: () => db, userIdFromAuthHeader: auth, stripe: () => stripe.client,
  })(post({ action: "location", platform: "ios", eventId: EVENT }));
  assertEquals(res.status, 400);
  assertEquals(await res.json(), { error: "tap_not_available", reason: "address_missing" });
});
