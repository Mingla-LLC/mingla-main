// Issue #1971 — Ari trip contract, implementor happy path.
//
// These assertions are made against the REAL exported registry, not a fixture:
// the point is that the nine trip capabilities are actually registered,
// authorized, receipt-backed and routed through the one canonical command. A
// test that exercised a private helper would stay green if a call site were
// deleted, which is exactly the failure this file exists to catch.
// deno-lint-ignore-file no-explicit-any require-await
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AGENT_TOOLS } from "../agentTools.ts";
import { DOMAIN_READ_ONLY, MONEY_CONFIRM_TOOLS } from "../agentDomainTools.ts";
import { AGENT_TOOL_AUTHORIZATION } from "../agentToolAuthorization.ts";
import { TENANT_SCOPED_READ_TOOL_NAMES } from "../agentTenantScope.ts";
import { buildSystemPrompt, PROMPT_VERSION } from "../agentSystemPrompt.ts";
import { ToolError } from "../agentToolHelpers.ts";

const TRIP_WRITE_TOOLS = [
  "create_trip",
  "update_trip",
  "manage_trip_days",
  "manage_trip_inclusions",
  "manage_trip_tiers",
  "manage_trip_traveler_intake",
  "publish_trip",
  "delete_trip",
];
const ALL_TRIP_TOOLS = [...TRIP_WRITE_TOOLS, "get_trip_order_money"];

const OPERATION_ID = "19710000-0000-4000-8000-0000000000a1";
const EVENT_ID = "19710000-0000-4000-8000-000000000020";
const BRAND_ID = "19710000-0000-4000-8000-000000000010";
const USER_ID = "19710000-0000-4000-8000-000000000001";

const find = (name: string) => {
  const tool = AGENT_TOOLS.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`missing tool: ${name}`);
  return tool;
};

/**
 * A client that records every RPC and rejects every table mutation. Any
 * executor that reached `.from(...).insert/update/delete` would throw here
 * instead of quietly writing.
 */
function recordingClient() {
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const client: any = {
    rpcCalls,
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      // #2019's delegated adapter resolves the caller's rank through these two
      // RPCs before any executor body runs. A brand owner clears every floor,
      // so the assertions below measure the trip contract and not the shared
      // authorization seam (which #2019's own suite owns).
      if (fn === "biz_role_rank") {
        const rank: Record<string, number> = {
          scanner: 10,
          marketing_manager: 20,
          finance_manager: 30,
          event_manager: 40,
          brand_admin: 50,
          brand_owner: 60,
        };
        return Promise.resolve({
          data: rank[String((args as any).p_role ?? "")] ?? 0,
          error: null,
        });
      }
      if (fn === "biz_brand_effective_rank_for_caller") {
        return Promise.resolve({ data: 60, error: null });
      }
      return Promise.resolve({ data: { ok: true, fn }, error: null });
    },
    from(table: string) {
      const forbidden = () => {
        throw new Error(`direct table mutation attempted on ${table}`);
      };
      const query: any = {
        select: () => query,
        eq: () => query,
        gt: () => query,
        is: () => query,
        limit: () => Promise.resolve({ data: [], error: null }),
        order: () => query,
        maybeSingle: () =>
          Promise.resolve({
            data: { id: EVENT_ID, brand_id: BRAND_ID, event_type: "trip" },
            error: null,
          }),
        single: () =>
          Promise.resolve({
            data: { id: EVENT_ID, brand_id: BRAND_ID, event_type: "trip" },
            error: null,
          }),
        insert: forbidden,
        update: forbidden,
        upsert: forbidden,
        delete: forbidden,
      };
      return query;
    },
  };
  return client;
}

Deno.test("#1971 happy: all nine trip capabilities are registered exactly once", () => {
  for (const name of ALL_TRIP_TOOLS) {
    const matches = AGENT_TOOLS.filter((tool) => tool.name === name);
    assertEquals(matches.length, 1, `${name} must be registered exactly once`);
  }
});

Deno.test("#1971 happy: every trip tool carries a declared role and resource binding", () => {
  const expected: Record<string, { requiredRole: string; resource: string }> = {
    create_trip: { requiredRole: "event_manager", resource: "brand" },
    update_trip: { requiredRole: "event_manager", resource: "event" },
    manage_trip_days: { requiredRole: "event_manager", resource: "event" },
    manage_trip_inclusions: {
      requiredRole: "event_manager",
      resource: "event",
    },
    manage_trip_tiers: { requiredRole: "event_manager", resource: "event" },
    manage_trip_traveler_intake: {
      requiredRole: "event_manager",
      resource: "event",
    },
    publish_trip: { requiredRole: "event_manager", resource: "event" },
    delete_trip: { requiredRole: "event_manager", resource: "event" },
    // The aggregate money read is finance-gated, matching
    // biz_trip_require_finance in the migration.
    get_trip_order_money: {
      requiredRole: "finance_manager",
      resource: "event",
    },
  };
  for (const [name, declaration] of Object.entries(expected)) {
    const registered = AGENT_TOOL_AUTHORIZATION[name];
    assert(registered, `${name} has no authorization declaration`);
    assertEquals(registered.requiredRole, declaration.requiredRole, name);
    assertEquals(registered.resource, declaration.resource, name);
    const tool = find(name);
    assertEquals(tool.requiredRole, declaration.requiredRole, `${name} tool`);
    assertEquals(tool.resource, declaration.resource, `${name} tool`);
  }
});

