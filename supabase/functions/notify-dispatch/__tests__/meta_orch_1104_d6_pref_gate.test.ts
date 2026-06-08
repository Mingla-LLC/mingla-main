// META-ORCH-1104 Phase 0 — D6 dead-gate fix regression (SPEC SC-0.8, T-0.7).
//
// Run:
//   deno test --allow-read supabase/functions/notify-dispatch/__tests__/meta_orch_1104_d6_pref_gate.test.ts
//
// Lane A F5.5b: the notification_preferences type-gate in notify-dispatch was a
// SILENT NO-OP — it read non-existent channel/type/opt_in columns. This test
// asserts the gate now reads the REAL boolean columns (push_enabled + the mapped
// category boolean), and that support message types map to the existing
// `messages` boolean (Option α).
//
// FAILS ON REVERT: reverting the fix re-introduces `row.channel`/`row.opt_in`
// reads and removes the support→messages mapping, both of which are asserted.

import { assert, assertStringIncludes } from "jsr:@std/assert@1";

const SRC = await Deno.readTextFile("supabase/functions/notify-dispatch/index.ts");

Deno.test("the dead channel/type/opt_in gate is gone (no silent no-op)", () => {
  // The fixed gate must NOT read the non-existent row.channel / row.opt_in
  // columns. Their presence means the dead gate survived.
  assert(
    !/row\.channel\s*===\s*"push"/.test(SRC),
    "notify-dispatch still reads the non-existent notification_preferences.channel column",
  );
  assert(
    !/row\.opt_in\s*===\s*false/.test(SRC),
    "notify-dispatch still reads the non-existent notification_preferences.opt_in column",
  );
});

Deno.test("the gate reads the REAL boolean columns (push_enabled + mapped category)", () => {
  // Global push toggle reads push_enabled.
  assertStringIncludes(SRC, "pref.push_enabled === false");
  // Type gate reads the mapped boolean column off the single prefs row.
  assertStringIncludes(SRC, "pref[prefKey] === false");
});

Deno.test("support message types map to the existing `messages` boolean (Option α)", () => {
  assertStringIncludes(SRC, '"business.support_message": "messages"');
  assertStringIncludes(SRC, '"business.support_new_ticket": "messages"');
});
