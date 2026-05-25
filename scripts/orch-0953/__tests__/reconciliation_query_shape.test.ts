import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

Deno.test("ORCH-0953 §3.9 — reconciliation SQL probe is read-only SELECT shape", async () => {
  const sql = await Deno.readTextFile(
    new URL("../connect_inventory_reconciliation.sql", import.meta.url),
  );
  const withoutComments = sql
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  assertEquals(
    /\b(insert|update|delete|drop|alter|create|truncate)\b/i.test(
      withoutComments,
    ),
    false,
  );
  assertStringIncludes(withoutComments, "SELECT");
  assertStringIncludes(withoutComments, "_live_stripe_accounts");
  assertStringIncludes(withoutComments, "HAVING COUNT(*) > 1");
});
