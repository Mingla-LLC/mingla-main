// #1982 — team invite/revoke, scanner list/revoke, Brand People list/get/add.
//
// Fails on revert of:
//   - list_brand_team returns members + brand invitations + scanner_invitations
//   - revoke_brand_invitation updates pending brand_invitations
//   - revoke_brand_member soft-deletes brand_team_members (no hard DELETE)
//   - invite_brand_member / invite_scanner require name; scanner → invite-scanner
//   - manage_brand_people list forwards p_cursor; get/add call book RPCs
//   - auth pins + PROMPT_VERSION v20 ads
//
// Run:
//   deno test --allow-read supabase/functions/_shared/__tests__/issue_1982_ari_team_people.implementor.test.ts

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { DOMAIN_TOOLS, DOMAIN_READ_ONLY } from "../agentDomainTools.ts";
import { AGENT_TOOL_AUTHORIZATION } from "../agentToolAuthorization.ts";
import { TENANT_SCOPED_READ_TOOL_NAMES } from "../agentTenantScope.ts";
import { isReadOnlyAgentToolCall } from "../agentTools.ts";
import { buildSystemPrompt, PROMPT_VERSION } from "../agentSystemPrompt.ts";
import { ToolError } from "../agentToolHelpers.ts";

const BRAND = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const INVITE = "33333333-3333-4333-8333-333333333333";
const MEMBER = "44444444-4444-4444-8444-444444444444";
const PERSON = "55555555-5555-4555-8555-555555555555";
const EVENT = "66666666-6666-4666-8666-666666666666";

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

const brandRow = {
  id: BRAND,
  name: "Test",
  slug: "test",
  default_currency: "usd",
  cover_media_url: null,
};

function brandClient(extra: {
  // deno-lint-ignore no-explicit-any
  from?: (table: string) => any;
  // deno-lint-ignore no-explicit-any
  rpc?: (name: string, args: Record<string, unknown>) => any;
  // deno-lint-ignore no-explicit-any
  invoke?: (name: string, init: any) => any;
} = {}) {
  const invokes: Array<{ name: string; body: Record<string, unknown> }> = [];
  const rpcs: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    invokes,
    rpcs,
    client: {
      from(table: string) {
        if (extra.from) return extra.from(table);
        if (table === "brands") return chain([brandRow]);
        if (table === "brand_team_members") return chain([]);
        throw new Error(`unexpected table ${table}`);
      },
      // deno-lint-ignore no-explicit-any
      rpc: (name: string, args: Record<string, unknown>): any => {
        rpcs.push({ name, args });
        if (extra.rpc) return extra.rpc(name, args);
        return Promise.resolve({ data: {}, error: null });
      },
      functions: {
        // deno-lint-ignore no-explicit-any
        invoke: (name: string, init: any) => {
          invokes.push({ name, body: init?.body ?? {} });
          if (extra.invoke) return extra.invoke(name, init);
          return Promise.resolve({ data: { ok: true }, error: null });
        },
      },
    },
  };
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
  assertEquals(AGENT_TOOL_AUTHORIZATION.revoke_brand_invitation, {
    requiredRole: "brand_admin",
    resource: "brand",
  });
  assertEquals(AGENT_TOOL_AUTHORIZATION.invite_brand_member, {
    requiredRole: "brand_admin",
    resource: "brand",
  });
  assertEquals(AGENT_TOOL_AUTHORIZATION.invite_scanner, {
    requiredRole: "event_manager",
    resource: "brand",
  });
  assertEquals(AGENT_TOOL_AUTHORIZATION.revoke_brand_member, {
    requiredRole: "brand_admin",
    resource: "brand",
  });
  assert(DOMAIN_READ_ONLY.has("list_brand_team"));
  assert(TENANT_SCOPED_READ_TOOL_NAMES.has("list_brand_team"));
  assert(isReadOnlyAgentToolCall("manage_brand_people", { action: "list" }));
  assert(isReadOnlyAgentToolCall("manage_brand_people", { action: "get" }));
  assert(!isReadOnlyAgentToolCall("manage_brand_people", { action: "add" }));
  assert(!isReadOnlyAgentToolCall("revoke_brand_invitation", {}));
  assert(!isReadOnlyAgentToolCall("invite_brand_member", {}));
});

Deno.test("#1982 implementor: PROMPT_VERSION v20 ads team surface", () => {
  assertEquals(PROMPT_VERSION, "v20");
  const prompt = buildSystemPrompt(null, [], { injectStrictReminder: false });
  assert(prompt.includes("revoke_brand_invitation"));
  assert(prompt.includes("scanner invitations"));
  assert(prompt.includes("cursor pagination"));
});

