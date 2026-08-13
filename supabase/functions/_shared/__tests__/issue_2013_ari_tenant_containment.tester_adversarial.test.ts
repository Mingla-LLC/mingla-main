// #2013 — independent adversarial tenant-containment regression.
// This deliberately exercises runtime query sequencing and the persisted
// context passed to Gemini; public RLS visibility must never become Ari scope.
// deno-lint-ignore-file no-explicit-any
import {
  assertEquals,
  assertFalse,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildSystemPrompt, type BrandSummary } from "../agentSystemPrompt.ts";
import { findTool, ToolError } from "../agentTools.ts";
import { resolveAccessibleAgentBrands } from "../agentTenantScope.ts";

const USER_A = "00000000-0000-4000-8000-00000000000a";
const OWN_A = "10000000-0000-4000-8000-00000000000a";
const DELEGATED_A = "10000000-0000-4000-8000-00000000000b";
const FOREIGN_B = "10000000-0000-4000-8000-00000000000c";
const FOREIGN_MARKER = "FOREIGN_B_SECRET_BRAND";

type Filter = { kind: "eq" | "is" | "not" | "in"; column: string; value: unknown };
type Call = { table: string; operation: string; column?: string; value?: unknown };

class FakeQuery implements PromiseLike<{ data: any; error: any }> {
  private filters: Filter[] = [];
  private maxRows: number | null = null;
  private single = false;

  constructor(
    private table: string,
    private rows: Record<string, any>[],
    private calls: Call[],
    private failure: Error | null,
  ) {}

  select(_columns: string) { this.calls.push({ table: this.table, operation: "select" }); return this; }
  eq(column: string, value: unknown) { this.filters.push({ kind: "eq", column, value }); this.calls.push({ table: this.table, operation: "eq", column, value }); return this; }
  is(column: string, value: unknown) { this.filters.push({ kind: "is", column, value }); this.calls.push({ table: this.table, operation: "is", column, value }); return this; }
  not(column: string, _operator: string, value: unknown) { this.filters.push({ kind: "not", column, value }); this.calls.push({ table: this.table, operation: "not", column, value }); return this; }
  in(column: string, value: unknown[]) { this.filters.push({ kind: "in", column, value }); this.calls.push({ table: this.table, operation: "in", column, value }); return this; }
  order(_column: string, _options: unknown) { return this; }
  limit(value: number) { this.maxRows = value; return this; }
  maybeSingle() { this.single = true; return this; }

  then<TResult1 = { data: any; error: any }, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result()).then(onfulfilled, onrejected);
  }

  private nested(row: Record<string, any>, column: string): unknown {
    return column.split(".").reduce((value: any, key) => value?.[key], row);
  }

  private result(): { data: any; error: any } {
    if (this.failure) return { data: null, error: { message: this.failure.message } };
    let data = this.rows.filter((row) => this.filters.every((filter) => {
      const actual = this.nested(row, filter.column);
      if (filter.kind === "eq" || filter.kind === "is") return actual === filter.value;
      if (filter.kind === "not") return actual !== filter.value;
      return (filter.value as unknown[]).includes(actual);
    }));
    if (this.maxRows !== null) data = data.slice(0, this.maxRows);
    return { data: this.single ? data[0] ?? null : data, error: null };
  }
}

class FakeClient {
  readonly calls: Call[] = [];
  constructor(
    private tables: Record<string, Record<string, any>[]>,
    private failedTable: string | null = null,
  ) {}
  from(table: string) {
    return new FakeQuery(
      table,
      this.tables[table] ?? [],
      this.calls,
      table === this.failedTable ? new Error("forced scope failure") : null,
    );
  }
}

function fixtureClient(failedTable: string | null = null): FakeClient {
  return new FakeClient({
    brands: [
      { id: OWN_A, name: "Account A", slug: "account-a", account_id: USER_A, deleted_at: null },
      { id: FOREIGN_B, name: FOREIGN_MARKER, slug: "foreign-b", account_id: "user-b", deleted_at: null },
    ],
    brand_team_members: [
      { brand_id: DELEGATED_A, user_id: USER_A, role: "event_manager", accepted_at: "2026-01-01", removed_at: null,
        brand: { id: DELEGATED_A, name: "Delegated A", slug: "delegated-a", deleted_at: null } },
      { brand_id: FOREIGN_B, user_id: USER_A, role: "admin", accepted_at: "2026-01-01", removed_at: "2026-08-01",
        brand: { id: FOREIGN_B, name: FOREIGN_MARKER, slug: "foreign-b", deleted_at: null } },
    ],
    events: [
      { id: "20000000-0000-4000-8000-00000000000a", brand_id: OWN_A, title: "Allowed A", deleted_at: null },
      { id: "20000000-0000-4000-8000-00000000000b", brand_id: FOREIGN_B, title: "Foreign B Event", deleted_at: null },
    ],
  }, failedTable);
}

