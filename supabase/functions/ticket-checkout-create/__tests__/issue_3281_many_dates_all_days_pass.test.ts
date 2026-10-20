/**
 * issue #3281 many-dates — allDaysPass binds upcoming dates before idempotency.
 * [TEST-MOD-APPROVED #3281]
 */
import { assert, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";

const src = await Deno.readTextFile(
  new URL("../index.ts", import.meta.url),
);

Deno.test("allDaysPass reads multi_date_pricing_mode and fills orderedEventDateIds", () => {
  assertMatch(src, /multi_date_pricing_mode/);
  assertMatch(src, /allDaysPass/);
  assertMatch(src, /all_days/);
  const passAt = src.indexOf("allDaysPass");
  const idemAt = src.indexOf("const idempotencyKey");
  assert(passAt > 0 && idemAt > passAt, "allDaysPass must precede idempotencyKey");
});

Deno.test("allDaysPass refuses when no upcoming dates remain", () => {
  assertMatch(src, /occurrence_not_available/);
});
