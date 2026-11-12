/**
 * #3355 Wave A (A7) — S4 favy10_mid_flow_ends_at.
 *
 * Replays production 2026-11-10: with an event setup open, the host typed
 * "Create a discount code for me using "FAVY10" as the code and 10% off this
 * code and let it run from now until 19th of December 2026." and got "I
 * didn't catch that as an answer to this step" twice; the code later saved
 * had no end date. Asserts on SAVED state: the event run is parked (not
 * cancelled, not answered), and the one proposal is create_discount with
 * code FAVY10, 10% (1000 bps) and ends_at 2026-12-19T22:59:59Z (23:59:59 on
 * 19 December in Africa/Lagos). The proposal is cancelled, so nothing is
 * written.
 *
 * Deterministic twins in CI: issue_3355_wave_a_understand_first ("A2
 * replay ...") and issue_3355_wave_a_truth_guards ("A6b ...").
 *
 * Mutation check: delete the park branch in runner.ts (the
 * `parkOrPass(request ?? "repeated")` call) and `run status` reads
 * awaiting_owner with "I didn't catch that" — FAIL; delete the ends_at bind in
 * checkStatedSlots (ariTruthGuards.ts) and `ends_at` reads null — FAIL.
 */

import { artefactOf, compareFacts } from "./lib.mjs";

export const HOST_FAVY10_SENTENCE =
  'Create a discount code for me using "FAVY10" as the code and 10% off this code and let it run from now until 19th of December 2026.';

export const meta = {
  id: "favy10_mid_flow_ends_at",
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
  const typed = await session.say(HOST_FAVY10_SENTENCE);
  const runs = await ctx.rest.select(
    "ari_flow_runs",
    `select=id,flow_key,status&conversation_id=eq.${session.conversationId}`,
  );
  const pending = await ctx.rest.select(
    "agent_pending_actions",
    `select=id,tool_name,tool_args,status&conversation_id=eq.${session.conversationId}&status=eq.pending`,
  );
  const proposal = pending.find((row) => row.tool_name === "create_discount");
  // Nothing is written: the proposal is cancelled, never confirmed.
  for (const row of pending) {
    await ctx.rest.update("agent_pending_actions", `id=eq.${row.id}`, {
      status: "cancelled",
      failure_reason: "EVAL_CLEANUP",
    });
  }
  return {
    state: { last: typed },
    facts: compareFacts([
      { fact: "an event card was open", expected: true, actual: !!card },
      {
        fact: "run status",
        expected: "parked",
        actual: runs.find((row) => row.flow_key === "create_event")?.status ?? null,
      },
      {
        fact: "never 'I didn't catch that'",
        expected: (value) => !/didn't catch that/i.test(value),
        label: "no waiting text",
        actual: String(typed.text ?? ""),
      },
      { fact: "proposal tool", expected: "create_discount", actual: proposal?.tool_name ?? null },
      { fact: "code", expected: "FAVY10", actual: proposal?.tool_args?.code ?? null },
      { fact: "value_bps", expected: 1000, actual: proposal?.tool_args?.value_bps ?? null },
      {
        fact: "ends_at",
        expected: "2026-12-19T22:59:59Z",
        actual: proposal?.tool_args?.ends_at ?? null,
      },
    ]),
  };
}
