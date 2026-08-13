// #2013 — append-only tenant-containment regression.
import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { READ_ONLY_TOOL_NAMES } from "../agentTools.ts";
import {
  AccessibleAgentBrand,
  TENANT_SCOPED_READ_TOOL_NAMES,
  TenantScopeError,
  requireAccessibleAgentBrand,
} from "../agentTenantScope.ts";

const owner: AccessibleAgentBrand = {
  id: "00000000-0000-4000-8000-00000000000a", name: "Owner A", slug: "owner-a",
  default_currency: "USD", cover_media_url: null, role: "owner", effective_rank: 60,
};
const delegated: AccessibleAgentBrand = {
  id: "00000000-0000-4000-8000-00000000000b", name: "Delegated B", slug: "delegated-b",
  default_currency: "USD", cover_media_url: null, role: "event_manager", effective_rank: 40,
};

Deno.test("#2013 registry covers every and only inline read tool", () => {
  assertEquals([...TENANT_SCOPED_READ_TOOL_NAMES].sort(), [...READ_ONLY_TOOL_NAMES].sort());
});

Deno.test("#2013 owner and active member are accessible; foreign public brand fails closed", () => {
  const scope = [owner, delegated];
  assertEquals(requireAccessibleAgentBrand(scope, owner.id).role, "owner");
  assertEquals(requireAccessibleAgentBrand(scope, delegated.id).effective_rank, 40);
  const error = assertThrows(
    () => requireAccessibleAgentBrand(scope, "00000000-0000-4000-8000-00000000000c"),
    TenantScopeError,
  );
  assertEquals(error.code, "BRAND_ACCESS_DENIED");
});

Deno.test("#2013 revoked membership is absent and cannot be recovered from public visibility", () => {
  const afterRevocation = [owner];
  assertThrows(() => requireAccessibleAgentBrand(afterRevocation, delegated.id), TenantScopeError);
});

Deno.test("#2013 negative proof is anchored to the repository's public brand RLS", async () => {
  const migration = await Deno.readTextFile(
    "supabase/migrations/20260729000000_meta_orch_0972_universal_authoring.sql",
  );
  assertEquals(migration.includes('CREATE POLICY "Public can read non-deleted brands"'), true);
  // Account B is deliberately public-visible at the database layer; absence
  // from Account A's explicit owner/member scope is therefore the proof.
  const accountAPrivateScope = [owner];
  assertThrows(() => requireAccessibleAgentBrand(accountAPrivateScope, delegated.id), TenantScopeError);
});
