// #1983 — account/inbox adversarial fail-on-revert.
//
// Run:
//   deno test --allow-read supabase/functions/_shared/__tests__/issue_1983_ari_account_inbox.tester_adversarial.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { DOMAIN_TOOLS } from "../agentDomainTools.ts";
import { AGENT_TOOL_AUTHORIZATION } from "../agentToolAuthorization.ts";
import { isReadOnlyAgentToolCall } from "../agentTools.ts";

const ACCOUNT_TOOLS = [
  "edit_profile_avatar",
  "manage_ari_history",
  "manage_business_notifications",
  "manage_support_inbox",
] as const;

Deno.test("#1983 tester: every account tool stays self/none", () => {
  for (const name of ACCOUNT_TOOLS) {
    assertEquals(AGENT_TOOL_AUTHORIZATION[name], {
      requiredRole: "self",
      resource: "none",
    }, name);
    assert(DOMAIN_TOOLS.some((t) => t.name === name), name);
  }
});

Deno.test("#1983 tester: mutating actions are never read-only", () => {
  assert(!isReadOnlyAgentToolCall("edit_profile_avatar", {}));
  assert(!isReadOnlyAgentToolCall("manage_ari_history", { action: "delete_all" }));
  assert(
    !isReadOnlyAgentToolCall("manage_business_notifications", {
      action: "mark_read",
    }),
  );
  assert(!isReadOnlyAgentToolCall("manage_support_inbox", { action: "reply" }));
});

Deno.test("#1983 tester: list/get stay read-only", () => {
  assert(isReadOnlyAgentToolCall("manage_ari_history", { action: "list" }));
  assert(
    isReadOnlyAgentToolCall("manage_business_notifications", { action: "list" }),
  );
  assert(isReadOnlyAgentToolCall("manage_support_inbox", { action: "list" }));
  assert(isReadOnlyAgentToolCall("manage_support_inbox", { action: "get" }));
});
