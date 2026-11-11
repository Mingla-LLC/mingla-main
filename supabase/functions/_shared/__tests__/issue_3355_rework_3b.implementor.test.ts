// Issue #3355 rework 3b — two live-eval defects.
//
//   3b-1  favy10_mid_flow_ends_at was flaky: Flash proposed create_discount
//         with a target that named no listing kind ("all", no kind, "event"
//         with no listing) and the #4304 canonicaliser refused ("I couldn't
//         tell which kind of listing this discount is for"). The server now
//         binds the kind before the canonicaliser: the host's own words, then
//         events when the brand sells events, then the brand's only kind,
//         then events for a brand with no listings; a brand with several kinds
//         and none named gets ONE question listing them. Flash's synonyms
//         ("event_ticket", "tickets", …) normalise; unknown kinds are still
//         refused.
//   3b-2  read answers in UTC: Flash said "10:59 PM West Africa Time" for an
//         end of 23:59:59 Lagos. Every instant the model reads (tool results,
//         history tool rows, the post-approval readback, the brand snapshot)
//         carries a brand-local rendering beside the raw ISO.
//
// MINGLA-INVARIANT: I-ARI-DISCOUNT-TARGET-RESOLVED | issue #3355 | A create_discount proposal whose target names no listing kind is bound at the server boundary (agent-chat, before the #4304 canonicaliser) from the host's words and the brand's listings; a brand with several kinds and none named is asked one question listing them; an unknown kind is still refused in plain words.
// MINGLA-INVARIANT: I-ARI-READS-IN-BRAND-TIME | issue #3355 | Every ISO instant in a tool result, history tool row, post-approval readback or brand snapshot reaches the model with a brand-local rendering beside it (`<field>_local`, or "(…)" in snapshot text) in the brand's zone, then the country's single zone, then UTC labelled "UTC"; the raw ISO is kept.
//
// Run: deno test --no-check --allow-read --allow-env \
//   supabase/functions/_shared/__tests__/issue_3355_rework_3b.implementor.test.ts

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  applyDiscountTargetDefault,
  canonicalizeCreateDiscountArgs,
  discountTargetsNeedDefault,
  readListingKindWord,
  resolveDiscountTargetDefault,
} from "../ariDiscountArgs.ts";
import { bindDiscountTargetDefault } from "../agentAri10xTools.ts";
import { ToolError } from "../agentToolHelpers.ts";
import { ownerCopyViolations } from "../ariOwnerCopy.ts";
import {
  ariBrandDisplayZone,
  ariLocalInstant,
  readAriBrandDisplayZone,
  withAriLocalTimes,
  withAriLocalTimesForModel,
  withAriLocalTimesInText,
} from "../ariLocalTime.ts";
import { buildAriBrandSnapshot } from "../ariTurnContext.ts";

// deno-lint-ignore no-explicit-any
type AnyClient = any;

const ROOT = new URL("../../../../", import.meta.url);
const read = (path: string) => Deno.readTextFileSync(new URL(path, ROOT));

const BRAND = "11111111-1111-4111-8111-111111111111";
const FAVY10_SENTENCE =
  'Create a discount code for me using "FAVY10" as the code and 10% off this code and let it run from now until 19th of December 2026.';
const LAGOS_END_UTC = "2026-12-19T22:59:59Z";
const LAGOS_END_LOCAL = "Sat 19 Dec 2026, 11:59 pm Lagos time";

type Result = { data: unknown; error: { message: string } | null };

