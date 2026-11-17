/**
 * issue #3281 bundle 3 — Ari experience parity.
 *
 * Ari carries what the Host experience wizard sends:
 *   - create_experience stops take start_offset_minutes;
 *   - update_experience price options keep their stored id, and every option
 *     carries its name, price and basis (a partial option would be re-priced
 *     to 0 by the server);
 *   - manage_experience_stops has a typed stop schema; the proposal is
 *     canonicalized (stop_order = position, offset always said) BEFORE the
 *     #1972 receipt binds it, and the executor never rewrites args;
 *   - get_experience reads the editable graph: revision first, verbatim.
 *   - the flow's experience row counts every live ticket option.
 */
import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  AGENT_TOOLS,
  canonicalizeAgentProposalArgs,
  ToolError,
} from "../agentTools.ts";
import { DOMAIN_READ_ONLY, DOMAIN_TOOLS } from "../agentDomainTools.ts";
import { AGENT_TOOL_AUTHORIZATION } from "../agentToolAuthorization.ts";
import { buildFlowProbeDeps } from "../ariFlows/edge.ts";

const BRAND = "11111111-1111-4111-8111-111111111111";
const EVENT = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const OPTION = "44444444-4444-4444-8444-444444444444";
// PostgREST's own timestamptz text, microseconds included.
const REVISION = "2026-11-17T23:07:08.847683+00:00";

// deno-lint-ignore no-explicit-any
type Json = any;

function schemaOf(name: string): Json {
  const tool = AGENT_TOOLS.find((t) => t.name === name);
  assert(tool, `${name} is registered`);
  return tool.parameters;
}

function rawTool(name: string) {
  const tool = DOMAIN_TOOLS.find((t) => t.name === name);
  assert(tool, `${name} is a domain tool`);
  return tool;
}

/** A Supabase client double: chainable filters, rows per table, rpc log. */
function fakeClient(tables: Record<string, Json[]>, rpcResult: Json = {}) {
  const rpcCalls: { fn: string; args: Json }[] = [];
  const reads: string[] = [];
  const client = {
    rpcCalls,
    reads,
    from(table: string) {
      reads.push(table);
      const rows = tables[table] ?? [];
      const result = { data: rows, error: null };
      const builder: Json = {
        select: () => builder,
        eq: () => builder,
        is: () => builder,
        not: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
        then: (resolve: (v: Json) => unknown) => Promise.resolve(result).then(resolve),
      };
      return builder;
    },
    rpc(fn: string, args: Json) {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ data: rpcResult, error: null });
    },
  };
  return client;
}

const accessTables = (event: Json) => ({
  brands: [{ id: BRAND, name: "Coastline", slug: "coastline", default_currency: "NGN" }],
  brand_team_members: [],
  events: [event],
});

// ── Schemas ────────────────────────────────────────────────────────────────

Deno.test("create_experience stops take start_offset_minutes (0..32767, an integer)", () => {
  const offset = schemaOf("create_experience").properties.stops.items.properties
    .start_offset_minutes;
  assertEquals(offset.type, "integer");
  assertEquals(offset.minimum, 0);
  assertEquals(offset.maximum, 32767); // experience_stops.start_offset_minutes is smallint
});

Deno.test("update_experience price options carry their id and every core field", () => {
  const items = schemaOf("update_experience").properties.price_options.items;
  assertEquals(items.properties.id, {
    type: "string",
    format: "uuid",
    description: items.properties.id.description,
  });
  // A partial {id, is_hidden} would let the server reset price to 0 / person.
  assertEquals(items.required, ["name", "price_cents", "price_basis"]);
});

Deno.test("manage_experience_stops types every stop key the wizard sends", () => {
  const items = schemaOf("manage_experience_stops").properties.stops.items;
  assertEquals(items.type, "object");
  assertEquals(Object.keys(items.properties).sort(), [
    "address", "ai_description", "city", "coordinate_precision", "country_code",
    "image_urls", "lat", "lng", "place_id", "place_name", "price_cents",
    "region", "start_offset_minutes", "start_time", "stop_order",
  ]);
  assertEquals(items.properties.start_offset_minutes.nullable, true);
  assertEquals(items.properties.start_offset_minutes.maximum, 32767);
});

// ── Canonicalization before the receipt binds the args ─────────────────────

Deno.test("manage_experience_stops proposals are numbered by position, idempotently", () => {
  const input = {
    event_id: EVENT,
    expected_revision: REVISION,
    experience_intents: ["romantic"],
    // A copied stop (order 1) and a new stop (none): both would claim 1.
    stops: [
      { place_name: "B", stop_order: 1, start_offset_minutes: 45 },
      { place_name: "A", start_offset_minutes: null },
      { place_name: "C", stop_order: 0, start_offset_minutes: 0 },
    ],
  };
  const before = structuredClone(input);
  const once = canonicalizeAgentProposalArgs("manage_experience_stops", input);
  assertEquals(input, before, "the input is not mutated");
  assertEquals((once.stops as Json[]).map((s) => s.stop_order), [0, 1, 2]);
  assertEquals((once.stops as Json[]).map((s) => s.start_offset_minutes), [45, null, 0]);
  assertEquals(canonicalizeAgentProposalArgs("manage_experience_stops", once), once);
  // Other tools are untouched.
  const other = { event_id: EVENT, title: "T" };
  assert(canonicalizeAgentProposalArgs("update_experience", other) === other);
});

