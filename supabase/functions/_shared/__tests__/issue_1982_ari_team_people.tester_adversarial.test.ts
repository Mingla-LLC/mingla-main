// #1982 — independent tester adversarial angle (different from implementor).
//
// Attacks:
//   - scanner invite must never hit invite-brand-member
//   - revoke_brand_member must never hard-DELETE
//   - empty invitee name refuses with zero invoke
//   - manage_brand_people add is never read-only; bogus cursor fails closed
//   - below-role auth pins stay exact
//
// Run:
//   deno test --allow-read supabase/functions/_shared/__tests__/issue_1982_ari_team_people.tester_adversarial.test.ts

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { DOMAIN_TOOLS } from "../agentDomainTools.ts";
import { AGENT_TOOL_AUTHORIZATION } from "../agentToolAuthorization.ts";
import { isReadOnlyAgentToolCall } from "../agentTools.ts";
import { ToolError } from "../agentToolHelpers.ts";

const BRAND = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

// deno-lint-ignore no-explicit-any
function domainTool(name: string): any {
  const tool = DOMAIN_TOOLS.find((t) => t.name === name);
  assert(tool, `${name} must be registered`);
  return tool;
}

Deno.test("#1982 tester: role pins stay exact", () => {
  assertEquals(AGENT_TOOL_AUTHORIZATION.invite_brand_member.requiredRole, "brand_admin");
  assertEquals(AGENT_TOOL_AUTHORIZATION.revoke_brand_member.requiredRole, "brand_admin");
  assertEquals(AGENT_TOOL_AUTHORIZATION.revoke_brand_invitation.requiredRole, "brand_admin");
  assertEquals(AGENT_TOOL_AUTHORIZATION.list_brand_team.requiredRole, "brand_admin");
  assertEquals(AGENT_TOOL_AUTHORIZATION.invite_scanner.requiredRole, "event_manager");
  assertEquals(AGENT_TOOL_AUTHORIZATION.revoke_scanner_invitation.requiredRole, "event_manager");
  assertEquals(AGENT_TOOL_AUTHORIZATION.manage_brand_people.requiredRole, "marketing_manager");
});

Deno.test("#1982 tester: invite_scanner never posts invite-brand-member", async () => {
  const tool = domainTool("invite_scanner");
  const invokes: string[] = [];
  const client = {
    functions: {
      // deno-lint-ignore no-explicit-any
      invoke: (name: string, _init: any) => {
        invokes.push(name);
        return Promise.resolve({ data: { ok: true }, error: null });
      },
    },
  };
  await tool.executor(
    {
      brand_id: BRAND,
      email: "s@b.com",
      name: "Sam",
      scope: "brand",
    },
    client as never,
    USER,
  );
  assertEquals(invokes, ["invite-scanner"]);
  assert(!invokes.includes("invite-brand-member"));
});

Deno.test("#1982 tester: empty invitee name never invokes", async () => {
  const tool = domainTool("invite_brand_member");
  let invoked = false;
  const client = {
    functions: {
      invoke: () => {
        invoked = true;
        return Promise.resolve({ data: {}, error: null });
      },
    },
  };
  await assertRejects(
    () =>
      tool.executor(
        { brand_id: BRAND, email: "a@b.com", name: "", role: "event_manager" },
        client as never,
        USER,
      ),
    ToolError,
  );
  assert(!invoked);
});

Deno.test("#1982 tester: revoke_brand_member source forbids hard DELETE", async () => {
  const source = await Deno.readTextFile(
    new URL("../agentDomainTools.ts", import.meta.url),
  );
  const start = source.indexOf('const revokeBrandMember = writeTool(');
  const end = source.indexOf('const revokeBrandInvitation = writeTool(');
  assert(start >= 0 && end > start);
  const block = source.slice(start, end);
  assert(block.includes("removed_at"));
  assert(!block.includes(".delete("));
  assert(!/\.from\(\s*"brand_members"\s*\)/.test(block));
});

Deno.test("#1982 tester: people add is confirmed write; bad cursor fails", async () => {
  assert(!isReadOnlyAgentToolCall("manage_brand_people", { action: "add" }));
  const tool = domainTool("manage_brand_people");
  let rpcCalled = false;
  const client = {
    from() {
      return {
        select: () => ({
          eq: () => ({
            is: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      };
    },
    rpc: () => {
      rpcCalled = true;
      return Promise.resolve({ data: {}, error: null });
    },
  };
  // assertAgentReadBrand needs owned brands — provide a minimal thenable brand list.
  const ownedClient = {
    from(table: string) {
      if (table === "brands" || table === "brand_team_members") {
        const data = table === "brands"
          ? [{
            id: BRAND,
            name: "T",
            slug: "t",
            default_currency: "usd",
            cover_media_url: null,
          }]
          : [];
        // deno-lint-ignore no-explicit-any
        const q: any = {
          select: () => q,
          eq: () => q,
          is: () => q,
          not: () => q,
          then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
            Promise.resolve({ data, error: null }).then(resolve, reject),
        };
        return q;
      }
      return client.from();
    },
    rpc: () => {
      rpcCalled = true;
      return Promise.resolve({ data: {}, error: null });
    },
  };
  await assertRejects(
    () =>
      tool.executor(
        { brand_id: BRAND, action: "list", cursor: "not-an-object" },
        ownedClient as never,
        USER,
      ),
    ToolError,
  );
  assert(!rpcCalled);
});

Deno.test("#1982 tester: revoke_brand_invitation is registered", () => {
  assert(DOMAIN_TOOLS.some((t) => t.name === "revoke_brand_invitation"));
  assertEquals(
    AGENT_TOOL_AUTHORIZATION.revoke_brand_invitation.resource,
    "brand",
  );
});
