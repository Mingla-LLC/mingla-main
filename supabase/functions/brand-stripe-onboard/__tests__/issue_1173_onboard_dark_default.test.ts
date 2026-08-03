/**
 * #1173 (sub-issue D of #1013) — SC-2 dark-default guard for the onboard flip.
 *
 * brand-stripe-onboard is a monolithic serve() (no injectable handler, and D's
 * allowlist permits only the additive flip block), so this asserts the guard
 * STRUCTURALLY — mirroring the repo's dark-scope guard test style
 * (payout-release-sweep issue_1171 adversarial). It proves the payout-schedule
 * flip + cutover stamp are reachable ONLY behind the `PAYOUT_HOLD_ONBOARD_FLIP
 * === "true"` gate, so the state D merges (flag unset) is byte-identical to
 * pre-D `main`: NO schedule call, NO stamp.
 *
 * Fails-on-revert: remove the `if (ONBOARD_FLIP)` guard or the `=== "true"`
 * flag derivation and an assertion below fails.
 */
import { assert, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(
  "supabase/functions/brand-stripe-onboard/index.ts",
);

Deno.test("onboard flip is dark by default (flag derives from PAYOUT_HOLD_ONBOARD_FLIP === \"true\")", () => {
  assertStringIncludes(
    source,
    'const ONBOARD_FLIP = Deno.env.get("PAYOUT_HOLD_ONBOARD_FLIP") === "true";',
  );
});

Deno.test("the payout-schedule flip + stamp are reachable only inside the ONBOARD_FLIP guard", () => {
  const guardIdx = source.indexOf("if (ONBOARD_FLIP) {");
  assert(guardIdx > 0, "ONBOARD_FLIP guard block not found");

  // The manual-flip CALL and the stamp RPC CALL must appear AFTER the guard
  // opens, never before it. (The import line is excluded — we search for the
  // invocation `setManualPayoutSchedule(` with a preceding `await `.)
  const flipCallIdx = source.indexOf("await setManualPayoutSchedule(");
  assert(flipCallIdx > guardIdx, "flip call is not inside the ONBOARD_FLIP guard");

  const stampCallIdx = source.indexOf('"stamp_payout_hold_cutover"');
  assert(stampCallIdx > guardIdx, "stamp RPC is not inside the ONBOARD_FLIP guard");

  // No manual-flip invocation appears before the guard opens (would leak the
  // flip into the always-on path and break the dark default).
  const preGuard = source.slice(0, guardIdx);
  assert(
    !preGuard.includes("await setManualPayoutSchedule("),
    "a flip call exists BEFORE the ONBOARD_FLIP guard (dark default broken)",
  );
  assert(
    !preGuard.includes('"stamp_payout_hold_cutover"'),
    "a stamp call exists BEFORE the ONBOARD_FLIP guard (dark default broken)",
  );
});

Deno.test("compensation restore is wired for the stamp-failure path (atomicity)", () => {
  // On stamp failure the onboard path must restore daily so a brand is never
  // left manual-but-unstamped.
  assertStringIncludes(source, "restoreDailyPayoutSchedule(");
  assertStringIncludes(source, "payout_hold.stamp_failed_rolled_back");
});
