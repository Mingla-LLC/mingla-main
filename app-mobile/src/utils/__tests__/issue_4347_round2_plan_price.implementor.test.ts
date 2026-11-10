// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4347 round 2 (Seth, 2026-11-09) — real price estimates on AI plans.
//
// An AI plan's stop prices are Google's per-person range in the PLACE's
// currency (₦100,000 at The Burgundy, Abuja). Read as US dollars, every paid
// Lagos/Abuja stop was "Upscale" and no amount was ever shown. Stops now carry
// `priceCurrency` + Google's `priceLevel`; the plan shows "From ≈ X pp" when
// every paying stop is priced in one currency, else the spend level taken from
// Google's level. Cards built before round 2 keep the old word until refresh.
//
// FAILS-ON-REVERT: deleting the `priced` branch of stopPriceView, the paying
// guard in curatedPlanEstimate, or the Google-level branch of curatedSpendLevel
// fails here.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { curatedPlanEstimate, curatedSpendLevel, stopPriceView } from "../curatedPriceRange.ts";

const burgundy = { priceMin: 100000, priceMax: 100000, priceOpenEnded: true, priceCurrency: "NGN", priceLevel: "PRICE_LEVEL_VERY_EXPENSIVE", placeType: "upscale_fine_dining" };
const gallery = { priceMin: 0, priceMax: 0, priceCurrency: null, priceLevel: null, placeType: "creative_arts" };
const park = { priceMin: 0, priceMax: 0, priceCurrency: null, priceLevel: "PRICE_LEVEL_FREE", placeType: "nature" };
const barNoRange = { priceMin: 0, priceMax: 0, priceCurrency: null, priceLevel: "PRICE_LEVEL_MODERATE", placeType: "drinks_and_music" };

Deno.test("#4347 r2 a stop with a currency and a start price is PRICED, in its own currency", () => {
  assertEquals(stopPriceView(burgundy), { kind: "priced", min: 100000, max: 100000, openEnded: true, currency: "NGN" });
  assertEquals(stopPriceView({ priceMin: 20, priceMax: 40, priceCurrency: "GBP" }), { kind: "priced", min: 20, max: 40, openEnded: false, currency: "GBP" });
});

Deno.test("#4347 r2 FREE only when Google says so; otherwise UNKNOWN, flagged when people pay there", () => {
  assertEquals(stopPriceView(park), { kind: "free" });
  assertEquals(stopPriceView(gallery), { kind: "unknown", paying: false });
  assertEquals(stopPriceView(barNoRange), { kind: "unknown", paying: true });
  // An amount without a currency is never priced (that was the bug).
  assertEquals(stopPriceView({ priceMin: 100000, priceMax: 100000, placeType: "fine_dining", priceCurrency: null }), { kind: "unknown", paying: true });
});

Deno.test("#4347 r2 the screenshot plan (gallery + The Burgundy) estimates From ₦100,000", () => {
  assertEquals(curatedPlanEstimate([gallery, burgundy]), { min: 100000, currency: "NGN" });
  assertEquals(curatedPlanEstimate([park, { ...burgundy, priceMin: 30000, priceMax: 50000, priceOpenEnded: false }, burgundy]), { min: 130000, currency: "NGN" });
});

Deno.test("#4347 r2 no honest total: a paying stop without a price, mixed currencies, or nothing priced", () => {
  assertEquals(curatedPlanEstimate([burgundy, barNoRange]), null);
  assertEquals(curatedPlanEstimate([burgundy, { ...burgundy, priceCurrency: "USD" }]), null);
  assertEquals(curatedPlanEstimate([gallery, park]), null);
  assertEquals(curatedPlanEstimate([]), null);
});

Deno.test("#4347 r2 the fallback level is Google's, never inferred from local-currency amounts", () => {
  assertEquals(curatedSpendLevel([burgundy, barNoRange]), "upscale");
  assertEquals(curatedSpendLevel([barNoRange, gallery]), "moderate");
  assertEquals(curatedSpendLevel([park]), "free");
  // Round-2 stops with no level anywhere: say nothing rather than guess.
  assertEquals(curatedSpendLevel([gallery]), null);
  // A ₦8,000 café with an INEXPENSIVE level is Budget, not "Upscale" (8000 > 150).
  assertEquals(curatedSpendLevel([{ priceMin: 8000, priceMax: 8000, priceCurrency: "NGN", priceLevel: "PRICE_LEVEL_INEXPENSIVE" }]), "budget");
});

Deno.test("#4347 r2 cards built before round 2 keep the old word until they refresh", () => {
  assertEquals(curatedSpendLevel([{ priceMin: 0, priceMax: 0 }]), "free");
  assertEquals(curatedSpendLevel([{ priceMin: 150, priceMax: 150 }]), "moderate");
  assertEquals(curatedPlanEstimate([{ priceMin: 150, priceMax: 150, placeType: "drinks" }]), null);
});
