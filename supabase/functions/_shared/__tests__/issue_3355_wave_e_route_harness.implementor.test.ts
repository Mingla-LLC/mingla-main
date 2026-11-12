// Issue #3355 Wave E (E1, E2) — the deterministic route harness.
//
// A table of real-shaped host messages (this morning's Lagos thread, the
// #3355 body's examples and the everyday asks around them). Each row runs
// twice through the shipped route code:
//   1. with the intent read stubbed to a plausible Flash read — every row
//      must take the expected route (0 misroutes);
//   2. with the intent read failing — the classifier hints route (today's
//      behaviour); the misroute rate is measured and ratcheted, and printed
//      for the Wave E report.
// Rows with an open setup are driven through decideFlowTurn on a live card
// (the real runner), so "park / cancel / answer / side" are outcomes, not
// labels. Live-model evals of the same table are Wave F.
//
// MINGLA-INVARIANT: I-ARI-ROUTE-HARNESS | issue #3355 | Every row of the Wave E route table takes its expected route with the stubbed intent read, and the hint-only fallback never misroutes more rows than the recorded ratchet.
//
// Run: deno test --no-check --allow-read --allow-env \
//   supabase/functions/_shared/__tests__/issue_3355_wave_e_route_harness.implementor.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  FALLBACK_MISROUTE_RATCHET,
  lastIntentResult,
  ROUTE_TABLE,
  routeClass,
  stubRead,
} from "./_issue3355RouteTable.ts";
import {
  HOST_FAVY10_SENTENCE,
  HOST_INFLUENCER_SENTENCE,
} from "./_issue3355WaveEFlowWorld.ts";

export { ROUTE_TABLE };

Deno.test("E harness: the table is real-shaped and large enough", () => {
  assert(ROUTE_TABLE.length >= 40, `${ROUTE_TABLE.length} rows`);
  const texts = ROUTE_TABLE.map((row) => row.text);
  assert(texts.includes(HOST_INFLUENCER_SENTENCE));
  assert(texts.includes(HOST_FAVY10_SENTENCE));
  for (
    const needle of [
      /customer list/,
      /website/i,
      /event/,
      /trip/,
      /venue/,
      /readiness|still need|ready to/,
      /discount|promo/,
      /ticket tier/,
      /[Rr]efund/,
      /payout/,
      /^stop$/,
      /^Not now$/,
    ]
  ) {
    assert(texts.some((text) => needle.test(text)), String(needle));
  }
});

Deno.test("E harness: with the intent read, every row takes its expected route", async () => {
  const misses: string[] = [];
  for (const row of ROUTE_TABLE) {
    const got = await routeClass(row, stubRead(row));
    assertEquals(lastIntentResult?.source, "model", row.text);
    if (got !== row.expect) {
      misses.push(
        `${row.open ?? "none"} | ${row.text} → ${got} (want ${row.expect})`,
      );
    }
  }
  assertEquals(misses, []);
});

Deno.test("E harness: with the intent read failing, the hint fallback misroute rate is measured and ratcheted", async () => {
  const misses: string[] = [];
  for (const row of ROUTE_TABLE) {
    const got = await routeClass(row, null);
    if (got !== row.expect) {
      misses.push(
        `${row.open ?? "none"} | ${row.text} → ${got} (want ${row.expect})`,
      );
    }
  }
  const rate = (misses.length / ROUTE_TABLE.length * 100).toFixed(1);
  console.log(
    `[wave-e harness] fallback misroutes: ${misses.length}/${ROUTE_TABLE.length} (${rate}%)\n${
      misses.map((miss) => `  - ${miss}`).join("\n")
    }`,
  );
  assert(
    misses.length <= FALLBACK_MISROUTE_RATCHET,
    `fallback misroutes rose to ${misses.length} (ratchet ${FALLBACK_MISROUTE_RATCHET})`,
  );
});
