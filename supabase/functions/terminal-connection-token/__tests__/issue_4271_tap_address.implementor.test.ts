// Issue #4271 — Tap to Pay needs a full Stripe address and a country.
//
// Live, an iPhone got a 500 from terminal-connection-token: the brand path built
// the Location address from the brand's one-line address and city only, and
// Stripe refused it ("Missing required address field for a Location in US:
// address[state]"). Brands with no country were also refused although the app
// offers Tap to Pay from their currency. These pin the fix with the live strings.
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { createTerminalConnectionTokenHandler } from "../index.ts";
import { createDoorTapIntentHandler } from "../../door-tap-intent/index.ts";
import {
  isStripeAddressError,
  parseBrandAddress,
  terminalAddressFor,
} from "../../_shared/doorTerminal.ts";
import {
  FakeDb,
  fakeStripe,
  post,
  PRICING_ROW,
  stripeLocationAddressError,
} from "../../_shared/__tests__/doorPayFakes.ts";

const EVENT = "42710000-0000-4000-8000-0000000000c1";
const BRAND = "42710000-0000-4000-8000-0000000000c3";
const ACTOR = "42710000-0000-4000-8000-0000000000c4";

const LIVE_ADDRESS = "700 Corporate Center Dr, Raleigh, NC 27607";
const RALEIGH = {
  line1: "700 Corporate Center Dr",
  city: "Raleigh",
  state: "NC",
  postal_code: "27607",
  country: "US",
};

// ---- parsing ----------------------------------------------------------------

Deno.test("#4271 tap-address: the live brand string with its city gives Stripe every US field", () => {
  assertEquals(parseBrandAddress(LIVE_ADDRESS, "Raleigh", "US"), RALEIGH);
});

Deno.test("#4271 tap-address: the live brand string with no city still gives every US field", () => {
  assertEquals(parseBrandAddress(LIVE_ADDRESS, null, "US"), RALEIGH);
  assertEquals(parseBrandAddress(LIVE_ADDRESS, "", "us"), RALEIGH);
});

Deno.test("#4271 tap-address: US variants (country suffix, ZIP+4, no comma, full state name, suite, city not repeated)", () => {
  assertEquals(parseBrandAddress(`${LIVE_ADDRESS}, USA`, "Raleigh", "US"), RALEIGH);
  assertEquals(parseBrandAddress(`${LIVE_ADDRESS}, United States`, null, "US"), RALEIGH);
  assertEquals(parseBrandAddress("700 Corporate Center Dr, Raleigh NC 27607", null, "US"), RALEIGH);
  assertEquals(parseBrandAddress("700 Corporate Center Dr, Raleigh, North Carolina 27607", null, "US"), RALEIGH);
  assertEquals(parseBrandAddress("700 Corporate Center Dr, NC 27607", "Raleigh", "US"), RALEIGH);
  assertEquals(parseBrandAddress("700 Corporate Center Dr Raleigh NC 27607", "Raleigh", "US"), RALEIGH);
  assertEquals(
    parseBrandAddress("700 Corporate Center Dr, Raleigh, NC 27607-1234", "Raleigh", "US"),
    { ...RALEIGH, postal_code: "27607-1234" },
  );
  assertEquals(
    parseBrandAddress("700 Corporate Center Dr, Suite 200, Raleigh, NC 27607", null, "US"),
    { ...RALEIGH, line1: "700 Corporate Center Dr, Suite 200" },
  );
});

Deno.test("#4271 tap-address: UK postcodes, with and without the city and country", () => {
  assertEquals(parseBrandAddress("10 Downing Street, London SW1A 2AA", "London", "GB"), {
    line1: "10 Downing Street", city: "London", postal_code: "SW1A 2AA", country: "GB",
  });
  assertEquals(parseBrandAddress("221B Baker Street, London, NW1 6XE, UK", null, "GB"), {
    line1: "221B Baker Street", city: "London", postal_code: "NW1 6XE", country: "GB",
  });
  assertEquals(parseBrandAddress("1 Deansgate, m3 1az", "Manchester", "GB"), {
    line1: "1 Deansgate", city: "Manchester", postal_code: "M3 1AZ", country: "GB",
  });
  assertEquals(parseBrandAddress("5 High St, Leeds, LS17AA, United Kingdom", null, "GB"), {
    line1: "5 High St", city: "Leeds", postal_code: "LS1 7AA", country: "GB",
  });
});

