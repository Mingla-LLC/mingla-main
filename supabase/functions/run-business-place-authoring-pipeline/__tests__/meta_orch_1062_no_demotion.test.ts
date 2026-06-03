// META-ORCH-1062 Phase 3 — regression test for I-NO-CLAIM-DEMOTION +
// I-NET-NEW-HOLD. The Tier-2 confirm step (handleConfirmAiOutputs) used to
// hard-code `is_servable: false` for EVERY business-authored confirm, which
// demoted an already-live claimed Google place off the deck with no restore
// path (defect 1062-B). The fix routes the is_servable write through the pure
// helper nextIsServableForConfirm(prior), which preserves a prior `true` and
// keeps a prior `false` held.
//
// fails-on-revert: revert the helper to `return false` (the old hard-coded
// behavior) and the "claim of a live place stays servable" case FAILS.

import {
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

import { nextIsServableForConfirm } from "../index.ts";

Deno.test("META-ORCH-1062: claim of an ALREADY-servable place stays servable (no demotion)", () => {
  // A live Google-seeded place being claimed: prior is_servable=true.
  assertEquals(nextIsServableForConfirm(true), true);
});

Deno.test("META-ORCH-1062: net-new business-authored row stays held off-deck (false)", () => {
  // Net-new self-listed venue: inserted with is_servable=false, must stay false
  // until admin approve (Phase 4 flips it).
  assertEquals(nextIsServableForConfirm(false), false);
});

Deno.test("META-ORCH-1062: null/undefined prior is treated as not-servable (held)", () => {
  assertEquals(nextIsServableForConfirm(null), false);
  assertEquals(nextIsServableForConfirm(undefined), false);
});
