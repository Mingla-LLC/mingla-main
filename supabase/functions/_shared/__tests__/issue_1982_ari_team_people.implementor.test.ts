// #1982 — list_brand_team, revoke_scanner_invitation, manage_brand_people.
//
// Run:
//   deno test --allow-read supabase/functions/_shared/__tests__/issue_1982_ari_team_people.implementor.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { DOMAIN_TOOLS, DOMAIN_READ_ONLY } from "../agentDomainTools.ts";
import { AGENT_TOOL_AUTHORIZATION } from "../agentToolAuthorization.ts";
import { TENANT_SCOPED_READ_TOOL_NAMES } from "../agentTenantScope.ts";
import { isReadOnlyAgentToolCall } from "../agentTools.ts";

const BRAND = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const INVITE = "33333333-3333-4333-8333-333333333333";

// deno-lint-ignore no-explicit-any
function domainTool(name: string): any {
  const tool = DOMAIN_TOOLS.find((t) => t.name === name);
  assert(tool, `${name} must be registered`);
  return tool;
}

// deno-lint-ignore no-explicit-any
function chain(data: unknown): any {
  const result = Promise.resolve({ data, error: null });
  // deno-lint-ignore no-explicit-any
  const query: any = {
    select: () => query,
    eq: () => query,
    is: () => query,
    not: () => query,
    order: () => query,
    update: () => query,
    maybeSingle: () =>
      Promise.resolve({
        data: Array.isArray(data) ? (data[0] ?? null) : data,
        error: null,
      }),
    then: result.then.bind(result),
    catch: result.catch.bind(result),
  };
  return query;
}

Deno.test("#1982 implementor: auth + read-only pins", () => {
  assertEquals(AGENT_TOOL_AUTHORIZATION.list_brand_team, {
    requiredRole: "brand_admin",
    resource: "brand",
  });
  assertEquals(AGENT_TOOL_AUTHORIZATION.revoke_scanner_invitation, {
    requiredRole: "event_manager",
    resource: "brand",
  });
  assertEquals(AGENT_TOOL_AUTHORIZATION.manage_brand_people, {
    requiredRole: "marketing_manager",
    resource: "brand",
  });
  assert(DOMAIN_READ_ONLY.has("list_brand_team"));
  assert(TENANT_SCOPED_READ_TOOL_NAMES.has("list_brand_team"));
  assert(isReadOnlyAgentToolCall("manage_brand_people", { action: "list" }));
  assert(isReadOnlyAgentToolCall("manage_brand_people", { action: "get" }));
  assert(!isReadOnlyAgentToolCall("manage_brand_people", { action: "add" }));
});

Deno.test("#1982 implementor: list_brand_team returns members + invitations", async () => {
  const tool = domainTool("list_brand_team");
  const brandRow = {
    id: BRAND,
    name: "Test",
    slug: "test",
    default_currency: "usd",
    cover_media_url: null,
  };
  const client = {
    from(table: string) {
      if (table === "brands") return chain([brandRow]);
      if (table === "brand_team_members") {
        return chain([{ id: "m1", user_id: USER, role: "event_manager" }]);
      }
      if (table === "brand_invitations") {
        return chain([{ id: "i1", email: "a@b.com", role: "finance_manager", status: "pending" }]);
      }
      throw new Error(table);
    },
  };
  const result = await tool.executor({ brand_id: BRAND }, client as never, USER);
  assertEquals(result.members.length, 1);
  assertEquals(result.invitations.length, 1);
});

Deno.test("#1982 implementor: revoke_scanner_invitation updates pending row", async () => {
  const tool = domainTool("revoke_scanner_invitation");
  let updated = false;
  const client = {
    from(table: string) {
      assertEquals(table, "scanner_invitations");
      return {
        update: (payload: Record<string, unknown>) => {
          assertEquals(payload.status, "revoked");
          updated = true;
          return {
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
          };
        },
      };
    },
  };
  const result = await tool.executor(
    { brand_id: BRAND, invitation_id: INVITE },
    client as never,
    USER,
  );
  assert(updated);
  assertEquals(result, { invitation_id: INVITE, revoked: true });
});

Deno.test("#1982 implementor: manage_brand_people list calls book RPC", async () => {
  const tool = domainTool("manage_brand_people");
  let rpcName = "";
  const client = {
    from(table: string) {
      if (table === "brands") {
        return chain([{
          id: BRAND,
          name: "Test",
          slug: "test",
          default_currency: "usd",
          cover_media_url: null,
        }]);
      }
      if (table === "brand_team_members") return chain([]);
      throw new Error(table);
    },
    rpc: (name: string, _args: Record<string, unknown>) => {
      rpcName = name;
      return Promise.resolve({
        data: { rows: [], nextCursor: null, bookTotal: 0, filteredTotal: 0 },
        error: null,
      });
    },
  };
  await tool.executor(
    { brand_id: BRAND, action: "list" },
    client as never,
    USER,
  );
  assertEquals(rpcName, "biz_get_brand_people_book");
});
