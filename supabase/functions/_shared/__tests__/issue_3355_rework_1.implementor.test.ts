// Issue #3355 rework 1 — the tester's FAIL verdict (Waves A–F), fixed.
//
// Each block names the verdict defect it pins. The tester's D1–D11 repros
// are folded in here (they failed on 269eac5377 and pass after the rework).
//
// MINGLA-INVARIANT: I-ARI-TRUTH-GUARDS-ON-EVERY-PATH | issue #3355 | Both Ari reply paths (the agent loop and the single-call path) run the one stated-values stage before a proposal card and the one write-claim guard before a text reply.

import {
  assert,
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  checkStatedSlots,
  claimEvidenceFromHistory,
  extractStatedSlots,
  guardWriteClaims,
  hostCodeTokens,
  preserveStatedSlots,
  TRUE_STATE_NOTHING_SAVED,
} from "../ariTruthGuards.ts";
import { ariGuideReadStatus } from "../agentAri10xTools.ts";
import { ariSensitiveReason, scrubAriExcerpt } from "../ariPii.ts";
import { rememberNoteError } from "../ariMemory.ts";

const NOW = new Date("2026-11-11T10:00:00Z");
const KEYS = new Set([
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

function check(
  messages: string[],
  args: Record<string, unknown>,
  extra: {
    timezone?: string | null;
    country?: string | null;
    currency?: string | null;
  } = {},
) {
  return checkStatedSlots({
    toolName: "create_discount",
    toolArgs: args,
    schemaKeys: KEYS,
    stated: extractStatedSlots(messages, NOW),
    timezone: extra.timezone === undefined ? "Africa/Lagos" : extra.timezone,
    country: extra.country ?? null,
    currency: extra.currency ?? null,
    now: NOW,
  });
}

function guard(text: string, evidence: unknown[] = []) {
  return guardWriteClaims({ text, pendingThisTurn: false, evidence });
}

// ── P1-1: a planned guide entry stays planned ───────────────────────────────

Deno.test("P1-1: a planned guide entry reads as planned whatever tools Ari has", () => {
  for (const key of ["trips-cancel-booking", "events-discount-codes"]) {
    const read = ariGuideReadStatus("Planned", key);
    assertEquals(read.status, "planned");
    assertEquals(read.how_to_say, "not_available_yet");
    assert(!("ari_tools" in read));
  }
  assertEquals(
    ariGuideReadStatus("Live", "events-discount-codes").status,
    "live",
  );
});

// ── P1-2: the write-claim guard ─────────────────────────────────────────────

Deno.test("P1-2 (D1): a passive-voice claim with no receipt is rewritten", () => {
  for (
    const text of [
      "Your discount code FAVY10 has been created and is live.",
      "The code was sent to your guests.",
      "Your event is now live.",
      "FAVY10 has now been saved.",
    ]
  ) {
    const out = guard(text);
    assert(out.rewritten, text);
    assert(out.text.startsWith(TRUE_STATE_NOTHING_SAVED));
  }
});

Deno.test("P1-2 (D2): a negation excuses only its own clause", () => {
  assert(
    guard("I couldn't find the old code, so I created FAVY10 for you.")
      .rewritten,
  );
  assert(guard("No problem, I've created FAVY10 for you.").rewritten);
  // Honest "not yet" sentences stay.
  for (
    const text of [
      "I haven't created FAVY10 yet.",
      "FAVY10 hasn't been created yet, and nothing has been sent.",
      "Nothing has been saved yet.",
      "Once you approve it, it will be created.",
      "Have I created FAVY10?",
      TRUE_STATE_NOTHING_SAVED,
    ]
  ) assertEquals(guard(text).rewritten, false, text);
});

Deno.test("P1-2 (D3): a proposal never backs 'created'; a cancelled card backs nothing", () => {
  const proposal = {
    pending_action_id: "p1",
    tool_name: "create_discount",
    args: { code: "FFBTSCOM10" },
  };
  assert(guard("Yes, I created FFBTSCOM10 for you.", [proposal]).rewritten);
  // "I proposed" stands while the card is live …
  assertEquals(
    guard("I proposed FFBTSCOM10 for 10% off. Approve it below.", [proposal])
      .rewritten,
    false,
  );
  // … and not once it was cancelled (the live-eval GIRLSTRIPLAGOS miss).
  const history = [
    {
      role: "assistant",
      tool_calls: {
        tool_name: "create_discount",
        args: { code: "GIRLSTRIPLAGOS" },
        pending_action_id: "p2",
      },
    },
    {
      role: "tool",
      tool_results: {
        tool_name: "create_discount",
        pending_action_id: "p2",
        outcome: "cancelled",
      },
    },
  ];
  assert(
    guard(
      "I proposed GIRLSTRIPLAGOS in the previous step.",
      claimEvidenceFromHistory(history),
    ).rewritten,
  );
  // Raw evidence with the cancelled receipt alongside is read the same way.
  assert(
    guard("I proposed GIRLSTRIPLAGOS earlier.", [
      history[0].tool_calls,
      history[1].tool_results,
    ]).rewritten,
  );
});

Deno.test("P1-2 (D4): the receipt must match the claim's verb and object", () => {
  const discount = {
    pending_action_id: "p1",
    tool_name: "create_discount",
    args: { code: "FAVY10" },
  };
  assert(guard("I've published your event.", [discount]).rewritten);
  const executed = claimEvidenceFromHistory([
    { role: "assistant", tool_calls: discount },
    {
      role: "tool",
      tool_results: {
        tool_name: "create_discount",
        pending_action_id: "p1",
        outcome: "executed",
        result: { id: "d1" },
      },
    },
  ]);
  // The executed discount backs the discount claim (its code comes from the
  // proposal's args), never a publish or a message.
  assertEquals(
    guard("I've created FAVY10 for you.", executed).rewritten,
    false,
  );
  assertEquals(
    guard("Your discount code FAVY10 has been created.", executed).rewritten,
    false,
  );
  assert(guard("I've published your event.", executed).rewritten);
  assert(guard("I've sent the message to your guests.", executed).rewritten);
  assert(guard("I created GIRLS20 for you.", executed).rewritten);
  // A publish receipt backs a publish claim.
  const published = [{
    tool_name: "publish_event",
    outcome: "executed",
    pending_action_id: "p9",
    result: { id: "e1" },
  }];
  assertEquals(guard("I've published your event.", published).rewritten, false);
});

// ── P1-3: stated values keep their kind and size ────────────────────────────

Deno.test("P1-3 (D5): a stated percent never becomes a fixed amount", () => {
  assertEquals(
    check(["Create code FAVY10, 10% off"], {
      code: "FAVY10",
      kind: "code",
      value_type: "amount",
      value_minor: 1000,
    }).kind,
    "ask",
  );
  // The right number on the wrong kind is still a different discount.
  assertEquals(
    check(["Create code FAVY10, 10% off"], {
      code: "FAVY10",
      kind: "code",
      value_type: "amount",
      value_bps: 1000,
      value_minor: 1000,
    }).kind,
    "ask",
  );
  // Missing value_bps for a stated percent is asked, not passed.
  assertEquals(
    check(["Create code FAVY10, 10% off"], { code: "FAVY10", kind: "code" })
      .kind,
    "ask",
  );
  assertEquals(
    check(["Create code FAVY10, 10% off"], {
      code: "FAVY10",
      kind: "code",
      value_type: "percent",
      value_bps: 1000,
    }).kind,
    "ok",
  );
});

Deno.test("P1-3 (D6): a stated amount is compared in the currency's minor units", () => {
  const amount = (minor: number, words: string, currency: string | null) =>
    check([words], {
      code: "FAVY10",
      kind: "code",
      value_type: "amount",
      value_minor: minor,
    }, { currency }).kind;
  assertEquals(amount(500, "Create code FAVY10 for ₦5,000 off", null), "ask");
  assertEquals(amount(500000, "Create code FAVY10 for ₦5,000 off", null), "ok");
  assertEquals(amount(500000, "Create code FAVY10 for N5k off", null), "ok");
  assertEquals(
    amount(500000, "Create code FAVY10, 5000 naira off", null),
    "ok",
  );
  // No currency in the words: the brand's own.
  assertEquals(amount(500000, "Create code FAVY10 5000 off", "NGN"), "ok");
  assertEquals(amount(5000, "Create code FAVY10 5000 off", "NGN"), "ask");
  // No currency anywhere: ask.
  assertEquals(amount(500000, "Create code FAVY10 5000 off", null), "ask");
  // A currency the brand does not sell in: ask.
  assertEquals(amount(500, "Create code FAVY10 £5 off", "NGN"), "ask");
  // "$" is the brand's own dollar.
  assertEquals(amount(1000, "Create code FAVY10 $10 off", "CAD"), "ok");
  // A stated amount never becomes a percent.
  assertEquals(
    check(["Create code FAVY10 for ₦5,000 off"], {
      code: "FAVY10",
      kind: "code",
      value_type: "percent",
      value_bps: 500,
    }).kind,
    "ask",
  );
});

Deno.test("P1-3: the stated values apply to every write tool whose schema has the field", async () => {
  const parameters = {
    properties: { brand_id: {}, value_bps: {}, value_type: {}, ends_at: {} },
  };
  const out = await preserveStatedSlots({
    toolName: "update_discount",
    toolArgs: { value_type: "amount", value_bps: 1000 },
    parameters,
    ownerMessages: ["Change it to 15% off"],
    userClient: {} as never,
    now: NOW,
  });
  assertEquals(out.kind, "ask");
});

// ── P1-4: both reply paths run both guards ──────────────────────────────────

Deno.test("P1-4: the single-call path runs the stated-values stage and the claim guard", async () => {
  const source = await Deno.readTextFile(
    new URL("../../agent-chat/index.ts", import.meta.url),
  );
  const loopStart = source.indexOf('.rpc("ari_agent_loop_enabled")');
  const singleStart = source.indexOf("let gemini;");
  assert(loopStart > 0 && singleStart > loopStart);
  const loop = source.slice(loopStart, singleStart);
  const single = source.slice(
    singleStart,
    source.indexOf("async function commitPendingTurn("),
  );
  for (const [name, part] of [["loop", loop], ["single", single]] as const) {
    assertMatch(part, /await statedSlotStage\(\{/, `${name}: stated values`);
    assertMatch(part, /guardReplyClaims\(/, `${name}: claim guard`);
  }
  // Single call: stated values before authorisation, the guard on the text.
  const statedAt = single.indexOf("await statedSlotStage({");
  const authorizeAt = single.indexOf("await authorizeAgentTool(", statedAt);
  assert(statedAt > 0 && authorizeAt > statedAt);
  assertMatch(
    single,
    /const answer = guardReplyClaims\(gemini\.textResponse\.trim\(\), history\);/,
  );
  assertMatch(single, /classification: "stated_slot_ask"/);
  // One helper each (no second copy of the rules).
  assertEquals(source.match(/guardWriteClaims\(\{/g)?.length, 1);
  assertEquals(source.match(/preserveStatedSlots\(\{/g)?.length, 1);
});

// ── P2-8: "until <day>" includes the whole day ──────────────────────────────

Deno.test("P2-8 (D7): until / through / till / by bind the END of the day", () => {
  for (const lead of ["until", "through", "till", "by"]) {
    const r = check([
      `Create code FAVY10 10% off ${lead} 19th of December 2026`,
    ], {
      code: "FAVY10",
      kind: "code",
      value_type: "percent",
      value_bps: 1000,
      ends_at: "2026-12-19T00:00:00+01:00",
    });
    assertEquals(r.kind, "ok", lead);
    if (r.kind === "ok") {
      assertEquals(r.args.ends_at, "2026-12-19T22:59:59Z", lead);
      assert(r.bound.includes("ends_at"), lead);
    }
  }
  // A time the host named is theirs.
  const timed = check(["Create FAVY10 10% off until 19 December at 6pm"], {
    code: "FAVY10",
    kind: "code",
    value_type: "percent",
    value_bps: 1000,
    ends_at: "2026-12-19T18:00:00+01:00",
  });
  assertEquals(
    timed.kind === "ok" && timed.args.ends_at,
    "2026-12-19T18:00:00+01:00",
  );
});

// ── P2-9: each code its own values ──────────────────────────────────────────

Deno.test("P2-9 (D8): two codes with their own values never share the first code's", () => {
  const words = [
    "Create FAVY10 10% off until 19 December and GIRLS20 20% off until 31 December",
  ];
  const second = check(words, {
    code: "GIRLS20",
    kind: "code",
    value_type: "percent",
    value_bps: 2000,
  });
  assertEquals(second.kind, "ok", JSON.stringify(second));
  if (second.kind === "ok") {
    assertEquals(second.args.ends_at, "2026-12-31T22:59:59Z");
  }
  const first = check(words, {
    code: "FAVY10",
    kind: "code",
    value_type: "percent",
    value_bps: 1000,
  });
  assertEquals(
    first.kind === "ok" && first.args.ends_at,
    "2026-12-19T22:59:59Z",
  );
  // The second code with the first code's percent is asked about, by name.
  const wrong = check(words, {
    code: "GIRLS20",
    kind: "code",
    value_type: "percent",
    value_bps: 1000,
  });
  assertEquals(wrong.kind, "ask");
  if (wrong.kind === "ask") {
    assertMatch(wrong.text, /GIRLS20/);
    assertMatch(wrong.text, /20% off/);
  }
  // Shared values still apply to both ("both 10% off until 19 December").
  const shared = check(
    ["Create FAVY10 and GIRLS20, both 10% off until 19 December"],
    { code: "FAVY10", kind: "code", value_type: "percent", value_bps: 1000 },
  );
  assertEquals(
    shared.kind === "ok" && shared.args.ends_at,
    "2026-12-19T22:59:59Z",
  );
  // A follow-up naming one code changes only that code.
  const later = extractStatedSlots([
    words[0],
    "Make GIRLS20 25% instead",
  ], NOW);
  assertEquals(later.per_code?.GIRLS20?.value_bps, 2500);
  assertEquals(later.per_code?.FAVY10?.value_bps, 1000);
});

// ── P2-10: a stated start date ──────────────────────────────────────────────

Deno.test("P2-10 (D9): a stated start date reaches starts_at or is asked about", () => {
  const base = {
    code: "FAVY10",
    kind: "code",
    value_type: "percent",
    value_bps: 1000,
  };
  const words = [
    "Create FAVY10 10% off from 1 December until 19 December 2026",
  ];
  const bound = check(words, base);
  assertEquals(bound.kind, "ok");
  if (bound.kind === "ok") {
    assertEquals(bound.args.starts_at, "2026-11-30T23:00:00Z");
    assertEquals(bound.args.ends_at, "2026-12-19T22:59:59Z");
  }
  assertEquals(
    check(words, { ...base, starts_at: "2026-12-05T00:00:00Z" }).kind,
    "ask",
  );
  assertEquals(
    check(words, { ...base, starts_at: "2026-12-01T09:00:00+01:00" }).kind,
    "ok",
  );
  // "from now" is not a date: nothing to check.
  const now = check(["Create FAVY10 10% off from now until 19 December"], base);
  assertEquals(now.kind === "ok" && now.args.starts_at, undefined);
});

// ── P3-13: whole-token codes ────────────────────────────────────────────────

Deno.test("P3-13 (D11): an invented code that is a substring of the host's words is asked for", async () => {
  const parameters = {
    properties: Object.fromEntries([...KEYS].map((k) => [k, {}])),
  };
  const ask = await preserveStatedSlots({
    toolName: "create_discount",
    toolArgs: {
      code: "PARTY10",
      kind: "code",
      value_type: "percent",
      value_bps: 1000,
    },
    parameters,
    ownerMessages: ["Make a discount code for my party 10% off"],
    userClient: {} as never,
    now: NOW,
  });
  assertEquals(ask.kind, "ask");
  const typed = await preserveStatedSlots({
    toolName: "create_discount",
    toolArgs: {
      code: "FAVY10",
      kind: "code",
      value_type: "percent",
      value_bps: 1000,
    },
    parameters,
    ownerMessages: ["Make a discount code favy10 for 10% off"],
    userClient: {} as never,
    now: NOW,
  });
  assertEquals(typed.kind, "ok");
  assert(hostCodeTokens(['Use "FAVY 10" please']).has("FAVY10"));
  assert(!hostCodeTokens(["my party 10% off"]).has("PARTY10"));
});

// ── P3-14: numeric dates and the brand's country ────────────────────────────

Deno.test("P3-14: a numeric date is read in the brand's country order, or asked", () => {
  const base = {
    code: "FAVY10",
    kind: "code",
    value_type: "percent",
    value_bps: 1000,
  };
  const us = check(["FAVY10 10% off until 12/19/2026"], base, {
    timezone: "America/New_York",
    country: "US",
  });
  assertEquals(us.kind === "ok" && us.args.ends_at, "2026-12-20T04:59:59Z");
  // 12/1/2026: 1 December in the US, 12 January in Nigeria.
  const usAmbiguous = check(["FAVY10 10% off until 12/1/2026"], base, {
    timezone: "America/New_York",
    country: "US",
  });
  assertEquals(
    usAmbiguous.kind === "ok" && usAmbiguous.args.ends_at,
    "2026-12-02T04:59:59Z",
  );
  const ng = check(["FAVY10 10% off until 12/1/2026"], base, { country: "NG" });
  assertEquals(ng.kind === "ok" && ng.args.ends_at, "2026-01-12T22:59:59Z");
  const unknown = check(["FAVY10 10% off until 12/1/2026"], base, {
    country: null,
  });
  assertEquals(unknown.kind, "ask");
  if (unknown.kind === "ask") {
    assertMatch(unknown.text, /12 January 2026 or 1 December 2026/);
  }
  // 19/12/2026 is only one real day, whatever the country.
  const dayFirst = check(["FAVY10 10% off until 19/12/2026"], base, {
    country: "US",
    timezone: "America/New_York",
  });
  assertEquals(
    dayFirst.kind === "ok" && dayFirst.args.ends_at,
    "2026-12-20T04:59:59Z",
  );
});

// ── P3-15: personal data ────────────────────────────────────────────────────

Deno.test("P3-15: obfuscated emails, full-width digits and PINs are refused and scrubbed", () => {
  for (
    const [text, reason] of [
      ["Reach me at ada [at] gmail [dot] com", "contact_details"],
      ["ada at gmail dot com", "contact_details"],
      ["ada(at)gmail(dot)com", "contact_details"],
      ["Call ０８０３１２３４５６７ any time", "contact_details"],
      ["my pin is 4455", "id_details"],
      ["PIN: 1234", "id_details"],
    ] as const
  ) assertEquals(ariSensitiveReason(text), reason, text);
  for (
    const text of [
      "Doors open at 9pm until 2026-12-19",
      "We start at nine dot thirty",
      "Pin the flyer to the top",
    ]
  ) assertEquals(ariSensitiveReason(text), null, text);
  assertEquals(
    scrubAriExcerpt("mail ada [at] gmail [dot] com"),
    "mail [email]",
  );
  assertEquals(scrubAriExcerpt("my pin is 4455"), "my pin is [number]");
  assertEquals(scrubAriExcerpt("call ０８０３１２３４５６７"), "call [phone]");
  assertEquals(
    scrubAriExcerpt("until 2026-12-19 at 23:59"),
    "until 2026-12-19 at 23:59",
  );
});

// ── P2-7: the SQL refusal for a brand-wide note reads in plain words ────────

Deno.test("P2-7: a scanner's brand-wide note is refused in plain words", () => {
  const error = rememberNoteError(
    "memory_brand_note_rank",
  ) as unknown as { code: string; message: string };
  assertEquals(error.code, "MEMORY_BRAND_RANK");
  assertMatch(error.message, /Only brand managers/);
  assertEquals(
    (rememberNoteError("not_authorized") as unknown as { code: string }).code,
    "BRAND_ACCESS_DENIED",
  );
});

// ── P3-17: the live eval leaves no stray lock file ──────────────────────────

Deno.test("P3-17: the live eval runs the route table with --no-lock", async () => {
  const source = await Deno.readTextFile(
    new URL("../../../../scripts/ari/eval/run-live.mjs", import.meta.url),
  );
  const spawn = source.slice(source.indexOf("function runRouteTable("));
  assertMatch(spawn.slice(0, 600), /"--no-lock"/);
});
