// #1980 — marketing audiences, templates, campaign reports.
//
// Run:
//   deno test --allow-read supabase/functions/_shared/__tests__/issue_1980_ari_marketing.implementor.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { DOMAIN_TOOLS, DOMAIN_READ_ONLY } from "../agentDomainTools.ts";
import { AGENT_TOOL_AUTHORIZATION } from "../agentToolAuthorization.ts";
import { TENANT_SCOPED_READ_TOOL_NAMES } from "../agentTenantScope.ts";
import { isReadOnlyAgentToolCall } from "../agentTools.ts";

Deno.test("#1980 implementor: auth + read-only pins", () => {
  assertEquals(AGENT_TOOL_AUTHORIZATION.manage_marketing_audiences, {
    requiredRole: "marketing_manager",
    resource: "optional_brand",
  });
  assertEquals(AGENT_TOOL_AUTHORIZATION.manage_marketing_templates, {
    requiredRole: "marketing_manager",
    resource: "optional_brand",
  });
  assertEquals(AGENT_TOOL_AUTHORIZATION.get_campaign_report, {
    requiredRole: "marketing_manager",
    resource: "campaign",
  });
  assert(DOMAIN_READ_ONLY.has("get_campaign_report"));
  assert(TENANT_SCOPED_READ_TOOL_NAMES.has("get_campaign_report"));
  assert(isReadOnlyAgentToolCall("manage_marketing_audiences", { action: "list" }));
  assert(!isReadOnlyAgentToolCall("manage_marketing_audiences", {
    action: "ensure_brand_buyers",
  }));
  assert(isReadOnlyAgentToolCall("manage_marketing_templates", { action: "list" }));
  for (const name of [
    "manage_marketing_audiences",
    "manage_marketing_templates",
    "get_campaign_report",
  ]) {
    assert(DOMAIN_TOOLS.some((t) => t.name === name), name);
  }
});
