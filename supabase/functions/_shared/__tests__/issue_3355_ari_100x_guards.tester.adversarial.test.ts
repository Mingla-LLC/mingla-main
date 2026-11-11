// Issue #3355 tester (adversarial) — the Ari 100x guards attacked from angles
// the implementor suites do not take: a hostile start_flow call, a model that
// invents stated values, end dates across DST and the extreme UTC offsets,
// and write claims that name things the chat never proposed.
//
// MINGLA-INVARIANT: I-ARI-START-FLOW-ARGS-STRICT | issue #3355 | start_flow accepts only a registered flow_key, the three known argument names and at most 8 flat scalar prefills; anything else (a domain tool name as flow_key, nested or prototype-polluting prefills, non-finite numbers) is not a valid call.
// MINGLA-INVARIANT: I-ARI-MODEL-VALUES-GROUNDED | issue #3355 | A stated value the intent read reports (code, percent, end day, limits) reaches a proposal check only when the host's own words carry it.
//
// Run: deno test --no-check --allow-read --allow-env \
//   supabase/functions/_shared/__tests__/issue_3355_ari_100x_guards.tester.adversarial.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  ariOfferingDetourIssue,
  ariSetupSkippedIssue,
  parseStartFlowArgs,
} from "../ariFlows/startFlowTool.ts";
import {
  checkStatedSlots,
  endOfLocalDayIso,
  extractStatedSlots,
  guardWriteClaims,
  mergeModelStatedSlots,
  TRUE_STATE_NOTHING_SAVED,
} from "../ariTruthGuards.ts";

const NOW = new Date("2026-11-11T10:00:00Z");
const DISCOUNT_KEYS = new Set([
  "brand_id",
  "kind",
  "code",
  "value_type",
  "value_bps",
  "value_minor",
  "starts_at",
  "ends_at",
  "max_total_uses",
  "max_uses_per_buyer",
]);

Deno.test("#3355 tester: start_flow refuses a domain tool, an unknown key or a forged flow", () => {
  for (
    const flow of [
      "create_discount",
      "refund_order",
      "publish_event",
      "set_brand_payout_country",
      "CREATE_EVENT",
      "create_event ",
      "",
    ]
  ) {
    assertEquals(parseStartFlowArgs({ flow_key: flow }), null, flow);
  }
  assertEquals(
    parseStartFlowArgs({ flow_key: "create_event", confirm: true }),
    null,
    "an extra argument (confirm) is not a valid call",
  );
  assertEquals(
    parseStartFlowArgs({
      flow_key: "create_event",
      brand_id: crypto.randomUUID(),
    }),
    null,
    "the model can never pick the brand",
  );
  assertEquals(parseStartFlowArgs(["create_event"]), null);
  assertEquals(parseStartFlowArgs(null), null);
});

Deno.test("#3355 tester: start_flow prefills stay flat scalars, bounded and unpolluted", () => {
  assertEquals(
    parseStartFlowArgs({
      flow_key: "create_event",
      prefills: { price: { $gt: 0 } },
    }),
    null,
  );
  assertEquals(
    parseStartFlowArgs({
      flow_key: "create_event",
      prefills: { title: ["a"] },
    }),
    null,
  );
  assertEquals(
    parseStartFlowArgs({
      flow_key: "create_event",
      prefills: { price: Infinity },
    }),
    null,
  );
  assertEquals(
    parseStartFlowArgs({ flow_key: "create_event", prefills: { price: NaN } }),
    null,
  );
  const polluted = JSON.parse(
    '{"flow_key":"create_event","prefills":{"__proto__":{"paid":true}}}',
  );
  assertEquals(parseStartFlowArgs(polluted), null, "__proto__ is not a key");
  assertEquals(
    parseStartFlowArgs({
      flow_key: "create_event",
      prefills: { "Title": "x" },
    }),
    null,
    "keys are lower-case words",
  );
  const nine = Object.fromEntries(
    Array.from({ length: 9 }, (_, i) => [`k${"abcdefghi"[i]}`, i]),
  );
  assertEquals(
    parseStartFlowArgs({ flow_key: "create_event", prefills: nine }),
    null,
  );
  const ok = parseStartFlowArgs({
    flow_key: "create_event",
    intent_text: "x".repeat(5000),
    prefills: { title: "y".repeat(5000), paid: true, price: 5000 },
  });
  assert(ok);
  assertEquals(ok.intent_text.length, 600);
  assertEquals(String(ok.prefills.title).length, 200);
  assertEquals(({} as Record<string, unknown>).paid, undefined);
});

