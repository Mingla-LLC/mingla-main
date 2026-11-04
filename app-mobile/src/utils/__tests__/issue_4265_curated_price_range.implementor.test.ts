// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4265 — a romantic curated card ("Artspace → Second Empire Restaurant
// and Tavern") read "$100.00–$0.00". The place pool stores Second Empire's
// open-ended price ("$100+") with no max; generate-curated-experiences writes
// that stop as priceMin 100 / priceMax 0 and totals 100 / 0. A span whose max is
// below its min has no known max, so the plan reads "from $100" ("$100+").
//
// FAILS-ON-REVERT: dropping the `hi < lo` open-ended branch in
// curatedPriceRange.ts, or going back to the raw "$min–$max" template in
// cardConverters.ts / the plain stop sums in expandedCardFacts.ts, fails here.

import { curatedTotalPriceRange, sumPriceSpans } from "../curatedPriceRange.ts";

function assertEquals(actual: unknown, expected: unknown, message = "mismatch"): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  actual:   ${a}\n  expected: ${e}`);
}
function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

// The live stops of the reported card (from the simulator's persisted deck).
const SECOND_EMPIRE_STOPS = [
  { min: 0, max: 0 }, // Harris Teeter (flowers)
  { min: 0, max: 0 }, // Artspace
  { min: 100, max: 0 }, // Second Empire — "$100+" stored with no max
];

Deno.test("an open-ended stop makes the plan read 'from', never max below min", () => {
  const total = sumPriceSpans(SECOND_EMPIRE_STOPS);
  assertEquals(total, { min: 100, max: 100, openEnded: true });
  assertEquals(curatedTotalPriceRange(100, 0), "$100+", "card-level totals 100/0 must not print $100–$0");
  assertEquals(curatedTotalPriceRange(150, 100), "$150+", "any total with max below min is open-ended");
});

Deno.test("ordinary ranges, single prices and free plans are unchanged", () => {
  assertEquals(sumPriceSpans([{ min: 20, max: 40 }, { min: 10, max: 30 }]), { min: 30, max: 70, openEnded: false });
  assertEquals(curatedTotalPriceRange(30, 70), "$30–$70");
  assertEquals(curatedTotalPriceRange(0, 0), "$0–$0", "free plan string unchanged (the plate prints Free)");
  assertEquals(curatedTotalPriceRange(undefined, undefined), "$0–$0");
  assertEquals(sumPriceSpans([{ min: 25, max: 25 }]), { min: 25, max: 25, openEnded: false });
});

const facts = await Deno.readTextFile(
  new URL("../../components/expandedCard/expandedCardFacts.ts", import.meta.url),
);
const converters = await Deno.readTextFile(new URL("../cardConverters.ts", import.meta.url));

Deno.test("the deck plate and the card conversion use the shared rule", () => {
  assert(facts.includes("sumPriceSpans("), "curatedPriceLabel must total stops with sumPriceSpans");
  assert(facts.includes("if (openEnded)"), "curatedPriceLabel must print an open-ended total as 'from'");
  assert(
    !converters.includes("`$${card.totalPriceMin ?? 0}–$${card.totalPriceMax ?? 0}`"),
    "cardConverters must not print the raw min–max template",
  );
  assert(converters.includes("curatedTotalPriceRange(card.totalPriceMin, card.totalPriceMax)"), "cardConverters uses the shared rule");
});
