// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4265 — a romantic curated card ("Artspace → Second Empire Restaurant
// and Tavern") read "$100.00–$0.00". The place pool stores Second Empire's
// open-ended price ("$100+") with no max; generate-curated-experiences writes
// that stop as priceMin 100 / priceMax 0 and totals 100 / 0. A span whose max is
// below its min has no known max, so the plan reads "from $100" ("$100+").
//
// FAILS-ON-REVERT: dropping the `hi < lo` open-ended branch in
// curatedPriceRange.ts, or going back to the plain stop sums in
// expandedCardFacts.ts, fails here.
//
// [#4347] curatedTotalPriceRange ("$30–$70", "$100+") was DELETED: an AI plan's
// totals are USD tier constants and now show a spend level (Decision 2), and a
// brand experience's envelope is formatted in its own currency. The open-ended
// rule this suite pins is unchanged and still owned by sumPriceSpans; the
// assertions on the deleted string formatter moved to the sums they wrapped.

import { sumPriceSpans } from "../curatedPriceRange.ts";

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
  assertEquals(sumPriceSpans([{ min: 100, max: 0 }]), { min: 100, max: 100, openEnded: true }, "card-level totals 100/0 are open-ended, never 100–0");
  assertEquals(sumPriceSpans([{ min: 150, max: 100 }]), { min: 150, max: 150, openEnded: true }, "any total with max below min is open-ended");
});

Deno.test("ordinary ranges, single prices and free plans are unchanged", () => {
  assertEquals(sumPriceSpans([{ min: 20, max: 40 }, { min: 10, max: 30 }]), { min: 30, max: 70, openEnded: false });
  assertEquals(sumPriceSpans([{ min: 0, max: 0 }]), { min: 0, max: 0, openEnded: false }, "a free plan stays 0–0 (the plate prints Free)");
  assertEquals(sumPriceSpans([{ min: 25, max: 25 }]), { min: 25, max: 25, openEnded: false });
});

const facts = await Deno.readTextFile(
  new URL("../../components/expandedCard/expandedCardFacts.ts", import.meta.url),
);
const converters = await Deno.readTextFile(new URL("../cardConverters.ts", import.meta.url));

Deno.test("the deck plate and the card conversion use the shared rule", () => {
  assert(facts.includes("sumPriceSpans("), "curatedPriceLabel must total stops with sumPriceSpans");
  // #4347: the open-ended flag now travels into formatDisplayPrice, which
  // prints "from" ("₦100+") — pinned behaviourally in issue_4347_display_price.
  assert(/formatMoney\(\{[\s\S]*?openEnded,/.test(facts), "curatedPriceLabel must pass the open-ended flag to the formatter");
  assert(
    !converters.includes("`$${card.totalPriceMin ?? 0}–$${card.totalPriceMax ?? 0}`"),
    "cardConverters must not print the raw min–max template",
  );
  assert(
    !/\$\$\{|\$\d/.test(converters),
    "#4347: cardConverters must not write a literal $ in front of an amount",
  );
  assert(facts.includes("openEnded: card.totalPriceOpenEnded"), "the brand total reads the card's open-ended flag");
});

// Server fix (_shared/curatedPrice.ts): an open-ended stop
// now arrives as max = min with priceOpenEnded, and the plan total with
// totalPriceOpenEnded. Without reading the flag those would print "$100–$100".
Deno.test("the server's explicit open-ended flag prints 'from' even when max equals min", () => {
  assertEquals(
    sumPriceSpans([{ min: 0, max: 0 }, { min: 100, max: 100, openEnded: true }]),
    { min: 100, max: 100, openEnded: true },
  );
  assertEquals(sumPriceSpans([{ min: 100, max: 100, openEnded: true }]), { min: 100, max: 100, openEnded: true });
  assertEquals(sumPriceSpans([{ min: 150, max: 170, openEnded: true }]), { min: 150, max: 150, openEnded: true });
  assertEquals(sumPriceSpans([{ min: 30, max: 70, openEnded: false }]), { min: 30, max: 70, openEnded: false });
  assertEquals(sumPriceSpans([{ min: 30, max: 70, openEnded: null }]), { min: 30, max: 70, openEnded: false });
});

Deno.test("replacing a stop recomputes the open-ended total with the shared rule", async () => {
  const mutate = await Deno.readTextFile(new URL("../mutateCuratedCard.ts", import.meta.url));
  assert(mutate.includes("sumPriceSpans("), "replaceStopInCard must total stops with sumPriceSpans");
  assert(mutate.includes("totalPriceOpenEnded: priceTotal.openEnded ? true : undefined"), "a stale open-ended flag must not survive a replace");
  assert(!mutate.includes("reduce((sum, s) => sum + s.priceMax, 0)"), "raw priceMax sum is back");
});
