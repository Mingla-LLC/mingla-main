// META-ORCH-1009 Sub-D — source-inspect tests for run-signal-scorer per-place
// mode + ai_signal_scores_at write column.
//
// SPEC: Mingla_Artifacts/specs/SPEC_META-ORCH-1009_SUB_D_REFRESH_CRON.md §3.1
// Acceptance: L1-04 / L1-05 (validation), L1-06 (per-place filtering), L1-07
// (ai_signal_scores_at populated), L1-08 (rule-only leaves NULL).
//
// Run: cd supabase && deno test --allow-read functions/run-signal-scorer/__tests__/per_place_mode.test.ts
//
// Why source-inspect: the edge fn uses Deno's `serve` + real Supabase client
// init at module load, so importing the index for a request/response test
// boots a network handler we can't sandbox cheaply. Source-text assertions
// give us deterministic + fails-on-revert coverage of the contract surface
// without booting the runtime.
//
// Fails-on-revert: at Sub-D-implementor base commit, removing the per-place
// branch (the `if (placeIds && placeIds.length > 0) { ... }` block in
// run-signal-scorer/index.ts) flips T-01 → fail. Removing the
// `ai_signal_scores_at: w.ai_signal_scores_at` line in the chunk payload
// flips T-04 → fail.

import { assert, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SOURCE = await Deno.readTextFile(
  new URL("../index.ts", import.meta.url),
);

Deno.test("T-01 [Sub-D] per-place mode branch present in run-signal-scorer", () => {
  // Per-place SELECT uses .in('id', placeIds); source-text assertion ensures
  // the branch hasn't been deleted in a future refactor.
  assertStringIncludes(
    SOURCE,
    ".in('id', placeIds)",
    "per-place SELECT branch missing",
  );
  assertStringIncludes(
    SOURCE,
    "placeIds && placeIds.length > 0",
    "per-place mode gate missing",
  );
});

Deno.test("T-02 [Sub-D] place_ids length cap (1000) enforced", () => {
  // SPEC §3.1: place_ids capped at 1000 with 400 response.
  assertStringIncludes(
    SOURCE,
    "place_ids length > 1000",
    "1000-id cap error message missing",
  );
  assertStringIncludes(
    SOURCE,
    "placeIds.length > 1000",
    "1000-id cap check missing",
  );
});

Deno.test("T-03 [Sub-D] place_ids + all_cities mutually exclusive", () => {
  // SPEC §3.1: rejects 400 when both are set.
  assertStringIncludes(
    SOURCE,
    "place_ids and all_cities are mutually exclusive",
    "mutual-exclusion error missing",
  );
});

Deno.test("T-04 [Sub-D] ai_signal_scores_at threaded into chunk payload", () => {
  // SPEC §3.1: every place_scores UPSERT chunk includes ai_signal_scores_at.
  // The field comes from result.ai_blended?.evaluated_at ?? null.
  assertStringIncludes(
    SOURCE,
    "ai_signal_scores_at: w.ai_signal_scores_at",
    "chunk payload does not write ai_signal_scores_at",
  );
  assertStringIncludes(
    SOURCE,
    "ai_signal_scores_at: result.ai_blended?.evaluated_at ?? null",
    "writes accumulator does not source ai_signal_scores_at from ai_blended.evaluated_at",
  );
});

Deno.test("T-05 [Sub-D] writes array typed with ai_signal_scores_at", () => {
  // Defensive: the typed array signature must list the new field; if a future
  // refactor drops the field from the type, the runtime write would silently
  // omit it (Supabase ignores unknown keys on upsert).
  assertStringIncludes(
    SOURCE,
    "ai_signal_scores_at: string | null;",
    "writes type does not declare ai_signal_scores_at",
  );
});

Deno.test("T-06 [Sub-D] validation: at least one of place_ids/city_id/all_cities required", () => {
  // SPEC §3.1: error if none provided.
  assertStringIncludes(
    SOURCE,
    "Provide place_ids, city_id, or all_cities=true",
    "missing-scope validation message missing",
  );
});

Deno.test("T-07 [Sub-D] paging-loop preserved for city/all_cities mode", () => {
  // Regression guard: per-place mode must not have replaced the existing
  // city/all_cities paging loop (Sub-B-shipped contract).
  assert(
    /while\s*\(\s*true\s*\)/.test(SOURCE),
    "city/all_cities paging loop missing",
  );
  assertStringIncludes(
    SOURCE,
    ".range(offset, offset + BATCH_SIZE - 1)",
    "city/all_cities range pagination missing",
  );
});