Deno.test("a stop that does not say its offset is refused before it can lose it", () => {
  const err = assertThrows(
    () =>
      canonicalizeAgentProposalArgs("manage_experience_stops", {
        event_id: EVENT,
        stops: [{ place_name: "A", start_offset_minutes: 30 }, { place_name: "B" }],
      }),
    ToolError,
  );
  assertEquals(err.code, "INVALID_ARGS");
  assert(err.message.includes("stops[1].start_offset_minutes"));
  assert(err.message.includes("get_experience"));
});

Deno.test("the manage_experience_stops executor sends the bound args unchanged", async () => {
  const args = canonicalizeAgentProposalArgs("manage_experience_stops", {
    event_id: EVENT,
    expected_revision: REVISION,
    experience_intents: ["romantic"],
    stops: [{ place_name: "A", start_offset_minutes: 15 }],
  });
  const bound = structuredClone(args);
  const client = fakeClient({ events: [{ id: EVENT, brand_id: BRAND }] }, { ok: true });
  await rawTool("manage_experience_stops").executor(args, client as Json, USER, {
    operationId: "55555555-5555-4555-8555-555555555555",
  } as Json);
  assertEquals(client.rpcCalls.length, 1);
  assertEquals(client.rpcCalls[0].fn, "ari_execute_experience_operation");
  // #1972: agent_operation_receipt_begin compares these bytes to the pending row.
  assertEquals(client.rpcCalls[0].args.p_args, bound);
  assertEquals(args, bound);
});

// ── get_experience ─────────────────────────────────────────────────────────

Deno.test("get_experience is a read at event_manager on experiences only", () => {
  assert(DOMAIN_READ_ONLY.has("get_experience"));
  assertEquals(AGENT_TOOL_AUTHORIZATION.get_experience.requiredRole, "event_manager");
  assertEquals(AGENT_TOOL_AUTHORIZATION.get_experience.resource, "event");
  assertEquals(schemaOf("get_experience").required, ["event_id"]);
});

Deno.test("get_experience returns the graph, its verbatim revision and whether a reason is needed", async () => {
  const graph = {
    price_options: [{ id: OPTION, name: "Standard", price_cents: 2_500_000 }],
    stops: [{ stop_order: 0, place_name: "A", start_offset_minutes: 45 }],
  };
  for (const [status, needsReason] of [["draft", false], ["live", true]] as const) {
    const client = fakeClient(
      accessTables({
        id: EVENT,
        brand_id: BRAND,
        status,
        updated_at: REVISION,
        event_type: "experience",
      }),
      graph,
    );
    const out = await rawTool("get_experience").executor(
      { event_id: EVENT },
      client as Json,
      USER,
      {} as Json,
    ) as Json;
    assertEquals(out, {
      event_id: EVENT,
      status,
      expected_revision: REVISION,
      edit_reason_required: needsReason,
      experience: graph,
    });
    assertEquals(client.rpcCalls, [{
      fn: "issue_1973_current_experience_payload",
      args: { p_event_id: EVENT },
    }]);
    // The revision is read before the graph (a race then fails stale).
    assertEquals(client.reads.at(-1), "events");
  }
});

Deno.test("get_experience refuses an event that is not an experience", async () => {
  const client = fakeClient(accessTables({
    id: EVENT,
    brand_id: BRAND,
    status: "draft",
    updated_at: REVISION,
    event_type: "event",
  }));
  const err = await assertRejects(
    () => rawTool("get_experience").executor({ event_id: EVENT }, client as Json, USER, {} as Json),
    ToolError,
  );
  assertEquals(err.code, "BRAND_ACCESS_DENIED");
  assertEquals(client.rpcCalls.length, 0);
});

Deno.test("get_experience refuses an event outside the caller's brands", async () => {
  const client = fakeClient({
    brands: [],
    brand_team_members: [],
    events: [{ id: EVENT, brand_id: BRAND, event_type: "experience" }],
  });
  const err = await assertRejects(
    () => rawTool("get_experience").executor({ event_id: EVENT }, client as Json, USER, {} as Json),
    ToolError,
  );
  assertEquals(err.code, "BRAND_ACCESS_DENIED");
  assertEquals(client.rpcCalls.length, 0);
});

// ── The flow's experience row ──────────────────────────────────────────────

Deno.test("the flow row's ticket price is the highest live option, not the first", async () => {
  const client = fakeClient({
    events: [{
      id: EVENT,
      title: "Walk",
      status: "draft",
      updated_at: REVISION,
      timezone: "Africa/Lagos",
      description: "A long enough description.",
      experience_intents: ["romantic"],
      whole_price_cents: null,
      theme: {},
    }],
    experience_stops: [],
    ticket_types: [
      { is_free: true, price_cents: 0, display_order: 0 },
      { is_free: false, price_cents: 2_500_000, display_order: 1 },
    ],
  });
  const row = await buildFlowProbeDeps(client as Json, BRAND).experienceRow!(EVENT);
  assert(row);
  assertEquals(row.is_free, true);
  assertEquals(row.whole_price_cents, null);
  assertEquals(row.ticket_price_cents, 2_500_000);
});
