/**
 * #3720 Slice D1 — base participant conversations SELECT excludes support.
 *
 * Run:
 *   deno test --allow-read supabase/migrations/__tests__/issue_3720_support_conversation_isolation.implementor.happy.test.ts
 *
 * Fails-on-revert: if either policy loses the support exclusion, these assert.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

const MIG = Deno.readTextFileSync(
  new URL(
    "../20271016003720_issue_3720_support_conversation_isolation.sql",
    import.meta.url,
  ),
);
const norm = MIG.replace(/\s+/g, " ").trim();

Deno.test("#3720 D1 reshapes both base conversations SELECT policies", () => {
  assertStringIncludes(
    norm,
    'DROP POLICY IF EXISTS "Users can view conversations they participate in"',
  );
  assertStringIncludes(
    norm,
    'DROP POLICY IF EXISTS "Users can view their conversations"',
  );
  assertStringIncludes(
    norm,
    'CREATE POLICY "Users can view conversations they participate in"',
  );
  assertStringIncludes(
    norm,
    'CREATE POLICY "Users can view their conversations"',
  );
});

Deno.test("#3720 D1 both policies exclude linked_entity_type support", () => {
  const exclusion =
    "conversations.linked_entity_type IS DISTINCT FROM 'support'";
  assertEquals(
    (norm.match(new RegExp(exclusion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ??
      []).length,
    2,
    "both SELECT policies must carry the support exclusion",
  );
  // Keep the SECURITY DEFINER participant helper (anti-recursion hotfix).
  assertStringIncludes(norm, "public.is_conversation_participant(conversations.id, auth.uid())");
});

Deno.test("#3720 D1 does not invent dedicated support message tables", () => {
  assertEquals(/CREATE TABLE/i.test(MIG), false);
  assertEquals(/support_messages/i.test(MIG), false);
});
