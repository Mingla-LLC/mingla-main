/**
 * #3720 — support-ticket RPC anonymous EXECUTE lockdown (fails on revert).
 *
 * Run:
 *   deno test --allow-read supabase/migrations/__tests__/issue_3720_support_ticket_anon_execute_lockdown.implementor.test.ts
 */

// MINGLA-INVARIANT: I-3720-SUPPORT-TICKET-AUTH-ONLY | issue #3720 | Only authenticated and service roles may execute the support-ticket creation RPC.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

const migration = Deno.readTextFileSync(
  new URL(
    "../20271024003720_issue_3720_support_ticket_anon_execute_lockdown.sql",
    import.meta.url,
  ),
);
const normalized = migration.replace(/\s+/g, " ").trim();

Deno.test("#3720 support-ticket RPC revokes direct anonymous EXECUTE", () => {
  assertStringIncludes(
    normalized,
    "REVOKE EXECUTE ON FUNCTION public.create_support_ticket(text, uuid) FROM PUBLIC, anon;",
  );
  assertStringIncludes(
    normalized,
    "GRANT EXECUTE ON FUNCTION public.create_support_ticket(text, uuid) TO authenticated, service_role;",
  );
});

Deno.test("#3720 support-ticket lockdown is ACL-only and self-verifying", () => {
  assertEquals(/CREATE\s+OR\s+REPLACE\s+FUNCTION/i.test(migration), false);
  assertStringIncludes(normalized, "I-3720-SUPPORT-TICKET-AUTH-ONLY");
  assertStringIncludes(normalized, "has_function_privilege( 'anon'");
  assertStringIncludes(normalized, "DO $check$");
  assert(normalized.endsWith("COMMIT;"), "migration must commit atomically");
});
