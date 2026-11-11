// #3355 tester retest 3 — repro for the claim-guard defects (failed 0/7 at
// 1defb54460). Folded in by rework 3 (implementor), adapted to the claim
// check that replaced the word-list guard (Seth, 2026-11-11):
//   - `guard()` now runs `checkReplyClaims` the way agent-chat does, with
//     Gemini Flash's own recorded answers (_issue3355ClaimFlash.ts) as the
//     model;
//   - each case passes the turn's intent. R3-G1's owner words were "help"; a
//     pure question is not checked by design (Seth's gate: only turns where
//     the host asked for an action, a write is near, or the reply names a
//     chat object), so R3-G1 runs as the host asking for the code
//     ("Create FAVY10 10% off", intent tool). The expectations are unchanged.
// Original: ~/.mingla-private/3355/tester/retest3/issue_3355_retest3_defects.tester.repro.test.ts
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildClaimEvidence,
  checkReplyClaims,
  type ClaimObservation,
} from "../ariClaimCheck.ts";
import {
  claimEvidenceFromHistory,
  extractStatedSlots,
  TRUE_STATE_NOTHING_SAVED,
  writeObjectsFrom,
  writeStatesFromHistory,
} from "../ariTruthGuards.ts";
import { isReadOnlyAgentToolCall } from "../agentTools.ts";
import { recordedClaimCall } from "./_issue3355ClaimFlash.ts";

type Row = Record<string, unknown>;

async function guard(
  owner: string[],
  text: string,
  history: Row[] = [],
  intent = "tool",
  observations: ClaimObservation[] = [],
) {
  const stated = extractStatedSlots(owner);
  const objects = [
    ...(stated.code ? [stated.code] : []),
    ...(stated.codes ?? []),
    ...Object.keys(stated.per_code ?? {}),
    ...writeObjectsFrom({ evidence: claimEvidenceFromHistory(history) }),
  ];
  const states = writeStatesFromHistory(history, new Map());
  const out = await checkReplyClaims({
    text,
    hostMessage: owner[owner.length - 1] ?? "",
    intent,
    recentWrite: states.length > 0 || observations.length > 0,
    objects,
    evidence: buildClaimEvidence({
      states,
      observations,
      isReadTool: (tool, args) => isReadOnlyAgentToolCall(tool, args),
    }),
    askedWriteThisTurn: intent === "tool",
    call: recordedClaimCall,
  });
  return { ...out, rewritten: out.text !== text };
}
const executed = (tool: string, args: Record<string, unknown>): Row[] => [
  {
    role: "assistant",
    content: { text: "" },
    tool_calls: { pending_action_id: "pa-1", tool_name: tool, args },
  },
  {
    role: "tool",
    tool_results: {
      pending_action_id: "pa-1",
      tool_name: tool,
      outcome: "executed",
    },
  },
];

Deno.test("R3-G1 a status claim in bold, quotes or code is removed (no evidence)", async () => {
  for (
    const t of [
      "Your discount is **live**.",
      "Your event is now `published`.",
      "**Done!** Your discount is set.",
      'Your code is "active" from today.',
    ]
  ) {
    assert((await guard(["Create FAVY10 10% off"], t)).rewritten, t);
  }
});
Deno.test("R3-G1 outcome synonyms are removed (no evidence)", async () => {
  for (
    const t of [
      "All set ✅ your guests can use the code at checkout.",
      "It's up and running.",
      "Your discount is good to go.",
      "Guests have been notified.",
      "I've shared it with your team.",
      "Everything went through.",
      "I don do am. Your discount don dey work.",
    ]
  ) {
    assert((await guard(["Create FAVY10 10% off"], t)).rewritten, t);
  }
});
Deno.test("R3-G1 a question cannot carry a past write ('Since I've created …?')", async () => {
  for (
    const t of [
      "Since I've created FAVY10 would you like me to share it?",
      "Want me to share the code, which is now live?",
    ]
  ) {
    assert(
      (await guard(["Create a discount code FAVY10 for 10% off"], t)).rewritten,
      t,
    );
  }
});
Deno.test("R3-G2 a read answer about an existing code is never replaced by 'Nothing has been saved'", async () => {
  const r = await guard(
    ["How is FAVY10 doing?"],
    "FAVY10 has been used 12 times and brought in ₦48,000 in sales.",
    [],
    "question",
  );
  assert(!/Nothing has been saved or sent for FAVY10/.test(r.text), r.text);
  assertEquals(
    r.text,
    "FAVY10 has been used 12 times and brought in ₦48,000 in sales.",
  );
});
Deno.test("R3-G2 guide answers survive", async () => {
  for (
    const t of [
      "Once published, your event shows on Explore and people can buy tickets.",
      "Payouts are sent to your bank 3 working days after the event ends.",
    ]
  ) {
    const r = await guard(["How does publishing work?"], t, [], "question");
    assertEquals(r.text, t);
  }
});
Deno.test("R3-G2 an executed support request or reply is never told as 'nothing sent'", async () => {
  const a = await guard(
    ["Did it go through?"],
    "Your request has been sent to the team. They usually reply within a day.",
    executed("create_support_ticket", {
      subject: "Payout missing",
      message: "m",
      topic: "payouts",
    }),
    "question",
  );
  assert(!a.text.includes(TRUE_STATE_NOTHING_SAVED), a.text);
  const b = await guard(
    ["Did my reply go?"],
    "I've sent your reply on the payout request.",
    executed("manage_support_inbox", {
      action: "reply",
      ticket_id: "1b4c2c7e-0000-4000-8000-000000000001",
      content: "any update?",
    }),
    "question",
  );
  assert(!b.text.includes(TRUE_STATE_NOTHING_SAVED), b.text);
});
Deno.test("R3-G2 a write that has no card (remember_note runs inline) is never told as 'nothing saved'", async () => {
  // Runtime 09:06Z: the note was saved, the host read "I haven't saved or sent anything for that yet".
  const r = await guard(
    ["Please remember this: our doors always open at 7pm for every event."],
    "Got it, I've saved that: doors open at 7pm for every event.",
    [],
    "tool",
    [{
      tool: "remember_note",
      args: {
        scope: "brand",
        kind: "fact",
        text: "Doors always open at 7pm for every event",
      },
      result: { id: "n1" },
    }],
  );
  assert(!r.text.includes(TRUE_STATE_NOTHING_SAVED), r.text);
});
