// Issue #3355 Wave C (C1 brand snapshot, C2 screen context) — Ari knows what
// is going on.
//
// MINGLA-INVARIANT: I-ARI-SNAPSHOT-CAPPED | issue #3355 | The per-turn brand snapshot is read with the caller's client, never exceeds ARI_BRAND_SNAPSHOT_MAX_CHARS, truncates lists with counts, omits a failed section with a marker instead of failing the turn, and is rebuilt after a write receipt.
// MINGLA-INVARIANT: I-ARI-SCREEN-CONTEXT-VALIDATED | issue #3355 | The Host's client_context reaches the model only when its route matches an App Map screen; an entity reaches it only when it is a uuid named in that route and the caller can read it under the active brand; anything else is dropped without failing the turn.
//
// Run: deno test --no-check --allow-read --allow-env \
//   supabase/functions/_shared/__tests__/issue_3355_wave_c_turn_context.implementor.test.ts

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { runAgentLoop } from "../agentLoop.ts";
import { ariGuideInitialCalls } from "../ariGuideKnowledge.ts";
import { ariDeterministicReadPlan } from "../agentToolsets.ts";
import {
  ARI_BRAND_SNAPSHOT_MAX_CHARS,
  ariTurnContextPart,
  buildAriBrandSnapshot,
  capAriSnapshotText,
  clearAriBrandSnapshotCache,
  getAriBrandSnapshot,
  latestAriWriteReceiptAt,
  parseAriClientContext,
  resolveAriScreenContext,
} from "../ariTurnContext.ts";

// The fake answers the narrow builder surface the snapshot uses.
// deno-lint-ignore no-explicit-any
type AnyClient = any;

const ROOT = new URL("../../../../", import.meta.url);
const read = (path: string) => Deno.readTextFileSync(new URL(path, ROOT));

const BRAND = "11111111-1111-4111-8111-111111111111";
const OTHER_BRAND = "22222222-2222-4222-8222-222222222222";
const EVENT = "33333333-3333-4333-8333-333333333333";
const FOREIGN_EVENT = "44444444-4444-4444-8444-444444444444";
const TRIP = "55555555-5555-4555-8555-555555555555";
const EVENT2 = "77777777-7777-4777-8777-777777777777";
const NOW = Date.parse("2026-11-10T12:00:00Z");

type Result = {
  data: unknown;
  error: { message: string; code?: string } | null;
};
type Fixture = {
  tables?: Record<string, (filters: Filter[]) => Result>;
  rpcs?: Record<string, (args: Record<string, unknown>) => Result>;
  slow?: Set<string>;
};
type Filter = { op: string; column: string; value: unknown };

/** A caller-scoped client fake: records every read, answers from fixtures. */
function fakeClient(fixture: Fixture) {
  const calls: string[] = [];
  const client = {
    calls,
    from(table: string) {
      calls.push(`from:${table}`);
      const filters: Filter[] = [];
      const run = (): Promise<Result> => {
        const answer = fixture.tables?.[table];
        const raw = answer
          ? answer(filters)
          : { data: null, error: { message: `no fixture for ${table}` } };
        const result = limit !== null && Array.isArray(raw.data)
          ? { ...raw, data: raw.data.slice(0, limit) }
          : raw;
        if (fixture.slow?.has(table)) {
          return new Promise((resolve) =>
            setTimeout(() => resolve(result), 200)
          );
        }
        return Promise.resolve(result);
      };
      const builder: Record<string, unknown> = {};
      let limit: number | null = null;
      for (const op of ["select", "order", "not"]) {
        builder[op] = () => builder;
      }
      builder.limit = (n: number) => {
        limit = n;
        return builder;
      };
      for (const op of ["eq", "is", "in", "neq"]) {
        builder[op] = (column: string, value: unknown) => {
          filters.push({ op, column, value });
          return builder;
        };
      }
      builder.maybeSingle = () =>
        run().then((r) => ({
          ...r,
          data: Array.isArray(r.data) ? r.data[0] ?? null : r.data,
        }));
      builder.then = (
        resolve: (r: Result) => unknown,
        reject: (e: unknown) => unknown,
      ) => run().then(resolve, reject);
      return builder;
    },
    rpc(name: string, args: Record<string, unknown> = {}) {
      calls.push(`rpc:${name}`);
      const answer = fixture.rpcs?.[name];
      return Promise.resolve(
        answer
          ? answer(args)
          : { data: null, error: { message: `no rpc ${name}` } },
      );
    },
  };
  return client;
}

