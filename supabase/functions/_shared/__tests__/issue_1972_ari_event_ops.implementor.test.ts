// #1972 reopen — group chat, door sale, orders, waitlist, scanner admin.
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

Deno.test("#1972 implementor: manage_event_door_sale create inserts ledger row", async () => {
  const tool = domainTool("manage_event_door_sale");
  const inserted: { payload?: Record<string, unknown> } = {};
  const client = {
    from(table: string) {
      if (table === "events") return eventsClient().from("events");
      assertEquals(table, "door_sales_ledger");
      return {
        insert: (payload: Record<string, unknown>) => {
          inserted.payload = payload;
          return {
            select: () => ({
              single: () =>
                Promise.resolve({
                  data: {
                    id: "ds1",
                    payment_method: payload.payment_method,
                    amount_cents: payload.amount_cents,
                    currency: payload.currency,
                    created_at: "2026-08-25T00:00:00Z",
                  },
                  error: null,
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
      action: "create",
      payment_method: "cash",
      amount_cents: 2500,
      currency: "gbp",
    },
    client as never,
    USER,
  );
  assertEquals(inserted.payload?.payment_method, "cash");
  assertEquals(inserted.payload?.amount_cents, 2500);
  assertEquals(inserted.payload?.currency, "GBP");
  assertEquals(result.recorded, true);
});