Deno.test("#1971 happy: every trip mutation requires an explicit expected revision", () => {
  for (const name of TRIP_WRITE_TOOLS) {
    if (name === "create_trip") continue; // nothing exists to compare against yet
    const tool = find(name);
    const required = (tool.parameters as any).required as string[];
    assert(
      required.includes("expected_updated_at"),
      `${name} must require expected_updated_at`,
    );
    assert(
      required.includes("event_id"),
      `${name} must require the trip it acts on`,
    );
  }
});

Deno.test("#1971 happy: no trip tool exposes an operation id to the model", () => {
  for (const name of ALL_TRIP_TOOLS) {
    const properties = Object.keys(
      ((find(name).parameters as any).properties ?? {}) as Record<
        string,
        unknown
      >,
    );
    for (const property of properties) {
      assert(
        !/operation_id|operationId/i.test(property),
        `${name} exposes ${property} to the model`,
      );
    }
  }
});

/**
 * One schema-valid argument set per write tool, shared by the routing proof and
 * the operation-id proof below. Sharing them matters: if a tool's schema
 * tightens, BOTH tests move together instead of one silently starting to fail
 * for a schema reason and masking what it was written to measure.
 */
const VALID_WRITE_ARGS: [string, Record<string, unknown>][] = [
  ["create_trip", { brand_id: BRAND_ID, title: "Trip" }],
  ["update_trip", {
    event_id: EVENT_ID,
    expected_updated_at: "2027-01-01T00:00:00Z",
    title: "New",
  }],
  ["manage_trip_days", {
    event_id: EVENT_ID,
    expected_updated_at: "2027-01-01T00:00:00Z",
    items: [{ ordinal: 1, title: "Day one" }],
  }],
  ["manage_trip_inclusions", {
    event_id: EVENT_ID,
    expected_updated_at: "2027-01-01T00:00:00Z",
    items: [{ kind: "included", item: "Transfer", ordinal: 0 }],
  }],
  ["manage_trip_tiers", {
    event_id: EVENT_ID,
    expected_updated_at: "2027-01-01T00:00:00Z",
    items: [],
  }],
  ["manage_trip_traveler_intake", {
    event_id: EVENT_ID,
    expected_updated_at: "2027-01-01T00:00:00Z",
    items: [],
  }],
  ["publish_trip", {
    event_id: EVENT_ID,
    expected_updated_at: "2027-01-01T00:00:00Z",
  }],
  ["delete_trip", {
    event_id: EVENT_ID,
    expected_updated_at: "2027-01-01T00:00:00Z",
  }],
];

Deno.test("#1971 happy: trip writes route through ari_execute_trip_operation and touch no table", async () => {
  assertEquals(
    VALID_WRITE_ARGS.map(([name]) => name).sort(),
    [...TRIP_WRITE_TOOLS].sort(),
    "every trip write tool must be exercised here",
  );
  for (const [name, args] of VALID_WRITE_ARGS) {
    const client = recordingClient();
    await find(name).executor(args, client, USER_ID, {
      operationId: OPERATION_ID,
    });
    const command = client.rpcCalls.find(
      (call: any) => call.fn === "ari_execute_trip_operation",
    );
    assert(command, `${name} did not reach ari_execute_trip_operation`);
    assertEquals(command.args.p_tool_name, name);
    // The operation id comes from the confirmed pending action, never the model.
    assertEquals(command.args.p_operation_id, OPERATION_ID);
  }
});

Deno.test("#1971 happy: the aggregate money read calls the fail-closed snapshot RPC", async () => {
  const client = recordingClient();
  await find("get_trip_order_money").executor(
    { event_id: EVENT_ID },
    client,
    USER_ID,
    undefined,
  );
  const call = client.rpcCalls.find(
    (entry: any) => entry.fn === "biz_get_trip_order_money_snapshot",
  );
  assert(call, "get_trip_order_money did not reach the snapshot RPC");
  assertEquals(call.args.p_event_id, EVENT_ID);
  // It is an inline read, so it must NOT be routed through a write command.
  assert(
    !client.rpcCalls.some((entry: any) =>
      entry.fn === "ari_execute_trip_operation"
    ),
    "the aggregate read went through the write command",
  );
});

Deno.test("#1971 happy: a trip write without a confirmed operation id fails closed", async () => {
  for (const [name, args] of VALID_WRITE_ARGS) {
    const error = await assertRejects(
      () => find(name).executor(args, recordingClient(), USER_ID, undefined),
      ToolError,
    );
    assertEquals(
      (error as ToolError).code,
      "OPERATION_ID_REQUIRED",
      `${name} executed without a confirmed proposal`,
    );
  }
});

Deno.test("#1971 happy: trip capability routing is classified correctly", () => {
  // The aggregate read runs inline and is tenant-scoped.
  assert(DOMAIN_READ_ONLY.has("get_trip_order_money"));
  assert(TENANT_SCOPED_READ_TOOL_NAMES.has("get_trip_order_money"));
  // Deposit/instalment metadata changes what a traveller is charged, so it is
  // always confirmed, never inline.
  assert(MONEY_CONFIRM_TOOLS.has("manage_trip_tiers"));
  for (const name of TRIP_WRITE_TOOLS) {
    assert(!DOMAIN_READ_ONLY.has(name), `${name} must not run inline`);
  }
});

Deno.test("#1971 happy: the prompt advertises the trip graph and its revision rule", () => {
  assertEquals(PROMPT_VERSION, "v15");
  const prompt = buildSystemPrompt(null, []);
  for (const name of ALL_TRIP_TOOLS) {
    assertStringIncludes(prompt, `- ${name} —`);
  }
  assertStringIncludes(prompt, "expected_updated_at");
  assertStringIncludes(prompt, "trip_revision_conflict");
  assertStringIncludes(prompt, "FULL REPLACEMENTS");
});
