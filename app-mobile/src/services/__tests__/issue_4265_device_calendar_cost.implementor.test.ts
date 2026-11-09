// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4265 — a curated plan added to the phone calendar wrote its notes as
// "Estimated cost: $min–$max" from the raw totals, so an open-ended "$100+"
// stop produced "Estimated cost: $100–$0".
//
// [#4347] REWRITTEN, same protection. An AI plan's totals are USD tier
// constants, not money, so the note no longer prints any amount: it gives the
// plan's SPEND LEVEL (Decision 2, approved 2026-11-08). "$100–$0" is now
// impossible by construction, and so is "$100" written to a naira viewer.
//
// deviceCalendarService imports expo-calendar, so it cannot load under Deno;
// the shared rule is exercised for real and the call site is pinned.
//
// FAILS-ON-REVERT: putting back a dollar template, or the tier-bracket money
// ("$50 – $150") per stop, in deviceCalendarService.ts fails the wiring test.

import { curatedSpendLevel } from "../../utils/curatedPriceRange.ts";

function assertEquals(actual: unknown, expected: unknown, message = "mismatch"): void {
  if (actual !== expected) throw new Error(`${message}\n  actual:   ${actual}\n  expected: ${expected}`);
}
function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

Deno.test("calendar spend level for the reported $100+ plan", () => {
  // Card built before the server fix: the open-ended stop is 100 / 0.
  assertEquals(curatedSpendLevel([{ priceMin: 0, priceMax: 0 }, { priceMin: 100, priceMax: 0 }]), "moderate");
  // After it: max = min.
  assertEquals(curatedSpendLevel([{ priceMin: 100, priceMax: 100 }]), "moderate");
  assertEquals(curatedSpendLevel([{ priceMin: 0, priceMax: 50 }]), "budget");
  assertEquals(curatedSpendLevel([{ priceMin: 300, priceMax: 500 }]), "upscale");
  assertEquals(curatedSpendLevel([{ priceMin: 0, priceMax: 0 }]), "free");
});

Deno.test("createEventFromCuratedCard writes a spend level, never an amount", async () => {
  const src = stripComments(
    await Deno.readTextFile(new URL("../deviceCalendarService.ts", import.meta.url)),
  );
  const start = src.indexOf("static createEventFromCuratedCard(");
  assert(start >= 0, "createEventFromCuratedCard is gone");
  const next = src.indexOf("static ", start + 10);
  const body = next > 0 ? src.slice(start, next) : src.slice(start);
  assert(body.includes("curatedSpendLevel("), "the plan note must use the shared spend-level rule");
  assert(body.includes("Spend level: "), "the plan note must say its spend level");
  assert(!body.includes("Estimated cost:"), "an amount line is back in the curated note");
  assert(!/\$\$\{/.test(body), "a literal $ is written in front of an amount");
  assert(!body.includes("tierRangeLabel("), "tier-bracket money is back on a stop line");
});