const eq = (filters: Filter[], column: string) =>
  filters.find((f) => f.op === "eq" && f.column === column)?.value;

function eventsTable(rows: Array<Record<string, unknown>>) {
  return (filters: Filter[]): Result => {
    const brand = eq(filters, "brand_id");
    const id = eq(filters, "id");
    return {
      data: rows.filter((row) =>
        (brand === undefined || row.brand_id === brand) &&
        (id === undefined || row.id === id)
      ),
      error: null,
    };
  };
}

const FAVY10 = {
  id: "d1",
  brand_id: BRAND,
  kind: "code",
  code: "FAVY10",
  name: "FAVY10",
  value_type: "percent",
  value_bps: 1000,
  status: "active",
  starts_at: "2026-11-10T09:00:00Z",
  ends_at: "2026-12-19T22:59:59Z",
  max_total_uses: 100,
  liveUses: 3,
  consumedUnits: 3,
};

function brandFixture(overrides: Partial<Fixture> = {}): Fixture {
  return {
    tables: {
      brands: () => ({
        data: [{
          name: "Favy Events",
          city: "Lagos",
          country_code: "NG",
          default_currency: "NGN",
          default_timezone: "Africa/Lagos",
        }],
        error: null,
      }),
      events: eventsTable([
        {
          id: EVENT,
          brand_id: BRAND,
          title: "Rooftop Night",
          status: "live",
          event_type: "event",
          updated_at: "2026-11-09T10:00:00Z",
          event_dates: [{
            start_at: "2026-12-01T18:00:00Z",
            end_at: "2026-12-01T23:00:00Z",
          }],
        },
        {
          id: TRIP,
          brand_id: BRAND,
          title: "Badagry Trip",
          status: "draft",
          event_type: "trip",
          updated_at: "2026-11-08T10:00:00Z",
          event_dates: [],
        },
        {
          id: "66666666-6666-4666-8666-666666666666",
          brand_id: BRAND,
          title: "Past Party",
          status: "live",
          event_type: "event",
          updated_at: "2026-10-01T10:00:00Z",
          event_dates: [{
            start_at: "2026-10-01T18:00:00Z",
            end_at: "2026-10-01T23:00:00Z",
          }],
        },
      ]),
      stay_offerings: () => ({ data: [], error: null }),
      agent_activity_events: () => ({
        data: [
          { event_type: "response_ready", created_at: "2026-11-10T10:08:53Z" },
          {
            event_type: "approved_action_started",
            created_at: "2026-11-10T10:07:00Z",
          },
        ],
        error: null,
      }),
      venue_listings: () => ({ data: [], error: null }),
    },
    rpcs: {
      brand_readiness: () => ({
        data: {
          brand_id: BRAND,
          counts: { blocking: 1, can_wait: 2, done: 5, deferred: 0 },
          money: {
            can_sell: true,
            can_be_paid_out: false,
            sell_reason: "ok",
            payout_reason: "no_bank",
          },
          items: [
            { key: "bank", severity: "blocking", state: "missing" },
            { key: "bio", severity: "skippable", state: "missing" },
            { key: "cover", severity: "skippable", state: "missing" },
            { key: "name", severity: "done", state: "done" },
          ],
        },
        error: null,
      }),
      brand_discounts_list: (args) => ({
        data: args.p_brand_id === BRAND && args.p_filter === "live"
          ? [FAVY10]
          : [],
        error: null,
      }),
      issue_3720_list_brand_groups: () => ({
        data: [{
          brand_id: BRAND,
          unread_count: 4,
          last_message_preview: "secret words",
        }],
        error: null,
      }),
    },
    ...overrides,
  };
}

