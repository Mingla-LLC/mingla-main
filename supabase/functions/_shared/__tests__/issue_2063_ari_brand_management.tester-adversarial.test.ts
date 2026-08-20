import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { findTool, ToolError } from "../agentTools.ts";

const USER_ID = "2063ffff-0000-4000-8000-000000000001";
const BRAND_ID = "2063ffff-0000-4000-8000-000000000002";
const VENUE_ID = "2063ffff-0000-4000-8000-000000000003";
const OPERATION_ID = "2063ffff-0000-4000-8000-000000000004";

function rpcClient() {
  const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const thenableQuery = (data: unknown) => {
    const query: Record<string, unknown> = {};
    for (
      const method of ["select", "eq", "is", "not", "order", "limit", "lt"]
    ) {
      query[method] = () => query;
    }
    query.maybeSingle = () => Promise.resolve({ data, error: null });
    query.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data, error: null }).then(resolve);
    return query;
  };
  return {
    calls,
    client: {
      rpc: async (name: string, params: Record<string, unknown>) => {
        calls.push({ name, params });
        if (name === "biz_brand_effective_rank_for_caller") {
          return { data: 60, error: null };
        }
        if (name === "biz_role_rank") return { data: 50, error: null };
        return { data: { ok: true }, error: null };
      },
      from: (table: string) => {
        if (table === "brands") {
          return thenableQuery({
            id: BRAND_ID,
            account_id: USER_ID,
            deleted_at: null,
          });
        }
        if (table === "venue_listings") {
          return thenableQuery({ id: VENUE_ID, brand_id: BRAND_ID });
        }
        if (table === "brand_team_members") return thenableQuery([]);
        throw new Error(`unexpected table ${table}`);
      },
    },
  };
}

function overnightWeek(): Array<Record<string, unknown>> {
  return Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    open_time: weekday === 5 ? "22:00" : "09:00",
    close_time: weekday === 5 ? "02:00" : "17:00",
    is_closed: false,
  }));
}

Deno.test("#2063 tester: Ari preserves the canonical Business overnight-hours contract", async () => {
  const tool = findTool("manage_brand_hours");
  assert(tool);
  const fixture = rpcClient();
  const args = {
    brand_id: BRAND_ID,
    venue_id: VENUE_ID,
    hours: overnightWeek(),
  };

  await tool.executor(
    args,
    fixture.client as never,
    USER_ID,
    { operationId: OPERATION_ID },
  );

  const operationCalls = fixture.calls.filter((call) =>
    call.name === "ari_execute_brand_operation"
  );
  assertEquals(operationCalls.length, 1);
  assertEquals(operationCalls[0]?.params.p_args, args);
  assertEquals(
    fixture.calls.filter((call) =>
      call.name === "biz_brand_effective_rank_for_caller" ||
      call.name === "biz_role_rank"
    ).length,
    2,
    "the tester fixture must retain the #2019 execution-time authorization guard",
  );

  const migration = await Deno.readTextFile(
    new URL(
      "../../../migrations/20270501002063_issue_2063_ari_brand_management.sql",
      import.meta.url,
    ),
  );
  assert(
    !migration.includes(
      "(item ->> 'open_time')::time >= (item ->> 'close_time')::time",
    ),
    "the SQL wrapper rejects the overnight span accepted by biz_upsert_brand_hours",
  );
});

Deno.test("#2063 tester: a currency proposal without the read version fails before mutation", async () => {
  const tool = findTool("manage_brand_discovery_currency");
  assert(tool);
  const fixture = rpcClient();

  const error = await assertRejects(
    () =>
      tool.executor(
        {
          brand_id: BRAND_ID,
          action: "set_provisional_currency",
          currency_code: "USD",
        },
        fixture.client as never,
        USER_ID,
        { operationId: OPERATION_ID },
      ),
    ToolError,
  );

  assertEquals(error.code, "INVALID_ARGS");
  assertEquals(fixture.calls.length, 0);
});

