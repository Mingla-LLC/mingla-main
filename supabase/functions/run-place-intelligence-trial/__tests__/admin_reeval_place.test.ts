// META-ORCH-1009 Sub-D — source-inspect tests for the new `admin_reeval_place`
// action handler in run-place-intelligence-trial/index.ts.
//
// SPEC: Mingla_Artifacts/specs/SPEC_META-ORCH-1009_SUB_D_REFRESH_CRON.md §3.3
// Acceptance: L3-02 (action wired into dispatcher + returns 200 with run_id),
//             L3-03 (rate-limit 429 on inflight),
//             L3-05 (source='admin-reeval-button' tag),
//             L3-06 / L3-07 (400/404 error paths).
//
// Run: cd supabase && deno test --allow-read functions/run-place-intelligence-trial/__tests__/admin_reeval_place.test.ts
//
// Why source-inspect: the edge fn boots a Deno serve handler + Supabase
// client at module load. Source-text assertions give deterministic +
// fails-on-revert coverage without running the network handler.
//
// Fails-on-revert: at Sub-D-implementor base commit, removing the case
// "admin_reeval_place" branch from the dispatcher flips T-01 → fail.
// Removing the handler definition flips T-02 → fail.

import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const SOURCE = await Deno.readTextFile(
  new URL("../index.ts", import.meta.url),
);

Deno.test("T-01 [Sub-D] dispatcher case 'admin_reeval_place' wired", () => {
  assertStringIncludes(
    SOURCE,
    'case "admin_reeval_place":',
    "dispatcher case missing",
  );
  assertStringIncludes(
    SOURCE,
    "handleAdminReevalPlace(",
    "handler dispatch call missing",
  );
});

Deno.test("T-02 [Sub-D] handleAdminReevalPlace function defined", () => {
  assertStringIncludes(
    SOURCE,
    "async function handleAdminReevalPlace(",
    "handler function definition missing",
  );
});

Deno.test("T-03 [Sub-D] rate-limit: 429 on existing pending/running run for place", () => {
  // SPEC §3.3: refuses with 429 if any row in pending/running for this place.
  assertStringIncludes(
    SOURCE,
    '.in("status", ["pending", "running"])',
    "rate-limit inflight query missing",
  );
  assertStringIncludes(
    SOURCE,
    '"rate_limited"',
    "rate-limit error code missing",
  );
  assertStringIncludes(
    SOURCE,
    "429",
    "429 status code missing for rate-limit",
  );
});

Deno.test("T-04 [Sub-D] source='admin-reeval-button' tagged on child row", () => {
  // SPEC §3.3: every admin_reeval_place insert sets source='admin-reeval-button'.
  assertStringIncludes(
    SOURCE,
    'source: "admin-reeval-button"',
    "child insert does not tag source='admin-reeval-button'",
  );
});

Deno.test("T-05 [Sub-D] parent run uses mode='admin_reeval'", () => {
  assertStringIncludes(
    SOURCE,
    'mode: "admin_reeval"',
    "parent run mode='admin_reeval' missing",
  );
});

Deno.test("T-06 [Sub-D] missing place_pool_id → 400 'place_pool_id required'", () => {
  assertStringIncludes(
    SOURCE,
    '"place_pool_id required"',
    "missing place_pool_id error message missing",
  );
});

Deno.test("T-07 [Sub-D] unknown place_pool_id → 404 'place not found'", () => {
  assertStringIncludes(
    SOURCE,
    '"place not found"',
    "place not found 404 message missing",
  );
});

Deno.test("T-08 [Sub-D] immediate process_chunk kick (same pattern as full_city)", () => {
  // SPEC §3.3: fire-and-forget kick to process_chunk so the operator does
  // not wait for the next pg_cron tick.
  assert(
    /action:\s*"process_chunk"/.test(SOURCE),
    "process_chunk kick action missing",
  );
  // Action listed in the missing-action error message guides users.
  assertStringIncludes(
    SOURCE,
    "admin_reeval_place",
    "admin_reeval_place not advertised in missing-action error",
  );
});

Deno.test("T-09 [Sub-D] action listed in missing-action error message", () => {
  // The missing-action error string enumerates every valid action; Sub-D's
  // admin_reeval_place must be appended so 400s guide correctly.
  assertStringIncludes(
    SOURCE,
    "'admin_reeval_place'",
    "admin_reeval_place not enumerated in missing-action 400",
  );
});

Deno.test("T-10 [Sub-D] concurrent-run-for-city 409 from 23505 unique violation", () => {
  // SPEC §3.3: if the parent insert hits the existing per-city unique idx,
  // surface a 409 with concurrent_run_for_city rather than 500.
  assertStringIncludes(
    SOURCE,
    '"concurrent_run_for_city"',
    "concurrent_run_for_city 409 path missing",
  );
});