Deno.test("#2013 tester: real owner/member queries exclude public foreign and revoked brands", async () => {
  const client = fixtureClient();
  const scope = await resolveAccessibleAgentBrands(client as any, USER_A);
  assertEquals(scope.map((brand) => brand.id).sort(), [DELEGATED_A, OWN_A].sort());
  assertEquals(client.calls.some((call) => call.table === "brands" && call.operation === "eq" && call.column === "account_id" && call.value === USER_A), true);
  assertEquals(client.calls.some((call) => call.table === "brand_team_members" && call.operation === "not" && call.column === "accepted_at"), true);
  assertEquals(client.calls.some((call) => call.table === "brand_team_members" && call.operation === "is" && call.column === "removed_at"), true);
});

Deno.test("#2013 tester: forged public brand is denied before event read or result persistence", async () => {
  const client = fixtureClient();
  const persisted: unknown[] = [];
  const tool = findTool("list_events");
  if (!tool) throw new Error("list_events missing");
  const error = await assertRejects(
    () => tool.executor({ brand_id: FOREIGN_B }, client as any, USER_A).then((result) => persisted.push(result)),
    ToolError,
  );
  assertEquals(error.code, "BRAND_ACCESS_DENIED");
  assertEquals(client.calls.some((call) => call.table === "events"), false);
  assertEquals(persisted, []);
});

Deno.test("#2013 tester: a scope lookup failure cannot fall through to public rows", async () => {
  const client = fixtureClient("brand_team_members");
  const tool = findTool("list_events");
  if (!tool) throw new Error("list_events missing");
  const error = await assertRejects(() => tool.executor({}, client as any, USER_A), ToolError);
  assertEquals(error.code, "TENANT_SCOPE_UNAVAILABLE");
  assertEquals(client.calls.some((call) => call.table === "events"), false);
});

const activeBrand: BrandSummary = {
  id: OWN_A,
  name: "Account A",
  slug: "account-a",
  defaultCurrency: "NGN",
  hasCover: false,
  hasBlockingEvents: false,
  role: "owner",
  effectiveRank: 60,
};

Deno.test("#2013 tester: pre-containment summary cannot re-enter a scoped model prompt", () => {
  const prompt = buildSystemPrompt(null, [activeBrand], {
    injectStrictReminder: false,
    business: {
      brands: [activeBrand],
      activeBrand,
      offerings: [],
      payoutReady: null,
      roleHint: "owner",
      conversationSummary: `Old answer exposed ${FOREIGN_MARKER}`,
    },
  });
  assertFalse(
    prompt.includes(FOREIGN_MARKER),
    "an untrusted pre-containment summary crossed the scoped Gemini boundary",
  );
});

Deno.test("#2013 tester: pre-containment tool results cannot re-enter scoped Gemini contents", async () => {
  const source = await Deno.readTextFile(new URL("../../agent-chat/index.ts", import.meta.url));
  const start = source.indexOf("const contents: GeminiContentMessage[] = [];");
  const end = source.indexOf("// Append the new user message", start);
  if (start < 0 || end <= start) throw new Error("agent-chat history serializer boundary changed");
  const executable = source.slice(start, end)
    .replace("const contents: GeminiContentMessage[] = [];", "const contents = [];")
    .replaceAll(" as any", "") + "\nreturn contents;";
  const serialize = new Function("history", executable) as (history: unknown[]) => unknown[];
  const contents = serialize([{
    role: "tool",
    tool_results: {
      tool_name: "list_brands",
      result: { brands: [{ id: FOREIGN_B, name: FOREIGN_MARKER }] },
    },
  }]);
  assertFalse(
    JSON.stringify(contents).includes(FOREIGN_MARKER),
    "an untrusted pre-containment tool result crossed the scoped Gemini boundary",
  );
});
