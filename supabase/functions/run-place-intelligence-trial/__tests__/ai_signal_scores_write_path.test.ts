// META-ORCH-1009 Sub-A — write-path tests for writeAiSignalScoresToPlacePool.
//
// SPEC: Mingla_Artifacts/specs/SPEC_META-ORCH-1009_SUB_A_AI_SIGNAL_SCORES_SCHEMA.md §4.3 + §3.2 D4
// Verifies:
//   (a) call shape is db.from('place_pool').update({ai_signal_scores: <slice>}).eq('id', <uuid>)
//   (b) supabase-error responses do NOT throw (non-fatal contract)
//   (c) thrown errors inside the call chain do NOT propagate (non-fatal contract)
//   (d) empty slice short-circuits with NO supabase calls
//
// Fails-on-revert at the SPEC baseline (revert by removing the helper export
// from ../index.ts).

import {
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { writeAiSignalScoresToPlacePool } from "../index.ts";

type UpdateCall = {
  table: string;
  patch: Record<string, unknown>;
  eqCol: string;
  eqVal: string;
};

function makeMockDb(
  errorToReturn: { message: string } | null,
  opts: { throwOnEq?: boolean } = {},
): { db: Parameters<typeof writeAiSignalScoresToPlacePool>[0]; calls: UpdateCall[] } {
  const calls: UpdateCall[] = [];
  const db = {
    from(table: string) {
      return {
        update(patch: Record<string, unknown>) {
          return {
            eq(eqCol: string, eqVal: string) {
              calls.push({ table, patch, eqCol, eqVal });
              if (opts.throwOnEq) {
                return Promise.reject(new Error("simulated network drop"));
              }
              return Promise.resolve({ error: errorToReturn });
            },
          };
        },
      };
    },
  };
  return { db, calls };
}

const SLICE: Record<string, unknown> = {
  fine_dining: {
    score_0_to_100: 5,
    inappropriate_for: false,
    reasoning: "x",
    evaluated_at: "2026-05-30T18:00:00.000Z",
    prompt_version: "v4",
    model: "gemini-2.5-flash",
  },
};

const PLACE_ID = "11111111-2222-3333-4444-555555555555";

Deno.test("happy path — calls db.from('place_pool').update({ai_signal_scores}).eq('id', placeId)", async () => {
  const { db, calls } = makeMockDb(null);
  const result = await writeAiSignalScoresToPlacePool(db, PLACE_ID, SLICE);
  assertStrictEquals(result, "ok");
  assertStrictEquals(calls.length, 1);
  assertStrictEquals(calls[0].table, "place_pool");
  assertEquals(calls[0].patch, { ai_signal_scores: SLICE });
  assertStrictEquals(calls[0].eqCol, "id");
  assertStrictEquals(calls[0].eqVal, PLACE_ID);
});

Deno.test("supabase-error returned from .eq() does NOT throw, returns 'error_caught'", async () => {
  // Silence the console.error during this test.
  const origErr = console.error;
  console.error = () => {};
  try {
    const { db, calls } = makeMockDb({ message: "permission denied" });
    const result = await writeAiSignalScoresToPlacePool(db, PLACE_ID, SLICE);
    assertStrictEquals(result, "error_caught");
    assertStrictEquals(calls.length, 1, "the update WAS attempted");
  } finally {
    console.error = origErr;
  }
});

Deno.test("thrown error inside the call chain does NOT propagate, returns 'error_caught'", async () => {
  const origErr = console.error;
  console.error = () => {};
  try {
    const { db, calls } = makeMockDb(null, { throwOnEq: true });
    const result = await writeAiSignalScoresToPlacePool(db, PLACE_ID, SLICE);
    assertStrictEquals(result, "error_caught");
    assertStrictEquals(calls.length, 1);
  } finally {
    console.error = origErr;
  }
});

Deno.test("empty slice short-circuits — NO supabase calls made", async () => {
  const { db, calls } = makeMockDb(null);
  const result = await writeAiSignalScoresToPlacePool(db, PLACE_ID, {});
  assertStrictEquals(result, "skipped_empty");
  assertStrictEquals(calls.length, 0, "no .update() should be issued on empty slice");
});

Deno.test("call sequence: trial_runs UPDATE precedes place_pool UPDATE (documented contract — proven by code reading, asserted here as a freeze)", async () => {
  // We can't drive processOnePlace end-to-end without a real Gemini call, so
  // this test pins the design intent: the helper is meant to be invoked AFTER
  // the trial-row UPDATE succeeds. We freeze that contract by asserting our
  // helper is a pure best-effort follow-up — it does not touch
  // place_intelligence_trial_runs at all (single-table single-purpose).
  const { db, calls } = makeMockDb(null);
  await writeAiSignalScoresToPlacePool(db, PLACE_ID, SLICE);
  for (const c of calls) {
    assertStrictEquals(
      c.table,
      "place_pool",
      "helper must NEVER touch place_intelligence_trial_runs — that's the caller's responsibility",
    );
  }
});