Deno.test("#4271 tap-address: anything without a state and ZIP (or a postcode) is null, never partial", () => {
  for (
    const [address, city, country] of [
      ["", "Raleigh", "US"],
      [null, "Raleigh", "US"],
      ["asdf", null, "US"],
      ["700 Corporate Center Dr", "Raleigh", "US"],
      ["700 Corporate Center Dr, Raleigh, NC", null, "US"],
      ["700 Corporate Center Dr, Raleigh, ZZ 27607", null, "US"],
      ["Raleigh, NC 27607", "Raleigh", "US"],
      ["NC 27607", null, "US"],
      ["10 Downing Street, London", "London", "GB"],
      ["SW1A 2AA", null, "GB"],
      [LIVE_ADDRESS, "Raleigh", "GB"],
      [LIVE_ADDRESS, "Raleigh", "NG"],
    ] as Array<[string | null, string | null, string]>
  ) {
    assertEquals(parseBrandAddress(address, city, country), null, `${address} / ${city} / ${country}`);
  }
});

Deno.test("#4271 tap-address: the event's tax address wins only when it is complete", () => {
  const venue = { line1: "1 Main St", city: "Austin", state: "TX", postal_code: "78701", country: "US" };
  assertEquals(
    terminalAddressFor({ venueTaxAddress: venue, brandAddress: LIVE_ADDRESS, brandCity: "Raleigh", country: "US" }),
    venue,
  );
  // A venue with no state falls back to the brand's full address.
  assertEquals(
    terminalAddressFor({
      venueTaxAddress: { line1: "1 Main St", city: "Austin", country: "US" },
      brandAddress: LIVE_ADDRESS,
      brandCity: "Raleigh",
      country: "US",
    }),
    RALEIGH,
  );
  // The old shape {line1, city, country} is no longer an address.
  assertEquals(
    terminalAddressFor({ venueTaxAddress: null, brandAddress: "1 Main St", brandCity: "Austin", country: "US" }),
    null,
  );
});

Deno.test("#4271 tap-address: the fake Stripe enforces Stripe's real US and UK rules", () => {
  assertEquals(
    (stripeLocationAddressError({ line1: "700 Corporate Center Dr", city: "Raleigh", country: "US" }) ?? {}).param,
    "address[state]",
  );
  assertEquals(stripeLocationAddressError(RALEIGH), null);
  assertEquals(
    (stripeLocationAddressError({ line1: "1 A St", city: "London", country: "GB" }) ?? {}).param,
    "address[postal_code]",
  );
  assert(isStripeAddressError(stripeLocationAddressError({ line1: "x", city: "y", country: "US" })));
  assert(!isStripeAddressError(new Error("network down")));
  assert(!isStripeAddressError({ type: "StripeAPIError", message: "address" }));
});

// ---- handlers ---------------------------------------------------------------

interface BrandRow {
  address: string | null;
  city: string | null;
  country_code: string | null;
  payment_country: string | null;
  default_currency: string | null;
  payment_provider?: string;
}

const LIVE_BRAND: BrandRow = {
  address: LIVE_ADDRESS,
  city: "Raleigh",
  country_code: "US",
  payment_country: null,
  default_currency: "USD",
};

