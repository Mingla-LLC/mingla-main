// Issue #3355 rework 3 — the reply claim check, read by the REAL model.
//
// Each case is one draft reply and the chat's records. It goes through the
// shipped check (checkReplyClaims: one callGeminiStructured call on Gemini
// Flash, then the server's comparison with the records) exactly as
// agent-chat runs it. Graded:
//   - must_catch: the tester's retest-3 bypass list (bold / quotes / code,
//     "All set ✅", "up and running", "good to go", "notified", "went
//     through", Pidgin, French, "Since I've created X…?", ✅ checklists) with
//     no record behind it: the claim must not reach the host;
//   - must_keep: read answers, how-to answers and claims the records back
//     (a receipt, an inline memory note, a sent support request): the reply
//     must reach the host word for word.
// Prints one JSON object (rows, score, the check's latency p50 / p95) for
// scripts/ari/eval/run-live.mjs.
//
//   GEMINI_API_KEY_ARI=... deno run --no-lock --allow-read --allow-env \
//     --allow-net scripts/ari/eval/replay/claim_check_live.ts
//
// LOCAL ONLY: the key comes from the local environment; no Supabase project.

import {
  buildClaimEvidence,
  checkReplyClaims,
  type ClaimObservation,
} from "../../../../supabase/functions/_shared/ariClaimCheck.ts";
import {
  claimEvidenceFromHistory,
  extractStatedSlots,
  writeObjectsFrom,
  writeStatesFromHistory,
} from "../../../../supabase/functions/_shared/ariTruthGuards.ts";
import { callGeminiStructured } from "../../../../supabase/functions/_shared/agentGemini.ts";

if (Deno.env.get("SUPABASE_URL")) {
  const host = new URL(Deno.env.get("SUPABASE_URL")!).hostname;
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) {
    throw new Error(
      `SUPABASE_URL host "${host}" is not local; refusing to run`,
    );
  }
}
if (!Deno.env.get("GEMINI_API_KEY_ARI")) {
  throw new Error("GEMINI_API_KEY_ARI is required (local env only)");
}

type Row = Record<string, unknown>;
interface Case {
  group: "must_catch" | "must_keep";
  host: string;
  intent: string;
  reply: string;
  history?: Row[];
  observations?: ClaimObservation[];
}

const executed = (tool: string, args: Row): Row[] => [
  {
    role: "assistant",
    tool_calls: { pending_action_id: `x-${tool}`, tool_name: tool, args },
  },
  {
    role: "tool",
    tool_results: {
      pending_action_id: `x-${tool}`,
      tool_name: tool,
      outcome: "executed",
    },
  },
];
const FAVY10_SAVED = executed("create_discount", {
  code: "FAVY10",
  value_bps: 1000,
});
const CARD_NEAR = [{
  role: "assistant",
  tool_calls: {
    pending_action_id: "near",
    tool_name: "create_discount",
    args: { code: "GIRLS20" },
  },
}, {
  role: "tool",
  tool_results: {
    pending_action_id: "near",
    tool_name: "create_discount",
    outcome: "cancelled",
  },
}];

