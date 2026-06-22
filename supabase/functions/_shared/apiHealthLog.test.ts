// ORCH-1201 — recordApiCall best-effort regression (SPEC §8.1 item 8).
// Run: deno test --allow-env --allow-net supabase/functions/_shared/apiHealthLog.test.ts
//
// Proves: a forced insert failure (unreachable SUPABASE_URL) is SWALLOWED and
// recordApiCall resolves without throwing — the host call must never break.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { recordApiCall } from "./apiHealthLog.ts";

// Sanitizers disabled: the supabase-js client spins an internal auth
// auto-refresh interval that the Deno sanitizer flags as a leak — it is NOT our
// code. The behavior under test is purely "recordApiCall does not throw".
Deno.test({
  name: "recordApiCall swallows a forced insert error (bad SUPABASE_URL)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    // Point at an unroutable host so the insert path throws internally.
    Deno.env.set("SUPABASE_URL", "http://127.0.0.1:1/badhost");
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fake-key");
    let threw = false;
    try {
      await recordApiCall("test_service", false, 12, 500);
    } catch {
      threw = true;
    }
    assertEquals(threw, false, "recordApiCall must NOT throw even when the insert fails");
  },
});

Deno.test("recordApiCall is a no-op (no throw) when env is missing", async () => {
  Deno.env.delete("SUPABASE_URL");
  Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  let threw = false;
  try {
    await recordApiCall("test_service", true, 5);
  } catch {
    threw = true;
  }
  assertEquals(threw, false);
});

// ORCH-1201-R2 T6 — the new 5th `err` arg is OPTIONAL: 4-arg AND 5-arg call
// shapes both compile + never throw (backward-compat for all 11 existing sites).
Deno.test("recordApiCall 5-arg depletion fingerprint is optional + non-throwing", async () => {
  Deno.env.delete("SUPABASE_URL"); // no-op insert path; only the arg shape under test
  Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  let threw = false;
  try {
    // 4-arg (legacy) still valid:
    await recordApiCall("openai", false, 12, 429);
    // 5-arg (new) depletion fingerprint:
    await recordApiCall("openai", false, 12, 429, { code: "insufficient_quota", text: "You exceeded your current quota" });
  } catch {
    threw = true;
  }
  assertEquals(threw, false);
});