Deno.test("#3355 tester: the setup and detour bounces never fire on the tool the host asked for", () => {
  assertEquals(
    ariOfferingDetourIssue({
      readSource: "model",
      targetTool: "create_discount",
      toolName: "create_discount",
    }),
    null,
  );
  assertEquals(
    ariOfferingDetourIssue({
      readSource: "hints",
      targetTool: "create_discount",
      toolName: "create_event",
    }),
    null,
    "a hints-only read never bounces a proposal",
  );
  assert(
    ariOfferingDetourIssue({
      readSource: "model",
      targetTool: "create_discount",
      toolName: "create_venue_listing",
    }),
  );
  assertEquals(
    ariSetupSkippedIssue({
      startFlowHint: "create_event",
      startFlowAllowed: false,
      toolName: "create_event",
    }),
    null,
    "with start_flow not offered, the create tool is never bounced into a loop",
  );
});

Deno.test("#3355 tester: values the model invents never become stated values", () => {
  const words = ["Create a discount code FAVY10 for my party"];
  const merged = mergeModelStatedSlots(
    extractStatedSlots(words, NOW),
    {
      code: "VIP50",
      percent_off: 50,
      ends_on: "2026-12-31",
      max_total_uses: 100,
      max_uses_per_buyer: 1,
    },
    words,
  );
  assertEquals(merged.code, "FAVY10");
  assertEquals(merged.value_bps, undefined, "the host named no percent");
  assertEquals(merged.ends_on, undefined, "the host named no end day");
  assertEquals(merged.max_total_uses, undefined);
  assertEquals(merged.max_uses_per_buyer, undefined);
  // The host named neither a code nor a number: the model's are dropped.
  const vague = ["Create a discount code for my party, a percent off"];
  const vagueMerged = mergeModelStatedSlots(
    extractStatedSlots(vague, NOW),
    { code: "VIP50", percent_off: 50 },
    vague,
  );
  assertEquals(vagueMerged.code, undefined, "an invented code is dropped");
  assertEquals(
    vagueMerged.value_bps,
    undefined,
    "an invented percent is dropped",
  );
  // A number the host wrote for something else is not a percent.
  const priced = ["Tickets are 10 pounds; make code FAVY10"];
  assertEquals(
    mergeModelStatedSlots(extractStatedSlots(priced, NOW), {
      percent_off: 10,
    }, priced).value_bps,
    undefined,
  );
  // An impossible day the model reports is dropped.
  const feb = ["Code FAVY10 until the end of February"];
  assertEquals(
    mergeModelStatedSlots(extractStatedSlots(feb, NOW), {
      ends_on: "2027-02-30",
    }, feb).ends_on,
    undefined,
  );
});

