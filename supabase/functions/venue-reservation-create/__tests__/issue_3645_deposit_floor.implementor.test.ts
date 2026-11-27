// Issue #3645 (payments audit item 7 follow-through) — a reservation fee or
// table hold above zero but below the provider's minimum charge (for example
// a ₦50 deposit, or ₦150 a discount brings to ₦60) is refused before any
// discount use is reserved, any session row is written or any provider is
// called, on both the Paystack and the Stripe arm.
//
// The handler is a serve() entry with no injection seam, so placement is
// proven on the source (the issue_3872 deposit pattern); the decision itself
// is a pure helper tested by value.
//
// FAILS-ON-REVERT: delete either arm's refusal, or move it after
// reserveDiscountUses / the session insert / the provider call -> the
// matching order case fails.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  RESERVATION_BELOW_PROVIDER_MINIMUM,
  reservationProviderFloorRefusal,
} from "../depositFloor.ts";
import {
  BELOW_PROVIDER_MINIMUM_COPY,
  DEPOSIT_UNCONFIGURED_COPY,
  guestReservationFailureCopy,
} from "../../../../packages/brand-rendering/venueGuestReservationErrorCopy.ts";

const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));

Deno.test("#3645 below the floor is refused with the floor and the charge currency", () => {
  assertEquals(reservationProviderFloorRefusal(9_999, "NGN"), {
    status: 422,
    body: { error: RESERVATION_BELOW_PROVIDER_MINIMUM, minCents: 10_000, currency: "NGN" },
  });
  assertEquals(reservationProviderFloorRefusal(6_000, "NGN")?.body.minCents, 10_000);
  // The Stripe arm passes the brand's lower-case settlement currency.
  assertEquals(reservationProviderFloorRefusal(29, "gbp")?.body, {
    error: RESERVATION_BELOW_PROVIDER_MINIMUM,
    minCents: 30,
    currency: "GBP",
  });
  assertEquals(reservationProviderFloorRefusal(49, " usd ")?.body.currency, "USD");
});

Deno.test("#3645 at the floor, free, invalid or a currency with no known floor passes", () => {
  assertEquals(reservationProviderFloorRefusal(10_000, "NGN"), null);
  assertEquals(reservationProviderFloorRefusal(30, "gbp"), null);
  assertEquals(reservationProviderFloorRefusal(0, "NGN"), null);
  assertEquals(reservationProviderFloorRefusal(-5, "NGN"), null);
  assertEquals(reservationProviderFloorRefusal(Number.NaN, "NGN"), null);
  assertEquals(reservationProviderFloorRefusal(1, "BGN"), null);
  assertEquals(reservationProviderFloorRefusal(1, "ISK"), null);
});

/** Index of `needle` after `from`, failing loudly when absent. */
const at = (needle: string, from: number): number => {
  const i = source.indexOf(needle, from);
  assert(i >= 0, `missing after ${from}: ${needle}`);
  return i;
};

Deno.test("#3645 Paystack arm: the exact NGN charge is checked before reserve, insert and initialize", () => {
  const arm = at('if (providerRouting.provider === "paystack") {', 0);
  const charged = at("const psBuyerTotalCents = depositMoney.totalCents;", arm);
  const check = at("reservationProviderFloorRefusal(\n      psBuyerTotalCents,\n      \"NGN\",", arm);
  const refuse = at("return jsonResponse(psFloorRefusal.body, psFloorRefusal.status);", check);
  const reserve = at("await reserveDiscountUses(sessionExpiresAt)", arm);
  const insert = at("await insertReservationSession(", arm);
  const provider = at("await paystackInitializeTransaction({", arm);
  const sent = at("amountSubunits: psBuyerTotalCents,", provider);
  assert(charged < check && check < refuse && refuse < reserve, "refusal must come before the discount reserve");
  assert(reserve < insert && insert < provider && provider < sent);
});

Deno.test("#3645 Stripe arm: the exact charged total is checked before reserve, insert and the provider", () => {
  const arm = at("// ── STRIPE ARM", 0);
  const ready = at('return jsonResponse({ error: "stripe_account_not_ready" }, 409);', arm);
  const charged = at("const totalCents = pricingBreakdown.buyer_total_cents;", arm);
  const check = at("reservationProviderFloorRefusal(\n    totalCents,\n    currency,", arm);
  const refuse = at("return jsonResponse(stripeFloorRefusal.body, stripeFloorRefusal.status);", check);
  const reserve = at("await reserveDiscountUses(sessionExpiresAt)", arm);
  const insert = at("await insertReservationSession(", arm);
  const provider = source.indexOf("stripe.", insert);
  assert(provider > insert, "no Stripe call after the insert");
  assert(ready < charged && charged < check && check < refuse && refuse < reserve);
  assert(reserve < insert);
});

Deno.test("#3645 the free path and preview never reach the floor check", () => {
  const free = at("if (depositNetCents === 0) {", 0);
  const freeEnd = at("completeFreeReservation(supabase, {", free);
  assert(!source.slice(free, freeEnd).includes("reservationProviderFloorRefusal"));
  const preview = at('if (mode === "preview") return jsonResponse(previewPayload(discountQuote));', 0);
  assert(preview < source.indexOf("reservationProviderFloorRefusal("));
  // Exactly the two arms call it.
  assertEquals(source.split("reservationProviderFloorRefusal(").length - 1, 2);
});

Deno.test("#3645 the guest copy for the refusal, shared by Host web and Explorer", () => {
  assertEquals(
    guestReservationFailureCopy("reservation_below_provider_minimum"),
    BELOW_PROVIDER_MINIMUM_COPY,
  );
  assert(BELOW_PROVIDER_MINIMUM_COPY.includes("Nothing has been charged."));
  // Unchanged neighbours.
  assertEquals(guestReservationFailureCopy("deposit_amount_unconfigured"), DEPOSIT_UNCONFIGURED_COPY);
  assertEquals(
    guestReservationFailureCopy("amount_too_large"),
    "This table's deposit is above what one payment can take. Ask the venue.",
  );
  assertEquals(guestReservationFailureCopy("reservation_session_failed"), null);
});
