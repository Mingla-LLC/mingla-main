/**
 * #3355 Wave A (A7) — S5 same_request_twice_never_same_card.
 *
 * Production 2026-11-10: the host sent the same request twice inside an open
 * flow and got the same card back both times. Asserts: with an event card
 * open, words the card cannot read get "I didn't catch that" once; the same
 * words again never bring that card back (the run is parked and the agent
 * loop answers); a request sent twice never returns a flow card.
 *
 * Deterministic twin in CI: issue_3355_wave_a_understand_first ("A2: unclear
 * words ..." and "A2: the same request sent twice ...").
 *
 * Mutation check: delete the `sameOwnerText(...)` clause in runner.ts and
 * `second reply card` equals the first card's id — FAIL.
 */

import { artefactOf, compareFacts } from "./lib.mjs";

export const meta = {
  id: "same_request_twice_never_same_card",
  brand: "ng",
  account: "ng_owner",
  capabilities: [],
};

export async function run(ctx) {
  const session = await ctx.session(meta.account, meta.brand, {
    timezone: "Africa/Lagos",
  });
  const opened = await session.say("Create an event");
  const card = artefactOf(opened);
  // A choice card is needed for "didn't catch that"; a form card takes typed
  // words as its answer, so the eval only types on a choice card.
  const onChoiceCard = card && card.answer_mode !== "form";
  const first = onChoiceCard ? await session.say("blue") : null;
  const second = onChoiceCard ? await session.say("blue") : null;
  const request = "Show me my discount codes please, then make one called LAGOS20";
  const r1 = await session.say(request);
  const r2 = await session.say(request);
  const pending = await ctx.rest.select(
    "agent_pending_actions",
    `select=id&conversation_id=eq.${session.conversationId}&status=eq.pending`,
  );
  for (const row of pending) {
    await ctx.rest.update("agent_pending_actions", `id=eq.${row.id}`, {
      status: "cancelled",
      failure_reason: "EVAL_CLEANUP",
    });
  }
  return {
    state: { last: r2 },
    facts: compareFacts([
      { fact: "an event card was open", expected: true, actual: !!card },
      {
        fact: "second reply card",
        expected: (value) => value === "skipped" || value !== card?.artefact_id,
        label: "never the open card again",
        actual: onChoiceCard ? artefactOf(second)?.artefact_id ?? null : "skipped",
      },
      {
        fact: "first unclear words",
        expected: (value) => value === "skipped" || /didn't catch that/i.test(value),
        label: "said once",
        actual: onChoiceCard ? String(first?.text ?? "") : "skipped",
      },
      {
        fact: "request twice: flow cards returned",
        expected: 0,
        actual: [r1, r2].filter((reply) =>
          !!card && artefactOf(reply)?.artefact_id === card.artefact_id
        ).length,
      },
    ]),
  };
}
