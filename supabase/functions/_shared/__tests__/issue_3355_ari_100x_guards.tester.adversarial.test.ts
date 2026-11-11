// Issue #3355 tester (adversarial) — the Ari 100x guards attacked from angles
// the implementor suites do not take: a hostile start_flow call, a model that
// invents stated values, end dates across DST and the extreme UTC offsets,
// and write claims that name things the chat never proposed.
//
// MINGLA-INVARIANT: I-ARI-START-FLOW-ARGS-STRICT | issue #3355 | start_flow accepts only a registered flow_key, the three known argument names and at most 8 flat scalar prefills; anything else (a domain tool name as flow_key, nested or prototype-polluting prefills, non-finite numbers) is not a valid call.
// Retest 2 adds: a card cancelled and then made again, amounts off in
// each currency's own minor units, and a negation that sits in a different
// clause from the claim.
//
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
  claimEvidenceFromHistory,
  endOfLocalDayIso,
  extractStatedSlots,
  mergeModelStatedSlots,
  TRUE_STATE_NOTHING_SAVED,
  writeObjectsFrom,
  writeStatesFromHistory,
} from "../ariTruthGuards.ts";
import { buildClaimEvidence, checkReplyClaims } from "../ariClaimCheck.ts";
import { recordedClaimCall } from "./_issue3355ClaimFlash.ts";

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
  // An impossible day the model reports is dropped. (Rework 2, P3-20: the
  // host's own "end of February" is now read as 28 February, so that is
  // what stands — never the model's 30 February.)
  const feb = ["Code FAVY10 until the end of February"];
  const febEnd = mergeModelStatedSlots(extractStatedSlots(feb, NOW), {
    ends_on: "2027-02-30",
  }, feb).ends_on;
  assertEquals([febEnd?.year, febEnd?.month, febEnd?.day], [2027, 2, 28]);
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

// Rework 3 (implementor; Seth's decision 2026-11-11, the claim check against
// the records) edited the three claim tests below: the reply's claims are read
// by Gemini Flash (its recorded answers, _issue3355ClaimFlash.ts) and kept only
// when a record backs them. The histories and wordings are the tester's; the
// expectations now say what the records prove (a backed claim stays word for
// word, an honest "not yet" is not a claim).

async function stateSaid(
  text: string,
  rows: Array<Record<string, unknown>>,
  host = "Create FAVY10",
  intent = "tool",
) {
  const states = writeStatesFromHistory(rows);
  return (await checkReplyClaims({
    text,
    hostMessage: host,
    intent,
    recentWrite: states.length > 0,
    objects: [
      ...writeObjectsFrom({ evidence: claimEvidenceFromHistory(rows) }),
      ...(extractStatedSlots([host], NOW).code
        ? [extractStatedSlots([host], NOW).code as string]
        : []),
    ],
    evidence: buildClaimEvidence({ states }),
    askedWriteThisTurn: intent === "tool",
    call: recordedClaimCall,
  })).text;
}

Deno.test("#3355 tester: an active-voice claim naming a code the chat never proposed is rewritten", async () => {
  const rows = [{
    role: "assistant",
    tool_calls: {
      pending_action_id: "p1",
      tool_name: "create_discount",
      args: { code: "FAVY10" },
    },
  }];
  const out = await stateSaid(
    "I've created GIRLSTRIPLAGOS for you. It is 10% off.",
    rows,
    "Create GIRLSTRIPLAGOS",
  );
  assert(!out.includes("I've created GIRLSTRIPLAGOS"));
  // #3355 rework 4 (R4-5): no read proved absence here, so Ari says what it
  // knows about this chat instead of "Nothing has been saved".
  assert(
    out.includes("I don't see GIRLSTRIPLAGOS in this chat yet."),
  );
  // A claim with no evidence at all is rewritten, whatever it names.
  assertEquals(
    await stateSaid(
      "We have just published your event.",
      [],
      "Publish my event",
    ),
    TRUE_STATE_NOTHING_SAVED,
  );
  // An honest "not yet" is not a claim: it stays.
  assertEquals(
    await stateSaid("I haven't created FAVY10 yet.", []),
    "I haven't created FAVY10 yet.",
  );
});

// ── Retest 2 ────────────────────────────────────────────────────────────────

function discountRows(
  spec: ReadonlyArray<[id: string, code: string, outcome: string | null]>,
) {
  const rows: Array<Record<string, unknown>> = [];
  for (const [id, code, outcome] of spec) {
    rows.push({
      role: "assistant",
      tool_calls: {
        pending_action_id: id,
        tool_name: "create_discount",
        args: { code, kind: "code" },
      },
    });
    if (outcome) {
      rows.push({
        role: "tool",
        tool_results: {
          pending_action_id: id,
          tool_name: "create_discount",
          outcome,
        },
      });
    }
  }
  return rows;
}

