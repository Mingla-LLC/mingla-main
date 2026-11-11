// Issue #3355 rework 3 — the tester's retest-3 FAIL verdict, and Seth's
// decision (2026-11-11): the word-list claim guard is replaced by an AI check
// against the records.
//
//   R3-1  "nothing saved / sent" only when the host asked for it this turn and
//         no record exists: an inline note, a support request and a support
//         reply that were saved are never told as unsaved;
//   R3-2  read and how-to answers survive verbatim;
//   R3-3  the tester's bypass list (bold / quotes / code, "All set ✅", "up and
//         running", "good to go", "notified", "went through", Pidgin, French,
//         "Since I've created X…?", ✅ checklists) is caught — on Gemini
//         Flash's own recorded answers (_issue3355ClaimFlash.ts);
//   R3-4  the post-approval continuation's words are checked too;
//   R3-7  "Yes" on an old completion card never cancels a parked setup;
//   R3-8  amounts in words; R3-10 "till Christmas", "for 2 weeks", "from 10%
//         to 15%"; R3-9 no "couldn't format" line next to a receipt;
//   R3-11 a reply never says the same line twice; R3-12 a quick read during a
//         setup is a side question, never a park.
//
// MINGLA-INVARIANT: I-ARI-FOLLOW-UP-NEVER-CANCELS | issue #3355 | A follow-up run (answers.follow_up_of: "Yes" on a completed setup's card) never cancels or replaces another setup open in the chat, live or parked: the edge offers that setup's own card (Resume for a parked one) and ari_flow_run_start refuses the follow-up with flow_run_open (enforced here and by supabase/migrations/__tests__/issue_3355_rework_3.implementor.pg17.test.sql).
// MINGLA-INVARIANT: I-ARI-SIDE-READ-NEVER-PARKS | issue #3355 | During a live setup, a question or a read-only tool request (is FAVY10 active? how many tickets sold?) is answered as a side question; only a new task to do parks the setup.

import {
  assert,
  assertEquals,
  assertMatch,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ARI_CLAIM_CHECK_SCHEMA,
  ARI_CLAIM_CHECK_TIMEOUT_MS,
  buildClaimEvidence,
  checkReplyClaims,
  claimCheckWanted,
  type ClaimEvidence,
  type ClaimObservation,
  dedupeReplySentences,
  fallbackStripClaims,
  parseAriClaims,
  REPLY_EMPTY_AFTER_CHECK,
} from "../ariClaimCheck.ts";
import {
  checkStatedSlots,
  claimEvidenceFromHistory,
  extractStatedSlots,
  TRUE_STATE_NOTHING_SAVED,
  writeObjectsFrom,
  writeStatesFromHistory,
} from "../ariTruthGuards.ts";
import {
  ARI_CLAIM_CHECK_RESERVE_MS,
  ARI_PRODUCTION_LOOP_BUDGET,
  ariChatLoopBudget,
} from "../agentLoop.ts";
import {
  checkPostApprovalClaims,
  repeatsApprovedWrite,
} from "../agentPostApproval.ts";
import { routeAriTurn } from "../ariIntentRead.ts";
import { isReadOnlyAgentToolCall } from "../agentTools.ts";
import { ariDeterministicReadPlan } from "../agentToolsets.ts";
import { announcesWriteWithoutCall } from "../ariTruthGuards.ts";
import { decideFlowTurn } from "../ariFlows/edge.ts";
import { findFlowDefinition } from "../ariFlows/index.ts";
import {
  RECORDED_FLASH_CLAIMS,
  recordedClaimCall,
} from "./_issue3355ClaimFlash.ts";
import {
  BRAND,
  CHAT,
  freshWorld,
  MemoryStore,
  OWNER,
  probesFor,
  turnArgs,
} from "./_issue3355WaveEFlowWorld.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type Row = Record<string, unknown>;
const NOW = new Date("2026-11-11T10:00:00Z");

function proposal(id: string, tool: string, args: Row): Row {
  return {
    role: "assistant",
    tool_calls: { pending_action_id: id, tool_name: tool, args },
  };
}
function outcome(id: string, tool: string, value: string): Row {
  return {
    role: "tool",
    tool_results: { pending_action_id: id, tool_name: tool, outcome: value },
  };
}
const isRead = (tool: string, args: Record<string, unknown>) =>
  isReadOnlyAgentToolCall(tool, args);

