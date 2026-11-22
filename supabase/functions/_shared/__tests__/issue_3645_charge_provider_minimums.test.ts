// Issue #3645 (18 Nov payments audit, item 7) — amounts typed at charge time
// (chip-ins, venue orders, bill-to-phone and tab settlements) are refused
// below the payment provider's minimum charge, before any row or provider
// call. The floor table is the one the publish-time ticket rule already uses
// (`_shared/money/providerMinimums.ts`, mirrored in SQL and the Host and kept
// identical by issue_3355_money_flow.implementor.test.ts).
//
// The chip-in refusal is proven on the real handler in
// rsvp-contribution-create/__tests__/issue_3645_chip_in_provider_minimum.test.ts.
// The venue handlers have no runtime harness in this repo (their suites are
// source-seam suites, e.g. issue_3872_venue_discounts.implementor.test.ts), so
// the venue half is proven here by the ONE shared refusal both handlers call
// (`venueOrderProviderFloorRefusal`: status, body and each audience's words),
// plus seams pinning the exact call (amount, charge currency, audience) and
// where it sits: after the replay, before every row write and provider call.
//
// Fails on revert: removing the helper or either venue check fails the
// boundary or seam tests below.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  chargeBelowProviderMinimum,
  PROVIDER_MINIMUM_CHARGE_MINOR,
  providerMinimumText,
} from "../money/providerMinimums.ts";
import {
  VENUE_ORDER_ERRORS,
  venueOrderChargeCurrency,
  venueOrderErrorCopy,
  venueOrderErrorStatus,
  venueOrderProviderFloorRefusal,
} from "../venueOrderPricing.ts";

Deno.test("#3645 floor: one minor unit under the minimum returns the floor, for every listed currency", () => {
  for (const [currency, floor] of Object.entries(PROVIDER_MINIMUM_CHARGE_MINOR)) {
    assertEquals(chargeBelowProviderMinimum(floor - 1, currency), floor, currency);
    assertEquals(chargeBelowProviderMinimum(1, currency), floor, currency);
    assertEquals(chargeBelowProviderMinimum(floor, currency), null, currency);
    assertEquals(chargeBelowProviderMinimum(floor + 1, currency), null, currency);
  }
});

Deno.test("#3645 floor: the Paystack naira floor is Seth's ₦100 (10000 kobo)", () => {
  assertEquals(chargeBelowProviderMinimum(9_999, "NGN"), 10_000);
  assertEquals(chargeBelowProviderMinimum(10_000, "NGN"), null);
  assertEquals(chargeBelowProviderMinimum(5_000, " ngn "), 10_000);
});

Deno.test("#3645 floor: free, invalid and unknown-currency amounts are never refused", () => {
  assertEquals(chargeBelowProviderMinimum(0, "NGN"), null);
  assertEquals(chargeBelowProviderMinimum(-100, "USD"), null);
  assertEquals(chargeBelowProviderMinimum(Number.NaN, "USD"), null);
  assertEquals(chargeBelowProviderMinimum(Number.POSITIVE_INFINITY, "USD"), null);
  // Not on Stripe's list: left open rather than guessed.
  assertEquals(chargeBelowProviderMinimum(1, "BGN"), null);
  assertEquals(chargeBelowProviderMinimum(1, "ISK"), null);
  assertEquals(chargeBelowProviderMinimum(1, null), null);
  assertEquals(chargeBelowProviderMinimum(1, 840), null);
});

Deno.test("#3645 floor text reads as money", () => {
  assertEquals(providerMinimumText(10_000, "NGN"), "₦100.00");
  assertEquals(providerMinimumText(30, "gbp"), "£0.30");
  assertEquals(providerMinimumText(50, "USD"), "US$0.50");
});

Deno.test("#3645 venue refusal copy: both audiences, the floor substituted, nothing charged, no provider names", () => {
  assertEquals(venueOrderErrorStatus("order_below_provider_minimum"), 422);
  for (const audience of ["guest", "staff"] as const) {
    const copy = venueOrderErrorCopy("order_below_provider_minimum", audience, {
      minimum: "₦100.00",
    });
    assert(copy !== null, audience);
    assert(copy.includes("₦100.00"), audience);
    assert(!copy.includes("{minimum}"), audience);
    assert(copy.includes("Nothing has been charged."), audience);
    assert(!/stripe|paystack/i.test(copy), audience);
  }
  // Staff are told the way out that works for a tab left at `settling`:
  // closing it as venue-collected (biz_venue_tab_close cancels a settlement
  // order that never left `venue_collected`).
  assert(
    VENUE_ORDER_ERRORS.order_below_provider_minimum.staff.includes(
      "Take it at the counter instead.",
    ),
  );
});

Deno.test("#3645 existing venue copy is unchanged by the new {minimum} slot", () => {
  assertEquals(
    venueOrderErrorCopy("order_total_invalid", "guest"),
    "We couldn't price that order. Nothing has been charged.",
  );
});

