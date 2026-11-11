// Issue #3355 Wave A (A6) — the claim and stated-slot guards (implementor
// happy path). Invariants are declared beside the guards in
// supabase/functions/_shared/ariTruthGuards.ts:
//   I-ARI-CLAIM-MATCHES-RECEIPT, I-ARI-STATED-SLOTS-PRESERVED.
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
  claimsPastWrite,
  endOfLocalDayIso,
  extractStatedSlots,
  guardWriteClaims,
  ownerMessagesForProposal,
  TRUE_STATE_NOTHING_SAVED,
} from "../ariTruthGuards.ts";

const FAVY10 =
  'Create a discount code for me using "FAVY10" as the code and 10% off this code and let it run from now until 19th of December 2026.';
const NOW = new Date("2026-11-10T09:51:52Z");
const BRAND = "22222222-2222-4222-8222-222222222222";
const DISCOUNT_KEYS = new Set([
  "brand_id", "kind", "code", "name", "value_type", "value_bps",
  "value_minor", "scope_kind", "combines_with", "starts_at", "ends_at",
  "ends_after_count", "max_total_uses", "max_uses_per_buyer",
  "min_subtotal_minor", "targets",
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

Deno.test("A6a: a claimed proposal with no proposal or receipt for it is rewritten to the true state", () => {
  const history = [
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
  const guarded = guardWriteClaims({
    text:
      "I proposed creating the discount code FFBTSCOM10 for 10% off. You can approve it below.",
    pendingThisTurn: false,
    evidence: claimEvidenceFromHistory(history),
  });
  assert(guarded.rewritten);
  assertNotMatch(guarded.text, /I proposed/);
  assertMatch(guarded.text, new RegExp(`^${TRUE_STATE_NOTHING_SAVED}`));
  assertEquals(guarded.unsupported.length, 1);
});

Deno.test("A6a: a claim backed by a receipt for what it names stands", () => {
  const evidence = claimEvidenceFromHistory([{
    role: "tool",
    tool_results: {
      tool_name: "create_discount",
      outcome: "executed",
      result: { code: "FAVY10" },
    },
  }]);
  const text = "I've created FAVY10 — it's live for 10% off.";
  const guarded = guardWriteClaims({ text, pendingThisTurn: false, evidence });
  assertEquals(guarded, { text, rewritten: false, unsupported: [] });
});

Deno.test("A6a: a pending action this turn, a negation, or no claim leave the words alone", () => {
  assert(!claimsPastWrite("I haven't created anything yet."));
  assert(!claimsPastWrite("I can create that code for you."));
  assert(claimsPastWrite("I've saved your changes."));
  const text = "I proposed the code below — approve it to save it.";
  assertEquals(
    guardWriteClaims({ text, pendingThisTurn: true, evidence: [] }).rewritten,
    false,
  );
  const failed = claimEvidenceFromHistory([{
    role: "tool",
    tool_results: { tool_name: "create_discount", outcome: "failed" },
  }]);
  assertEquals(failed, [], "a failed write is not a receipt");
  const unnamed = guardWriteClaims({
    text: "I've saved it.",
    pendingThisTurn: false,
    evidence: [],
  });
  assert(unnamed.rewritten, "nothing in the chat backs the claim");
  assertMatch(unnamed.text, /prepare it for you to approve/);
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
  assertEquals(stated.ends_on, undefined, "FAVY10's end never leaks onto the next code");
  assertEquals(stated.code, "GIRLSTRIPLAGOS");
});