Deno.test("C1: the snapshot for a fixture brand carries the active discount and its ends_at", async () => {
  const client = fakeClient(brandFixture());
  const snapshot = await buildAriBrandSnapshot({
    client: client as AnyClient,
    brandId: BRAND,
    now: NOW,
  });
  assertStringIncludes(
    snapshot.text,
    "FAVY10: 10% off, ends 2026-12-19T22:59:59.000Z, used 3 of 100 times",
  );
  assertStringIncludes(
    snapshot.text,
    `Brand: "Favy Events" · Lagos, NG · currency NGN · time zone Africa/Lagos`,
  );
  assertStringIncludes(snapshot.text, "Checklist: 1 blocking, 2 can wait");
  assertStringIncludes(
    snapshot.text,
    "Selling: can sell paid tickets; payouts: not ready (no_bank)",
  );
  assertStringIncludes(snapshot.text, "Home to-dos open: 3");
  assertStringIncludes(
    snapshot.text,
    `- event "Rooftop Night" live, starts 2026-12-01T18:00:00.000Z`,
  );
  assertStringIncludes(
    snapshot.text,
    `- trip "Badagry Trip" draft, no date yet`,
  );
  assert(
    !snapshot.text.includes("Past Party"),
    "an ended offering is not upcoming",
  );
  assertStringIncludes(
    snapshot.text,
    "Recent Ari activity: response_ready 2026-11-10T10:08:53.000Z",
  );
  assertStringIncludes(snapshot.text, "Brand group: 4 unread messages");
  assert(!snapshot.text.includes("secret words"), "never a message preview");
  assertEquals(snapshot.unavailable, []);
  // Caller-scoped reads only: tables through RLS, RPCs that check auth.uid().
  assert(client.calls.includes("rpc:brand_discounts_list"));
  assert(client.calls.includes("rpc:brand_readiness"));
});

Deno.test("C1: a read error in one section omits only that section, with a marker", async () => {
  const base = brandFixture();
  const client = fakeClient({
    ...base,
    rpcs: {
      ...base.rpcs,
      brand_discounts_list: () => ({ data: null, error: { message: "boom" } }),
    },
  });
  const snapshot = await buildAriBrandSnapshot({
    client: client as AnyClient,
    brandId: BRAND,
    now: NOW,
  });
  assertEquals(snapshot.unavailable, ["discounts"]);
  assert(!snapshot.text.includes("FAVY10"));
  assert(!snapshot.text.includes("Active discounts"));
  assertStringIncludes(snapshot.text, "Not available this turn: discounts");
  assertStringIncludes(snapshot.text, "Rooftop Night");
  assertStringIncludes(snapshot.text, "Checklist: 1 blocking");
  assertStringIncludes(snapshot.text, "Brand group: 4 unread");
});

Deno.test("C1: a slow section times out and is left out; a thrown read never fails the turn", async () => {
  const base = brandFixture();
  const client = fakeClient({
    ...base,
    slow: new Set(["agent_activity_events"]),
    rpcs: {
      ...base.rpcs,
      brand_readiness: () => {
        throw new Error("network down");
      },
    },
  });
  const snapshot = await buildAriBrandSnapshot({
    client: client as AnyClient,
    brandId: BRAND,
    now: NOW,
    sectionTimeoutMs: 20,
  });
  assertEquals(
    [...snapshot.unavailable].sort(),
    ["activity", "checklist", "home_todos", "money"],
  );
  assertStringIncludes(snapshot.text, "FAVY10");
  // Let the fake's slow read settle so the test leaves no timer behind.
  await new Promise((resolve) => setTimeout(resolve, 250));
});

