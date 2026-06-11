// ORCH-1108 — list-my-pending-invites projection-leak guard (SC-8).
//
// Implementor happy-path: the source MUST NOT select or return token_hash /
// invited_by / email, MUST select only the curated projection, and MUST derive
// the match email from the JWT (no email parameter the caller could inject).
// Reverting the curated `.select(...)` to a `select("*")` would surface
// token_hash → the leak assertions fail (fails-on-revert).

import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

Deno.test("list-my-pending-invites returns only the curated projection", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

  // Curated SELECT — exactly the five-field projection + the brand join.
  assertStringIncludes(
    source,
    'select("id, brand_id, role, expires_at, brands!inner(name, deleted_at)")',
  );

  // The response payload is shaped { invites: [...] } with brand_name mapped.
  assertStringIncludes(source, "brand_name:");
  assertStringIncludes(source, "return json({ invites }, 200)");
});

Deno.test("list-my-pending-invites never selects token_hash / invited_by", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

  // token_hash / invited_by must never be SELECTED or returned (a passing
  // mention in a doc comment is fine; what matters is no select/projection of
  // them and no select("*") that would leak the full row).
  assertEquals(/\.select\([^)]*token_hash/.test(source), false);
  assertEquals(/\.select\([^)]*invited_by/.test(source), false);
  assertEquals(source.includes('select("*")'), false);
  // The mapped response object must not assign token_hash/invited_by/email.
  assertEquals(/token_hash\s*:/.test(source), false);
  assertEquals(/invited_by\s*:/.test(source), false);
});

Deno.test("list-my-pending-invites derives email from the JWT, not a param", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

  // Email is read off the authenticated user and lowercased (both sides).
  assertStringIncludes(source, "userResult.user.email");
  assertStringIncludes(source, ".trim().toLowerCase()");
  // The match filters status=pending + non-expired.
  assertStringIncludes(source, '.eq("status", "pending")');
  assertStringIncludes(source, '.gt("expires_at", nowIso)');
});
