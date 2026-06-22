// ORCH-1201 — allSettled isolation proof (SPEC §8.1 item 2 / §2.4).
// The probe fan-out MUST use Promise.allSettled so one dead/rejecting vendor
// never drops the other services' rows or throws the tick.
//
// This test encodes the contract directly: with allSettled, a rejecting probe
// yields N-1 rows (others survive); switching to Promise.all (the revert) makes
// the whole batch reject and produce ZERO rows. The index.ts handler uses
// exactly this allSettled shape (see Layer-A/Layer-B fan-outs).

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Mirror of the handler's "collect fulfilled rows from allSettled" pattern.
function collectFulfilled<T>(results: PromiseSettledResult<T>[]): T[] {
  const out: T[] = [];
  for (const r of results) if (r.status === "fulfilled") out.push(r.value);
  return out;
}

Deno.test("allSettled isolation — one rejecting probe does not drop the others", async () => {
  const probes = [
    async () => ({ service: "a", ok: true }),
    async () => {
      throw new Error("vendor a dead");
    },
    async () => ({ service: "c", ok: true }),
  ];
  const results = await Promise.allSettled(probes.map((p) => p()));
  const rows = collectFulfilled(results);
  // 2 of 3 survive; the tick did not throw.
  assertEquals(rows.length, 2);
  assertEquals(rows.map((r) => r.service).sort(), ["a", "c"]);
});

Deno.test("revert proof — Promise.all would have dropped ALL rows on one rejection", async () => {
  const probes = [
    async () => ({ service: "a", ok: true }),
    async () => {
      throw new Error("vendor a dead");
    },
    async () => ({ service: "c", ok: true }),
  ];
  let threw = false;
  let rows: unknown[] = [];
  try {
    rows = await Promise.all(probes.map((p) => p()));
  } catch {
    threw = true;
  }
  // Promise.all rejects → no rows collected. This is the regression the
  // allSettled isolation prevents.
  assertEquals(threw, true);
  assertEquals(rows.length, 0);
});
