// #1972 reopen — group chat, door sale, orders, waitlist, scanner admin.
// [TEST-MOD-APPROVED #4063] Door-sale creation now shares the durable order RPC.
//
// Run:
//   deno test --allow-read supabase/functions/_shared/__tests__/issue_1972_ari_event_ops.implementor.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DOMAIN_TOOLS,
  DOMAIN_READ_ONLY,
  MONEY_CONFIRM_TOOLS,
} from "../agentDomainTools.ts";
import { AGENT_TOOL_AUTHORIZATION } from "../agentToolAuthorization.ts";
import { TENANT_SCOPED_READ_TOOL_NAMES } from "../agentTenantScope.ts";
import { isReadOnlyAgentToolCall } from "../agentTools.ts";

const BRAND = "11111111-1111-4111-8111-111111111111";
const EVENT = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const INVITE = "44444444-4444-4444-8444-444444444444";
const TICKET_TYPE = "55555555-5555-4555-8555-555555555555";
const OPERATION = "66666666-6666-4666-8666-666666666666";

// deno-lint-ignore no-explicit-any
function domainTool(name: string): any {
  const tool = DOMAIN_TOOLS.find((t) => t.name === name);
  assert(tool, `${name} must be registered`);
  return tool;
}

function eventsClient() {
  return {
    from(table: string) {
      if (table === "events") {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { id: EVENT, brand_id: BRAND },
                    error: null,
                  }),
              }),
            }),
          }),
        };
      }
      throw new Error(table);
    },
  };
}

Deno.test("#1972 implementor: auth + read-only pins", () => {
  assertEquals(AGENT_TOOL_AUTHORIZATION.manage_event_group_chat, {
    requiredRole: "event_manager",
    resource: "event",
  });
  assertEquals(AGENT_TOOL_AUTHORIZATION.manage_event_door_sale, {
    requiredRole: "event_manager",
    resource: "event",
  });
  assertEquals(AGENT_TOOL_AUTHORIZATION.list_event_orders, {
    requiredRole: "finance_manager",
    resource: "event",
  });
  assertEquals(AGENT_TOOL_AUTHORIZATION.manage_event_waitlist, {
    requiredRole: "event_manager",
    resource: "event",
  });
  assertEquals(AGENT_TOOL_AUTHORIZATION.manage_event_scanners, {
    requiredRole: "event_manager",
    resource: "event",
  });
  assert(DOMAIN_READ_ONLY.has("list_event_orders"));
  assert(TENANT_SCOPED_READ_TOOL_NAMES.has("list_event_orders"));
  assert(MONEY_CONFIRM_TOOLS.has("manage_event_door_sale"));
  assert(isReadOnlyAgentToolCall("manage_event_door_sale", { action: "list" }));
  assert(!isReadOnlyAgentToolCall("manage_event_door_sale", { action: "create" }));
  assert(isReadOnlyAgentToolCall("manage_event_waitlist", { action: "list" }));
  assert(isReadOnlyAgentToolCall("manage_event_scanners", { action: "list" }));
  assert(
    isReadOnlyAgentToolCall("manage_event_group_chat", { action: "get" }),
  );
  for (const name of [
    "manage_event_group_chat",
    "manage_event_door_sale",
    "list_event_orders",
    "manage_event_waitlist",
    "manage_event_scanners",
  ]) {
    assert(DOMAIN_TOOLS.some((t) => t.name === name), name);
  }
});

Deno.test("#1972 implementor: manage_event_scanners revoke updates pending row", async () => {
  const tool = domainTool("manage_event_scanners");
  let updated = false;
  const client = {
    from(table: string) {
      if (table === "events") return eventsClient().from("events");
      assertEquals(table, "scanner_invitations");
      return {
        update: (payload: Record<string, unknown>) => {
          assertEquals(payload.status, "revoked");
          updated = true;
          return {
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    select: () => ({
                      maybeSingle: () =>
                        Promise.resolve({ data: { id: INVITE }, error: null }),
                    }),
                  }),
                }),
              }),
            }),
          };
        },
      };
    },
  };
  const result = await tool.executor(
    {
      brand_id: BRAND,
      event_id: EVENT,
      action: "revoke",
      invitation_id: INVITE,
    },
    client as never,
    USER,
  );
  assert(updated);
  assertEquals(result, { invitation_id: INVITE, revoked: true });
});

Deno.test("#4063 implementor: manage_event_door_sale create records the durable order", async () => {
  const tool = domainTool("manage_event_door_sale");
  const invoked: { fn?: string; args?: Record<string, unknown> } = {};
  const client = {
    from(table: string) {
      return eventsClient().from(table);
    },
    rpc(fn: string, args: Record<string, unknown>) {
      invoked.fn = fn;
      invoked.args = args;
      return Promise.resolve({
        data: {
          orderId: "77777777-7777-4777-8777-777777777777",
          ticketIds: ["88888888-8888-4888-8888-888888888888"],
          receiptQueued: true,
          replayed: false,
        },
        error: null,
      });
    },
  };
  const result = await tool.executor(
    {
      brand_id: BRAND,
      event_id: EVENT,
      action: "create",
      payment_method: "cash",
      lines: [{ ticket_type_id: TICKET_TYPE, quantity: 1 }],
      buyer_phone: "+447700900406",
    },
    client as never,
    USER,
    { operationId: OPERATION },
  );
  assertEquals(invoked.fn, "biz_door_sale_record");
  assertEquals(invoked.args, {
    p_event_id: EVENT,
    p_event_date_id: null,
    p_lines: [{ ticket_type_id: TICKET_TYPE, quantity: 1 }],
    p_payment_method: "cash",
    p_buyer_name: null,
    p_buyer_phone_e164: "+447700900406",
    p_buyer_email: null,
    p_notes: null,
    p_client_request_id: OPERATION,
  });
  assertEquals(result.recorded, true);
  assertEquals(result.sale.receiptQueued, true);
});
