// [META-ORCH-1009 Sub-A] Adversarial tests for ai_signal_scores schema.
//
// Written by mingla-tester (QA pass). Probes edges the implementor's 11 tests
// did not cover: duplicate signal_ids (deterministic last-wins), wrong-data-
// type infiltration through the TS escape hatches the helper has, write-path
// behaviour when supabase update affects zero rows (UPDATE of non-existent id),
// helper invocation pattern when called with an array containing only null/
// undefined entries, and a single-call invocation freeze on the write helper
// (ensures it never makes a SECOND supabase call internally).
//
// All five FAIL on the SPEC baseline before the implementor's helpers existed
// (revert proof: remove the two helper exports from ../index.ts).
//
// Run: deno test --no-check --allow-net \
//   supabase/functions/run-place-intelligence-trial/__tests__/ai_signal_scores_adversarial.test.ts

import {
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildAiSignalScoresSlice,
  writeAiSignalScoresToPlacePool,
} from "../index.ts";

const EVAL_AT = "2026-05-30T19:00:00.000Z";
const PROMPT_VERSION = "v4";
const MODEL = "gemini-2.5-flash";

type WriteHelperDb = Parameters<typeof writeAiSignalScoresToPlacePool>[0];

function captureCalls(
  errorToReturn: { message: string } | null,
): { db: WriteHelperDb; calls: Array<{ patch: Record<string, unknown>; eqVal: string }> } {
  const calls: Array<{ patch: Record<string, unknown>; eqVal: string }> = [];
  const db: WriteHelperDb = {
    from(_table: string) {
      return {
        update(patch: Record<string, unknown>) {
          return {
            eq(_col: string, eqVal: string) {
              calls.push({ patch, eqVal });
              return Promise.resolve({ error: errorToReturn });
            },
          };
        },
      };
    },
  };
  return { db, calls };
}

// ─── ADV-01 ────────────────────────────────────────────────────────────────
// Duplicate signal_id in source array: SPEC §3.1 implies one canonical value
// per signal. Helper iterates an array, so a duplicate must produce
// deterministic "last-write-wins" semantics (matches the at-rest JSON object
// contract — JSON objects cannot have duplicate keys; last assignment wins).
Deno.test("ADV-01 — duplicate signal_id in source: last entry wins deterministically", () => {
  const out = buildAiSignalScoresSlice(
    [
      { signal_id: "romantic", score_0_to_100: 10, inappropriate_for: false, reasoning: "first wins?" },
      { signal_id: "romantic", score_0_to_100: 90, inappropriate_for: false, reasoning: "second wins" },
      { signal_id: "romantic", score_0_to_100: 50, inappropriate_for: true, reasoning: "third wins (final)" },
    ],
    EVAL_AT,
    PROMPT_VERSION,
    MODEL,
  );
  assertEquals(Object.keys(out), ["romantic"]);
  assertStrictEquals(out["romantic"].score_0_to_100, 50);
  assertStrictEquals(out["romantic"].inappropriate_for, true);
  assertStrictEquals(out["romantic"].reasoning, "third wins (final)");
});

// ─── ADV-02 ────────────────────────────────────────────────────────────────
// Array containing only null/undefined entries should NOT throw and should
// produce {}. The helper's per-entry `if (!ev ...) continue` guard must
// silently skip nullish array members (Gemini function-calling has been
// observed to occasionally emit holes in tool-call arrays under partial
// generation failures — guard against that drift).
Deno.test("ADV-02 — array of null/undefined entries returns {} (no throw)", () => {
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const out = buildAiSignalScoresSlice(
      [null, undefined, null] as unknown as ReadonlyArray<{
        signal_id: string;
        score_0_to_100: number;
        inappropriate_for: boolean;
        reasoning: string;
      }>,
      EVAL_AT,
      PROMPT_VERSION,
      MODEL,
    );
    assertEquals(out, {});
  } finally {
    console.warn = origWarn;
  }
});