/** A caller-scoped fake answering from per-table rows (filters on brand_id). */
function fakeClient(
  tables: Record<string, Array<Record<string, unknown>> | "error">,
  rpcs: Record<string, unknown> = {},
) {
  const calls: string[] = [];
  return {
    calls,
    from(table: string) {
      calls.push(`from:${table}`);
      const eqs: Record<string, unknown> = {};
      const run = (): Promise<Result> => {
        const rows = tables[table];
        if (rows === undefined || rows === "error") {
          return Promise.resolve({ data: null, error: { message: "no" } });
        }
        return Promise.resolve({
          data: rows.filter((row) =>
            Object.entries(eqs).every(([k, v]) => !(k in row) || row[k] === v)
          ),
          error: null,
        });
      };
      const builder: Record<string, unknown> = {};
      for (const op of ["select", "order", "not", "limit", "is", "neq", "in"]) {
        builder[op] = () => builder;
      }
      builder.eq = (column: string, value: unknown) => {
        eqs[column] = value;
        return builder;
      };
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
    rpc(name: string) {
      calls.push(`rpc:${name}`);
      return Promise.resolve(
        name in rpcs
          ? { data: rpcs[name], error: null }
          : { data: null, error: { message: `no rpc ${name}` } },
      );
    },
  };
}

function favyArgs(targets: unknown, scope = "listing_kinds") {
  return {
    brand_id: BRAND,
    kind: "code",
    code: "FAVY10",
    name: "FAVY10",
    value_type: "percent",
    value_bps: 1000,
    scope_kind: scope,
    ends_at: LAGOS_END_UTC,
    targets,
  };
}

// The target shapes Flash produced in the live runs (and their neighbours).
const UNSPECIFIED_TARGETS: Array<[string, unknown]> = [
  ["listing_kind with no kind", [{ target_kind: "listing_kind" }]],
  ["listing_kind 'all'", [{
    target_kind: "listing_kind",
    listing_kind: "all",
  }]],
  ["listing_kind ''", [{ target_kind: "listing_kind", listing_kind: "" }]],
  ["listing_kind 'everything'", [{
    target_kind: "listing_kind",
    listing_kind: "everything",
  }]],
  ["'event' with no listing named", [{ target_kind: "event" }]],
  ["no targets on a listing-kind scope", []],
];

// ── 3b-1: the discount target ──────────────────────────────────────────────

Deno.test("3b-1: the default order — host words, events, only kind, no listings, else ask", () => {
  assertEquals(
    resolveDiscountTargetDefault(["event", "trip"], FAVY10_SENTENCE),
    {
      kind: "default",
      listingKinds: ["event"],
      reason: "brand_sells_events",
    },
  );
  assertEquals(resolveDiscountTargetDefault(["experience"], FAVY10_SENTENCE), {
    kind: "default",
    listingKinds: ["experience"],
    reason: "brand_only_kind",
  });
  assertEquals(resolveDiscountTargetDefault([], FAVY10_SENTENCE), {
    kind: "default",
    listingKinds: ["event"],
    reason: "brand_no_listings",
  });
  assertEquals(
    resolveDiscountTargetDefault(["experience", "trip"], FAVY10_SENTENCE),
    { kind: "ask", listingKinds: ["experience", "trip"] },
  );
  // The host's own words win over the brand default.
  assertEquals(
    resolveDiscountTargetDefault(
      ["event", "trip"],
      "Make SUMMER10 for 10% off my trips",
    ).listingKinds,
    ["trip"],
  );
});

for (const [label, targets] of UNSPECIFIED_TARGETS) {
  Deno.test(`3b-1: Flash's ${label} binds to events for a brand that sells events`, async () => {
    const raw = favyArgs(targets);
    assert(discountTargetsNeedDefault(raw), "the server must resolve it");
    // Without the bind, #4304 refuses (or writes a code that covers nothing).
    if (Array.isArray(targets) && targets.length > 0) {
      assertThrows(() => canonicalizeCreateDiscountArgs(raw), ToolError);
    }
    const client = fakeClient({
      events: [{ brand_id: BRAND, event_type: "event" }],
      venue_listings: [],
    });
    const bound = await bindDiscountTargetDefault(
      "create_discount",
      raw,
      client as AnyClient,
      FAVY10_SENTENCE,
    );
    const canonical = canonicalizeCreateDiscountArgs(bound);
    assertEquals(canonical.targets, [{
      target_kind: "listing_kind",
      listing_kind: "event",
    }]);
    assertEquals(canonical.scope_kind, "listing_kinds");
    // What the host stated is untouched.
    assertEquals(canonical.code, "FAVY10");
    assertEquals(canonical.value_bps, 1000);
    assertEquals(canonical.ends_at, LAGOS_END_UTC);
  });
}

Deno.test("3b-1: Flash's synonyms normalise to the canonical kind without a bind", () => {
  for (
    const word of [
      "events",
      "event_ticket",
      "event_tickets",
      "event tickets",
      "tickets",
      "ticket",
      "Events",
    ]
  ) {
    const canonical = canonicalizeCreateDiscountArgs(
      favyArgs([{ target_kind: "listing_kind", listing_kind: word }]),
    );
    assertEquals(
      canonical.targets,
      [{ target_kind: "listing_kind", listing_kind: "event" }],
      word,
    );
  }
  assertEquals(readListingKindWord("all"), "unspecified");
});

Deno.test("3b-1: a brand with several kinds and none named gets ONE question listing them", async () => {
  const client = fakeClient({
    events: [
      { brand_id: BRAND, event_type: "experience" },
      { brand_id: BRAND, event_type: "trip" },
    ],
    venue_listings: [],
  });
  const error = await assertRejects(
    () =>
      bindDiscountTargetDefault(
        "create_discount",
        favyArgs([{ target_kind: "listing_kind", listing_kind: "all" }]),
        client as AnyClient,
        FAVY10_SENTENCE,
      ),
    ToolError,
  );
  assertEquals((error as ToolError).code, "DISCOUNT_PROPOSAL_INVALID");
  assertEquals(
    (error as ToolError).message,
    "Which listings is this discount for: your experiences or your trips? Tell me and I'll set it up.",
  );
  assert(!/couldn't tell/i.test((error as ToolError).message));
  assertEquals(ownerCopyViolations((error as ToolError).message, "prose"), []);
});

Deno.test("3b-1: #4304's refusal stays for a kind Ari does not know", async () => {
  const raw = favyArgs([{
    target_kind: "listing_kind",
    listing_kind: "banana",
  }]);
  assert(!discountTargetsNeedDefault(raw), "an invalid kind is not defaulted");
  const client = fakeClient({ events: [], venue_listings: [] });
  const bound = await bindDiscountTargetDefault(
    "create_discount",
    raw,
    client as AnyClient,
    FAVY10_SENTENCE,
  );
  assertEquals(
    client.calls,
    [],
    "no read for a proposal that needs no default",
  );
  const error = assertThrows(
    () => canonicalizeCreateDiscountArgs(bound),
    ToolError,
  );
  assertStringIncludes(error.message, "I couldn't tell which kind of listing");
});

Deno.test("3b-1: valid targets and brand-wide codes are left exactly as they are", async () => {
  const client = fakeClient({ events: [], venue_listings: [] });
  for (
    const args of [
      favyArgs([{ target_kind: "event", target_id: BRAND }], "listings"),
      favyArgs([{ target_kind: "listing_kind", listing_kind: "trip" }]),
      favyArgs([], "brand"),
      { ...favyArgs([]), kind: "sale_price", value_type: "set_price" },
    ]
  ) {
    assertEquals(
      await bindDiscountTargetDefault(
        "create_discount",
        args,
        client as AnyClient,
        "",
      ),
      args,
    );
  }
  assertEquals(
    await bindDiscountTargetDefault(
      "create_event",
      { title: "x" },
      client as AnyClient,
      "",
    ),
    { title: "x" },
  );
  assertEquals(client.calls, []);
});

Deno.test("3b-1: applyDiscountTargetDefault keeps a valid target next to a defaulted one", () => {
  const out = applyDiscountTargetDefault(
    favyArgs([
      { target_kind: "listing_kind", listing_kind: "trip" },
      { target_kind: "listing_kind", listing_kind: "all" },
    ]),
    { kind: "default", listingKinds: ["event"], reason: "brand_sells_events" },
  );
  assertEquals(out.targets, [
    { target_kind: "listing_kind", listing_kind: "trip" },
    { target_kind: "listing_kind", listing_kind: "event" },
  ]);
});

Deno.test("3b-1: both agent-chat proposal paths bind the target before #4304 canonicalises", () => {
  const source = read("supabase/functions/agent-chat/index.ts");
  const binds = [...source.matchAll(/await bindDiscountTargetDefault\(/g)];
  assertEquals(binds.length, 2, "the loop path and the single-call path");
  for (const match of binds) {
    const after = source.slice(match.index!, match.index! + 600);
    assert(
      after.includes("canonicalizeAgentProposalArgs("),
      "the canonicaliser runs right after the bind",
    );
  }
});

// ── 3b-2: brand-local times ────────────────────────────────────────────────

Deno.test("3b-2: a list_discounts result reaches the model with ends_at_local in Lagos time", () => {
  const result = {
    discounts: [{
      code: "FAVY10",
      starts_at: "2026-11-11T14:08:00+00:00",
      ends_at: "2026-12-19T22:59:59+00:00",
      status: "active",
      targets: [{ created_at: "2026-11-11T14:08:01.123Z" }],
    }],
  };
  const out = withAriLocalTimes(result, "Africa/Lagos") as typeof result & {
    discounts: Array<Record<string, unknown>>;
  };
  const row = out.discounts[0];
  assertEquals(row.ends_at, "2026-12-19T22:59:59+00:00", "raw ISO kept");
  assertEquals(row.ends_at_local, LAGOS_END_LOCAL);
  assertEquals(row.starts_at_local, "Wed 11 Nov 2026, 3:08 pm Lagos time");
  assertEquals(
    (row.targets as Array<Record<string, unknown>>)[0].created_at_local,
    "Wed 11 Nov 2026, 3:08 pm Lagos time",
  );
  assert(!("status_local" in row), "only instants get a local rendering");
});

Deno.test("3b-2: the zone falls back to the country's single zone, then UTC labelled 'UTC'", async () => {
  assertEquals(ariBrandDisplayZone(null, "NG"), "Africa/Lagos");
  assertEquals(ariBrandDisplayZone("Europe/London", "NG"), "Europe/London");
  assertEquals(ariBrandDisplayZone(null, "US"), null);
  assertEquals(
    ariLocalInstant(LAGOS_END_UTC, null),
    "Sat 19 Dec 2026, 10:59 pm UTC",
  );
  assertEquals(ariLocalInstant("not a date", "Africa/Lagos"), null);
  assertEquals(
    await readAriBrandDisplayZone(
      fakeClient({
        brands: [{ id: BRAND, default_timezone: null, country_code: "NG" }],
      }) as AnyClient,
      BRAND,
    ),
    "Africa/Lagos",
  );
  assertEquals(
    await readAriBrandDisplayZone(
      fakeClient({ brands: "error" }) as AnyClient,
      BRAND,
    ),
    null,
  );
});

Deno.test("3b-2: the model input's functionResponse parts carry the local string; text is unchanged", () => {
  const contents = [
    {
      role: "user",
      parts: [{ text: `<user_data>\nwhen does FAVY10 end?\n</user_data>` }],
    },
    {
      role: "model",
      parts: [{
        functionCall: { name: "list_discounts", args: { brand_id: BRAND } },
      }],
    },
    {
      role: "user",
      parts: [{
        functionResponse: {
          name: "list_discounts",
          response: { result: [{ code: "FAVY10", ends_at: LAGOS_END_UTC }] },
        },
      }],
    },
  ];
  const out = withAriLocalTimesForModel(contents, "Africa/Lagos");
  const body = JSON.stringify(out);
  assertStringIncludes(body, `"ends_at_local":"${LAGOS_END_LOCAL}"`);
  assertStringIncludes(body, `"ends_at":"${LAGOS_END_UTC}"`);
  assertEquals(out[0], contents[0]);
  assertEquals(out[1], contents[1]);
  assert(!JSON.stringify(contents).includes("_local"), "input not mutated");
});

Deno.test("3b-2: every model call that reads results passes its contents through the local-time renderer", () => {
  for (
    const path of [
      "supabase/functions/agent-chat/index.ts",
      "supabase/functions/_shared/agentPostApproval.ts",
    ]
  ) {
    const source = read(path);
    const calls = [...source.matchAll(/await callGemini\(\{/g)];
    assert(calls.length > 0, path);
    for (const match of calls) {
      const head = source.slice(match.index!, match.index! + 200);
      assert(
        /contents:\s*withAriLocalTimesForModel\(/.test(head),
        `${path}: a callGemini without brand-local times:\n${head}`,
      );
    }
  }
  assertStringIncludes(
    read("supabase/functions/_shared/agentPostApproval.ts"),
    "boundedJson(withAriLocalTimes(args.result, zone))",
  );
});

Deno.test("3b-2: the brand snapshot reads its instants in the brand's zone too", async () => {
  const client = fakeClient(
    {
      brands: [{
        id: BRAND,
        name: "Favy Events",
        city: "Lagos",
        country_code: "NG",
        default_currency: "NGN",
        default_timezone: null,
      }],
      events: [],
      stays: [],
      agent_activity_events: [],
    },
    {
      brand_discounts_list: [{
        kind: "code",
        code: "FAVY10",
        value_type: "percent",
        value_bps: 1000,
        ends_at: LAGOS_END_UTC,
        liveUses: 0,
      }],
    },
  );
  const snapshot = await buildAriBrandSnapshot({
    client: client as AnyClient,
    brandId: BRAND,
    now: Date.parse("2026-11-11T14:08:00Z"),
  });
  assertStringIncludes(
    snapshot.text,
    `FAVY10: 10% off, ends 2026-12-19T22:59:59.000Z (${LAGOS_END_LOCAL})`,
  );
  assertStringIncludes(
    snapshot.text,
    "read 2026-11-11T14:08:00.000Z (Wed 11 Nov 2026, 3:08 pm Lagos time)",
  );
  assertEquals(
    withAriLocalTimesInText("ends 2026-12-19T22:59:59Z, used 0", null),
    "ends 2026-12-19T22:59:59Z (Sat 19 Dec 2026, 10:59 pm UTC), used 0",
  );
});