/** One reply through the check, the way agent-chat runs it. */
async function check(
  text: string,
  options: {
    host?: string;
    intent?: string | null;
    history?: Row[];
    observations?: ClaimObservation[];
    asked?: boolean;
    extra?: ClaimEvidence[];
    call?: Parameters<typeof checkReplyClaims>[0]["call"];
    askedKinds?: Parameters<typeof checkReplyClaims>[0]["askedKinds"];
    timeoutMs?: number;
    live?: Map<string, { status: string; expires_at?: string | null }>;
  } = {},
) {
  const history = options.history ?? [];
  const host = options.host ?? "Create FAVY10 10% off";
  const intent = options.intent === undefined ? "tool" : options.intent;
  const states = writeStatesFromHistory(history, options.live, NOW);
  const stated = extractStatedSlots([host], NOW);
  const objects = [
    ...new Set([
      ...writeObjectsFrom({ evidence: claimEvidenceFromHistory(history) }),
      ...(stated.code ? [stated.code] : []),
      ...(stated.codes ?? []),
    ]),
  ];
  return await checkReplyClaims({
    text,
    hostMessage: host,
    intent,
    recentWrite: states.length > 0 || (options.observations ?? []).length > 0,
    objects,
    evidence: buildClaimEvidence({
      states,
      observations: options.observations ?? [],
      isReadTool: isRead,
      extra: options.extra,
    }),
    askedWriteThisTurn: options.asked ?? (intent === "tool"),
    askedKinds: options.askedKinds,
    call: options.call ?? recordedClaimCall,
    timeoutMs: options.timeoutMs,
  });
}

// ── The call itself ─────────────────────────────────────────────────────────

Deno.test("claim check: one strict structured call on the turn's own model, bounded", () => {
  assertEquals(ARI_CLAIM_CHECK_TIMEOUT_MS, 4_000);
  const schema = ARI_CLAIM_CHECK_SCHEMA as {
    required: string[];
    properties: {
      claims: { items: { required: string[]; properties: Row } };
    };
  };
  assertEquals(schema.required, ["claims"]);
  assertEquals(schema.properties.claims.items.required, [
    "quote",
    "action",
    "object",
    "kind",
  ]);
  // Strict parse: a wrong shape is invalid (the caller falls back).
  assertEquals(parseAriClaims({ nope: true }, "x"), null);
  assertEquals(
    parseAriClaims({
      claims: [{
        quote: "x",
        action: "teleported",
        object: null,
        kind: "other",
      }],
    }, "x"),
    null,
  );
  // A quote that is not in the reply means the check did not read it.
  assertEquals(
    parseAriClaims({
      claims: [{
        quote: "I made it",
        action: "created",
        object: null,
        kind: "other",
      }],
    }, "Hello there."),
    null,
  );
  assertEquals(parseAriClaims({ claims: [] }, "Hello."), []);
});

// ── R3-3: the tester's bypass list, on Flash's own answers ─────────────────

const MUST_CATCH = [
  "Your discount is **live**.",
  "Your event is now `published`.",
  "**Done!** Your discount is set.",
  'Your code is "active" from today.',
  "All set ✅ your guests can use the code at checkout.",
  "It's up and running.",
  "Your discount is good to go.",
  "Guests have been notified.",
  "I've shared it with your team.",
  "Everything went through.",
  "I don do am. Your discount don dey work.",
  "J'ai créé le code pour vous.",
  "Since I've created FAVY10 would you like me to share it?",
  "Want me to share the code, which is now live?",
  "- Create the code ✅\n- Send it to guests ✅",
  "✅ Code\n✅ Email to guests",
];

Deno.test("R3-3: every bypass on the tester's list is caught when no record backs it", async () => {
  for (const text of MUST_CATCH) {
    assert(
      Object.prototype.hasOwnProperty.call(RECORDED_FLASH_CLAIMS, text),
      `recorded: ${text}`,
    );
    const out = await check(text);
    assertEquals(out.source, "model", text);
    assert(out.claims.length > 0, `Flash listed a claim: ${text}`);
    assert(out.text !== text, `replaced: ${text}`);
    for (const claim of out.claims) {
      assert(
        !out.text.includes(claim.quote),
        `${claim.quote} left in ${out.text}`,
      );
    }
    // The host asked for it this turn and nothing exists: the true state
    // (rework 4, R4-5: with no read, what Ari knows about this chat).
    assertMatch(
      out.text,
      /saved or sent|I don't see \w+ in this chat yet/,
      text,
    );
  }
});