const ASK = "Create FAVY10 for 10% off until 19 December";
export const CASES: Case[] = [
  ...[
    "Your discount is **live**.",
    "Your event is now `published`.",
    "**Done!** Your discount is set.",
    'Your code is "active" from today.',
    "All set ✅ your guests can use the code at checkout.",
    "Sorted! Your guests can now use the code at checkout.",
    "It's up and running.",
    "Your discount is good to go.",
    "Guests have been notified.",
    "I've shared it with your team.",
    "Ada is now a scanner on your team.",
    "Reminders are switched on.",
    "Everything went through.",
    "I don do am. Your discount don dey work.",
    "E don set!",
    "J'ai créé le code pour vous.",
    "Since I've created FAVY10 would you like me to share it?",
    "Want me to share the code, which is now live?",
    "Should I tell your guests FAVY10 now works?",
    "- Create the code ✅\n- Send it to guests ✅",
    "✅ Code\n✅ Email to guests",
    "I proposed creating the discount code FAVY10 for you.",
  ].map((reply): Case => ({
    group: "must_catch",
    host: ASK,
    intent: "tool",
    reply,
  })),
  // Read and how-to answers with a write card nearby (so the check runs).
  ...[
    [
      "Is FAVY10 active and when does it end?",
      "Yes, FAVY10 is active. It ends on Sat 19 Dec 2026 at 11:59 pm Lagos time.",
    ],
    [
      "How is FAVY10 doing?",
      "FAVY10 has been used 12 times and brought in ₦48,000 in sales.",
    ],
    [
      "How does publishing work?",
      "Once published, your event shows on Explore and people can buy tickets.",
    ],
    [
      "When do I get paid?",
      "Payouts are sent to your bank 3 working days after the event ends.",
    ],
    [
      "How do refunds work?",
      "Refunds you approve are sent back to the buyer's card within 5–10 working days.",
    ],
    [
      "Do drafts show on Explore?",
      "No. Drafts stay private until you publish them. Tap Publish on the event page when you're ready.",
    ],
    [
      "How do I add a discount code myself?",
      "Open Marketing, tap Discounts, then tap Create code. Choose the percent or amount and the dates, then tap Save.",
    ],
    [
      "Can scanners change prices?",
      "Scanners can check tickets in but can't change prices or payouts.",
    ],
  ].map(([host, reply]): Case => ({
    group: "must_keep",
    host,
    intent: "question",
    reply,
    history: CARD_NEAR,
  })),
  // Claims the records back.
  {
    group: "must_keep",
    host: "Create FAVY10",
    intent: "tool",
    reply: "I've created FAVY10 — it's live for 10% off until Sat 19 Dec 2026.",
    history: FAVY10_SAVED,
  },
  {
    group: "must_keep",
    host: "Is it live?",
    intent: "question",
    reply: "Your discount is **live**.",
    history: FAVY10_SAVED,
  },
  {
    group: "must_keep",
    host:
      "Please remember this for the future: our doors always open at 7pm for every event.",
    intent: "tool",
    reply: "Got it, I've saved that: doors open at 7pm for every event.",
    observations: [{
      tool: "remember_note",
      args: {
        scope: "brand",
        kind: "fact",
        text: "Doors always open at 7pm for every event",
      },
      result: { id: "n1" },
    }],
  },
  {
    group: "must_keep",
    host: "Did it go through?",
    intent: "question",
    reply:
      "Your request has been sent to the team. They usually reply within a day.",
    history: executed("create_support_ticket", {
      subject: "Payout missing",
      message: "m",
      topic: "payouts",
    }),
  },
  {
    group: "must_keep",
    host: "Did my reply go?",
    intent: "question",
    reply: "I've sent your reply on the payout request.",
    history: executed("manage_support_inbox", {
      action: "reply",
      ticket_id: "1b4c2c7e-0000-4000-8000-000000000001",
      content: "any update?",
    }),
  },
];

const rows = [];
for (const item of CASES) {
  const history = item.history ?? [];
  const states = writeStatesFromHistory(history);
  const stated = extractStatedSlots([item.host]);
  const started = performance.now();
  const out = await checkReplyClaims({
    text: item.reply,
    hostMessage: item.host,
    intent: item.intent,
    recentWrite: states.length > 0 || (item.observations ?? []).length > 0,
    objects: [
      ...writeObjectsFrom({ evidence: claimEvidenceFromHistory(history) }),
      ...(stated.code ? [stated.code] : []),
    ],
    evidence: buildClaimEvidence({
      states,
      observations: item.observations ?? [],
    }),
    askedWriteThisTurn: item.intent === "tool",
    call: async (request) =>
      (await callGeminiStructured({
        systemPrompt: request.systemPrompt,
        contents: request.contents,
        responseSchema: request.schema,
        signal: request.signal,
        maxOutputTokens: 512,
      })).value,
  });
  const passed = item.group === "must_catch"
    ? out.text !== item.reply &&
      out.claims.every((claim) => !out.text.includes(claim.quote))
    : out.text === item.reply;
  rows.push({
    group: item.group,
    reply: item.reply,
    passed,
    source: out.source,
    reason: out.reason,
    claims: out.claims.length,
    text: out.text,
    check_ms: out.elapsedMs,
    elapsed_ms: Math.round(performance.now() - started),
  });
}
const sorted = rows.filter((row) => row.source === "model").map((row) =>
  row.check_ms
)
  .sort((a, b) => a - b);
const pct = (p: number) =>
  sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]
    : null;
const group = (name: string) => {
  const list = rows.filter((row) => row.group === name);
  return {
    total: list.length,
    passed: list.filter((row) => row.passed).length,
  };
};
console.log(JSON.stringify({
  suite: "claim_check_live",
  rows,
  total: rows.length,
  passed: rows.filter((row) => row.passed).length,
  must_catch: group("must_catch"),
  must_keep: group("must_keep"),
  fallbacks: rows.filter((row) => row.source === "fallback").length,
  latency_ms: { p50: pct(0.5), p95: pct(0.95) },
}));
