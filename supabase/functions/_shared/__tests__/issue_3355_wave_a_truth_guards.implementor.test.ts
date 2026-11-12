// Issue #3355 Wave A (A6) — the claim and stated-slot guards (implementor
// happy path).
// MINGLA-INVARIANT: I-ARI-CLAIM-MATCHES-RECEIPT | issue #3355 | On every model-text path, a turn where the host asked for an action, a write card or receipt is near, or the reply names one of the chat's objects runs one structured claim extraction; each completion claim is kept only when the chat's records back it, otherwise its sentence is replaced in place by the server's true state; when the check fails, only first-person past-tense completion claims about an unbacked write are replaced.
// MINGLA-INVARIANT: I-ARI-STATED-SLOTS-PRESERVED | issue #3355 | Codes, percentages, fixed amounts off, start and end dates and use limits the host stated (last 6 owner messages since the previous proposal of the same tool) are compared with the proposal args on both agent paths; the latest statement per code and field wins; a stated end day binds to 23:59:59 local and a future start day to 00:00 local; anything missing, different or in conflict makes Ari ask instead of proposing.
//
// Replays production 2026-11-10: "I proposed creating the discount code
// FFBTSCOM10" with no proposal for it, and FAVY10's "until 19th of December
// 2026" dropped from the saved code.
//
// Run: deno test --no-check --allow-env --allow-read \
//   supabase/functions/_shared/__tests__/issue_3355_wave_a_truth_guards.implementor.test.ts

import {
  assert,
  assertEquals,
  assertMatch,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  checkStatedSlots,
  claimEvidenceFromHistory,
  endOfLocalDayIso,
  extractStatedSlots,
  ownerMessagesForProposal,
  TRUE_STATE_NOTHING_SAVED,
  writeObjectsFrom,
  writeStatesFromHistory,
} from "../ariTruthGuards.ts";
import { buildClaimEvidence, checkReplyClaims } from "../ariClaimCheck.ts";
import { recordedClaimCall } from "./_issue3355ClaimFlash.ts";

const FAVY10 =
  'Create a discount code for me using "FAVY10" as the code and 10% off this code and let it run from now until 19th of December 2026.';
const NOW = new Date("2026-11-10T09:51:52Z");
const BRAND = "22222222-2222-4222-8222-222222222222";
const DISCOUNT_KEYS = new Set([
  "brand_id",
  "kind",
  "code",
  "name",
  "value_type",
  "value_bps",
  "value_minor",
  "scope_kind",
  "combines_with",
  "starts_at",
  "ends_at",
  "ends_after_count",
  "max_total_uses",
  "max_uses_per_buyer",
  "min_subtotal_minor",
  "targets",
]);

function modelArgs(extra: Record<string, unknown> = {}) {
  return {
    brand_id: BRAND,
    kind: "code",
    code: "FAVY10",
    name: "FAVY10",
    value_type: "percent",
    value_bps: 1000,
    scope_kind: "listing_kinds",
    targets: [{ target_kind: "listing_kind", listing_kind: "event" }],
    ...extra,
  };
}

// ── I-ARI-CLAIM-MATCHES-RECEIPT ─────────────────────────────────────────────

// #3355 rework 3 (Seth, 2026-11-11): the claim check against the records.
// The model reads the reply's completion claims (Flash's recorded answers
// here); the server keeps a backed claim word for word and replaces an
// unbacked one with the true state.

async function checked(
  text: string,
  history: Array<Record<string, unknown>>,
  host: string,
  intent = "tool",
) {
  const states = writeStatesFromHistory(history);
  return await checkReplyClaims({
    text,
    hostMessage: host,
    intent,
    recentWrite: states.length > 0,
    objects: [
      ...writeObjectsFrom({ evidence: claimEvidenceFromHistory(history) }),
      ...(extractStatedSlots([host], NOW).code
        ? [extractStatedSlots([host], NOW).code as string]
        : []),
    ],
    evidence: buildClaimEvidence({ states }),
    askedWriteThisTurn: intent === "tool",
    call: recordedClaimCall,
  });
}