Deno.test("#2063 tester: destructive week replacement is visibly reviewable and editable", async () => {
  const cardUrl = new URL(
    "../../../../mingla-business/src/components/ari/ToolProposalCard.tsx",
    import.meta.url,
  );
  const editUrl = new URL(
    "../../../../mingla-business/src/components/ari/ToolEditForm.tsx",
    import.meta.url,
  );
  const card = await Deno.readTextFile(cardUrl);
  const edit = await Deno.readTextFile(editUrl);
  const fieldsStart = card.indexOf("function fieldsFor(");
  const fieldsEnd = card.indexOf(
    "// ----------------------------------------------------------------------------",
    fieldsStart,
  );
  const fields = card.slice(fieldsStart, fieldsEnd);

  assert(
    fields.includes('toolName === "manage_brand_hours"') &&
      fields.includes("args.hours"),
    "the confirmation card hides the seven-day replacement payload",
  );
  assert(
    edit.includes('toolName === "manage_brand_hours"'),
    "Edit opens a dead-end instead of allowing the proposed week to be corrected",
  );
});

Deno.test("#2063 tester: audit pagination cannot skip rows tied on created_at", async () => {
  const source = await Deno.readTextFile(
    new URL("../agentTools.ts", import.meta.url),
  );
  const start = source.indexOf("const listBrandAuditLog");
  const end = source.indexOf("const manageBrandDiscoveryCurrency", start);
  const auditTool = source.slice(start, end);

  assert(
    auditTool.includes("before_id"),
    "a timestamp-only cursor cannot identify a stable page boundary when audit rows tie",
  );
  assert(
    /\.order\("created_at",[^)]*\)\s*\.order\("id",/.test(auditTool),
    "audit rows need a deterministic created_at + id order",
  );
  assert(
    auditTool.includes("created_at.eq") && auditTool.includes("id.lt"),
    "the next-page predicate must retain tied created_at rows below the cursor id",
  );
});

Deno.test("#2063 tester: Ari invalidates brand-management caches through their factories", async () => {
  const source = await Deno.readTextFile(
    new URL(
      "../../../../mingla-business/src/hooks/useConfirmPendingAction.ts",
      import.meta.url,
    ),
  );

  for (
    const factory of [
      "brandKeys",
      "brandHoursKeys",
      "venueAvailabilityKeys",
      "brandDiscoveryCurrencyKeys",
    ]
  ) {
    assert(source.includes(factory), `missing canonical ${factory} import/use`);
  }
  for (
    const literal of [
      '["brandHours", brandId]',
      '["venueAvailabilityConfig", brandId]',
      '["brand-discovery-currency"]',
      '["brands", "detail", brandId]',
    ]
  ) {
    assert(
      !source.includes(literal),
      `hardcoded query key ${literal} bypasses its canonical factory`,
    );
  }
});

Deno.test("#2063 tester: every receipt-backed brand write can recover an executing confirmation", async () => {
  const source = await Deno.readTextFile(
    new URL("../../agent-confirm-action/index.ts", import.meta.url),
  );
  const setStart = source.indexOf("const RECEIPT_BACKED_EVENT_TOOL_NAMES");
  const receiptBackedSet = source.slice(setStart, source.indexOf("]);", setStart));
  for (const toolName of [
    "create_brand",
    "update_brand",
    "delete_brand",
    "manage_brand_hours",
    "manage_brand_discovery_currency",
  ]) {
    assert(
      receiptBackedSet.includes(`"${toolName}"`),
      `${toolName} would reject an ambiguous executing retry before receipt replay`,
    );
  }
  assert(
    !receiptBackedSet.includes('"list_brand_audit_log"'),
    "non-receipt-backed brand reads must not acquire executing-write recovery",
  );
  for (const eventTool of ["create_event", "update_event", "publish_event"]) {
    assert(receiptBackedSet.includes(`"${eventTool}"`), `lost #1972 ${eventTool} recovery`);
  }
});
