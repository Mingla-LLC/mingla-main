/**
 * issue #3281 bundle 3 — Ari experience parity.
 *
 * Ari carries what the Host experience wizard sends:
 *   - create_experience stops take start_offset_minutes;
 *   - update_experience price options keep their stored id, and every option
 *     carries its name, price and basis (a partial option would be re-priced
 *     to 0 by the server);
 *   - manage_experience_stops has a typed stop schema; the proposal is
 *     numbered by position BEFORE the #1972 receipt binds it; a stop that
 *     does not say its offset goes back to the model (agent-chat
 *     validateProposal), and the executor refuses in plain words only when a
 *     saved offset would be lost; it never rewrites args;
 *   - get_experience is offered whenever an experience edit is;
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
import {
  DOMAIN_READ_ONLY,
  DOMAIN_TOOLS,
  EXPERIENCE_PRICE_OPTION_REFUSAL,
  EXPERIENCE_STOP_OFFSET_REFUSAL,
  experiencePriceOptionsIssue,
  experienceStopsOffsetIssue,
} from "../agentDomainTools.ts";
import {
  AGENT_TOOL_AUTHORIZATION,
  authorizeAgentTool,
} from "../agentToolAuthorization.ts";
import { selectAriTools } from "../agentToolsets.ts";
import { DOMAIN_REFUSED_CODE } from "../ariRefusalCopy.ts";
import { ARI_CAPABILITY_INDEX, ARI_TOOL_RULES } from "../agentSystemPrompt.ts";
import { ariToolDeclarations } from "../ariToolDescriptions.ts";
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
      let rows = tables[table] ?? [];
      const builder: Json = {
        select: () => builder,
        eq: () => builder,
        is: () => builder,
        not: () => builder,
        order: () => builder,
        // Honoured, so a query that reads only the first row is caught.
        limit: (n: number) => {
          rows = rows.slice(0, n);
          return builder;
        },
        maybeSingle: () =>
          Promise.resolve({ data: rows[0] ?? null, error: null }),
        then: (resolve: (v: Json) => unknown) =>
          Promise.resolve({ data: rows, error: null }).then(resolve),
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
  brands: [{
    id: BRAND,
    name: "Coastline",
    slug: "coastline",
    default_currency: "NGN",
  }],
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

Deno.test("update_experience price options carry their id; a partial option is caught outside the schema", () => {
  const items = schemaOf("update_experience").properties.price_options.items;
  assertEquals(items.properties.id, {
    type: "string",
    format: "uuid",
    description: items.properties.id.description,
  });
  // Not a schema `required`: an approval bound before this rule must still
  // replay. agent-chat and the executor catch a partial option instead.
  assertEquals(items.required, undefined);
  assertEquals(
    experiencePriceOptionsIssue({
      price_options: [
        { id: OPTION, name: "Standard", price_cents: 0, price_basis: "person" },
        { id: OPTION, is_hidden: true },
      ],
    })?.startsWith(
      "price_options[1] must carry name, price_cents and price_basis",
    ),
    true,
  );
  assertEquals(
    experiencePriceOptionsIssue({
      price_options: [{
        name: "Standard",
        price_cents: 0,
        price_basis: "person",
      }],
    }),
    null,
  );
  assertEquals(experiencePriceOptionsIssue({ title: "T" }), null);
});

Deno.test("manage_experience_stops types every stop key the wizard sends", () => {
  const items = schemaOf("manage_experience_stops").properties.stops.items;
  assertEquals(items.type, "object");
  assertEquals(Object.keys(items.properties).sort(), [
    "address",
    "ai_description",
    "city",
    "coordinate_precision",
    "country_code",
    "image_urls",
    "lat",
    "lng",
    "place_id",
    "place_name",
    "price_cents",
    "region",
    "start_offset_minutes",
    "start_time",
    "stop_order",
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
  assertEquals((once.stops as Json[]).map((s) => s.start_offset_minutes), [
    45,
    null,
    0,
  ]);
  assertEquals(
    canonicalizeAgentProposalArgs("manage_experience_stops", once),
    once,
  );
  // Other tools are untouched.
  const other = { event_id: EVENT, title: "T" };
  assert(canonicalizeAgentProposalArgs("update_experience", other) === other);
});

Deno.test("a stop that does not say its offset goes back to the model, never to the owner", () => {
  // Set-date stops carry a clock start_time and no offset: still not a throw.
  const setDate = {
    event_id: EVENT,
    stops: [{ place_name: "A", start_time: "18:00" }],
  };
  assertEquals(
    canonicalizeAgentProposalArgs("manage_experience_stops", setDate),
    {
      ...setDate,
      stops: [{ place_name: "A", start_time: "18:00", stop_order: 0 }],
    },
  );
  const issue = experienceStopsOffsetIssue({
    stops: [{ place_name: "A", start_offset_minutes: 30 }, { place_name: "B" }],
  });
  assert(issue?.startsWith("stops[1].start_offset_minutes is missing"));
  assert(issue?.includes("get_experience"));
  assertEquals(
    experienceStopsOffsetIssue({
      stops: [
        { place_name: "A", start_offset_minutes: null },
        { place_name: "B", startOffsetMinutes: 30 },
      ],
    }),
    null,
  );
  assertEquals(experienceStopsOffsetIssue({ event_id: EVENT }), null);
});

Deno.test("agent-chat returns the offset issue to the model in validateProposal", async () => {
  const chat = await Deno.readTextFile(
    new URL("../../agent-chat/index.ts", import.meta.url),
  );
  const at = chat.indexOf("validateProposal: (call) => {");
  assert(at > 0);
  const hook = chat.slice(
    at,
    chat.indexOf('if (call.name !== "draft_campaign") return null;', at),
  );
  assert(hook.includes('call.name === "manage_experience_stops"'));
  assert(hook.includes("experienceStopsOffsetIssue(call.args)"));
  assert(hook.includes('code: "EXPERIENCE_STOP_OFFSET_MISSING"'));
  assert(hook.includes('call.name === "update_experience"'));
  assert(hook.includes("experiencePriceOptionsIssue(call.args)"));
  assert(hook.includes('code: "EXPERIENCE_PRICE_OPTION_PARTIAL"'));
});

Deno.test("the executor refuses in plain words only when a saved offset would be lost", async () => {
  const args = canonicalizeAgentProposalArgs("manage_experience_stops", {
    event_id: EVENT,
    expected_revision: REVISION,
    experience_intents: ["romantic"],
    stops: [{ place_name: "A" }],
  });
  const context = {
    operationId: "55555555-5555-4555-8555-555555555555",
  } as Json;
  // A saved offset would be cleared: refused, nothing sent.
  const saved = fakeClient({
    events: [{ id: EVENT, brand_id: BRAND }],
    experience_stops: [{ start_offset_minutes: 45 }],
  });
  const err = await assertRejects(
    () =>
      rawTool("manage_experience_stops").executor(
        args,
        saved as Json,
        USER,
        context,
      ),
    ToolError,
  );
  assertEquals(err.code, DOMAIN_REFUSED_CODE);
  assertEquals(err.message, EXPERIENCE_STOP_OFFSET_REFUSAL);
  assert(!/[a-z]+_[a-z_]+/.test(err.message), "no code words for the owner");
  assertEquals(saved.rpcCalls.length, 0);
  // Nothing saved to lose (set-date, or a proposal from before this change).
  const none = fakeClient({
    events: [{ id: EVENT, brand_id: BRAND }],
    experience_stops: [],
  }, { ok: true });
  await rawTool("manage_experience_stops").executor(
    args,
    none as Json,
    USER,
    context,
  );
  assertEquals(none.rpcCalls.map((c) => c.fn), [
    "ari_execute_experience_operation",
  ]);
});

Deno.test("stops and options read by get_experience validate when sent back", async () => {
  // The read-back shape (issue_1973_current_experience_payload): nulls,
  // stored image URLs, a Postgres time, and every option field.
  const stops = [
    {
      stop_order: 0,
      place_id: null,
      place_name: "A very long stop name ".repeat(8),
      address: null,
      city: null,
      region: null,
      country_code: null,
      lat: null,
      lng: null,
      coordinate_precision: null,
      image_urls: null,
      start_time: "18:00:00",
      start_offset_minutes: null,
      price_cents: 0,
      ai_description: "First room.",
    },
  ];
  const options = [{
    id: OPTION,
    name: "Standard",
    price_cents: 2_500_000,
    price_basis: "person",
    block_minutes: null,
    min_blocks: null,
    max_blocks: null,
    group_max: null,
    capacity: null,
    is_hidden: false,
  }];
  const refusesClient = {
    from() {
      throw new Error("schema passed; role lookup reached");
    },
    rpc() {
      throw new Error("schema passed; role lookup reached");
    },
  };
  for (
    const [name, args] of [
      ["manage_experience_stops", {
        event_id: EVENT,
        expected_revision: REVISION,
        stops,
        experience_intents: ["romantic"],
      }],
      ["update_experience", {
        event_id: EVENT,
        expected_revision: REVISION,
        price_options: options,
      }],
    ] as const
  ) {
    const tool = AGENT_TOOLS.find((t) => t.name === name)!;
    const err = await assertRejects(() =>
      authorizeAgentTool(tool, args as Json, refusesClient as Json, USER)
    );
    assert(
      !(err instanceof ToolError && err.code === "INVALID_ARGS"),
      `${name}: ${String(err)}`,
    );
  }
});

Deno.test("a partial price option is refused on a first attempt and replayed on a retry", async () => {
  const args = {
    event_id: EVENT,
    expected_revision: REVISION,
    price_options: [{ id: OPTION, name: "Standard", price_cents: 0 }],
  };
  const bound = structuredClone(args);
  const first = fakeClient({ events: [{ id: EVENT, brand_id: BRAND }] }, {
    ok: true,
  });
  const err = await assertRejects(
    () =>
      rawTool("update_experience").executor(args, first as Json, USER, {
        operationId: "55555555-5555-4555-8555-555555555555",
      } as Json),
    ToolError,
  );
  assertEquals(err.code, DOMAIN_REFUSED_CODE);
  assertEquals(err.message, EXPERIENCE_PRICE_OPTION_REFUSAL);
  assertEquals(first.rpcCalls.length, 0);
  // Bound before this rule and already executing: the receipt RPC replays it.
  const retry = fakeClient({ events: [{ id: EVENT, brand_id: BRAND }] }, {
    ok: true,
  });
  await rawTool("update_experience").executor(args, retry as Json, USER, {
    operationId: "55555555-5555-4555-8555-555555555555",
    retry: true,
  } as Json);
  assertEquals(retry.rpcCalls.map((c) => c.fn), [
    "ari_execute_experience_operation",
  ]);
  assertEquals(retry.rpcCalls[0].args.p_args, bound);
  // And the legacy shape still passes the schema, so confirm can reach replay.
  const err2 = await assertRejects(() =>
    authorizeAgentTool(
      AGENT_TOOLS.find((t) => t.name === "update_experience")!,
      args as Json,
      {
        from() {
          throw new Error("schema passed");
        },
        rpc() {
          throw new Error("schema passed");
        },
      } as Json,
      USER,
    )
  );
  assert(
    !(err2 instanceof ToolError && err2.code === "INVALID_ARGS"),
    String(err2),
  );
});

Deno.test("get_experience is offered whenever an experience edit is, and not otherwise", () => {
  const names = (keys: string[], query: string) =>
    selectAriTools(AGENT_TOOLS, keys as Json, 12, query).map((t) => t.name);
  for (
    const query of [
      "change the price to $40",
      "make the second one start 30 minutes later",
      "Move the second stop of my wine walk experience to 7pm",
      "update my sunset tour",
    ]
  ) {
    const picked = names(["core", "listings"], query);
    const edits = picked.some((n) =>
      n === "update_experience" || n === "manage_experience_stops"
    );
    assertEquals(
      picked.includes("get_experience"),
      edits,
      `${query}: ${picked.join(",")}`,
    );
    assert(picked.length <= 12, query);
    if (edits) {
      const at = picked.indexOf("get_experience");
      const edit = picked.findIndex((n) =>
        n === "update_experience" || n === "manage_experience_stops"
      );
      assert(at < edit, `${query}: the read sits before its edit`);
    }
  }
  assert(
    !names(["core", "listings"], "How do I add a ticket tier?").includes(
      "get_experience",
    ),
  );
});

Deno.test("the manage_experience_stops executor sends the bound args unchanged", async () => {
  const args = canonicalizeAgentProposalArgs("manage_experience_stops", {
    event_id: EVENT,
    expected_revision: REVISION,
    experience_intents: ["romantic"],
    stops: [{ place_name: "A", start_offset_minutes: 15 }],
  });
  const bound = structuredClone(args);
  const client = fakeClient({ events: [{ id: EVENT, brand_id: BRAND }] }, {
    ok: true,
  });
  await rawTool("manage_experience_stops").executor(
    args,
    client as Json,
    USER,
    {
      operationId: "55555555-5555-4555-8555-555555555555",
    } as Json,
  );
  assertEquals(client.rpcCalls.length, 1);
  assertEquals(client.rpcCalls[0].fn, "ari_execute_experience_operation");
  // #1972: agent_operation_receipt_begin compares these bytes to the pending row.
  assertEquals(client.rpcCalls[0].args.p_args, bound);
  assertEquals(args, bound);
});

// ── get_experience ─────────────────────────────────────────────────────────

Deno.test("get_experience is a read at event_manager on experiences only", () => {
  assert(DOMAIN_READ_ONLY.has("get_experience"));
  assertEquals(
    AGENT_TOOL_AUTHORIZATION.get_experience.requiredRole,
    "event_manager",
  );
  assertEquals(AGENT_TOOL_AUTHORIZATION.get_experience.resource, "event");
  assertEquals(schemaOf("get_experience").required, ["event_id"]);
});

Deno.test("get_experience returns the graph, its verbatim revision and whether a reason is needed", async () => {
  const graph = {
    price_options: [{ id: OPTION, name: "Standard", price_cents: 2_500_000 }],
    stops: [{ stop_order: 0, place_name: "A", start_offset_minutes: 45 }],
  };
  for (
    const [status, needsReason] of [["draft", false], ["live", true]] as const
  ) {
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
    () =>
      rawTool("get_experience").executor(
        { event_id: EVENT },
        client as Json,
        USER,
        {} as Json,
      ),
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
    () =>
      rawTool("get_experience").executor(
        { event_id: EVENT },
        client as Json,
        USER,
        {} as Json,
      ),
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
  const row = await buildFlowProbeDeps(client as Json, BRAND).experienceRow!(
    EVENT,
  );
  assert(row);
  assertEquals(row.is_free, true);
  assertEquals(row.whole_price_cents, null);
  assertEquals(row.ticket_price_cents, 2_500_000);
});

Deno.test("Ari is told to read first and to say every offset (current prompt)", () => {
  for (const tool of ["update_experience", "manage_experience_stops"]) {
    assert(
      ARI_TOOL_RULES[tool].some((rule) =>
        rule.includes("get_experience first")
      ),
      `${tool} rule: read first`,
    );
  }
  assert(
    ARI_TOOL_RULES.manage_experience_stops.some((rule) =>
      rule.includes("start_offset_minutes") && rule.includes("or null")
    ),
  );
  assert(
    ARI_TOOL_RULES.update_experience.some((rule) =>
      rule.includes("Keep each stored option's id")
    ),
  );
  assert(
    ARI_TOOL_RULES.create_experience.some((rule) =>
      rule.includes("start_offset_minutes")
    ),
  );
  assert(/^- get_experience — /m.test(ARI_CAPABILITY_INDEX));
});

Deno.test("get_experience is described and catalogued with the experience tools", async () => {
  const declared = ariToolDeclarations(AGENT_TOOLS).find((d) =>
    d.name === "get_experience"
  );
  assert(declared, "declared to the model");
  // The onboarding "schedule" step lists it beside update_experience.
  const ari10x = await Deno.readTextFile(
    new URL("../agentAri10xTools.ts", import.meta.url),
  );
  const at = ari10x.indexOf('key: "schedule"');
  const step = ari10x.slice(at, ari10x.indexOf("human_owned", at));
  assert(
    step.includes('"get_experience"') && step.includes('"update_experience"'),
  );
});

Deno.test("a retry of an executing stop edit is replayed, never refused by the offset check", async () => {
  // Proposed before this change: positional order, no offsets. An earlier
  // attempt may have committed; the receipt RPC replays its answer.
  const args = {
    event_id: EVENT,
    expected_revision: REVISION,
    experience_intents: ["romantic"],
    stops: [{ place_name: "A", stop_order: 0 }],
  };
  const bound = structuredClone(args);
  const client = fakeClient({
    events: [{ id: EVENT, brand_id: BRAND }],
    experience_stops: [{ start_offset_minutes: 45 }],
  }, { ok: true });
  await rawTool("manage_experience_stops").executor(
    args,
    client as Json,
    USER,
    {
      operationId: "55555555-5555-4555-8555-555555555555",
      retry: true,
    } as Json,
  );
  assertEquals(client.rpcCalls.map((c) => c.fn), [
    "ari_execute_experience_operation",
  ]);
  assertEquals(client.rpcCalls[0].args.p_args, bound);
  assert(
    !client.reads.includes("experience_stops"),
    "no offset read on a retry",
  );
});

Deno.test("agent-confirm-action canonicalizes pending proposals only, never an executing retry", async () => {
  const confirm = await Deno.readTextFile(
    new URL("../../agent-confirm-action/index.ts", import.meta.url),
  );
  assert(
    /if \(pending\.status === "pending"\) \{\s*canonicalArgs = canonicalizeAgentProposalArgs\(\s*pending\.tool_name,\s*candidateArgs,\s*\);\s*\} else \{\s*canonicalArgs = candidateArgs;\s*\}/
      .test(confirm),
    "an executing retry replays its stored args verbatim",
  );
});
