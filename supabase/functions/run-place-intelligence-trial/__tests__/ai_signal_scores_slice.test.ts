// META-ORCH-1009 Sub-A — unit tests for buildAiSignalScoresSlice.
//
// SPEC: Mingla_Artifacts/specs/SPEC_META-ORCH-1009_SUB_A_AI_SIGNAL_SCORES_SCHEMA.md §4.3
// Pins the I-AI-SIGNAL-SCORES-SHAPE-CONTRACT shape and the slicer's
// defensive/clamping/rounding behaviour. Fails-on-revert at the SPEC baseline
// (revert by removing the helper export from ../index.ts).
//
// Run: deno test supabase/functions/run-place-intelligence-trial/__tests__/

import {
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildAiSignalScoresSlice } from "../index.ts";

const EVAL_AT = "2026-05-30T18:00:00.000Z";
const PROMPT_VERSION = "v4";
const MODEL = "gemini-2.5-flash";

Deno.test("Test A — happy path: 3-signal Q2 produces exact 6-field shape per signal", () => {
  const input = [
    {
      signal_id: "fine_dining",
      score_0_to_100: 5,
      inappropriate_for: false,
      reasoning: "CAVA is fast-casual, not fine dining.",
    },
    {
      signal_id: "brunch",
      score_0_to_100: 0,
      inappropriate_for: true,
      reasoning: "serves_brunch=false structurally.",
    },
    {
      signal_id: "casual_food",
      score_0_to_100: 95,
      inappropriate_for: false,
      reasoning: "Core identity is casual Mediterranean bowls.",
    },
  ];
  const out = buildAiSignalScoresSlice(input, EVAL_AT, PROMPT_VERSION, MODEL);

  assertEquals(Object.keys(out).sort(), ["brunch", "casual_food", "fine_dining"]);

  for (const signalId of Object.keys(out)) {
    const entry = out[signalId];
    // Exactly 6 keys, no more, no fewer.
    assertEquals(
      Object.keys(entry).sort(),
      [
        "evaluated_at",
        "inappropriate_for",
        "model",
        "prompt_version",
        "reasoning",
        "score_0_to_100",
      ],
    );
    assertStrictEquals(entry.evaluated_at, EVAL_AT);
    assertStrictEquals(entry.prompt_version, PROMPT_VERSION);
    assertStrictEquals(entry.model, MODEL);
    assertStrictEquals(typeof entry.score_0_to_100, "number");
    assertStrictEquals(typeof entry.inappropriate_for, "boolean");
    assertStrictEquals(typeof entry.reasoning, "string");
  }
  // Field-level spot checks
  assertStrictEquals(out["fine_dining"].score_0_to_100, 5);
  assertStrictEquals(out["brunch"].inappropriate_for, true);
  assertStrictEquals(out["casual_food"].score_0_to_100, 95);
});

Deno.test("Test B — empty input: null / undefined / [] all return {}", () => {
  assertEquals(buildAiSignalScoresSlice(null, EVAL_AT, PROMPT_VERSION, MODEL), {});
  assertEquals(
    buildAiSignalScoresSlice(undefined, EVAL_AT, PROMPT_VERSION, MODEL),
    {},
  );
  assertEquals(buildAiSignalScoresSlice([], EVAL_AT, PROMPT_VERSION, MODEL), {});
});

Deno.test("Test C — malformed evals skipped, well-formed kept", () => {
  // Silence the console.warn during this test for cleaner output.
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const input = [
      {
        signal_id: "fine_dining",
        score_0_to_100: 50,
        inappropriate_for: false,
        reasoning: "well-formed",
      },
      // missing reasoning
      {
        signal_id: "brunch",
        score_0_to_100: 10,
        inappropriate_for: false,
        reasoning: "",
      } as unknown as {
        signal_id: string;
        score_0_to_100: number;
        inappropriate_for: boolean;
        reasoning: string;
      },
      // missing signal_id
      {
        signal_id: "",
        score_0_to_100: 20,
        inappropriate_for: false,
        reasoning: "still has reasoning but no id",
      },
      // invalid score_0_to_100 type
      {
        signal_id: "romantic",
        score_0_to_100: "high" as unknown as number,
        inappropriate_for: false,
        reasoning: "wrong type for score",
      },
      // invalid inappropriate_for type
      {
        signal_id: "trendy",
        score_0_to_100: 30,
        inappropriate_for: "no" as unknown as boolean,
        reasoning: "wrong type for inappropriate_for",
      },
    ];
    const out = buildAiSignalScoresSlice(
      input,
      EVAL_AT,
      PROMPT_VERSION,
      MODEL,
    );
    assertEquals(Object.keys(out), ["fine_dining"]);
    assertStrictEquals(out["fine_dining"].score_0_to_100, 50);
  } finally {
    console.warn = origWarn;
  }
});

Deno.test("Test D — score_0_to_100 clamping to [0, 100]", () => {
  const cases: Array<{ input: number; expected: number }> = [
    { input: -10, expected: 0 },
    { input: 0, expected: 0 },
    { input: 50, expected: 50 },
    { input: 100, expected: 100 },
    { input: 200, expected: 100 },
  ];
  for (const c of cases) {
    const out = buildAiSignalScoresSlice(
      [
        {
          signal_id: "s_" + c.input,
          score_0_to_100: c.input,
          inappropriate_for: false,
          reasoning: "x",
        },
      ],
      EVAL_AT,
      PROMPT_VERSION,
      MODEL,
    );
    assertStrictEquals(
      out["s_" + c.input].score_0_to_100,
      c.expected,
      `score ${c.input} should clamp to ${c.expected}`,
    );
  }
});

Deno.test("Test E — score_0_to_100 rounding (42.7 -> 43)", () => {
  const out = buildAiSignalScoresSlice(
    [
      {
        signal_id: "x",
        score_0_to_100: 42.7,
        inappropriate_for: false,
        reasoning: "round me",
      },
    ],
    EVAL_AT,
    PROMPT_VERSION,
    MODEL,
  );
  assertStrictEquals(out["x"].score_0_to_100, 43);
});

Deno.test("Test F — prompt_version + model + evaluated_at pass-through verbatim", () => {
  const out = buildAiSignalScoresSlice(
    [
      {
        signal_id: "x",
        score_0_to_100: 1,
        inappropriate_for: false,
        reasoning: "a",
      },
    ],
    "2099-12-31T23:59:59.999Z",
    "v5-test",
    "test-model-1.0",
  );
  assertStrictEquals(out["x"].evaluated_at, "2099-12-31T23:59:59.999Z");
  assertStrictEquals(out["x"].prompt_version, "v5-test");
  assertStrictEquals(out["x"].model, "test-model-1.0");
});