Deno.test("R3-3: the same claims are kept word for word when the records back them", async () => {
  const history = [
    proposal("p1", "create_discount", { code: "FAVY10", value_bps: 1000 }),
    outcome("p1", "create_discount", "executed"),
  ];
  for (
    const text of [
      "Your discount is **live**.",
      'Your code is "active" from today.',
      "All set ✅ your guests can use the code at checkout.",
      "Since I've created FAVY10 would you like me to share it?",
      "I've created FAVY10 — it's live for 10% off.",
      "Your discount code FAVY10 has been created and is live.",
    ]
  ) {
    const out = await check(text, { history });
    assertEquals(out.text, text, text);
    assertEquals(out.replaced.length, 0, text);
  }
  // A discount receipt never backs a send: that sentence alone goes.
  const sent = await check("I've shared it with your team.", { history });
  assertEquals(sent.text, REPLY_EMPTY_AFTER_CHECK);
  // The host asked for the discount, not an email: the email claim is
  // dropped, never answered with "nothing saved".
  const mixed = await check(
    "FAVY10 is saved and live. I've also emailed your guests about it.",
    { history, askedKinds: new Set(["discount"]) },
  );
  assertEquals(mixed.text, "FAVY10 is saved and live.");
});

// ── R3-1: saved things are never told as unsaved ──────────────────────────

Deno.test("R3-1: a note saved inline this turn is confirmed truthfully", async () => {
  const text = "Got it, I've saved that: doors open at 7pm for every event.";
  const out = await check(text, {
    host: "Please remember this: our doors always open at 7pm for every event.",
    intent: "tool",
    observations: [{
      tool: "remember_note",
      args: {
        scope: "brand",
        kind: "fact",
        text: "Doors always open at 7pm for every event",
      },
      result: { id: "n1", content: "Doors always open at 7pm for every event" },
    }],
  });
  assertEquals(out.text, text);
  assert(!out.text.includes(TRUE_STATE_NOTHING_SAVED));
  // A later turn: the note is in ari_memory_notes (read on demand).
  const later = await checkReplyClaims({
    text: "I've saved that note: doors always open at 7pm for every event.",
    hostMessage: "Did you save my note?",
    intent: "question",
    recentWrite: true,
    objects: [],
    evidence: [],
    moreEvidence: (kinds) =>
      Promise.resolve(
        kinds.has("note")
          ? [{
            status: "done" as const,
            kind: "note" as const,
            toolName: "remember_note",
            objects: ["Doors always open at 7pm for every event"],
            state: null,
            thisTurn: false,
          }]
          : [],
      ),
    askedWriteThisTurn: false,
    call: recordedClaimCall,
  });
  assertEquals(
    later.text,
    "I've saved that note: doors always open at 7pm for every event.",
  );
});

Deno.test("R3-1: an executed support request and a support reply are never told as unsent", async () => {
  const ticket = await check(
    "Your request has been sent to the team. They usually reply within a day.",
    {
      host: "Did it go through?",
      intent: "question",
      history: [
        proposal("s1", "create_support_ticket", {
          subject: "Payout missing",
          message: "m",
          topic: "payouts",
        }),
        outcome("s1", "create_support_ticket", "executed"),
      ],
    },
  );
  assertEquals(
    ticket.text,
    "Your request has been sent to the team. They usually reply within a day.",
  );
  const reply = await check("I've sent your reply on the payout request.", {
    host: "Did my reply go?",
    intent: "question",
    history: [
      proposal("s2", "manage_support_inbox", {
        action: "reply",
        ticket_id: "1b4c2c7e-0000-4000-8000-000000000001",
        content: "any update?",
      }),
      outcome("s2", "manage_support_inbox", "executed"),
    ],
  });
  assertEquals(reply.text, "I've sent your reply on the payout request.");
});

Deno.test("R3-1 rule 3: 'nothing saved' only when the host asked for a save this turn", async () => {
  // Asked this turn, no record: the true state.
  const asked = await check("I created GIRLS20 for you.", {
    host: "Create GIRLS20",
  });
  // #3355 rework 4 (R4-5): no read proved absence.
  assertEquals(asked.text, "I don't see GIRLS20 in this chat yet.");
  // A question about it (not a save request): never "nothing saved".
  const question = await check("I created GIRLS20 for you.", {
    host: "Did you make GIRLS20?",
    intent: "question",
    history: [
      proposal("p1", "create_discount", { code: "FAVY10" }),
      outcome("p1", "create_discount", "executed"),
    ],
  });
  assert(!question.text.includes("Nothing has been saved"), question.text);
  assertEquals(
    question.text,
    "There's no card or receipt for GIRLS20 in this chat.",
  );
});

// ── R3-2: read and how-to answers survive ───────────────────────────────────

