// Issue #3645 (payments audit item 7 follow-through) — the pure chip-in
// refusal factory the Host, buyer web and Explorer callers throw, and the
// panel reads its "Add at least …" floor from.
//
// FAILS-ON-REVERT: let a malformed `minCents` through, or change the message
// away from the server code -> the matching case fails.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { chipInRefusalFromBody } from "../chipInRefusal.ts";

Deno.test("#3645 the error's message stays the server code (callers match on message)", () => {
  const err = chipInRefusalFromBody("amount_below_min", {
    error: "amount_below_min",
    minCents: 10_000,
    reason: "provider_minimum",
  });
  assertEquals(err instanceof Error, true);
  assertEquals(err.message, "amount_below_min");
  assertEquals(err.minCents, 10_000);
});

Deno.test("#3645 a host-minimum refusal carries its floor too", () => {
  assertEquals(chipInRefusalFromBody("amount_below_min", { minCents: 5_000 }).minCents, 5_000);
});

Deno.test("#3645 a missing or malformed floor is dropped, never guessed", () => {
  for (const minCents of [undefined, null, "10000", -1, 0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60]) {
    assertEquals(chipInRefusalFromBody("amount_below_min", { minCents }).minCents, null, String(minCents));
  }
  for (const body of [null, undefined, "amount_below_min", 42, []]) {
    assertEquals(chipInRefusalFromBody("amount_below_min", body).minCents, null, String(body));
  }
});

Deno.test("#3645 other codes keep their code and carry no floor", () => {
  const err = chipInRefusalFromBody("brand_cannot_collect", { error: "brand_cannot_collect" });
  assertEquals(err.message, "brand_cannot_collect");
  assertEquals(err.minCents, null);
});
