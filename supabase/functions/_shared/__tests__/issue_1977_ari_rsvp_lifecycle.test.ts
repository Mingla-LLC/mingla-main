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

const tool = (name: string) => {
  const value = DOMAIN_TOOLS.find((candidate) => candidate.name === name);
  assert(value, `${name} must be registered`);
  return value;
};

function clientHarness() {
  const rpcCalls: Array<[string, Record<string, unknown>]> = [];
  const invokeCalls: Array<[string, Record<string, unknown>, Record<string, string> | undefined]> = [];
  const client = {
    from: (table: string) => {
      assertEquals(table, "events");
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "is"]) chain[method] = () => chain;
      chain.maybeSingle = () => Promise.resolve({ data: { id: EVENT_ID, brand_id: BRAND_ID }, error: null });
      return chain;
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push([name, args]);
      return Promise.resolve({ data: { ok: true }, error: null });
    },
    functions: {
      invoke: (name: string, options: { body: Record<string, unknown>; headers?: Record<string, string> }) => {
        invokeCalls.push([name, options.body, options.headers]);
        return Promise.resolve({ data: { refund: { financial_state: "pending" } }, error: null });
      },
    },
  };
  return { client, rpcCalls, invokeCalls };
}

Deno.test("#1977 registers the complete RSVP lifecycle and minimized reads", () => {
  for (const name of [
    "create_rsvp",
    "update_rsvp",
    "publish_rsvp",
    "update_rsvp_contribution_settings",
    "list_guest_roster",
    "set_rsvp_guest_status",
    "list_rsvp_contributions",
    "refund_rsvp_contribution",
  ]) tool(name);
  assert(DOMAIN_READ_ONLY.has("list_guest_roster"));
  assert(DOMAIN_READ_ONLY.has("list_rsvp_contributions"));
  assertEquals(AGENT_TOOL_AUTHORIZATION.list_guest_roster.requiredRole, "event_manager");
  assertEquals(AGENT_TOOL_AUTHORIZATION.list_rsvp_contributions.requiredRole, "finance_manager");
  assertEquals(AGENT_TOOL_AUTHORIZATION.refund_rsvp_contribution.requiredRole, "finance_manager");
});

Deno.test("#1977 Ari creates, updates, and publishes through one canonical graph", async () => {
  const { client, rpcCalls } = clientHarness();
  await tool("create_rsvp").executor({
    brand_id: BRAND_ID,
    title: "Jollof Night",
    timezone: "Africa/Lagos",
    format: "in_person",
    capacity: 80,
  }, client as never, "user");
  await tool("update_rsvp").executor({
    event_id: EVENT_ID,
    title: "Jollof and Jazz Night",
  }, client as never, "user");
  await tool("publish_rsvp").executor({ event_id: EVENT_ID }, client as never, "user");
  assertEquals(rpcCalls.map(([name]) => name), [
    "business_create_rsvp_draft_graph",
    "business_update_rsvp_graph",
    "business_publish_rsvp_graph",
  ]);
  assertEquals(rpcCalls[0][1].p_client_request_id, null);
  assertEquals(rpcCalls[1][1].p_client_request_id, null);
  assertEquals(rpcCalls[2][1].p_client_request_id, null);
});

Deno.test("#1977 selected and all-pending guest decisions stay explicit", async () => {
  const { client, rpcCalls } = clientHarness();
  await tool("set_rsvp_guest_status").executor({
    event_id: EVENT_ID,
    decision: "approve",
    scope: "selected",
    roster_keys: [`rsvp:${RSVP_ID}`],
    roster_watermark: 42,
  }, client as never, "user");
  assertEquals(rpcCalls[0], ["business_set_rsvp_guest_status", {
    p_event_id: EVENT_ID,
    p_decision: "approve",
    p_scope: "selected",
    p_roster_keys: [`rsvp:${RSVP_ID}`],
    p_expected_watermark: 42,
    p_client_request_id: null,
  }]);
  await assertRejects(
    () => tool("set_rsvp_guest_status").executor({
      event_id: EVENT_ID,
      decision: "deny",
      scope: "selected",
    }, client as never, "user"),
    ToolError,
    "roster_keys are required",
  );
  await assertRejects(
    () => tool("set_rsvp_guest_status").executor({
      event_id: EVENT_ID,
      decision: "approve",
      scope: "all_pending",
      roster_keys: [`rsvp:${RSVP_ID}`],
    }, client as never, "user"),
    ToolError,
    "must be omitted",
  );
});

Deno.test("#1977 refund binds event and contribution without order or caller amount", async () => {
  const { client, invokeCalls } = clientHarness();
  await tool("refund_rsvp_contribution").executor({
    event_id: EVENT_ID,
    contribution_id: CONTRIBUTION_ID,
    mode: "discretionary",
    reason: "Guest requested the contribution refund",
    confirm_phrase: "REFUND",
  }, client as never, "user");
  assertEquals(invokeCalls[0], ["rsvp-contribution-refund", {
    eventId: EVENT_ID,
    contributionId: CONTRIBUTION_ID,
    mode: "discretionary",
    reason: "Guest requested the contribution refund",
  }, { "Idempotency-Key": `${EVENT_ID}:${CONTRIBUTION_ID}:discretionary` }]);
});
