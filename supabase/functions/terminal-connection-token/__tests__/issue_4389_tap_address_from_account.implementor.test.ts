// Issue #4389 — Tap to Pay on iPhone takes its Location address from the
// connected account (Stripe already collected and verified it), then the T1
// fallback, then the old sources. No usable address is address_missing with
// the T1 route, never a dead end. The bank country (payout_country) decides
// the Location country.
//
// MINGLA-INVARIANT: I-4389-TAP-ADDRESS-FROM-ACCOUNT | issue #4389 | the Terminal Location address is the account's identity address first, brands.tap_location_address second; address_missing always carries route /brand/{id}/tap-to-pay/address.
//
// FAILS-ON-REVERT: dropping `accountAddress` from terminalAddressFor's source
// list fails tests 1 and 2 (the brand line is used instead); dropping
// `tapAddressRoute` from the refusal fails test 4.
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { createTerminalConnectionTokenHandler } from "../index.ts";
import { terminalAddressFor } from "../../_shared/doorTerminal.ts";
import { identityAddressOf } from "../../_shared/stripeBlueprintClient.ts";
import { FakeDb, fakeStripe, post } from "../../_shared/__tests__/doorPayFakes.ts";

const BRAND = "43890000-0000-4000-8000-0000000000c3";
const ACTOR = "43890000-0000-4000-8000-0000000000c4";

function db(brand: Record<string, unknown>): FakeDb {
  const row = {
    id: BRAND, name: "Night Owl", payment_provider: "stripe", address: null, city: null,
    country_code: null, payment_country: null, default_currency: "USD", payout_country: "US",
    tap_location_address: null, stripe_connect_id: "acct_4389", stripe_charges_enabled: true,
    ...brand,
  };
  return new FakeDb(
    (op) => {
      if (op.table === "brands") return { data: row, error: null };
      if (op.table === "brand_terminal_locations" && op.action === "select") return { data: null, error: null };
      return { data: null, error: null };
    },
    (name) => {
      if (name === "biz_tap_to_pay_release") return { data: { iphone: true, android: true }, error: null };
      if (name === "issue_4271_can_take_brand_door_payment") return { data: true, error: null };
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    },
  );
}

function handler(d: FakeDb, s: ReturnType<typeof fakeStripe>, account: Record<string, unknown> | null) {
  return createTerminalConnectionTokenHandler({
    serviceClient: () => d,
    userIdFromAuthHeader: () => Promise.resolve(ACTOR),
    stripe: () => s.client,
    accountAddress: () => Promise.resolve(account),
  });
}

const locationAddress = (s: ReturnType<typeof fakeStripe>): unknown =>
  (s.calls.find((c) => c.method === "terminal.locations.create")?.params as { address?: unknown } | undefined)
    ?.address;

Deno.test("#4389 1 — a finished US account gets a Location from its own address, nothing typed in Mingla", async () => {
  const s = fakeStripe();
  const res = await handler(db({}), s, {
    line1: "1520 N Milwaukee Ave", city: "Chicago", state: "IL", postal_code: "60622", country: "US",
  })(post({ brandId: BRAND, platform: "ios" }));
  assertEquals(res.status, 200);
  assertEquals(locationAddress(s), {
    line1: "1520 N Milwaukee Ave", city: "Chicago", state: "IL", postal_code: "60622", country: "US",
  });
});

Deno.test("#4389 2 — a finished GB account too", async () => {
  const s = fakeStripe();
  const res = await handler(db({ payout_country: "GB", default_currency: "GBP" }), s, {
    line1: "14 Redchurch Street", city: "London", postal_code: "E2 7DJ", country: "GB",
  })(post({ brandId: BRAND, platform: "ios" }));
  assertEquals(res.status, 200);
  assertEquals(locationAddress(s), {
    line1: "14 Redchurch Street", city: "London", postal_code: "E2 7DJ", country: "GB",
  });
});

Deno.test("#4389 3 — no account address: the T1 address is used", async () => {
  const s = fakeStripe();
  const res = await handler(db({
    tap_location_address: { line1: "1520 N Milwaukee Ave", line2: "Unit 2", city: "Chicago", state: "IL", postal_code: "60622", country: "US" },
  }), s, null)(post({ brandId: BRAND, platform: "ios" }));
  assertEquals(res.status, 200);
  assertEquals((locationAddress(s) as { line1: string }).line1, "1520 N Milwaukee Ave, Unit 2");
});

Deno.test("#4389 4 — nothing usable: address_missing names the T1 screen; Stripe is never asked", async () => {
  const s = fakeStripe();
  const res = await handler(db({}), s, { line1: "Chicago", city: "", country: "US" })(
    post({ brandId: BRAND, platform: "ios" }),
  );
  assertEquals(res.status, 400);
  assertEquals(await res.json(), {
    error: "tap_not_available",
    reason: "address_missing",
    route: `/brand/${BRAND}/tap-to-pay/address`,
  });
  assertEquals(s.calls.length, 0);
});

Deno.test("#4389 5 — the bank country decides: a GB address on a US brand is never used", () => {
  assertEquals(
    terminalAddressFor({
      accountAddress: { line1: "14 Redchurch Street", city: "London", postal_code: "E2 7DJ", country: "GB" },
      venueTaxAddress: null, brandAddress: null, brandCity: null, country: "US",
    }),
    null,
  );
});

Deno.test("#4389 6 — identityAddressOf reads company first, individual for an individual", () => {
  const company = { line1: "1 Co St", city: "Chicago", country: "US" };
  const person = { line1: "2 Home Rd", city: "Chicago", country: "US" };
  assertEquals(identityAddressOf({ id: "a", identity: { entity_type: "company", business_details: { address: company }, individual: { address: person } } }), company);
  assertEquals(identityAddressOf({ id: "a", identity: { entity_type: "individual", business_details: { address: company }, individual: { address: person } } }), person);
  assert(identityAddressOf({ id: "a", identity: { entity_type: "company", business_details: { address: { line1: " " } } } }) === null);
});