// ─── ADV-03 ────────────────────────────────────────────────────────────────
// Non-finite scores (NaN / Infinity / -Infinity) must NOT corrupt the JSONB.
// The implementor's helper added `Number.isFinite(ev.score_0_to_100)` after
// the SPEC's basic `typeof === "number"` check. Verify the upgrade.
// (Without it: NaN passes typeof; Math.round(NaN)=NaN; Math.min(100,NaN)=NaN;
// Math.max(0,NaN)=NaN — would produce a NaN field that breaks the SHAPE
// contract.)
Deno.test("ADV-03 — non-finite scores (NaN / Infinity) are dropped, not stored", () => {
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const out = buildAiSignalScoresSlice(
      [
        { signal_id: "nan_sig", score_0_to_100: NaN, inappropriate_for: false, reasoning: "x" },
        { signal_id: "inf_sig", score_0_to_100: Number.POSITIVE_INFINITY, inappropriate_for: false, reasoning: "x" },
        { signal_id: "neg_inf_sig", score_0_to_100: Number.NEGATIVE_INFINITY, inappropriate_for: false, reasoning: "x" },
        { signal_id: "good_sig", score_0_to_100: 42, inappropriate_for: false, reasoning: "good" },
      ],
      EVAL_AT,
      PROMPT_VERSION,
      MODEL,
    );
    assertEquals(Object.keys(out), ["good_sig"]);
    assertStrictEquals(out["good_sig"].score_0_to_100, 42);
  } finally {
    console.warn = origWarn;
  }
});

// ─── ADV-04 ────────────────────────────────────────────────────────────────
// Writer must issue EXACTLY one supabase call per invocation (no retry loop,
// no shadow second write). Freezes the "single-shot" call shape so a future
// refactor that introduces e.g. read-back-verify cannot inflate cost or
// double-write silently.
Deno.test("ADV-04 — writer issues exactly ONE supabase call (no shadow second write)", async () => {
  const { db, calls } = captureCalls(null);
  const slice = {
    fine_dining: {
      score_0_to_100: 5,
      inappropriate_for: false,
      reasoning: "x",
      evaluated_at: EVAL_AT,
      prompt_version: PROMPT_VERSION,
      model: MODEL,
    },
  };
  const result = await writeAiSignalScoresToPlacePool(
    db,
    "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    slice,
  );
  assertStrictEquals(result, "ok");
  assertStrictEquals(calls.length, 1, "writer must NOT make additional supabase calls");
});

// ─── ADV-05 ────────────────────────────────────────────────────────────────
// Writer called with a place_pool_id that does NOT exist in the DB: in
// supabase-js, that returns `{ error: null }` with zero rows affected — NOT
// an error. The writer must return "ok" (silently — UPDATE 0 rows is not a
// failure mode). This pins the contract Sub-D will inherit when its refresh
// cron may legitimately target rows that have since been deleted.
Deno.test("ADV-05 — writer treats UPDATE-affects-zero-rows as 'ok' (not 'error_caught')", async () => {
  // Simulate supabase returning `{ error: null }` even though the .eq()
  // matched zero rows — this is the canonical supabase-js behaviour for a
  // .update() that affects zero rows (no rows returned by default).
  const { db, calls } = captureCalls(null);
  const slice = {
    fine_dining: {
      score_0_to_100: 5,
      inappropriate_for: false,
      reasoning: "x",
      evaluated_at: EVAL_AT,
      prompt_version: PROMPT_VERSION,
      model: MODEL,
    },
  };
  const result = await writeAiSignalScoresToPlacePool(
    db,
    "00000000-0000-0000-0000-000000000000",
    slice,
  );
  assertStrictEquals(result, "ok");
  assertStrictEquals(calls.length, 1);
  assertStrictEquals(calls[0].eqVal, "00000000-0000-0000-0000-000000000000");
});