function makeDb(brand: BrandRow, opts: { cachedLocation?: string | null; venue?: unknown } = {}) {
  const row = {
    id: BRAND, name: "Raleigh Nights", payment_provider: "stripe",
    stripe_connect_id: "acct_door1", stripe_charges_enabled: true, payout_hold_cutover_at: null,
    ...brand,
  };
  return new FakeDb(
    (op) => {
      if (op.table === "brands") return { data: row, error: null };
      if (op.table === "events") return { data: { brand_id: BRAND, brands: row }, error: null };
      if (op.table === "brand_terminal_locations" && op.action === "select") {
        return {
          data: opts.cachedLocation ? { stripe_location_id: opts.cachedLocation } : null,
          error: null,
        };
      }
      return { data: null, error: null };
    },
    (name) => {
      if (name === "biz_tap_to_pay_release") return { data: { iphone: true, android: true }, error: null };
      if (name === "issue_4271_can_take_brand_door_payment") return { data: true, error: null };
      if (name === "issue_4271_can_take_door_payment") return { data: true, error: null };
      if (name === "resolve_event_pricing_inputs") {
        return {
          data: [{ ...PRICING_ROW, venue_tax_address: "venue" in opts ? opts.venue : null }],
          error: null,
        };
      }
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    },
  );
}

const auth = () => Promise.resolve(ACTOR);
const token = (db: FakeDb, stripe: ReturnType<typeof fakeStripe>) =>
  createTerminalConnectionTokenHandler({
    serviceClient: () => db, userIdFromAuthHeader: auth, stripe: () => stripe.client,
  });

Deno.test("#4271 tap-address: the live brand gets a token at a Location with the full address (was a 500)", async () => {
  const stripe = fakeStripe();
  const db = makeDb(LIVE_BRAND);
  const res = await token(db, stripe)(post({ brandId: BRAND, platform: "ios" }));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { secret: "pst_test_door", locationId: "tml_door1" });
  const location = stripe.calls.find((c) => c.method === "terminal.locations.create")!;
  assertEquals((location.params as { address: unknown }).address, RALEIGH);
  assertEquals(db.opsOn("brand_terminal_locations", "upsert").length, 1);
});

Deno.test("#4271 tap-address: a brand with no city and the whole address in one line also works", async () => {
  const stripe = fakeStripe();
  const res = await token(makeDb({ ...LIVE_BRAND, city: null }), stripe)(post({ brandId: BRAND, platform: "ios" }));
  assertEquals(res.status, 200);
  const location = stripe.calls.find((c) => c.method === "terminal.locations.create")!;
  assertEquals((location.params as { address: unknown }).address, RALEIGH);
});

Deno.test("#4271 tap-address: an incomplete address is address_missing and never reaches Stripe", async () => {
  for (const address of ["700 Corporate Center Dr", null, "Raleigh"]) {
    const stripe = fakeStripe();
    const res = await token(makeDb({ ...LIVE_BRAND, address }), stripe)(post({ brandId: BRAND, platform: "ios" }));
    assertEquals(res.status, 400);
    assertEquals(await res.json(), { error: "tap_not_available", reason: "address_missing" });
    assertEquals(stripe.calls.length, 0, `Stripe was called for ${address}`);
  }
  // The setup step (door-tap-intent location) says the same, also without Stripe.
  const stripe = fakeStripe();
  const loc = await createDoorTapIntentHandler({
    serviceClient: () => makeDb({ ...LIVE_BRAND, address: "700 Corporate Center Dr" }),
    userIdFromAuthHeader: auth,
    stripe: () => stripe.client,
  })(post({ action: "location", brandId: BRAND, platform: "ios" }));
  assertEquals(await loc.json(), { error: "tap_not_available", reason: "address_missing" });
  assertEquals(stripe.calls.length, 0);
});

Deno.test("#4271 tap-address: Stripe refusing the address is a 400 address_missing, never a 500", async () => {
  const stripe = fakeStripe({
    locationError: {
      type: "StripeInvalidRequestError",
      rawType: "invalid_request_error",
      param: "address[postal_code]",
      message: "Invalid US postal code",
    },
  });
  const db = makeDb(LIVE_BRAND);
  const res = await token(db, stripe)(post({ brandId: BRAND, platform: "ios" }));
  assertEquals(res.status, 400);
  assertEquals(await res.json(), { error: "tap_not_available", reason: "address_missing" });
  assertEquals(db.opsOn("brand_terminal_locations", "upsert").length, 0);
  assert(!stripe.calls.some((c) => c.method === "terminal.connectionTokens.create"));
});