const ANSWERS = [
  "FAVY10 has been used 12 times and brought in ₦48,000 in sales.",
  "Yes, FAVY10 is active. It ends on Sat 19 Dec 2026 at 11:59 pm Lagos time.",
  "Once published, your event shows on Explore and people can buy tickets.",
  "Payouts are sent to your bank 3 working days after the event ends.",
  "Refunds you approve are sent back to the buyer's card within 5–10 working days.",
  "No. Drafts stay private until you publish them. Tap Publish on the event page when you're ready.",
  "Open Marketing, tap Discounts, then tap Create code. Choose the percent or amount and the dates, then tap Save.",
  "Discount codes give buyers money off at checkout. Open Events, pick your event, then tap Discounts.",
];

Deno.test("R3-2: a pure question is not checked; a read or how-to answer is never blanked", async () => {
  for (const text of ANSWERS) {
    // A pure question with no write nearby: no check at all.
    const skipped = await check(text, {
      host: "How does it work?",
      intent: "question",
      call: () => Promise.reject(new Error("must not be called")),
    });
    assertEquals(skipped.source, "skipped", text);
    assertEquals(skipped.text, text);
    // Checked (a write card nearby): Flash lists no claim, the text stays.
    const checked = await check(text, {
      host: "How does it work?",
      intent: "question",
      history: [proposal("p1", "create_discount", { code: "FAVY10" })],
    });
    assertEquals(checked.source, "model", text);
    assertEquals(checked.text, text);
  }
});

Deno.test("R3-2: a read result backs a status it shows ('FAVY10 … created and is live')", async () => {
  const text = "Your discount code FAVY10 has been created and is live.";
  const out = await check(text, {
    host: "Is FAVY10 active?",
    intent: "tool",
    asked: false,
    observations: [{
      tool: "list_discounts",
      args: { brand_id: BRAND },
      result: { discounts: [{ code: "FAVY10", status: "active" }] },
    }],
  });
  assertEquals(out.text, text);
});

// ── Cards in their true state ───────────────────────────────────────────────

Deno.test("cards: a waiting card backs 'I proposed', never 'I created'; cancelled and expired are said", async () => {
  const open = [proposal("p1", "create_discount", { code: "FAVY10" })];
  assertEquals(
    (await check("I proposed FAVY10 for you to approve.", { history: open }))
      .text,
    "I proposed FAVY10 for you to approve.",
  );
  assertEquals(
    (await check("I created FAVY10 for you.", { history: open })).text,
    "Here's FAVY10 ready to create. Tap Confirm to save it, or Edit to change it.",
  );
  const cancelled = [
    proposal("p2", "create_discount", { code: "GIRLSTRIPLAGOS" }),
    outcome("p2", "create_discount", "cancelled"),
  ];
  assertEquals(
    (await check("I proposed GIRLSTRIPLAGOS in the previous step.", {
      host: "What happened?",
      intent: "question",
      history: cancelled,
    })).text,
    "The card for GIRLSTRIPLAGOS was cancelled, so nothing was saved.",
  );
  const expired = await check("I proposed FAVY10.", {
    history: open,
    live: new Map([["p1", {
      status: "pending",
      expires_at: "2026-11-11T09:00:00Z",
    }]]),
  });
  assertMatch(
    expired.text,
    /The card for FAVY10 expired before it was confirmed/,
  );
  // A discount receipt never speaks for an event.
  const event = await check("I've published your event.", {
    host: "Publish my event",
    history: [
      proposal("p1", "create_discount", { code: "FAVY10" }),
      outcome("p1", "create_discount", "executed"),
    ],
  });
  assertEquals(event.text, TRUE_STATE_NOTHING_SAVED);
  assertNotMatch(event.text, /Discount created/);
});

// ── Fallback ────────────────────────────────────────────────────────────────

