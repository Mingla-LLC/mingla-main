// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4265 — a curated plan added to the phone calendar wrote its notes as
// "Estimated cost: $min–$max" from the raw totals, so an open-ended "$100+"
// stop produced "Estimated cost: $100–$0". The service now prints the total
// with the same rule the cards use (curatedTotalPriceRange): "$100+".
//
// deviceCalendarService imports expo-calendar, so it cannot load under Deno;
// the shared formatter is exercised for real and the call site is pinned.
//
// FAILS-ON-REVERT: putting back the raw template in deviceCalendarService.ts
// fails the wiring test.

import { curatedTotalPriceRange } from "../../utils/curatedPriceRange.ts";

function assertEquals(actual: unknown, expected: unknown, message = "mismatch"): void {
  if (actual !== expected) throw new Error(`${message}\n  actual:   ${actual}\n  expected: ${expected}`);
}
function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

Deno.test("calendar cost line never reads $100–$0", () => {
  // Card built before the server fix: totals 100 / 0.
  assertEquals(`Estimated cost: ${curatedTotalPriceRange(100, 0, undefined)}`, "Estimated cost: $100+");
  // Card built after it: max = min plus the explicit flag.
  assertEquals(`Estimated cost: ${curatedTotalPriceRange(100, 100, true)}`, "Estimated cost: $100+");
  // Ordinary range unchanged.
  assertEquals(`Estimated cost: ${curatedTotalPriceRange(30, 70, undefined)}`, "Estimated cost: $30–$70");
});

Deno.test("createEventFromCuratedCard uses the shared open-ended formatter", async () => {
  const src = stripComments(
    await Deno.readTextFile(new URL("../deviceCalendarService.ts", import.meta.url)),
  );
  assert(
    src.includes("import { curatedTotalPriceRange } from '../utils/curatedPriceRange';"),
    "deviceCalendarService must import the shared formatter",
  );
  assert(
    src.includes(
      "`Estimated cost: ${curatedTotalPriceRange(card.totalPriceMin, card.totalPriceMax, card.totalPriceOpenEnded)}`",
    ),
    "the notes line must use curatedTotalPriceRange with the open-ended flag",
  );
  assert(!/Estimated cost: \$\$\{card\.totalPriceMin/.test(src), "raw $min–$max template is back");
});
