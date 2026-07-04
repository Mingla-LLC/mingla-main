// ORCH-1304 [approve generates the pitch] — the pitch (place_pool.generative_summary)
// is drafted at APPROVE by handleEvaluateSignals, ONLY when the venue has none yet,
// and FAIL-SOFT (a draft failure must not fail the approve). This supersedes
// META-ORCH-1290 D-3 (owner self-drafts the pitch pre-submit).
//
// I-PROPOSED-1304-PITCH-GENERATED-AT-APPROVE. The Gemini call itself is not unit-
// testable (module-level fetch), so the decision seam is factored into the pure/
// injectable resolvePitchOnApprove + shouldDraftPitchOnApprove, tested here.
//
// MUST FAIL when reverted:
//   * generate even when a pitch exists (clobber) → T-1304-2 fails;
//   * turn fail-soft into fail-hard (rethrow) → T-1304-3 throws instead of null.

import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";

import { resolvePitchOnApprove, shouldDraftPitchOnApprove } from "../index.ts";

// ── shouldDraftPitchOnApprove: draft only when empty ────────────────────────────
Deno.test("ORCH-1304 shouldDraftPitchOnApprove — empty/whitespace/null → true", () => {
  assertEquals(shouldDraftPitchOnApprove(""), true);
  assertEquals(shouldDraftPitchOnApprove("   "), true);
  assertEquals(shouldDraftPitchOnApprove(null), true);
  assertEquals(shouldDraftPitchOnApprove(undefined), true);
});

Deno.test("ORCH-1304 shouldDraftPitchOnApprove — existing pitch → false (no clobber)", () => {
  assertEquals(shouldDraftPitchOnApprove("A cosy candlelit wine bar in Raleigh."), false);
});

// ── T-1304-1: empty pitch + successful draft → writes the trimmed bio ───────────
Deno.test("ORCH-1304 T-1 — empty pitch, draft succeeds → returns trimmed bio", async () => {
  let called = 0;
  const out = await resolvePitchOnApprove(null, async () => {
    called++;
    return "  A vivid one-paragraph pitch a guest would read.  ";
  });
  assertEquals(called, 1);
  assertEquals(out, "A vivid one-paragraph pitch a guest would read.");
});

// ── T-1304-2: existing pitch → NOT drafted (no clobber; draftFn never called) ───
Deno.test("ORCH-1304 T-2 — existing pitch → null, draftFn NOT called (no clobber)", async () => {
  let called = 0;
  const out = await resolvePitchOnApprove("Owner-edited pitch, keep me.", async () => {
    called++;
    return "SHOULD NOT BE USED";
  });
  assertEquals(out, null);
  assertEquals(called, 0);
});

// ── T-1304-3: empty pitch + draft throws → null (FAIL-SOFT, never rethrows) ──────
Deno.test("ORCH-1304 T-3 — draft throws → null (fail-soft, approve not failed)", async () => {
  let threw = false;
  let out: string | null = "unset";
  try {
    out = await resolvePitchOnApprove("", async () => {
      throw new Error("gemini_failed:429");
    });
  } catch {
    threw = true;
  }
  assert(!threw, "resolvePitchOnApprove must swallow the draft error (fail-soft)");
  assertEquals(out, null);
});

// ── edge: empty pitch + draft returns empty/whitespace → null (no blank write) ──
Deno.test("ORCH-1304 edge — draft returns whitespace → null (no blank pitch)", async () => {
  const out = await resolvePitchOnApprove("", async () => "   ");
  assertEquals(out, null);
});