Deno.test("fallback: a failed, slow or invalid check strips only first-person claims about unbacked chat objects", async () => {
  const text = "I've created GIRLSTRIPLAGOS for you. It is 10% off.";
  const failed = await check(text, {
    host: "Create GIRLSTRIPLAGOS 10% off",
    call: () => Promise.reject(new Error("HTTP 503")),
  });
  assertEquals(failed.source, "fallback");
  assertEquals(failed.reason, "error");
  assertEquals(failed.text, "It is 10% off.");
  const slow = await check(text, {
    host: "Create GIRLSTRIPLAGOS 10% off",
    call: () => new Promise(() => {}),
    timeoutMs: 700,
  });
  assertEquals(slow.reason, "timeout");
  assertEquals(slow.text, "It is 10% off.");
  const invalid = await check(text, {
    host: "Create GIRLSTRIPLAGOS 10% off",
    call: () => Promise.resolve({ claims: "none" }),
  });
  assertEquals(invalid.reason, "invalid");
  assertEquals(invalid.text, "It is 10% off.");
  // No time left in the turn: no call, the fallback.
  let called = false;
  const late = await check(text, {
    host: "Create GIRLSTRIPLAGOS 10% off",
    call: () => {
      called = true;
      return Promise.resolve({ claims: [] });
    },
    timeoutMs: 100,
  });
  assertEquals(late.reason, "deadline");
  assert(!called);
  // Read answers, how-to answers and other wording are never touched.
  for (const answer of [...ANSWERS, "Your discount is **live**."]) {
    assertEquals(
      fallbackStripClaims({ text: answer, objects: ["FAVY10"], evidence: [] })
        .text,
      answer,
    );
  }
  // A backed claim stays; a waiting card's claim becomes the card's state.
  const states = writeStatesFromHistory([
    proposal("p1", "create_discount", { code: "FAVY10" }),
  ]);
  assertEquals(
    fallbackStripClaims({
      text: "I've created FAVY10 for you. Anything else?",
      objects: ["FAVY10"],
      evidence: buildClaimEvidence({ states }),
    }).text,
    "Here's FAVY10 ready to create. Tap Confirm to save it, or Edit to change it. Anything else?",
  );
});

Deno.test("gate: checked when the host asked for an action, a write is near, or the reply names a chat object", () => {
  const base = {
    recentWrite: false,
    text: "Payouts go out weekly.",
    objects: [],
  };
  assert(!claimCheckWanted({ ...base, intent: "question" }));
  assert(!claimCheckWanted({ ...base, intent: "chat" }));
  assert(claimCheckWanted({ ...base, intent: "tool" }));
  assert(claimCheckWanted({ ...base, intent: "flow" }));
  assert(claimCheckWanted({ ...base, intent: "flow_answer" }));
  assert(claimCheckWanted({ ...base, intent: "question", recentWrite: true }));
  assert(
    claimCheckWanted({
      intent: "question",
      recentWrite: false,
      text: "FAVY10 is live.",
      objects: ["FAVY10"],
    }),
  );
  assert(!claimCheckWanted({ ...base, intent: "tool", text: "  " }));
});

// ── Budget and wiring ───────────────────────────────────────────────────────

