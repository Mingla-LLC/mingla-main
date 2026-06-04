// ORCH-1066 — source-inspect tests for the deck-score-tuner edge actions added to
// admin-review-venue-claim/index.ts (set_place_score / pin_place_score /
// score_place_preview). Mirrors the ORCH-1064 source-inspect approach: the edge
// fn boots serve() + a real Supabase client at module load, so we assert the
// contract surface against the source text (deterministic + fails-on-revert).
//
// Run: cd supabase && deno test --allow-read \
//   functions/admin-review-venue-claim/__tests__/orch_1066_tuner_actions.test.ts
//
// Fails-on-revert: removing any of the three action branches (or renaming the RPC
// it calls / its audit action) flips the matching test.

import { assert, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SOURCE = await Deno.readTextFile(new URL("../index.ts", import.meta.url));

Deno.test("T-01 [ORCH-1066] all three tuner action branches present", () => {
  assertStringIncludes(SOURCE, 'rawAction === "set_place_score"');
  assertStringIncludes(SOURCE, 'rawAction === "pin_place_score"');
  assertStringIncludes(SOURCE, 'rawAction === "score_place_preview"');
});

Deno.test("T-02 [ORCH-1066] each action calls its dedicated place-keyed RPC via userClient", () => {
  assertStringIncludes(SOURCE, '"admin_set_place_signal_score"');
  assertStringIncludes(SOURCE, '"admin_pin_place_to_top"');
  assertStringIncludes(SOURCE, '"admin_score_place_preview"');
  // place-keyed param name (NOT brand_id) — these target place_pool directly.
  assertStringIncludes(SOURCE, "p_place_pool_id: placePoolId");
});

Deno.test("T-03 [ORCH-1066] each write action audit-logs with target_type place_pool", () => {
  assertStringIncludes(SOURCE, 'action: "place_score_set"');
  assertStringIncludes(SOURCE, 'action: "place_score_pin"');
  assertStringIncludes(SOURCE, 'action: "place_score_preview_seed"');
  assertStringIncludes(SOURCE, 'target_type: "place_pool"');
});

Deno.test("T-04 [ORCH-1066] place_pool_id is required (400 guard)", () => {
  assertStringIncludes(SOURCE, '"place_pool_id_required"');
});

Deno.test("T-05 [ORCH-1066] pin defaults radius to 16000 and rejects non-positive", () => {
  assertStringIncludes(SOURCE, "16000");
  assertStringIncludes(SOURCE, '"invalid_radius"');
});

Deno.test("T-06 [ORCH-1066] admin gate + verify_jwt path preserved (unchanged)", () => {
  // The existing in-body admin gate must still run BEFORE any tuner action.
  assertStringIncludes(SOURCE, '"is_admin_user"');
  assertStringIncludes(SOURCE, 'isAdmin !== true');
  // No verify_jwt override sneaked into the source.
  assert(
    !/verify_jwt\s*[:=]\s*false/.test(SOURCE),
    "verify_jwt must not be flipped to false in this fn source",
  );
});

Deno.test("T-07 [ORCH-1066] 1062 brand-keyed score_override branch still present (untouched)", () => {
  // SC-8: the legacy approval channel must keep working.
  assertStringIncludes(SOURCE, 'rawAction === "score_override"');
  assertStringIncludes(SOURCE, '"admin_apply_score_override"');
});
