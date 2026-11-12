/**
 * #3355 Wave A (A7) — S3 influencer_request_discount_path.
 *
 * Replays production 2026-11-10 (Lagos host, run 8a841954): the host's exact
 * request for influencer discount codes was routed into a create_event setup
 * by the keyword router and the model never saw it. Asserts on SAVED state:
 * no flow run was started in the chat, the reply is not a flow card, and Ari
 * either proposes a create_discount card or answers about discount codes.
 *
 * Deterministic twin in CI: supabase/functions/_shared/__tests__/
 * issue_3355_wave_a_understand_first.implementor.test.ts ("A1: ...").
 *
 * Mutation check: delete the `createsNonOffering` line in
 * classifyOfferingIntent (ariFlows/index.ts) and `flow runs in the chat`
 * reads 1 (create_event) — FAIL.
 */

import { artefactOf, compareFacts } from "./lib.mjs";

export const HOST_INFLUENCER_SENTENCE =
  "I want to create discount codes for influencers and marketers of my event to give their followers to get discounts when purchasing tickets";

export const meta = {
  id: "influencer_request_discount_path",
  brand: "ng",
  account: "ng_owner",
  capabilities: [],
};

export async function run(ctx) {
  const session = await ctx.session(meta.account, meta.brand, {
    timezone: "Africa/Lagos",
  });
  const reply = await session.say(HOST_INFLUENCER_SENTENCE);
  const runs = session.conversationId
    ? await ctx.rest.select(
      "ari_flow_runs",
      `select=id,flow_key,status&conversation_id=eq.${session.conversationId}`,
    )
    : [];
  const text = String(reply.text ?? "");
  return {
    state: { last: reply },
    facts: compareFacts([
      { fact: "flow runs in the chat", expected: 0, actual: runs.length },
      { fact: "no flow card", expected: null, actual: artefactOf(reply)?.step_key ?? null },
      {
        fact: "discount path",
        expected: (value) =>
          value.tool === "create_discount" || /discount|code/i.test(value.text),
        label: "a create_discount card, or an answer about discount codes",
        actual: { tool: reply.tool_name ?? null, text: text.slice(0, 160) },
      },
    ]),
  };
}