Deno.test("C1: the cap holds with 50 offerings and 30 discounts; lists say how many more", async () => {
  const many = Array.from({ length: 50 }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    brand_id: BRAND,
    title: `Offering ${i} ${"x".repeat(200)}`,
    status: "draft",
    event_type: "event",
    updated_at: new Date(NOW - i * 1000).toISOString(),
    event_dates: [],
  }));
  const base = brandFixture();
  const client = fakeClient({
    ...base,
    tables: { ...base.tables, events: eventsTable(many) },
    rpcs: {
      ...base.rpcs,
      brand_discounts_list: () => ({
        data: Array.from(
          { length: 30 },
          (_, i) => ({ ...FAVY10, code: `CODE${i}` }),
        ),
        error: null,
      }),
    },
  });
  const snapshot = await buildAriBrandSnapshot({
    client: client as AnyClient,
    brandId: BRAND,
    now: NOW,
  });
  assert(
    snapshot.text.length <= ARI_BRAND_SNAPSHOT_MAX_CHARS,
    `snapshot ${snapshot.text.length} chars`,
  );
  assertEquals(snapshot.text.match(/^- event "Offering/gm)?.length, 5);
  // The scan reads at most 40 rows and says so ("40+").
  assertStringIncludes(
    snapshot.text,
    "Offerings (upcoming or draft, 5 of 40+):",
  );
  assertStringIncludes(snapshot.text, "- … 35+ more");
  assertStringIncludes(snapshot.text, "Active discounts (30):");
  assertStringIncludes(snapshot.text, "- … 22 more");
  assert(!snapshot.text.includes("x".repeat(100)), "titles are capped");
});

Deno.test("C1: the hard character cap holds whatever the sections return", () => {
  const lines = Array.from(
    { length: 500 },
    (_, i) => `- line ${i} ${"y".repeat(90)}`,
  );
  const text = capAriSnapshotText(lines);
  assert(
    text.length <= ARI_BRAND_SNAPSHOT_MAX_CHARS,
    `capped text ${text.length} chars`,
  );
  assert(text.endsWith("… (snapshot truncated)"));
  assertEquals(capAriSnapshotText(["a", "b"]), "a\nb");
});

Deno.test("C1: cached per brand and user for 60 s; a newer write receipt rebuilds it", async () => {
  clearAriBrandSnapshotCache();
  const client = fakeClient(brandFixture());
  const c = client as AnyClient;
  const first = await getAriBrandSnapshot({
    client: c,
    brandId: BRAND,
    userId: "u1",
    now: NOW,
  });
  const reads = client.calls.length;
  const second = await getAriBrandSnapshot({
    client: c,
    brandId: BRAND,
    userId: "u1",
    now: NOW + 30_000,
  });
  assertEquals(second, first);
  assertEquals(client.calls.length, reads, "a fresh cache does not read again");
  await getAriBrandSnapshot({
    client: c,
    brandId: BRAND,
    userId: "u2",
    now: NOW + 30_000,
  });
  assert(client.calls.length > reads, "another user never shares the cache");
  const afterUser2 = client.calls.length;
  const receiptAt = latestAriWriteReceiptAt([
    {
      role: "tool",
      tool_results: { outcome: "executed" },
      created_at: new Date(NOW + 40_000).toISOString(),
    },
    {
      role: "tool",
      tool_results: { outcome: "failed" },
      created_at: new Date(NOW + 50_000).toISOString(),
    },
  ]);
  assertEquals(receiptAt, NOW + 40_000);
  const third = await getAriBrandSnapshot({
    client: c,
    brandId: BRAND,
    userId: "u1",
    now: NOW + 45_000,
    latestReceiptAt: receiptAt,
  });
  assert(
    client.calls.length > afterUser2,
    "a write receipt invalidates the snapshot",
  );
  assertEquals(third.built_at, NOW + 45_000);
  const afterReceipt = client.calls.length;
  await getAriBrandSnapshot({
    client: c,
    brandId: BRAND,
    userId: "u1",
    now: NOW + 120_000,
  });
  assert(client.calls.length > afterReceipt, "60 s expiry");
  clearAriBrandSnapshotCache();
});