const SAVED_FAVY10 = [
  {
    role: "assistant",
    tool_calls: {
      tool_name: "create_discount",
      args: modelArgs(),
      pending_action_id: "p1",
    },
  },
  {
    role: "tool",
    tool_results: {
      tool_name: "create_discount",
      pending_action_id: "p1",
      outcome: "executed",
      result: { code: "FAVY10" },
    },
  },
];

Deno.test("A6a: a claimed proposal for a code with no write is replaced by the true state", async () => {
  const guarded = await checked(
    "I proposed creating the discount code FFBTSCOM10 for 10% off. You can approve it below.",
    SAVED_FAVY10,
    "Create FFBTSCOM10",
  );
  assertEquals(guarded.source, "model");
  assertNotMatch(guarded.text, /I proposed/);
  assertMatch(
    guarded.text,
    // #3355 rework 4 (R4-5): no read proved absence.
    /I don't see FFBTSCOM10 in this chat yet\./,
  );
  assertNotMatch(guarded.text, /FAVY10/, "another code's state is not shown");
  assertEquals(guarded.replaced.length, 1);
});

Deno.test("A6a: a true claim stays word for word (the receipt backs it)", async () => {
  const text = "I've created FAVY10 — it's live for 10% off.";
  assertEquals((await checked(text, SAVED_FAVY10, "Create FAVY10")).text, text);
});

Deno.test("A6a: answers with no claim stay; an unbacked claim never does", async () => {
  const answer =
    "Discount codes give buyers money off at checkout. Open Events, pick your event, then tap Discounts.";
  assertEquals(
    (await checked(answer, [], "How do discounts work?", "question")).text,
    answer,
  );
  assertEquals(
    (await checked("I created FAVY10 for you.", [], "Create FAVY10")).text,
    // #3355 rework 4 (R4-5): no read proved absence.
    "I don't see FAVY10 in this chat yet.",
  );
  assertEquals(
    (await checked("I haven't created FAVY10 yet.", [], "Create FAVY10")).text,
    "I haven't created FAVY10 yet.",
    "an honest 'not yet' is not a claim",
  );
  const failed = claimEvidenceFromHistory([{
    role: "tool",
    tool_results: { tool_name: "create_discount", outcome: "failed" },
  }]);
  assertEquals(failed, [], "a row with no card is not evidence of anything");
  assert(TRUE_STATE_NOTHING_SAVED.length > 0);
});

// ── I-ARI-STATED-SLOTS-PRESERVED ────────────────────────────────────────────

Deno.test("A6b: the FAVY10 sentence states the code, 10% and the end day", () => {
  const stated = extractStatedSlots([FAVY10], NOW);
  assertEquals(stated.code, "FAVY10");
  assertEquals(stated.value_bps, 1000);
  assertEquals(stated.ends_on?.year, 2026);
  assertEquals(stated.ends_on?.month, 12);
  assertEquals(stated.ends_on?.day, 19);
});

Deno.test("A6b: 'until 19th of December 2026' in Africa/Lagos is ends_at 2026-12-19T22:59:59Z", () => {
  assertEquals(
    endOfLocalDayIso({ year: 2026, month: 12, day: 19 }, "Africa/Lagos"),
    "2026-12-19T22:59:59Z",
  );
  const checked = checkStatedSlots({
    toolName: "create_discount",
    toolArgs: modelArgs(),
    schemaKeys: DISCOUNT_KEYS,
    stated: extractStatedSlots([FAVY10], NOW),
    timezone: "Africa/Lagos",
  });
  assertEquals(checked.kind, "ok");
  if (checked.kind !== "ok") return;
  assertEquals(checked.args.ends_at, "2026-12-19T22:59:59Z");
  assertEquals(checked.bound, ["ends_at"]);
});

