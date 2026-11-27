// Issue #3645 (payments audit item 7 follow-through) — the pure chip-in
// refusal helpers the Host, buyer web and Explorer callers build their thrown
// error with, and the panel reads its "Add at least …" floor from.
//
// FAILS-ON-REVERT: drop `minCents` from the error, read it with a type guess,
// or round the floor to nearest instead of up -> the matching case fails.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  ChipInRefusalError,
  chipInRefusalFloorCents,
  chipInRefusalFromBody,
  chipInWholeUnitFloorCents,
} from "../chipInRefusal.ts";

Deno.test("#3645 the error's message stays the server code (callers match on message)", () => {
  const err = chipInRefusalFromBody("amount_below_min", {
    error: "amount_below_min",
    minCents: 10_000,
    reason: "provider_minimum",
  });
  assertEquals(err instanceof Error, true);
  assertEquals(err instanceof ChipInRefusalError, true);
  assertEquals(err.message, "amount_below_min");
  assertEquals(err.code, "amount_below_min");
  assertEquals(err.minCents, 10_000);
  assertEquals(err.reason, "provider_minimum");
});

Deno.test("#3645 a host-minimum refusal has the floor and no reason", () => {
  const err = chipInRefusalFromBody("amount_below_min", { minCents: 5_000 });
  assertEquals(err.minCents, 5_000);
  assertEquals(err.reason, null);
});

Deno.test("#3645 a missing or malformed floor or reason is dropped, never guessed", () => {
  for (const minCents of [undefined, null, "10000", -1, 0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60]) {
    assertEquals(chipInRefusalFromBody("amount_below_min", { minCents }).minCents, null, String(minCents));
  }
  for (const body of [null, undefined, "amount_below_min", 42, []]) {
    const err = chipInRefusalFromBody("amount_below_min", body);
    assertEquals(err.minCents, null);
    assertEquals(err.reason, null);
  }
  assertEquals(chipInRefusalFromBody("x", { reason: "PROVIDER_MINIMUM" }).reason, null);
});

Deno.test("#3645 the floor named: server first, then host minimum, then none", () => {
  const server = chipInRefusalFromBody("amount_below_min", { minCents: 10_000 });
  assertEquals(chipInRefusalFloorCents(server, 5_000), 10_000);
  assertEquals(chipInRefusalFloorCents(server, null), 10_000);
  assertEquals(chipInRefusalFloorCents(new Error("amount_below_min"), 5_000), 5_000);
  assertEquals(chipInRefusalFloorCents(new Error("amount_below_min"), null), null);
  assertEquals(chipInRefusalFloorCents(chipInRefusalFromBody("amount_below_min", null), 0), null);
  assertEquals(chipInRefusalFloorCents("amount_below_min", 5_000), 5_000);
  assertEquals(chipInRefusalFloorCents(null, null), null);
});

Deno.test("#3645 the floor is read by shape, so a second copy of the module still works", () => {
  const foreign = Object.assign(new Error("amount_below_min"), { minCents: 10_000 });
  assertEquals(chipInRefusalFloorCents(foreign, 5_000), 10_000);
  const badForeign = Object.assign(new Error("amount_below_min"), { minCents: "10000" });
  assertEquals(chipInRefusalFloorCents(badForeign, 5_000), 5_000);
});

Deno.test("#3645 the floor is rounded UP to a whole unit (the field takes whole units)", () => {
  const cases: Array<[number, number]> = [
    [10_000, 10_000], // NGN ₦100
    [30, 100], // GBP 30p -> £1 (nearest would say £0)
    [50, 100], // USD 50c -> $1
    [250, 300], // DKK 2.50 -> 3
    [1_500, 1_500], // CZK 15
    [17_500, 17_500], // HUF 175
    [101, 200],
    [100, 100],
    [1, 100],
  ];
  for (const [floor, whole] of cases) {
    assertEquals(chipInWholeUnitFloorCents(floor), whole, String(floor));
  }
});