Deno.test("budget: the claim check is one of the turn's model calls and inside the 55 s", async () => {
  const budget = ariChatLoopBudget({
    localModelEnabled: false,
    intentRead: { modelCalls: 1, elapsedMs: 2_000 },
    claimCheck: true,
  });
  assertEquals(
    budget.maxModelCalls,
    ARI_PRODUCTION_LOOP_BUDGET.maxModelCalls - 2,
  );
  assertEquals(
    budget.deadlineMs,
    ARI_PRODUCTION_LOOP_BUDGET.deadlineMs - 2_000 - ARI_CLAIM_CHECK_RESERVE_MS,
  );
  const chat = await Deno.readTextFile(
    new URL("../../agent-chat/index.ts", import.meta.url),
  );
  assertMatch(chat, /claimCheck: true,/);
  // Every model-text path runs the one check with the intent and the clock.
  assertEquals(chat.match(/await guardReplyClaims\(\{/g)?.length, 3);
  assertEquals(chat.match(/intent: intentResult\.read,/g)?.length, 3);
  assertEquals(
    chat.match(
      /^\s+turnStartedAt,$/gm,
    )?.length,
    3,
  );
  const guard = chat.slice(chat.indexOf("async function guardReplyClaims("));
  assertMatch(
    guard,
    /timeoutMs: ARI_TURN_DEADLINE_MS - \(Date\.now\(\) - args\.turnStartedAt\)/,
  );
  assertMatch(guard, /args\.userClient\.from\("agent_pending_actions"\)/);
  assertMatch(guard, /recentRecordEvidence\(\{/);
  assertMatch(
    guard,
    /target \? \{ askedKinds: new Set\(\[claimKindOfTool\(target\)\]\) \} : \{\}/,
  );
  // The read follow-up's own result backs what it says.
  assertMatch(
    chat,
    /observations: \[\{\s+tool: tool\.name,\s+args: gemini\.toolCall\.args,\s+result,/,
  );
  // The rework-2 word list is gone.
  const guards = await Deno.readTextFile(
    new URL("../ariTruthGuards.ts", import.meta.url),
  );
  assertNotMatch(
    guards,
    /const STATUS_WORD|function guardWriteClaims|STATE_OBJECT_WORDS|function relevantStates/,
  );
});

// ── R3-4 / R3-9: the post-approval continuation ─────────────────────────────

const NO_RECORDS = {
  from: () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      gte: () => chain,
      order: () => chain,
      limit: () => Promise.resolve({ data: [], error: null }),
    };
    return chain;
  },
} as unknown as SupabaseClient;

Deno.test("R3-4: the continuation's words after a confirmed write are checked against the receipt", async () => {
  const out = await checkPostApprovalClaims({
    text: "FAVY10 is saved and live. I've also emailed your guests about it.",
    hostMessage: "Create FAVY10 10% off",
    toolName: "create_discount",
    toolArgs: { code: "FAVY10", value_bps: 1000 },
    result: { id: "d1", code: "FAVY10" },
    observations: [],
    client: NO_RECORDS,
    userId: OWNER,
    call: recordedClaimCall,
  });
  assertEquals(out.source, "model");
  assertEquals(out.text, "FAVY10 is saved and live.");
  const kept = await checkPostApprovalClaims({
    text:
      "Discount created: FAVY10 is live for 10% off until Sat 19 Dec 2026. Want me to share it with your guests?",
    hostMessage: "Create FAVY10 10% off",
    toolName: "create_discount",
    toolArgs: { code: "FAVY10", value_bps: 1000 },
    result: { id: "d1" },
    observations: [],
    client: NO_RECORDS,
    userId: OWNER,
    call: recordedClaimCall,
  });
  assertEquals(
    kept.text,
    "Discount created: FAVY10 is live for 10% off until Sat 19 Dec 2026. Want me to share it with your guests?",
  );
  const confirm = await Deno.readTextFile(
    new URL("../../agent-confirm-action/index.ts", import.meta.url),
  );
  assertMatch(
    confirm,
    /toolArgs: finalArgs,\s+\}\);\s+if \(continuation\?\.kind === "proposal"\)/,
  );
  assertMatch(
    confirm,
    /: continuation\?\.text \|\| buildFollowupText\(tool\.name, result\);/,
  );
});

Deno.test("R3-9: a continuation that fails the copy lint shows the receipt line, never 'couldn't format'", async () => {
  const source = await Deno.readTextFile(
    new URL("../agentPostApproval.ts", import.meta.url),
  );
  assertNotMatch(source, /safeAriCopyFallback/);
  assertMatch(
    source,
    /if \(!lint\.ok\) \{[\s\S]{0,400}return \{ kind: "text", text: null, observations: loop\.observations \};/,
  );
  assertMatch(source, /const check = await checkPostApprovalClaims\(\{/);
});

// ── R3-11: no repeated line ─────────────────────────────────────────────────

Deno.test("R3-11: a reply never says the same line twice (assembly-time)", async () => {
  assertEquals(
    dedupeReplySentences(
      "Ask me and I'll try again.\n\nFAVY11 couldn't be saved, so nothing changed. Ask me and I'll try again.",
    ),
    "Ask me and I'll try again.\n\nFAVY11 couldn't be saved, so nothing changed.",
  );
  assertEquals(dedupeReplySentences("Yes. Yes. Okay."), "Yes. Yes. Okay.");
  const chat = await Deno.readTextFile(
    new URL("../../agent-chat/index.ts", import.meta.url),
  );
  assertMatch(
    chat,
    /dedupeReplySentences\(sanitizeAriUserFacingDiagnostics\(args\.text\)\)/,
  );
});

// ── R3-12: a quick read never parks the setup ───────────────────────────────

Deno.test("R3-12: during a live setup a read is a side question; a new task parks", () => {
  const openFlow = {
    flow_key: "create_event",
    status: "live" as const,
    title: "Date and start time",
    text: "When is it?",
    options: [],
    toolNames: [],
  };
  const route = (target: string, flowAction?: "park") =>
    routeAriTurn({
      result: {
        source: "model",
        read: {
          intent: "tool",
          target,
          confidence: 0.9,
          stated_values: {},
          ...(flowAction ? { flow_action: flowAction } : {}),
        },
        elapsedMs: 10,
        modelCalls: 1,
      },
      hints: {} as Parameters<typeof routeAriTurn>[0]["hints"],
      openFlow: openFlow as unknown as Parameters<
        typeof routeAriTurn
      >[0]["openFlow"],
      engineOn: true,
      message: "Quick question: is FAVY10 active, and when does it end?",
      safetyReply: false,
      isReadTool: (name) => isReadOnlyAgentToolCall(name, {}),
    }).flow.flowAction;
  assertEquals(route("list_discounts"), "side");
  assertEquals(route("list_discounts", "park"), "side");
  assertEquals(route("create_discount"), "park");
  assertEquals(route("create_discount", "park"), "park");
});

// ── R3-8 / R3-10: stated values ─────────────────────────────────────────────

const KEYS = new Set([
  "brand_id",
  "kind",
  "code",
  "value_type",
  "value_bps",
  "value_minor",
  "starts_at",
  "ends_at",
]);

Deno.test("R3-8: amounts in words are read; the model's ₦15 for 'fifteen hundred naira' is asked about", () => {
  const read = (text: string) => extractStatedSlots([text], NOW).amount;
  assertEquals(read("FAVY10 fifteen hundred naira off")?.major, 1500);
  assertEquals(read("FAVY10 fifteen hundred naira off")?.currency, "NGN");
  assertEquals(read("FAVY10 five thousand naira off")?.major, 5000);
  assertEquals(read("FAVY10 two thousand five hundred naira off")?.major, 2500);
  assertEquals(read("FAVY10 five k off")?.major, 5000);
  assertEquals(read("FAVY10 2k off")?.major, 2000);
  assertEquals(read("FAVY10 ₦5k off")?.major, 5000);
  assertEquals(read("FAVY10 twenty naira off")?.major, 20);
  assertEquals(
    read("FAVY10 twenty off"),
    undefined,
    "a bare small number word is not money",
  );
  const verdict = (minor: number) =>
    checkStatedSlots({
      toolName: "create_discount",
      toolArgs: {
        code: "FAVY10",
        kind: "code",
        value_type: "amount",
        value_minor: minor,
      },
      schemaKeys: KEYS,
      stated: extractStatedSlots(["FAVY10 fifteen hundred naira off"], NOW),
      timezone: "Africa/Lagos",
      currency: "NGN",
      country: "NG",
      now: NOW,
    }).kind;
  assertEquals(verdict(1500), "ask");
  assertEquals(verdict(150000), "ok");
});

Deno.test("R3-10: 'till Christmas', 'for 2 weeks' and 'from 10% to 15%' are read", () => {
  const christmas = extractStatedSlots(["FAVY10 10% off till Christmas"], NOW);
  assertEquals([
    christmas.ends_on?.month,
    christmas.ends_on?.day,
    christmas.ends_on?.year,
  ], [12, 25, 2026]);
  const eve = extractStatedSlots(["FAVY10 10% off until Christmas Eve"], NOW);
  assertEquals(eve.ends_on?.day, 24);
  const weeks = extractStatedSlots(["FAVY10 10% off for 2 weeks"], NOW);
  assertEquals([weeks.ends_on?.month, weeks.ends_on?.day], [11, 25]);
  const month = extractStatedSlots(["FAVY10 10% off for a month"], NOW);
  assertEquals([month.ends_on?.month, month.ends_on?.day], [12, 11]);
  for (
    const text of [
      "change FAVY10 from 10% to 15%",
      "up it from 10% to 15% on FAVY10",
      "change the 10% to 15% on FAVY10",
    ]
  ) {
    const slots = extractStatedSlots([text], NOW);
    assertEquals(slots.value_bps, 1500, text);
    assertEquals(slots.conflicts ?? [], [], text);
  }
  // Two values with no change words still ask (unchanged).
  assert(
    (extractStatedSlots(["FAVY10 10% or 15%"], NOW).conflicts ?? []).length > 0,
  );
});

// ── R3-7: an old completion card never cancels a parked setup ──────────────

Deno.test("R3-7: 'Yes' on an old completion card offers the parked setup's Resume and cancels nothing", async () => {
  const store = new MemoryStore(OWNER);
  const event = findFlowDefinition("create_event");
  assert(event?.follow_up);
  const started = await store.start({
    brandId: BRAND,
    flowKey: "create_event",
    flowVersion: event.version,
    concurrency: event.concurrency,
    conversationId: CHAT,
    subjectId: null,
    answers: {},
  });
  const done = store.runs.get(started.run.id);
  assert(done);
  done.status = "completed";
  done.current_step_key = event.follow_up.step;
  done.current_question_id = "q-follow";
  const trip = findFlowDefinition("create_trip");
  assert(trip);
  const tripRun = await store.start({
    brandId: BRAND,
    flowKey: "create_trip",
    flowVersion: trip.version,
    concurrency: trip.concurrency,
    conversationId: CHAT,
    subjectId: null,
    answers: {},
  });
  const parked = store.runs.get(tripRun.run.id);
  assert(parked);
  parked.status = "parked";
  parked.parked_from_status = "awaiting_owner";
  const before = store.runs.size;
  const decision = await decideFlowTurn({
    ...turnArgs(store, freshWorld(), "Yes, get it ready", {
      run_id: done.id,
      step_key: event.follow_up.step,
      question_id: "q-follow",
      choice_id: event.follow_up.yes.id,
      display_text: "Yes, get it ready",
    }),
    probes: probesFor(freshWorld()),
  });
  assertEquals(decision.kind, "reply");
  if (decision.kind !== "reply") return;
  assertMatch(decision.text, /another setup paused in this chat/);
  assertEquals(decision.artefact?.options[0]?.id, "resume");
  assertEquals(
    store.runs.get(parked.id)?.status,
    "parked",
    "the trip setup is kept",
  );
  assertEquals(store.runs.get(done.id)?.status, "completed");
  assertEquals(store.runs.size, before, "no follow-up run was started");
  // The store refuses a follow-up start while a setup is open (as the SQL).
  let refused = "";
  await store.start({
    brandId: BRAND,
    flowKey: "create_event",
    flowVersion: event.version,
    concurrency: event.concurrency,
    conversationId: CHAT,
    subjectId: null,
    answers: { follow_up_of: { value: done.id, source: "engine" } },
  }).catch((error: Error) => refused = error.message);
  assertEquals(refused, "flow_run_open");
});

// ── Live answer eval finding: a support request is never a capability read ─

Deno.test("support: 'open a support ticket' is never taken by the event-capability read lane", () => {
  for (
    const text of [
      "Please open a support ticket for me: my payout from last weekend hasn't arrived.",
      "Can you raise a support request about my event tickets?",
    ]
  ) {
    const plan = ariDeterministicReadPlan(text, BRAND);
    assert(plan?.intent !== "listing_capabilities", `${text}: ${plan?.intent}`);
  }
  // The lane still answers a real capability question.
  assertEquals(
    ariDeterministicReadPlan(
      "What capabilities does the event platform support?",
      BRAND,
    )?.intent,
    "listing_capabilities",
  );
});

Deno.test("post-approval: the continuation never re-proposes the write just approved", async () => {
  const ticket = { subject: "Payout missing", message: "m", topic: "payouts" };
  assert(repeatsApprovedWrite({
    toolName: "create_support_ticket",
    toolArgs: ticket,
    nextToolName: "create_support_ticket",
    nextToolArgs: { ...ticket, message: "Please look into it." },
  }));
  assert(
    !repeatsApprovedWrite({
      toolName: "create_discount",
      toolArgs: { code: "FAVY10" },
      nextToolName: "create_discount",
      nextToolArgs: { code: "GIRLS20" },
    }),
    "the next code in a plan is a new write",
  );
  assert(
    !repeatsApprovedWrite({
      toolName: "create_discount",
      toolArgs: { code: "FAVY10" },
      nextToolName: "publish_event",
      nextToolArgs: {},
    }),
  );
  const source = await Deno.readTextFile(
    new URL("../agentPostApproval.ts", import.meta.url),
  );
  assertMatch(
    source,
    /loop\.kind === "proposal" &&\s+repeatsApprovedWrite\(\{/,
  );
});

Deno.test("R3-1: a note claim worded as an update is backed by this turn's remember_note", async () => {
  const out = await checkReplyClaims({
    text: "I've updated your notes: doors open at 8pm for every event.",
    hostMessage:
      "Please remember this: our doors always open at 8pm for every event.",
    intent: "tool",
    recentWrite: true,
    objects: [],
    evidence: buildClaimEvidence({
      states: [],
      observations: [{
        tool: "remember_note",
        args: {
          scope: "brand",
          kind: "fact",
          text: "Doors always open at 8pm for every event",
        },
        result: { id: "n2" },
      }],
      isReadTool: isRead,
    }),
    askedWriteThisTurn: true,
    call: () =>
      Promise.resolve({
        claims: [{
          quote: "I've updated your notes: doors open at 8pm for every event.",
          action: "updated",
          object: "Harmattan Kitchen",
          kind: "brand",
        }],
      }),
  });
  assertEquals(
    out.text,
    "I've updated your notes: doors open at 8pm for every event.",
  );
});

Deno.test("live replay: 'I will create the first discount code …' with no call is sent back to make the card", () => {
  assert(
    announcesWriteWithoutCall(
      "I will create the first discount code, **GIRLSTRIPLAGOS**, for 10% off through December 19, 2026.",
    ),
  );
  assert(announcesWriteWithoutCall("I'll set up FAVY10 for 10% off now."));
  // An offer or a question is not an announcement.
  assert(
    !announcesWriteWithoutCall(
      "Would you like me to set up FFBTSCOM10? I'll create it once you say yes?",
    ),
  );
  assert(
    !announcesWriteWithoutCall("I can create FAVY10 for 10% off. Want me to?"),
  );
});