Deno.test("#1982 implementor: list_brand_team returns members + invitations + scanners", async () => {
  const tool = domainTool("list_brand_team");
  const { client } = brandClient({
    from(table: string) {
      if (table === "brands") return chain([brandRow]);
      if (table === "brand_team_members") {
        return chain([{ id: MEMBER, user_id: USER, role: "event_manager" }]);
      }
      if (table === "brand_invitations") {
        return chain([{
          id: INVITE,
          email: "a@b.com",
          role: "finance_manager",
          status: "pending",
        }]);
      }
      if (table === "scanner_invitations") {
        return chain([{
          id: "s1",
          brand_id: BRAND,
          scope: "brand",
          email: "scan@b.com",
          status: "pending",
        }]);
      }
      throw new Error(table);
    },
  });
  const result = await tool.executor({ brand_id: BRAND }, client as never, USER);
  assertEquals(result.members.length, 1);
  assertEquals(result.invitations.length, 1);
  assertEquals(result.scanner_invitations.length, 1);
  assertEquals(result.scanner_invitations[0].email, "scan@b.com");
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

Deno.test("#1982 implementor: revoke_brand_invitation updates pending invite", async () => {
  const tool = domainTool("revoke_brand_invitation");
  let updated = false;
  const client = {
    from(table: string) {
      assertEquals(table, "brand_invitations");
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

Deno.test("#1982 implementor: revoke_brand_member soft-deletes membership", async () => {
  const tool = domainTool("revoke_brand_member");
  let payload: Record<string, unknown> | null = null;
  const client = {
    from(table: string) {
      assertEquals(table, "brand_team_members");
      return {
        update: (p: Record<string, unknown>) => {
          payload = p;
          return {
            eq: () => ({
              eq: () => ({
                is: () => ({
                  select: () => ({
                    maybeSingle: () =>
                      Promise.resolve({ data: { id: MEMBER }, error: null }),
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
    { brand_id: BRAND, member_id: MEMBER },
    client as never,
    USER,
  );
  assert(payload !== null);
  assertEquals(typeof (payload as Record<string, unknown>).removed_at, "string");
  assertEquals(result, { member_id: MEMBER, revoked: true });
});

Deno.test("#1982 implementor: invite_brand_member requires name and hits edge", async () => {
  const tool = domainTool("invite_brand_member");
  const { client, invokes } = brandClient();
  await assertRejects(
    () =>
      tool.executor(
        { brand_id: BRAND, email: "a@b.com", name: "  ", role: "event_manager" },
        client as never,
        USER,
      ),
    ToolError,
  );
  assertEquals(invokes.length, 0);
  await tool.executor(
    {
      brand_id: BRAND,
      email: "a@b.com",
      name: "Ada",
      role: "event_manager",
    },
    client as never,
    USER,
  );
  assertEquals(invokes.length, 1);
  assertEquals(invokes[0].name, "invite-brand-member");
  assertEquals(invokes[0].body.invitee_name, "Ada");
});

Deno.test("#1982 implementor: invite_scanner routes to invite-scanner", async () => {
  const tool = domainTool("invite_scanner");
  const { client, invokes } = brandClient();
  await assertRejects(
    () =>
      tool.executor(
        {
          brand_id: BRAND,
          email: "s@b.com",
          name: "Sam",
          scope: "event",
        },
        client as never,
        USER,
      ),
    ToolError,
  );
  assertEquals(invokes.length, 0);
  await tool.executor(
    {
      brand_id: BRAND,
      email: "s@b.com",
      name: "Sam",
      scope: "event",
      event_id: EVENT,
      can_accept_payments: true,
    },
    client as never,
    USER,
  );
  assertEquals(invokes[0].name, "invite-scanner");
  assertEquals(invokes[0].body.event_id, EVENT);
  assertEquals(invokes[0].body.can_accept_payments, true);
});

Deno.test("#1982 implementor: manage_brand_people list forwards cursor", async () => {
  const tool = domainTool("manage_brand_people");
  const cursor = { updatedAt: "2026-09-12T00:00:00Z", personId: PERSON };
  const { client, rpcs } = brandClient({
    rpc: (_name, _args) =>
      Promise.resolve({
        data: {
          rows: [{ id: PERSON }],
          nextCursor: { updatedAt: "2026-09-11T00:00:00Z", personId: PERSON },
        },
        error: null,
      }),
  });
  const result = await tool.executor(
    { brand_id: BRAND, action: "list", cursor, limit: 10 },
    client as never,
    USER,
  );
  assertEquals(rpcs[0].name, "biz_get_brand_people_book");
  assertEquals(rpcs[0].args.p_cursor, cursor);
  assertEquals(rpcs[0].args.p_limit, 10);
  assertEquals(result.hasMore, true);
  assertEquals(result.nextCursor, {
    updatedAt: "2026-09-11T00:00:00Z",
    personId: PERSON,
  });
});

Deno.test("#1982 implementor: manage_brand_people get + add", async () => {
  const tool = domainTool("manage_brand_people");
  const { client, rpcs } = brandClient({
    rpc: (name, _args) => {
      if (name === "biz_get_brand_person") {
        return Promise.resolve({
          data: { id: PERSON, display_name: "Pat" },
          error: null,
        });
      }
      return Promise.resolve({
        data: { id: PERSON, created: true },
        error: null,
      });
    },
  });
  const got = await tool.executor(
    { brand_id: BRAND, action: "get", person_id: PERSON },
    client as never,
    USER,
  );
  assertEquals(rpcs[0].name, "biz_get_brand_person");
  assertEquals(got.id, PERSON);

  await assertRejects(
    () =>
      tool.executor(
        { brand_id: BRAND, action: "add", display_name: "  " },
        client as never,
        USER,
      ),
    ToolError,
  );

  const added = await tool.executor(
    {
      brand_id: BRAND,
      action: "add",
      display_name: "Pat",
      email: "p@b.com",
      client_request_id: PERSON,
    },
    client as never,
    USER,
  );
  const addRpc = rpcs.find((r) => r.name === "biz_add_brand_person");
  assert(addRpc);
  assertEquals(addRpc.args.p_display_name, "Pat");
  assertEquals(addRpc.args.p_client_request_id, PERSON);
  assertEquals(added.id, PERSON);
});