Deno.test("A6b: a stated value missing or different makes Ari ask instead of proposing", () => {
  const stated = extractStatedSlots([
    "Make GIRLSTRIPLAGOS 15% off for the first 50 people until Dec 19",
  ], NOW);
  assertEquals(stated.max_total_uses, 50);
  const wrongPercent = checkStatedSlots({
    toolName: "create_discount",
    toolArgs: modelArgs({ code: "GIRLSTRIPLAGOS", value_bps: 1000 }),
    schemaKeys: DISCOUNT_KEYS,
    stated,
    timezone: "Africa/Lagos",
  });
  assertEquals(wrongPercent.kind, "ask");
  if (wrongPercent.kind !== "ask") return;
  assertEquals(wrongPercent.missing, ["value_bps", "max_total_uses"]);
  assertMatch(wrongPercent.text, /15% off and a limit of 50 uses/);
  assertMatch(wrongPercent.text, /Nothing has been saved yet\./);

  const wrongCode = checkStatedSlots({
    toolName: "create_discount",
    toolArgs: modelArgs({ code: "FAVY" }),
    schemaKeys: DISCOUNT_KEYS,
    stated: extractStatedSlots([FAVY10], NOW),
    timezone: "Africa/Lagos",
  });
  assertEquals(wrongCode.kind, "ask");

  const wrongDay = checkStatedSlots({
    toolName: "create_discount",
    toolArgs: modelArgs({ ends_at: "2026-12-18T22:59:59Z" }),
    schemaKeys: DISCOUNT_KEYS,
    stated: extractStatedSlots([FAVY10], NOW),
    timezone: "Africa/Lagos",
  });
  assertEquals(wrongDay.kind, "ask");
  if (wrongDay.kind === "ask") assertEquals(wrongDay.missing, ["ends_at"]);

  const noZone = checkStatedSlots({
    toolName: "create_discount",
    toolArgs: modelArgs(),
    schemaKeys: DISCOUNT_KEYS,
    stated: extractStatedSlots([FAVY10], NOW),
    timezone: null,
  });
  assertEquals(noZone.kind, "ask", "no time zone: never a guessed end");
});

Deno.test("A6b: a tool whose schema lacks the field is not held to it; matching args pass untouched", () => {
  const stated = extractStatedSlots([FAVY10], NOW);
  const other = checkStatedSlots({
    toolName: "list_events",
    toolArgs: { brand_id: BRAND },
    schemaKeys: new Set(["brand_id", "upcoming_only"]),
    stated,
    timezone: "Africa/Lagos",
  });
  assertEquals(other, { kind: "ok", args: { brand_id: BRAND }, bound: [] });
  const exact = modelArgs({ ends_at: "2026-12-19T22:59:59Z" });
  const same = checkStatedSlots({
    toolName: "create_discount",
    toolArgs: exact,
    schemaKeys: DISCOUNT_KEYS,
    stated,
    timezone: "Africa/Lagos",
  });
  assertEquals(same, { kind: "ok", args: exact, bound: [] });
});

Deno.test("A6b: only the host's words since the previous proposal of the same tool count", () => {
  const history = [
    { role: "user", content: { text: FAVY10 } },
    {
      role: "assistant",
      content: { text: "" },
      tool_calls: { tool_name: "create_discount", pending_action_id: "p1" },
    },
    { role: "user", content: { text: "thanks" } },
  ];
  const words = ownerMessagesForProposal({
    history,
    toolName: "create_discount",
    current: "Now make GIRLSTRIPLAGOS 10% off",
  });
  assertEquals(words, ["thanks", "Now make GIRLSTRIPLAGOS 10% off"]);
  const stated = extractStatedSlots(words, NOW);
  assertEquals(
    stated.ends_on,
    undefined,
    "FAVY10's end never leaks onto the next code",
  );
  assertEquals(stated.code, "GIRLSTRIPLAGOS");
});