Deno.test("C1: 'How is FAVY10 doing?' is answered from the snapshot without an extra read", async () => {
  const message = "How is FAVY10 doing?";
  // No deterministic pre-read for this message.
  assertEquals(ariGuideInitialCalls(message), []);
  assertEquals(
    ariDeterministicReadPlan(message, BRAND, null, false, null),
    null,
  );
  const client = fakeClient(brandFixture());
  const snapshot = await buildAriBrandSnapshot({
    client: client as AnyClient,
    brandId: BRAND,
    now: NOW,
  });
  const part = ariTurnContextPart({ snapshot, screen: null });
  assert(part);
  const contents = [{
    role: "user",
    parts: [part, { text: `<user_data>\n${message}\n</user_data>` }],
  }];
  let modelCalls = 0;
  const result = await runAgentLoop({
    callModel: () => {
      modelCalls++;
      // Deterministic harness model: answer from a discount line in context,
      // otherwise read the discounts.
      const context = contents[0].parts.map((p) => p.text).join("\n");
      const line = context.split("\n").find((l) => l.startsWith("- FAVY10:"));
      return Promise.resolve(
        line
          ? { textResponse: `FAVY10 is live: ${line.slice(2)}.`, toolCalls: [] }
          : {
            toolCalls: [{ name: "list_discounts", args: { brand_id: BRAND } }],
          },
      );
    },
    classifyTool: () => "read",
    executeTool: () => Promise.resolve([FAVY10]),
  });
  assertEquals(result.kind, "text");
  assertEquals(result.observations.length, 0, "no extra read call");
  assertEquals(modelCalls, 1);
  if (result.kind === "text") {
    assertStringIncludes(result.text, "ends 2026-12-19T22:59:59.000Z");
    assertStringIncludes(result.text, "used 3 of 100");
  }
});

Deno.test("C1/C2: agent-chat injects the snapshot and screen inside <user_data>, read as the caller", () => {
  const source = read("supabase/functions/agent-chat/index.ts");
  assertStringIncludes(
    source,
    "getAriBrandSnapshot({\n          client: userClient,",
  );
  assertStringIncludes(
    source,
    "latestReceiptAt: latestAriWriteReceiptAt(history)",
  );
  assertStringIncludes(
    source,
    "resolveAriScreenContext({\n          client: userClient,",
  );
  assertStringIncludes(
    source,
    "...(turnContextPart ? [turnContextPart] : []),",
  );
  const part = ariTurnContextPart({
    snapshot: {
      brand_id: BRAND,
      built_at: NOW,
      text: "BRAND SNAPSHOT",
      unavailable: [],
    },
    screen: null,
  });
  assert(part?.text.startsWith('<user_data source="ari_turn_context">\n'));
  assert(part?.text.endsWith("\n</user_data>"));
  // A stored title can never close the delimiter early.
  const module = read("supabase/functions/_shared/ariTurnContext.ts");
  assertStringIncludes(module, 'replace(/[<>]/g, "")');
  assert(!/service.?role/i.test(module.replace(/^\/\/.*$/gm, "")));
});

// ── C2 ──────────────────────────────────────────────────────────────────────

const ACTIVE = { id: BRAND, name: "Favy Events" };

function screenClient() {
  return fakeClient({
    tables: {
      events: eventsTable([
        {
          id: EVENT,
          brand_id: BRAND,
          title: "Rooftop Night",
          event_type: "event",
        },
        {
          id: TRIP,
          brand_id: BRAND,
          title: "Badagry Trip",
          event_type: "trip",
        },
        {
          id: EVENT2,
          brand_id: BRAND,
          title: "Other Night",
          event_type: "event",
        },
        {
          id: FOREIGN_EVENT,
          brand_id: OTHER_BRAND,
          title: "Not yours",
          event_type: "event",
        },
      ]),
      venue_listings: () => ({ data: [], error: null }),
    },
  });
}

