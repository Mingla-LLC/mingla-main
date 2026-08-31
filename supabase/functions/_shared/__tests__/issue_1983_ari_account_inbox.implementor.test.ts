// #1983 — profile avatar, Ari history, notifications, support inbox.
//
// Run:
//   deno test --allow-read supabase/functions/_shared/__tests__/issue_1983_ari_account_inbox.implementor.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { DOMAIN_TOOLS } from "../agentDomainTools.ts";
import { AGENT_TOOL_AUTHORIZATION } from "../agentToolAuthorization.ts";
import { isReadOnlyAgentToolCall } from "../agentTools.ts";

Deno.test("#1983 implementor: auth + read-only pins", () => {
  assertEquals(AGENT_TOOL_AUTHORIZATION.edit_profile_avatar, {
    requiredRole: "self",
    resource: "none",
  });
  assertEquals(AGENT_TOOL_AUTHORIZATION.manage_ari_history, {
    requiredRole: "self",
    resource: "none",
  });
  assertEquals(AGENT_TOOL_AUTHORIZATION.manage_business_notifications, {
    requiredRole: "self",
    resource: "none",
  });
  assertEquals(AGENT_TOOL_AUTHORIZATION.manage_support_inbox, {
    requiredRole: "self",
    resource: "none",
  });
  assert(isReadOnlyAgentToolCall("manage_ari_history", { action: "list" }));
  assert(!isReadOnlyAgentToolCall("manage_ari_history", { action: "delete_all" }));
  assert(isReadOnlyAgentToolCall("manage_business_notifications", { action: "list" }));
  assert(isReadOnlyAgentToolCall("manage_support_inbox", { action: "get" }));
  for (const name of [
    "edit_profile_avatar",
    "manage_ari_history",
    "manage_business_notifications",
    "manage_support_inbox",
  ]) {
    assert(DOMAIN_TOOLS.some((t) => t.name === name), name);
  }
});
