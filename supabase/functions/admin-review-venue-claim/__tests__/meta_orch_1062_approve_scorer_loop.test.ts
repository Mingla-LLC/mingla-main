// META-ORCH-1062 Phase 4 (keystone) — regression test for I-SCORER-INVOKE-HAS-
// SIGNAL-ID. The deployed v92 approve path invoked run-signal-scorer with
// `{ place_ids: [placePoolId] }` and NO signal_id. run-signal-scorer hard-
// requires signal_id (returns HTTP 400 `signal_id is required` on entry), so
// the call silently failed inside best-effort try/catch → place_scores was
// never produced → an approved venue never reached the deck (defect 1062-A).
//
// The fix routes every scorer invoke through buildScorerInvokeBody(signalId,
// placePoolId), which always includes signal_id and throws if it is missing.
//
// fails-on-revert: revert buildScorerInvokeBody to `return { place_ids: [...] }`
// (the old shape, no signal_id) and the "body includes signal_id" assertion
// FAILS.

import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

import { buildScorerInvokeBody } from "../index.ts";

Deno.test("META-ORCH-1062: scorer invoke body ALWAYS includes signal_id (kills the 1062-A 400 bug)", () => {
  const body = buildScorerInvokeBody("date_night", "pp-123");
  // The keystone assertion: signal_id MUST be present + correct.
  assert(
    Object.prototype.hasOwnProperty.call(body, "signal_id"),
    "scorer body must include signal_id",
  );
  assertEquals(body.signal_id, "date_night");
  assertEquals(body.place_ids, ["pp-123"]);
});

Deno.test("META-ORCH-1062: scorer body shape is exactly { signal_id, place_ids }", () => {
  const body = buildScorerInvokeBody("groups", "pp-xyz");
  assertEquals(Object.keys(body).sort(), ["place_ids", "signal_id"]);
});

Deno.test("META-ORCH-1062: a missing signal_id throws (defensive — never invoke the scorer 400 path)", () => {
  assertThrows(
    () => buildScorerInvokeBody("", "pp-123"),
    Error,
    "signal_id is required",
  );
});
