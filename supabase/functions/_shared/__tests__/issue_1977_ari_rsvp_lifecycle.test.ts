import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AGENT_TOOL_AUTHORIZATION } from "../agentToolAuthorization.ts";
import { DOMAIN_READ_ONLY, DOMAIN_TOOLS } from "../agentDomainTools.ts";
import { ToolError } from "../agentToolHelpers.ts";

const EVENT_ID = "19770000-0000-4000-8000-000000000001";
const BRAND_ID = "19770000-0000-4000-8000-000000000002";
const CONTRIBUTION_ID = "19770000-0000-4000-8000-000000000003";
const RSVP_ID = "19770000-0000-4000-8000-000000000004";
const OPERATION_ID = "19770000-0000-4000-8000-000000000005";

const tool = (name: string) => {
  const value = DOMAIN_TOOLS.find((candidate) => candidate.name === name);
  assert(value, `${name} must be registered`);
  return value;
};

function clientHarness() {
  const rpcCalls: Array<[string, Record<string, unknown>]> = [];
  const invokeCalls: Array<
    [string, Record<string, unknown>, Record<string, string> | undefined]
  > = [];
  const client = {
    from: (table: string) => {
      assertEquals(table, "events");
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "is"]) chain[method] = () => chain;
      chain.maybeSingle = () =>
        Promise.resolve({
          data: { id: EVENT_ID, brand_id: BRAND_ID },
          error: null,
        });
      return chain;
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push([name, args]);
      return Promise.resolve({ data: { ok: true }, error: null });
    },
    functions: {
      invoke: (
        name: string,
        options: {
          body: Record<string, unknown>;
          headers?: Record<string, string>;
        },
      ) => {
        invokeCalls.push([name, options.body, options.headers]);
        return Promise.resolve({
          data: { refund: { financial_state: "pending" } },
          error: null,
        });
      },
    },
  };
  return { client, rpcCalls, invokeCalls };
}

Deno.test("#1977 registers the complete RSVP lifecycle and minimized reads", () => {
  for (
    const name of [
      "create_rsvp",
      "update_rsvp",
      "publish_rsvp",
      "update_rsvp_contribution_settings",
      "list_guest_roster",
      "set_rsvp_guest_status",
      "refund_rsvp_contribution",
    ]
  ) tool(name);
  assert(DOMAIN_READ_ONLY.has("list_guest_roster"));
  assertEquals(
    AGENT_TOOL_AUTHORIZATION.list_guest_roster.requiredRole,
    "event_manager",
  );
  assertEquals(
    AGENT_TOOL_AUTHORIZATION.refund_rsvp_contribution.requiredRole,
    "finance_manager",
  );
});

Deno.test("#1977 Ari creates, updates, and publishes through one canonical graph", async () => {
  const { client, rpcCalls } = clientHarness();
  await tool("create_rsvp").executor(
    {
      brand_id: BRAND_ID,
      title: "Jollof Night",
      timezone: "Africa/Lagos",
      format: "in_person",
      capacity: 80,
    },
    client as never,
    "user",
    { operationId: OPERATION_ID },
  );
  await tool("update_rsvp").executor(
    {
      event_id: EVENT_ID,
      title: "Jollof and Jazz Night",
    },
    client as never,
    "user",
    { operationId: OPERATION_ID },
  );
  await tool("publish_rsvp").executor(
    { event_id: EVENT_ID },
    client as never,
    "user",
    { operationId: OPERATION_ID },
  );
  assertEquals(rpcCalls.map(([name]) => name), [
    "ari_execute_rsvp_operation",
    "ari_execute_rsvp_operation",
    "ari_execute_rsvp_operation",
  ]);
  assertEquals(rpcCalls[0][1].p_operation_id, OPERATION_ID);
  assertEquals(rpcCalls[0][1].p_tool_name, "create_rsvp");
  assertEquals(rpcCalls[1][1].p_tool_name, "update_rsvp");
  assertEquals(rpcCalls[2][1].p_tool_name, "publish_rsvp");
});

Deno.test("#1977 selected and all-pending guest decisions stay explicit", async () => {
  const { client, rpcCalls } = clientHarness();
  await tool("set_rsvp_guest_status").executor(
    {
      event_id: EVENT_ID,
      decision: "approve",
      scope: "selected",
      roster_keys: [`rsvp:${RSVP_ID}`],
      roster_watermark: 42,
    },
    client as never,
    "user",
    { operationId: OPERATION_ID },
  );
  assertEquals(rpcCalls[0], ["ari_execute_rsvp_operation", {
    p_operation_id: OPERATION_ID,
    p_tool_name: "set_rsvp_guest_status",
    p_args: {
      event_id: EVENT_ID,
      decision: "approve",
      scope: "selected",
      roster_keys: [`rsvp:${RSVP_ID}`],
      roster_watermark: 42,
    },
  }]);
  await assertRejects(
    () =>
      tool("set_rsvp_guest_status").executor(
        {
          event_id: EVENT_ID,
          decision: "deny",
          scope: "selected",
        },
        client as never,
        "user",
        { operationId: OPERATION_ID },
      ),
    ToolError,
    "roster_keys are required",
  );
  await assertRejects(
    () =>
      tool("set_rsvp_guest_status").executor(
        {
          event_id: EVENT_ID,
          decision: "approve",
          scope: "all_pending",
          roster_keys: [`rsvp:${RSVP_ID}`],
        },
        client as never,
        "user",
        { operationId: OPERATION_ID },
      ),
    ToolError,
    "must be omitted",
  );
});

Deno.test("#1977 refund binds event and contribution without order or caller amount", async () => {
  const { client, invokeCalls } = clientHarness();
  await tool("refund_rsvp_contribution").executor(
    {
      event_id: EVENT_ID,
      contribution_id: CONTRIBUTION_ID,
      mode: "discretionary",
      reason: "Guest requested the contribution refund",
      confirm_phrase: "REFUND",
    },
    client as never,
    "user",
    { operationId: OPERATION_ID },
  );
  assertEquals(invokeCalls[0], ["rsvp-contribution-refund", {
    eventId: EVENT_ID,
    contributionId: CONTRIBUTION_ID,
    mode: "discretionary",
    reason: "Guest requested the contribution refund",
    operationId: OPERATION_ID,
    operationArgs: {
      event_id: EVENT_ID,
      contribution_id: CONTRIBUTION_ID,
      mode: "discretionary",
      reason: "Guest requested the contribution refund",
      confirm_phrase: "REFUND",
    },
  }, { "Idempotency-Key": OPERATION_ID }]);
});