Deno.test("#3355 tester: a stated end day binds 23:59:59 local across DST and the extreme offsets", () => {
  const cases: Array<
    [string, { year: number; month: number; day: number }, string]
  > = [
    // London: the clocks go forward on 29 March 2026 (BST, +01:00).
    [
      "Europe/London",
      { year: 2026, month: 3, day: 29 },
      "2026-03-29T22:59:59Z",
    ],
    // London: back on 25 October 2026 (GMT by 23:59).
    [
      "Europe/London",
      { year: 2026, month: 10, day: 25 },
      "2026-10-25T23:59:59Z",
    ],
    // New York: back on 1 November 2026 (EST, -05:00).
    [
      "America/New_York",
      { year: 2026, month: 11, day: 1 },
      "2026-11-02T04:59:59Z",
    ],
    // Lagos never changes (+01:00).
    [
      "Africa/Lagos",
      { year: 2026, month: 12, day: 19 },
      "2026-12-19T22:59:59Z",
    ],
    // The widest offsets either side.
    [
      "Pacific/Kiritimati",
      { year: 2026, month: 12, day: 19 },
      "2026-12-19T09:59:59Z",
    ],
    [
      "Pacific/Pago_Pago",
      { year: 2026, month: 12, day: 19 },
      "2026-12-20T10:59:59Z",
    ],
  ];
  for (const [zone, day, expected] of cases) {
    assertEquals(
      endOfLocalDayIso(day, zone),
      expected,
      `${zone} ${JSON.stringify(day)}`,
    );
  }
  // The guard binds the same instant when the model left ends_at out.
  const stated = extractStatedSlots(
    ["Code SPRING10 10% off until 29 March 2026"],
    NOW,
  );
  const check = checkStatedSlots({
    toolName: "create_discount",
    toolArgs: {
      code: "SPRING10",
      kind: "code",
      value_type: "percent",
      value_bps: 1000,
    },
    schemaKeys: DISCOUNT_KEYS,
    stated,
    timezone: "Europe/London",
  });
  assertEquals(check.kind, "ok");
  if (check.kind === "ok") {
    assertEquals(check.args.ends_at, "2026-03-29T22:59:59Z");
  }
});

Deno.test("#3355 tester: a stated end a day off, or a different stated code, is asked about", () => {
  const stated = extractStatedSlots(
    ["Create FAVY10 10% off until 19th of December 2026"],
    NOW,
  );
  // Two days late is not a time zone slip: it is asked about, never bound.
  const late = checkStatedSlots({
    toolName: "create_discount",
    toolArgs: {
      code: "FAVY10",
      kind: "code",
      value_type: "percent",
      value_bps: 1000,
      ends_at: "2026-12-21T22:59:59Z",
    },
    schemaKeys: DISCOUNT_KEYS,
    stated,
    timezone: "Africa/Lagos",
  });
  assertEquals(late.kind, "ask");
  // A model-renamed code is asked about.
  const renamed = checkStatedSlots({
    toolName: "create_discount",
    toolArgs: {
      code: "FAVY15",
      kind: "code",
      value_type: "percent",
      value_bps: 1000,
    },
    schemaKeys: DISCOUNT_KEYS,
    stated,
    timezone: "Africa/Lagos",
  });
  assertEquals(renamed.kind, "ask");
  // No time zone known: the end day is asked about, never guessed in UTC.
  const noZone = checkStatedSlots({
    toolName: "create_discount",
    toolArgs: {
      code: "FAVY10",
      kind: "code",
      value_type: "percent",
      value_bps: 1000,
    },
    schemaKeys: DISCOUNT_KEYS,
    stated,
    timezone: null,
  });
  assertEquals(noZone.kind, "ask");
});

Deno.test("#3355 tester: an active-voice claim naming a code the chat never proposed is rewritten", () => {
  const evidence = [{
    pending_action_id: "p1",
    tool_name: "create_discount",
    args: { code: "FAVY10" },
  }];
  const out = guardWriteClaims({
    text: "I've created GIRLSTRIPLAGOS for you. It is 10% off.",
    pendingThisTurn: false,
    evidence,
  });
  assert(out.rewritten);
  assert(out.text.startsWith(TRUE_STATE_NOTHING_SAVED));
  assert(!out.text.includes("I've created GIRLSTRIPLAGOS"));
  // A claim with no evidence at all is rewritten, whatever it names.
  const bare = guardWriteClaims({
    text: "We have just published your event.",
    pendingThisTurn: false,
    evidence: [],
  });
  assert(bare.rewritten);
  // An honest "not yet" is kept.
  const honest = guardWriteClaims({
    text: "I haven't created FFBTSCOM10 yet.",
    pendingThisTurn: false,
    evidence: [],
  });
  assertEquals(honest.rewritten, false);
});