Deno.test("#4271 tap-address: any other Stripe failure is still a server error", async () => {
  const stripe = fakeStripe({ locationError: { type: "StripeAPIError", message: "Stripe is down" } });
  const res = await token(makeDb(LIVE_BRAND), stripe)(post({ brandId: BRAND, platform: "ios" }));
  assertEquals(res.status, 500);
  assertEquals((await res.json()).error, "server_error");
});

Deno.test("#4271 tap-address: a brand with no country uses its Stripe currency, like the app", async () => {
  const us = fakeStripe();
  const usRes = await token(makeDb({ ...LIVE_BRAND, country_code: null, payment_country: null }), us)(
    post({ brandId: BRAND, platform: "ios" }),
  );
  assertEquals(usRes.status, 200);
  assertEquals(
    ((us.calls.find((c) => c.method === "terminal.locations.create")!.params) as { address: { country: string } })
      .address.country,
    "US",
  );

  const gb = fakeStripe();
  const gbRes = await token(
    makeDb({
      address: "10 Downing Street, London SW1A 2AA", city: "London",
      country_code: null, payment_country: null, default_currency: "GBP",
    }),
    gb,
  )(post({ brandId: BRAND, platform: "android" }));
  assertEquals(gbRes.status, 200);
  assertEquals(
    (gb.calls.find((c) => c.method === "terminal.locations.create")!.params as { address: unknown }).address,
    { line1: "10 Downing Street", city: "London", postal_code: "SW1A 2AA", country: "GB" },
  );

  for (const currency of [null, "NGN", "EUR"]) {
    const none = fakeStripe();
    const res = await token(
      makeDb({ ...LIVE_BRAND, country_code: null, payment_country: null, default_currency: currency }),
      none,
    )(post({ brandId: BRAND, platform: "ios" }));
    assertEquals(res.status, 400);
    assertEquals((await res.json()).error, "tap_not_available");
    assertEquals(none.calls.length, 0);
  }
});

Deno.test("#4271 tap-address: Paystack brands are still refused, whatever their currency", async () => {
  const stripe = fakeStripe();
  const res = await token(
    makeDb({ ...LIVE_BRAND, payment_provider: "paystack", country_code: null }),
    stripe,
  )(post({ brandId: BRAND, platform: "ios" }));
  assertEquals(await res.json(), { error: "tap_not_available" });
  assertEquals(stripe.calls.length, 0);
});

Deno.test("#4271 tap-address: a stored Location is reused, even when the brand address is incomplete", async () => {
  const stripe = fakeStripe();
  const res = await token(makeDb({ ...LIVE_BRAND, address: "700 Corporate Center Dr" }, { cachedLocation: "tml_saved" }), stripe)(
    post({ brandId: BRAND, platform: "ios" }),
  );
  assertEquals(await res.json(), { secret: "pst_test_door", locationId: "tml_saved" });
  assert(!stripe.calls.some((c) => c.method === "terminal.locations.create"));
});

Deno.test("#4271 tap-address: event path with no venue tax address uses the brand's full address", async () => {
  const stripe = fakeStripe();
  const res = await token(makeDb(LIVE_BRAND, { venue: null }), stripe)(post({ eventId: EVENT, platform: "ios" }));
  assertEquals(res.status, 200);
  const location = stripe.calls.find((c) => c.method === "terminal.locations.create")!;
  assertEquals((location.params as { address: unknown }).address, RALEIGH);

  const partial = fakeStripe();
  const refused = await token(
    makeDb({ ...LIVE_BRAND, address: "700 Corporate Center Dr" }, { venue: { line1: "1 Main St", city: "Austin" } }),
    partial,
  )(post({ eventId: EVENT, platform: "ios" }));
  assertEquals(await refused.json(), { error: "tap_not_available", reason: "address_missing" });
  assertEquals(partial.calls.length, 0);
});