Deno.test("C2: a valid screen and entity are kept and 'this event' resolves to it", async () => {
  const screen = await resolveAriScreenContext({
    client: screenClient() as AnyClient,
    raw: { route: `/event/${EVENT}`, entity_kind: "event", entity_id: EVENT },
    activeBrand: ACTIVE,
  });
  assertEquals(screen?.pattern, "/event/[id]");
  assertEquals(screen?.entity, {
    kind: "event",
    id: EVENT,
    title: "Rooftop Night",
  });
  const part = ariTurnContextPart({ snapshot: null, screen });
  assertStringIncludes(
    part!.text,
    `The host is on ${screen!.screen_title} for "Rooftop Night".`,
  );
  assertStringIncludes(
    part!.text,
    `"This event" or "this one" means event ${EVENT}`,
  );
  const trip = await resolveAriScreenContext({
    client: screenClient() as AnyClient,
    raw: { route: `/trip/${TRIP}/edit`, entity_kind: "trip", entity_id: TRIP },
    activeBrand: ACTIVE,
  });
  assertEquals(trip?.entity?.title, "Badagry Trip");
});

Deno.test("C2: a route that is not a Host screen is dropped", async () => {
  for (
    const route of [
      "/not-a-screen/at/all",
      "https://evil.example/event/1",
      "//evil.example",
      "/event/../admin",
      "event/123",
    ]
  ) {
    const screen = await resolveAriScreenContext({
      client: screenClient() as AnyClient,
      raw: { route },
      activeBrand: ACTIVE,
    });
    assertEquals(screen, null, route);
  }
  assertEquals(parseAriClientContext({ route: "/home", extra: 1 }), null);
  assertEquals(parseAriClientContext("/home"), null);
  assertEquals(parseAriClientContext({ route: 12 }), null);
});

Deno.test("C2: a foreign-brand entity, a non-uuid, a kind mismatch or an id not in the route is dropped", async () => {
  const cases: Array<Record<string, unknown>> = [
    {
      route: `/event/${FOREIGN_EVENT}`,
      entity_kind: "event",
      entity_id: FOREIGN_EVENT,
    },
    { route: "/event/abc", entity_kind: "event", entity_id: "abc" },
    { route: `/event/${TRIP}`, entity_kind: "event", entity_id: TRIP },
    { route: `/event/${EVENT}`, entity_kind: "event", entity_id: TRIP },
    // Readable, same brand, right kind, but not the screen the host is on.
    { route: `/event/${EVENT}`, entity_kind: "event", entity_id: EVENT2 },
    { route: `/event/${EVENT}`, entity_kind: "ticket", entity_id: EVENT },
  ];
  for (const raw of cases) {
    const screen = await resolveAriScreenContext({
      client: screenClient() as AnyClient,
      raw,
      activeBrand: ACTIVE,
    });
    assert(
      screen,
      `the screen itself is still valid for ${JSON.stringify(raw)}`,
    );
    assertEquals(screen.entity, null, JSON.stringify(raw));
    const part = ariTurnContextPart({ snapshot: null, screen });
    assert(!part!.text.includes("Not yours"));
    assert(!part!.text.includes("means event"));
  }
  const noBrand = await resolveAriScreenContext({
    client: screenClient() as AnyClient,
    raw: { route: `/event/${EVENT}`, entity_kind: "event", entity_id: EVENT },
    activeBrand: null,
  });
  assertEquals(noBrand?.entity, null);
});

Deno.test("C2: agent-chat accepts client_context without a 400 and never trusts it unvalidated", () => {
  const source = read("supabase/functions/agent-chat/index.ts");
  assertStringIncludes(source, "client_context?: unknown;");
  assert(!source.includes('"client_context is invalid"'));
  assertStringIncludes(source, "raw: body.client_context,");
});
