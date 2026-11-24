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
// After the discount reservation reprices a guest order, `venueOrderRepricedVerdict`
// decides it again on the FINAL total: a free/paid flip goes back to review
// and a paid total is held to the floor (review of #4565).
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
  venueOrderRepricedVerdict,
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

Deno.test("#3645 repriced: free → paid after the reservation sends the guest back to review, never a free completion", () => {
  // The bug: movesMoney was decided on the pre-reservation total (0), so a
  // repriced 2500 landed as payment_status 'paid' with nothing charged.
  assertEquals(venueOrderRepricedVerdict(false, 2_500, "USD"), { kind: "review" });
  // Even a total under the floor is a review first: the guest must see it.
  assertEquals(venueOrderRepricedVerdict(false, 1, "USD"), { kind: "review" });
  assertEquals(venueOrderRepricedVerdict(false, 1, "NGN"), { kind: "review" });
});

Deno.test("#3645 repriced: paid → free after the reservation sends the guest back to review, never a zero charge", () => {
  assertEquals(venueOrderRepricedVerdict(true, 0, "USD"), { kind: "review" });
  assertEquals(venueOrderRepricedVerdict(true, 0, "NGN"), { kind: "review" });
});

Deno.test("#3645 repriced: a paid total that stays paid is held to the floor on the FINAL amount", () => {
  const verdict = venueOrderRepricedVerdict(true, 49, "USD");
  assertEquals(verdict.kind, "refuse");
  if (verdict.kind !== "refuse") return;
  assertEquals(verdict.refusal, venueOrderProviderFloorRefusal(49, "USD", "guest"));
  assertEquals(verdict.refusal.status, 422);
  assertEquals(verdict.refusal.body.error, "order_below_provider_minimum");
  assertEquals(verdict.refusal.body.minCents, 50);
  // Paystack charges naira: the ₦100 floor applies.
  const ngn = venueOrderRepricedVerdict(true, 9_999, "NGN");
  assertEquals(ngn.kind, "refuse");
  if (ngn.kind === "refuse") assertEquals(ngn.refusal.body.minCents, 10_000);
});

Deno.test("#3645 repriced: unchanged free, paid at or above the floor, and unknown-currency paid totals proceed", () => {
  assertEquals(venueOrderRepricedVerdict(false, 0, "USD"), { kind: "proceed" });
  assertEquals(venueOrderRepricedVerdict(true, 50, "USD"), { kind: "proceed" });
  assertEquals(venueOrderRepricedVerdict(true, 10_000, "NGN"), { kind: "proceed" });
  assertEquals(venueOrderRepricedVerdict(true, 1, "BGN"), { kind: "proceed" });
});

Deno.test("#3645 venue-order-create: after the reservation reprices, the verdict runs on the final total, hands the uses back, and answers before any row or provider call", async () => {
  const source = await Deno.readTextFile(
    new URL("../../venue-order-create/index.ts", import.meta.url),
  );
  const verdict = `const repriced = venueOrderRepricedVerdict(
      movesMoney,
      money.totalCents,
      venueOrderChargeCurrency(routing.provider, settlementCurrency),
    );
    if (repriced.kind !== "proceed") {
      await releaseDiscountUses();
      if (repriced.kind === "refuse") {
        return jsonResponse(repriced.refusal.body, repriced.refusal.status);
      }
      return checkoutReviewRequired(discountQuote, pricedDiscount, reviewDetail);
    }`;
  assertEquals(source.split(verdict).length, 2, "exactly one post-reservation verdict");
  const at = source.indexOf(verdict);
  // The old movesMoney-gated recheck (which skipped free → paid) is gone.
  assertEquals(source.includes("const reservedRefusal ="), false);
  // It reads the total the reservation just priced…
  const repricedAt = source.indexOf(
    "({ discountedCart, money, notices, pricingBreakdown } = pricedDiscount);",
  );
  assert(repricedAt > source.indexOf("callReserveDiscountUses(supabase, {"));
  assert(at > repricedAt, "verdict must follow the reservation's repricing");
  // …inside the discount branch (only a reservation can change the total)…
  const branch = source.indexOf("if (discountedCart.discountCents > 0) {");
  assert(branch >= 0 && branch < repricedAt);
  assert(
    at < source.indexOf("let referralAttribution: ReferrerResolution;", repricedAt),
  );
  // …and before every write or provider call, including the ones that read
  // movesMoney (row payment state, the zero-total completion).
  for (
    const later of [
      '.from("venue_order_sessions")\n      .insert(',
      "await insertVenueOrderRow(",
      'payment_status: movesMoney ? "pending" : "paid"',
      "if (!movesMoney) {",
      "paystackInitializeTransaction({",
      "checkout.sessions.create(",
      "paymentIntents.create(",
    ]
  ) {
    assert(source.indexOf(later, repricedAt) > at, `verdict must precede ${later}`);
  }
  // The release really hands the reserved uses back for this order.
  const release = between(
    source,
    "const releaseDiscountUses = async (): Promise<void> => {",
    "};",
  );
  assert(release.includes("if (!discountUsesReserved) return;"));
  assert(
    release.includes('callReleaseDiscountUses(supabase, "venue_order", orderId)'),
  );
  // Both review answers share one shape (the client already handles it).
  assertEquals(source.split('error: "checkout_review_required"').length, 2);
  assertEquals(source.split("return checkoutReviewRequired(").length, 3);
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