Deno.test("#3645 venue refusal: below the floor is a 422 with the floor, its currency and the audience's words", () => {
  const guest = venueOrderProviderFloorRefusal(9_999, "NGN", "guest");
  assertEquals(guest, {
    status: 422,
    body: {
      error: "order_below_provider_minimum",
      message:
        "Card payments start at ₦100.00. Add a little more to your order. Nothing has been charged.",
      minCents: 10_000,
      currency: "NGN",
    },
  });
  const staff = venueOrderProviderFloorRefusal(29, "gbp", "staff");
  assertEquals(staff, {
    status: 422,
    body: {
      error: "order_below_provider_minimum",
      message:
        "That's too small to bill to a phone: card payments start at £0.30. Take it at the counter instead. Nothing has been charged.",
      minCents: 30,
      currency: "GBP",
    },
  });
});

Deno.test("#3645 venue refusal: free, at-the-floor, fees-lifted and unknown-currency totals pass", () => {
  assertEquals(venueOrderProviderFloorRefusal(0, "NGN", "guest"), null);
  assertEquals(venueOrderProviderFloorRefusal(10_000, "NGN", "guest"), null);
  // A subtotal under the floor whose passed fees / tip lift the TOTAL to it:
  // the check is on the total, so it goes through.
  assertEquals(venueOrderProviderFloorRefusal(50, "USD", "staff"), null);
  assertEquals(venueOrderProviderFloorRefusal(1, "BGN", "guest"), null);
});

Deno.test("#3645 venue charge currency: Paystack charges NGN whatever the pricing currency says", () => {
  assertEquals(venueOrderChargeCurrency("paystack", "USD"), "NGN");
  assertEquals(venueOrderChargeCurrency("paystack", "NGN"), "NGN");
  assertEquals(venueOrderChargeCurrency("stripe", "GBP"), "GBP");
  // A USD-priced Paystack brand: ₦99.99 is refused even though 9,999 "cents"
  // would clear the USD floor.
  assertEquals(
    venueOrderProviderFloorRefusal(
      9_999,
      venueOrderChargeCurrency("paystack", "USD"),
      "guest",
    )?.body.minCents,
    10_000,
  );
});

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert(from >= 0, `missing ${start}`);
  assert(to > from, `missing ${end} after ${start}`);
  return source.slice(from, to);
}

Deno.test("#3645 venue-order-create: the guest floor runs on the charged total in the charged currency, after replay and before any reservation, row or provider call", async () => {
  const source = await Deno.readTextFile(
    new URL("../../venue-order-create/index.ts", import.meta.url),
  );
  const call = `if (movesMoney) {
    const refusal = venueOrderProviderFloorRefusal(
      money.totalCents,
      venueOrderChargeCurrency(routing.provider, settlementCurrency),
      "guest",
    );
    if (refusal) return jsonResponse(refusal.body, refusal.status);
  }`;
  assertEquals(source.split(call).length, 2, "exactly one guest floor call");
  const check = source.indexOf(call);
  // A retry of an order that already exists keeps resuming it.
  assert(check > source.indexOf("await findReplayableVenueOrder("));
  assert(check > source.indexOf('kind: "already_created"'));
  for (
    const later of [
      "callReserveDiscountUses(supabase, {",
      '.from("venue_order_sessions")\n      .insert(',
      "await insertVenueOrderRow(",
      "paystackInitializeTransaction({",
      "checkout.sessions.create(",
      "paymentIntents.create(",
    ]
  ) {
    const at = source.indexOf(later);
    assert(at > check, `floor must precede ${later}`);
  }
});

Deno.test("#3645 venue-order-staff: billToPhone refuses below the floor before the order moves to Mingla or a provider is called", async () => {
  const source = await Deno.readTextFile(
    new URL("../../venue-order-staff/index.ts", import.meta.url),
  );
  const body = between(
    source,
    "async function billToPhone(",
    "async function handleTabClose(",
  );
  const call = `const refusal = venueOrderProviderFloorRefusal(
    money.totalCents,
    venueOrderChargeCurrency(routing.provider, settlementCurrency),
    "staff",
  );
  if (refusal) return jsonResponse(refusal.body, refusal.status);`;
  assertEquals(body.split(call).length, 2, "exactly one staff floor call");
  const check = body.indexOf(call);
  assert(
    check >
      body.indexOf('if (money.totalCents <= 0) return fail("order_total_invalid");'),
  );
  for (const later of [".update({", "paystackInitializeTransaction({", "paymentIntents.create("]) {
    const at = body.indexOf(later);
    assert(at > check, `floor must precede ${later}`);
  }
  // Both staff money paths (settle one order, close a tab) end in billToPhone.
  assertEquals(source.match(/return await billToPhone\(supabase, \{/g)?.length, 2);
  // And the Paystack rails really do charge NGN (what venueOrderChargeCurrency
  // assumes).
  assert(body.includes('currency: "NGN",'));
});