Deno.test("#3355 tester retest 2: a card cancelled then made again shows what the new card proves", async () => {
  const remade = discountRows([["p1", "FAVY10", "cancelled"], [
    "p2",
    "FAVY10",
    "executed",
  ]]);
  assertEquals(
    await stateSaid("I created FAVY10 for you.", remade),
    "I created FAVY10 for you.",
    "the second card's receipt backs it",
  );
  const waiting = discountRows([["p1", "FAVY10", "cancelled"], [
    "p2",
    "FAVY10",
    null,
  ]]);
  assertEquals(
    await stateSaid("I created FAVY10 for you.", waiting),
    "Here's FAVY10 ready to create. Tap Confirm to save it, or Edit to change it.",
  );
  assertEquals(
    await stateSaid("I proposed FAVY10 for you to approve.", waiting),
    "I proposed FAVY10 for you to approve.",
    "a waiting card backs 'I proposed'",
  );
  const swapped = discountRows([["p1", "FAVY10", "cancelled"], [
    "p2",
    "GIRLS20",
    null,
  ]]);
  assertEquals(
    await stateSaid("I proposed FAVY10 for you to approve.", swapped),
    "The card for FAVY10 was cancelled, so nothing was saved.",
  );
  // Created, then a later card for it cancelled: the code still exists.
  const edited = discountRows([["p1", "FAVY10", "executed"], [
    "p2",
    "FAVY10",
    "cancelled",
  ]]);
  assertEquals(
    await stateSaid("FAVY10 has been created.", edited),
    "FAVY10 has been created.",
  );
  assert(
    (await stateSaid(
      "I proposed FAVY10.",
      discountRows([["p1", "FAVY10", "expired"]]),
    ))
      .startsWith("The card for FAVY10 expired"),
  );
  assert(
    (await stateSaid(
      "FAVY10 has been created.",
      discountRows([["p1", "FAVY10", "failed"]]),
    )).startsWith("FAVY10 couldn't be saved"),
  );
  // A discount receipt never speaks for an event.
  assertEquals(
    await stateSaid("I published your event.", remade, "Publish my event"),
    TRUE_STATE_NOTHING_SAVED,
  );
});

Deno.test("#3355 tester retest 2: no excuse in any clause keeps an unbacked claim", async () => {
  const none: Array<Record<string, unknown>> = [];
  for (
    const text of [
      "I created FAVY10, but I haven't published the event.",
      "I created FAVY10 — you can't miss it on the Discounts page.",
      "Once again, I created FAVY10.",
    ]
  ) {
    assertEquals(
      await stateSaid(text, none),
      // #3355 rework 4 (R4-5): no read proved absence.
      "I don't see FAVY10 in this chat yet.",
      text,
    );
  }
  // Honest negatives and conditionals are not claims (rework 3).
  for (
    const text of [
      "I haven't created FAVY10 yet.",
      "The code FAVY10 was not created.",
      "If you approve, FAVY10 will be created.",
    ]
  ) assertEquals(await stateSaid(text, none), text, text);
});

const AMOUNT_KEYS = new Set([
  "brand_id",
  "kind",
  "code",
  "value_type",
  "value_bps",
  "value_minor",
]);
const amountCheck = (
  message: string,
  valueMinor: number,
  currency: string,
) =>
  checkStatedSlots({
    toolName: "create_discount",
    toolArgs: {
      code: "FAVY10",
      kind: "code",
      value_type: "amount",
      value_minor: valueMinor,
    },
    schemaKeys: AMOUNT_KEYS,
    stated: extractStatedSlots([message], NOW),
    timezone: null,
    currency,
    country: null,
    now: NOW,
  }).kind;

Deno.test("#3355 tester retest 2: an amount off is compared in each currency's own minor units", () => {
  // USD cents.
  assertEquals(amountCheck("Code FAVY10 for $5.50 off", 550, "USD"), "ok");
  assertEquals(amountCheck("Code FAVY10 for $5.50 off", 500, "USD"), "ask");
  assertEquals(amountCheck("Code FAVY10 for $5 off", 5, "USD"), "ask");
  // GBP pence, by sign and by word.
  assertEquals(amountCheck("Code FAVY10 £5 off", 500, "GBP"), "ok");
  assertEquals(amountCheck("Code FAVY10 5 quid off", 5, "GBP"), "ask");
  // "$" is the brand's own dollar; on a pound brand it is a question.
  assertEquals(amountCheck("Code FAVY10 $5 off", 500, "CAD"), "ok");
  assertEquals(amountCheck("Code FAVY10 $5 off", 500, "GBP"), "ask");
  // Naira kobo with "k" and thousands separators; cedi pesewas; shilling cents.
  assertEquals(amountCheck("Code FAVY10 ₦5k off", 500000, "NGN"), "ok");
  assertEquals(amountCheck("Code FAVY10 5k off", 5000, "NGN"), "ask");
  assertEquals(amountCheck("Code FAVY10 5,000 naira off", 500000, "NGN"), "ok");
  assertEquals(amountCheck("Code FAVY10 GH₵50 off", 5000, "GHS"), "ok");
  assertEquals(amountCheck("Code FAVY10 KSh 500 off", 50000, "KES"), "ok");
});
