import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  bindAgentProposalState,
  findTool,
  ToolError,
} from "../agentTools.ts";

const USER_ID = "20630000-0000-4000-8000-000000000001";
const BRAND_ID = "20630000-0000-4000-8000-000000000002";
const VENUE_ID = "20630000-0000-4000-8000-000000000003";
const OPERATION_ID = "20630000-0000-4000-8000-000000000004";

type RpcCall = { name: string; params: Record<string, unknown> };

function thenableQuery(result: { data: unknown; error: unknown }) {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "not", "order", "limit", "lt", "or"]) {
    query[method] = () => query;
  }
  query.maybeSingle = () => Promise.resolve(result);
  query.then = (
    resolve: (value: { data: unknown; error: unknown }) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return query;
}

function clientFixture(options: { auditRows?: unknown[]; withScope?: boolean } = {}) {
  const rpcCalls: RpcCall[] = [];
  const fromCalls: string[] = [];
  const client = {
    rpc: async (name: string, params: Record<string, unknown>) => {
      rpcCalls.push({ name, params });
      if (name === "biz_brand_effective_rank_for_caller") {
        return { data: 60, error: null };
      }
      if (name === "biz_role_rank") return { data: 50, error: null };
      if (name === "ari_execute_brand_operation") {
        return {
          data: {
            brand: { id: BRAND_ID, name: "North Star" },
            operation_id: params.p_operation_id,
          },
          error: null,
        };
      }
      if (name === "issue_1384_brand_currency_state") {
        return {
          data: { brandId: BRAND_ID, stateVersion: 7, currencyCode: "USD" },
          error: null,
        };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    from: (table: string) => {
      fromCalls.push(table);
      if (table === "agent_user_profile") {
        return thenableQuery({ data: null, error: null });
      }
      if (table === "brands") {
        return thenableQuery({
          data: options.withScope
            ? [{
              id: BRAND_ID,
              name: "North Star",
              slug: "north-star",
              default_currency: "USD",
              cover_media_url: null,
            }]
            : { id: BRAND_ID },
          error: null,
        });
      }
      if (table === "brand_team_members") {
        return thenableQuery({ data: [], error: null });
      }
      if (table === "venue_listings") {
        return thenableQuery({
          data: { id: VENUE_ID, brand_id: BRAND_ID },
          error: null,
        });
      }
      if (table === "audit_log") {
        return thenableQuery({ data: options.auditRows ?? [], error: null });
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { client, rpcCalls, fromCalls };
}

function sevenDayHours() {
  return Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    open_time: weekday === 6 ? null : "09:00",
    close_time: weekday === 6 ? null : "17:00",
    is_closed: weekday === 6,
  }));
}

Deno.test("#2063 every brand write forwards the immutable pending-action operation id", async () => {
  const cases = [
    {
      tool: "create_brand",
      args: { name: "North Star", slug: "north-star" },
    },
    {
      tool: "update_brand",
      args: { brand_id: BRAND_ID, description: "Fresh description" },
    },
    {
      tool: "delete_brand",
      args: { brand_id: BRAND_ID, confirm_phrase: "North Star" },
    },
    {
      tool: "manage_brand_hours",
      args: { brand_id: BRAND_ID, venue_id: VENUE_ID, hours: sevenDayHours() },
    },
    {
      tool: "manage_brand_discovery_currency",
      args: {
        brand_id: BRAND_ID,
        action: "set_provisional_currency",
        currency_code: "USD",
        expected_state_version: 1,
      },
    },
  ];
  for (const sample of cases) {
    const tool = findTool(sample.tool);
    assert(tool, `missing ${sample.tool}`);
    const fixture = clientFixture();
    await tool.executor(
      sample.args,
      fixture.client as never,
      USER_ID,
      { operationId: OPERATION_ID },
    );
    const call = fixture.rpcCalls.find((candidate) =>
      candidate.name === "ari_execute_brand_operation"
    );
    assert(call, `${sample.tool} bypassed the atomic wrapper`);
    assertEquals(call.params.p_operation_id, OPERATION_ID);
    assertEquals(call.params.p_tool_name, sample.tool);
    assertEquals(call.params.p_args, sample.args);
  }
});

Deno.test("#2063 writes fail closed without a confirmation operation id", async () => {
  const tool = findTool("update_brand");
  assert(tool);
  const fixture = clientFixture();
  const error = await assertRejects(
    () =>
      tool.executor(
        { brand_id: BRAND_ID, name: "Changed" },
        fixture.client as never,
        USER_ID,
        { operationId: null },
      ),
    ToolError,
  );
  assertEquals(error.code, "OPERATION_ID_REQUIRED");
  assertEquals(
    fixture.rpcCalls.some((call) =>
      call.name === "ari_execute_brand_operation"
    ),
    false,
  );
});

Deno.test("#2063 hours require one complete, non-duplicated seven-day payload", async () => {
  const tool = findTool("manage_brand_hours");
  assert(tool);
  const fixture = clientFixture();
  const duplicateMonday = sevenDayHours();
  duplicateMonday[6] = { ...duplicateMonday[6], weekday: 0 };
  const error = await assertRejects(
    () =>
      tool.executor(
        { brand_id: BRAND_ID, venue_id: VENUE_ID, hours: duplicateMonday },
        fixture.client as never,
        USER_ID,
        { operationId: OPERATION_ID },
      ),
    ToolError,
  );
  assertEquals(error.code, "INVALID_ARGS");
  assertEquals(
    fixture.rpcCalls.some((call) =>
      call.name === "ari_execute_brand_operation"
    ),
    false,
  );
});

Deno.test("#2063 audit read uses the canonical table and returns no before/after payload", async () => {
  const tool = findTool("list_brand_audit_log");
  assert(tool);
  const row = {
    id: OPERATION_ID,
    user_id: USER_ID,
    action: "brand.updated",
    target_type: "brand",
    target_id: BRAND_ID,
    created_at: "2026-08-14T00:00:00Z",
  };
  const fixture = clientFixture({ auditRows: [row], withScope: true });
  const result = await tool.executor(
    { brand_id: BRAND_ID, limit: 25 },
    fixture.client as never,
    USER_ID,
    { operationId: null },
  ) as { entries: Array<Record<string, unknown>> };
  assert(fixture.fromCalls.includes("audit_log"));
  assertEquals(result.entries, [row]);
  assertEquals("before" in result.entries[0], false);
  assertEquals("after" in result.entries[0], false);
});

Deno.test("#2063 discovery-currency updates preserve the explicit optimistic version", async () => {
  const tool = findTool("manage_brand_discovery_currency");
  assert(tool);
  const fixture = clientFixture();
  await tool.executor(
    {
      brand_id: BRAND_ID,
      action: "set_provisional_currency",
      currency_code: "ngn",
      expected_state_version: 7,
    },
    fixture.client as never,
    USER_ID,
    { operationId: OPERATION_ID },
  );
  const call = fixture.rpcCalls.find((candidate) =>
    candidate.name === "ari_execute_brand_operation"
  );
  assert(call);
  assertEquals(call.params.p_args, {
    brand_id: BRAND_ID,
    action: "set_provisional_currency",
    currency_code: "ngn",
    expected_state_version: 7,
  });
});

Deno.test("#2063 discovery-currency state is a read-only finance-gated action", async () => {
  const tool = findTool("manage_brand_discovery_currency");
  assert(tool);
  const fixture = clientFixture();
  await tool.executor(
    { brand_id: BRAND_ID, action: "get_state" },
    fixture.client as never,
    USER_ID,
    { operationId: null },
  );
  assertEquals(
    fixture.rpcCalls.filter((call) => call.name === "issue_1384_brand_currency_state").length,
    1,
  );
  assertEquals(
    fixture.rpcCalls.some((call) => call.name === "ari_execute_brand_operation"),
    false,
  );
});

Deno.test("#2063 proposal preparation binds canonical currency state instead of model input", async () => {
  const fixture = clientFixture();
  const bound = await bindAgentProposalState(
    "manage_brand_discovery_currency",
    {
      brand_id: BRAND_ID,
      action: "set_provisional_currency",
      currency_code: "USD",
      expected_state_version: 999,
    },
    fixture.client as never,
  );
  assertEquals(bound.expected_state_version, 7);
  assertEquals(
    fixture.rpcCalls.filter((call) => call.name === "issue_1384_brand_currency_state").length,
    1,
  );
  assertEquals(
    fixture.rpcCalls.some((call) => call.name === "ari_execute_brand_operation"),
    false,
  );
});

Deno.test("#2063 audit next cursor carries the stable timestamp and row id", async () => {
  const tool = findTool("list_brand_audit_log");
  assert(tool);
  const tiedAt = "2026-08-14T01:00:00.000Z";
  const rows = [
    { id: "20630000-0000-4000-8000-000000000010", created_at: tiedAt },
    { id: "20630000-0000-4000-8000-000000000009", created_at: tiedAt },
  ];
  const fixture = clientFixture({ auditRows: rows, withScope: true });
  const result = await tool.executor(
    { brand_id: BRAND_ID, limit: 2 },
    fixture.client as never,
    USER_ID,
    { operationId: null },
  ) as { next_cursor: { before_created_at: string; before_id: string } | null };
  assertEquals(result.next_cursor, {
    before_created_at: tiedAt,
    before_id: rows[1].id,
  });
});
