// #1983 — account/inbox + settings/deletion adversarial fail-on-revert.
//
// Run:
//   deno test --allow-read supabase/functions/_shared/__tests__/issue_1983_ari_account_inbox.tester_adversarial.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DOMAIN_TOOLS,
  MONEY_CONFIRM_TOOLS,
} from "../agentDomainTools.ts";
import { AGENT_TOOL_AUTHORIZATION } from "../agentToolAuthorization.ts";
import { isReadOnlyAgentToolCall } from "../agentTools.ts";

const ACCOUNT_TOOLS = [
  "edit_profile_avatar",
  "manage_ari_history",
  "manage_business_notifications",
  "manage_support_inbox",
] as const;

const SETTINGS_TOOLS = [
  "update_ari_prefs",
  "update_notification_prefs",
  "create_support_ticket",
  "request_account_deletion",
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

Deno.test("#1983 tester: settings/support/deletion stay self-scoped", () => {
  assertEquals(AGENT_TOOL_AUTHORIZATION.update_ari_prefs, {
    requiredRole: "self",
    resource: "none",
  });
  assertEquals(AGENT_TOOL_AUTHORIZATION.update_notification_prefs, {
    requiredRole: "self",
    resource: "none",
  });
  assertEquals(AGENT_TOOL_AUTHORIZATION.create_support_ticket, {
    requiredRole: "self",
    resource: "optional_brand",
  });
  assertEquals(AGENT_TOOL_AUTHORIZATION.request_account_deletion, {
    requiredRole: "self",
    resource: "none",
  });
  for (const name of SETTINGS_TOOLS) {
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
  assert(!isReadOnlyAgentToolCall("update_notification_prefs", {}));
  assert(!isReadOnlyAgentToolCall("request_account_deletion", {}));
  assert(!isReadOnlyAgentToolCall("create_support_ticket", {}));
});

Deno.test("#1983 tester: list/get stay read-only", () => {
  assert(isReadOnlyAgentToolCall("manage_ari_history", { action: "list" }));
  assert(
    isReadOnlyAgentToolCall("manage_business_notifications", { action: "list" }),
  );
  assert(isReadOnlyAgentToolCall("manage_support_inbox", { action: "list" }));
  assert(isReadOnlyAgentToolCall("manage_support_inbox", { action: "get" }));
});

Deno.test("#1983 tester: notification prefs cannot reintroduce email|sms|order", () => {
  const tool = DOMAIN_TOOLS.find((t) => t.name === "update_notification_prefs");
  assert(tool);
  const props = (tool.parameters as { properties: Record<string, unknown> })
    .properties;
  assert(!("email_enabled" in props), "email_enabled must stay gone");
  assert(!("sms_enabled" in props), "sms_enabled must stay gone");
  assert(!("push_enabled" in props), "push_enabled must stay gone");
  const channel = props.channel as { enum?: string[] };
  assertEquals(channel.enum, ["push", "in_app"]);
  const type = props.type as { enum?: string[] };
  assert(type.enum?.includes("business.order_paid"));
  assert(!type.enum?.includes("order"));
  const src = Deno.readTextFileSync(
    new URL("../agentDomainTools.ts", import.meta.url),
  );
  const start = src.indexOf('const updateNotificationPrefs = writeTool(');
  assert(start >= 0);
  const end = src.indexOf("const createSupportTicket = writeTool(", start);
  const block = src.slice(start, end);
  assert(!block.includes('channel: "email"'));
  assert(!block.includes('channel: "sms"'));
  assert(!block.includes('type: "order"'));
  assert(block.includes('onConflict: "user_id,channel,type"'));
});

Deno.test("#1983 tester: account deletion must keep side business + DELETE", () => {
  assert(MONEY_CONFIRM_TOOLS.has("request_account_deletion"));
  const tool = DOMAIN_TOOLS.find((t) => t.name === "request_account_deletion");
  assert(tool);
  const props = (tool.parameters as { properties: Record<string, unknown> })
    .properties;
  const phrase = props.confirm_phrase as { enum?: string[] };
  assertEquals(phrase.enum, ["DELETE"]);
  const src = Deno.readTextFileSync(
    new URL("../agentDomainTools.ts", import.meta.url),
  );
  const start = src.indexOf('const requestAccountDeletion = writeTool(');
  assert(start >= 0);
  const end = src.indexOf("const getOperatorSnapshot = writeTool(", start);
  const block = src.slice(start, end);
  assert(block.includes('side: "business"'));
  assert(!block.includes("legal_name: args.legal_name"));
  assert(!block.includes('confirm: "DELETE"'));
});
